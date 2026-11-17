// #66: the Ask box streams the owner assistant's answer as newline-delimited JSON events (steps, text, done).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vera', 'viewer password 123');
after(() => t.close());

/** POST the question; returns { status, type, events } with every line parsed (chunks arrive as they are written). */
async function stream(cookie, question) {
  const r = await fetch(`${t.base}/api/owner/ask/stream`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
  const type = r.headers.get('content-type') || '';
  if (!type.startsWith('application/x-ndjson')) return { status: r.status, type, body: await r.json() };
  const events = []; let buf = ''; let chunks = 0;
  const dec = new TextDecoder();
  for await (const c of r.body) { chunks++; buf += dec.decode(c, { stream: true }); }
  for (const line of buf.split('\n')) if (line.trim()) events.push(JSON.parse(line));
  return { status: r.status, type, events, chunks, cache: r.headers.get('cache-control') };
}

test('#66: steps, interim text and the final answer, in order; the result matches the plain Ask', async () => {
  t.script.push(
    [{ type: 'text', text: 'Let me look at the chats.' }, { type: 'tool_use', id: 'v1', name: 'list_visible_chats', input: {} }],
    [{ type: 'tool_use', id: 'v2', name: 'search_messages', input: { query: 'train secret words' } }],
    [{ type: 'text', text: 'Anu said 9:10.' }],
  );
  const r = await stream(owner, 'who talked about the train?');
  assert.equal(r.status, 200);
  assert.equal(r.cache, 'no-store');
  const kinds = r.events.map((e) => (e.type === 'step' ? `${e.step}${e.tool ? `:${e.tool}` : ''}` : e.type));
  assert.deepEqual(kinds.filter((k) => k !== 'delta'), ['thinking', 'text', 'tool:list_visible_chats', 'thinking', 'tool:search_messages', 'thinking', 'text', 'done']);
  assert.equal(r.events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Let me look at the chats.Anu said 9:10.', '047: token deltas add up to the text');
  const texts = r.events.filter((e) => e.type === 'text');
  assert.equal(texts[0].text, 'Let me look at the chats.');
  assert.equal(texts[0].final, false);
  assert.equal(r.events.at(-2).final, true);
  const done = r.events.at(-1);
  assert.equal(done.reply, 'Anu said 9:10.');
  assert.deepEqual(done.confirms, []);
  assert.ok(r.events.filter((e) => e.step === 'tool').every((e) => e.ok === true));
  // steps carry tool names only: no arguments, no tool results, no message contents
  assert.doesNotMatch(JSON.stringify(r.events.slice(0, -1)), /secret words|query/);
  // the conversation is remembered like the plain Ask
  const hist = (await t.api(owner, 'GET', '/api/owner/ask/history')).body;
  assert.deepEqual(hist.slice(-2).map((m) => m.text), ['who talked about the train?', 'Anu said 9:10.']);
});

test('#66: a change is held for Confirm (step "held"), and the panel Confirm still applies it', async () => {
  t.script.push([{ type: 'tool_use', id: 'h1', name: 'set_agent_enabled', input: { agent_id: 'helper', enabled: false } }], [{ type: 'text', text: 'Ready to switch it off.' }]);
  const r = await stream(owner, 'turn the helper off');
  const held = r.events.find((e) => e.step === 'held');
  assert.equal(held.tool, 'set_agent_enabled');
  const done = r.events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.confirms.length, 1);
  assert.equal(t.agents.getAgent('helper').enabled, true, 'not done before Confirm');
  assert.match((await t.api(owner, 'POST', '/api/owner/ask/confirm', { code: done.confirms[0].code })).body.reply, /^Done/);
  assert.equal(t.agents.getAgent('helper').enabled, false);
  await t.api(owner, 'PUT', '/api/agents/helper', { enabled: true });
});

test('#66: a failing tool shows as a failed step; a model error ends with the friendly reply', async () => {
  t.script.push([{ type: 'tool_use', id: 'f1', name: 'no_such_tool', input: {} }], [{ type: 'text', text: 'Could not.' }]);
  const r = await stream(owner, 'do the impossible');
  assert.deepEqual(r.events.find((e) => e.step === 'tool'), { type: 'step', step: 'tool', tool: 'no_such_tool', ok: false });
  assert.equal(r.events.at(-1).reply, 'Could not.');

  t.claudeFail.push({ status: 500 });
  const e = await stream(owner, 'hello?');
  assert.equal(e.events.at(-1).type, 'done');
  assert.ok(e.events.at(-1).reply.length > 0);
});

test('#66: roles, empty questions and sign-in are checked before the stream starts', async () => {
  t.script.push([{ type: 'tool_use', id: 'r1', name: 'set_agent_enabled', input: { agent_id: 'helper', enabled: false } }], [{ type: 'text', text: 'no' }]);
  const v = await stream(viewer, 'turn the helper off');
  assert.equal(v.status, 200);
  assert.ok(!v.events.some((e) => e.step === 'held'), 'viewers never get change tools');
  const empty = await stream(owner, '   ');
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /Ask a question/);
  const anon = await fetch(`${t.base}/api/owner/ask/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"question":"hi"}' });
  assert.equal(anon.status, 401);
  const form = await fetch(`${t.base}/api/owner/ask/stream`, { method: 'POST', headers: { cookie: owner, 'content-type': 'text/plain' }, body: 'question=hi' });
  assert.equal(form.status, 415, 'JSON only (CSRF guard)');
});

test('066: Stop closes the stream: the model call ends, no further tool or round runs, the partial answer is kept', async () => {
  const reqs = t.claudeReqs.length;
  const toolRuns = () => t.db.listActivity({ limit: 200 }).filter((a) => a.type === 'owner.tool').length;
  const runs = toolRuns();
  t.claudeStreamFail.push({ after: 3, hang: true });
  t.script.push(
    [{ type: 'text', text: 'Let me look at the chats first, one moment.' }, { type: 'tool_use', id: 's1', name: 'list_visible_chats', input: {} }],
    [{ type: 'text', text: 'This round never runs.' }],
  );
  const stop = new AbortController();
  const r = await fetch(`${t.base}/api/owner/ask/stream`, { method: 'POST', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ question: 'stop me' }), signal: stop.signal });
  const dec = new TextDecoder(); let buf = '';
  try { for await (const c of r.body) { buf += dec.decode(c, { stream: true }); if (buf.includes('"delta"')) stop.abort(); } } catch { /* aborted */ }
  let last = null;
  for (let i = 0; i < 50 && !/Stopped/.test(last?.text || ''); i++) {
    await new Promise((res) => setTimeout(res, 50));
    last = (await t.api(owner, 'GET', '/api/owner/ask/history?limit=2')).body.at(-1);
  }
  assert.equal(last.role, 'assistant');
  assert.match(last.text, /^Let me\b.*\n\n\(Stopped\.\)$/s, 'partial text, then the stop note');
  assert.equal(t.claudeReqs.length - reqs, 1, 'no second round');
  assert.equal(t.script.length, 1, 'the next round was never asked'); t.script.length = 0;
  assert.equal(toolRuns(), runs, 'the tool did not run');
  const { accountState } = await import('../src/core/providers/breaker.js');
  assert.equal(accountState('anthropic').state, 'ok', 'Stop does not pause the account');
});
