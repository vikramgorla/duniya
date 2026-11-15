/// <reference types="node" />
// #66: streamed Ask answers in the app — NDJSON parsing, readable and non-readable bodies, the client's stream().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, applyAskEvent, createClient, ndjsonReader, readStream, stepLabel, toolWords, type AskProgress, type BodyReader, type Session, type StreamEvent } from './api-core.ts';

const enc = new TextEncoder();
const EVENTS = [
  { type: 'step', step: 'thinking', round: 0 }, { type: 'text', text: 'Let me look.', final: false }, { type: 'ping' },
  { type: 'step', step: 'tool', tool: 'chat_recap', ok: true }, { type: 'step', step: 'held', tool: 'set_agent_enabled', ok: true },
  { type: 'done', reply: 'Anu said 9:10.', confirms: [{ code: 'H4M9', preview: 'Turn off helper' }] },
];
const NDJSON = EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n';
/** A body that hands out the text in awkward pieces (split inside lines and inside a multi-byte character). */
function chunked(text: string, size: number): { getReader(): BodyReader } {
  const bytes = enc.encode(text); let i = 0;
  return { getReader: () => ({ read: async () => (i >= bytes.length ? { done: true } : { done: false, value: bytes.slice(i, (i += size)) }) }) };
}

test('ndjson: lines across chunks, pings dropped, bad lines skipped, done returned', () => {
  const seen: StreamEvent[] = [];
  const r = ndjsonReader((e) => seen.push(e));
  r.push('not json\n'); r.push(NDJSON.slice(0, 7)); r.push(NDJSON.slice(7, 60)); r.push(NDJSON.slice(60));
  const done = r.end();
  assert.deepEqual(seen.map((e) => e.type), ['step', 'text', 'step', 'step']);
  assert.equal(done.reply, 'Anu said 9:10.');
});

test('ndjson: an error event rejects with its status; a stream without done is "cut off"', () => {
  const r = ndjsonReader(() => {});
  assert.throws(() => r.push('{"type":"error","error":"The owner assistant is not ready yet","status":503}\n'), (e: ApiError) => e.status === 503 && /not ready/.test(e.message));
  const cut = ndjsonReader(() => {});
  cut.push('{"type":"step","step":"thinking"}\n');
  assert.throws(() => cut.end(), /cut off/);
});

test('readStream: readable body chunk by chunk (with é split across chunks), or the whole text at the end', async () => {
  const text = NDJSON.replace('Let me look.', 'Je regarde, Vedika: é');
  for (const size of [1, 5, 64, 10_000]) {
    const seen: StreamEvent[] = [];
    const done = await readStream({ text: async () => '', body: chunked(text, size) }, (e) => seen.push(e));
    assert.equal(seen[1].text, 'Je regarde, Vedika: é', `size ${size}`);
    assert.equal(done.confirms.length, 1);
  }
  const seen: StreamEvent[] = [];
  const done = await readStream({ text: async () => NDJSON, body: null }, (e) => seen.push(e));
  assert.equal(seen.length, 4);
  assert.equal(done.reply, 'Anu said 9:10.');
});

test('client.stream: Bearer + NDJSON accept, refresh after 401, server errors as ApiError', async () => {
  let session: Session = { server: 'https://s', accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 3600_000 };
  const calls: string[] = [];
  const res = (status: number, body: string, stream = false) => ({ ok: status < 400, status, json: async () => JSON.parse(body), text: async () => body, body: stream ? chunked(body, 9) : null });
  const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push(`${init?.method} ${url} ${init?.headers?.authorization || ''} ${init?.headers?.accept || ''}`);
    if (url.endsWith('/oauth/token')) return res(200, JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }));
    return res(200, '{}');
  };
  const streamFetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push(`stream ${init?.method} ${url} ${init?.headers?.authorization} ${init?.headers?.accept} ${init?.body}`);
    if (init?.headers?.authorization === 'Bearer a1') return res(401, '{"error":"expired"}');
    if (JSON.parse(init?.body || '{}').question === 'forbidden') return res(403, '{"error":"Read-only account"}');
    return res(200, NDJSON, true);
  };
  const api = createClient({ getSession: () => session, saveTokens: (t) => { session = { ...session, ...t }; }, onSignedOut: () => {}, fetchFn, streamFetchFn });
  const seen: StreamEvent[] = [];
  const done = await api.stream<{ reply: string }>('/api/owner/ask/stream', { question: 'who?' }, (e) => seen.push(e));
  assert.equal(done.reply, 'Anu said 9:10.');
  assert.equal(seen.length, 4);
  assert.ok(calls.some((c) => c.startsWith('POST https://s/oauth/token')), 'refreshed');
  assert.equal(calls.at(-1), 'stream POST https://s/api/owner/ask/stream Bearer a2 application/x-ndjson {"question":"who?"}');
  await assert.rejects(api.stream('/api/owner/ask/stream', { question: 'forbidden' }, () => {}), (e: ApiError) => e.status === 403 && e.message === 'Read-only account');
});

test('Ask progress: steps and latest text from events; short labels without arguments', () => {
  let p: AskProgress = { steps: [], text: '' };
  for (const e of EVENTS) p = applyAskEvent(p, e);
  p = applyAskEvent(p, { type: 'step', step: 'tool', tool: 'list_usage', ok: false });
  p = applyAskEvent(p, { type: 'step', step: 'weird' });
  assert.equal(p.text, 'Let me look.');
  assert.equal(p.steps[0].step, 'thinking');
  assert.deepEqual(p.steps.slice(1).map(stepLabel), ['✓ chat recap', '⏸ change held: set agent enabled', '✕ usage failed']);
  assert.equal(toolWords('get_owner_assistant'), 'owner assistant');
  assert.equal(toolWords('search_messages'), 'search messages');
});

test('#83: text deltas are appended, a new round starts a new text, "restarted" drops the partial text', () => {
  let p: AskProgress = { steps: [], text: '' };
  const run = (events: StreamEvent[]) => { for (const e of events) p = applyAskEvent(p, e); return p.text; };
  assert.equal(run([{ type: 'step', step: 'thinking' }, { type: 'delta', text: 'Let ' }, { type: 'delta', text: 'me ' }]), 'Let me ');
  assert.equal(run([{ type: 'delta', text: 'look.' }, { type: 'text', text: 'Let me look.', final: false }]), 'Let me look.');
  assert.equal(run([{ type: 'step', step: 'tool', tool: 'chat_recap', ok: true }, { type: 'step', step: 'thinking' }]), 'Let me look.', 'interim text stays until the next round writes');
  assert.equal(run([{ type: 'delta', text: 'Anu ' }]), 'Anu ', 'the first delta of a round replaces it');
  assert.equal(run([{ type: 'delta', text: 'said' }, { type: 'restarted', reason: 'network' }]), '');
  assert.equal(p.restarted, true);
  assert.equal(run([{ type: 'text', text: 'Anu said 9:10.', final: true }]), 'Anu said 9:10.', 'the whole text wins');
  assert.equal(p.restarted, false, 'the note ends with the restarted round');
  assert.deepEqual(p.steps.map((s) => s.step), ['thinking', 'tool', 'thinking'], 'deltas and restarts are not steps');
});
