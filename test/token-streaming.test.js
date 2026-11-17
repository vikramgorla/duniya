// 047 (#83): token-by-token streaming of the owner assistant's text in the Ask box. Fake streaming providers only:
// the fake Claude API answers `stream: true` with Anthropic SSE events, fakeChatProvider with Chat Completions chunks.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, fakeChatProvider } from './harness.js';

const alpha = fakeChatProvider({ name: 'alpha', models: ['fake-large', 'fake-mini'] });
let t; let owner; let breaker;

// Fake ChatGPT Responses endpoint (stream: true): output_text deltas, then the completed response.
const cg = { reqs: 0, items: null };
const chatgptHttp = http.createServer(async (req, res) => {
  for await (const c of req) void c;
  cg.reqs++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
  for (const d of ['Puja ', 'at ', '10:00.']) ev({ type: 'response.output_text.delta', delta: d });
  const items = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Puja at 10:00.' }] }];
  for (const item of items) ev({ type: 'response.output_item.done', item });
  ev({ type: 'response.completed', response: { output: items, usage: { input_tokens: 5, output_tokens: 3 } } });
  res.end();
}).listen(0);

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
  owner = await t.login();
  breaker = await import('../src/core/providers/breaker.js');
  const r = await t.api(owner, 'POST', '/api/providers/compatible', { id: 'alpha', name: 'alpha', baseUrl: alpha.url(), key: 'ka' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await t.api(owner, 'GET', '/api/providers?refresh=1');
});
after(() => { alpha.close(); chatgptHttp.close(); t.close(); });
beforeEach(async () => {
  breaker.reset(); breaker.resetSwitches(); breaker.resetAllFailedAlert();
  t.claudeFail.length = 0; t.claudeStreamFail.length = 0; t.script.length = 0;
  Object.assign(alpha, { fail: {}, streamFail: [], refuseStream: false }); alpha.script.length = 0;
  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { model: 'auto' });
});

async function stream(question) {
  const r = await fetch(`${t.base}/api/owner/ask/stream`, { method: 'POST', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
  assert.equal(r.status, 200);
  const events = []; let buf = '';
  const dec = new TextDecoder();
  for await (const c of r.body) buf += dec.decode(c, { stream: true });
  for (const line of buf.split('\n')) if (line.trim()) events.push(JSON.parse(line));
  return events;
}
const kinds = (events) => events.map((e) => (e.type === 'step' ? e.step : e.type)).filter((k, i, a) => !(k === 'delta' && a[i - 1] === 'delta'));
const deltas = (events) => events.filter((e) => e.type === 'delta').map((e) => e.text);
const usageRows = () => t.db.db.prepare("SELECT * FROM usage WHERE kind = 'owner' ORDER BY id").all();

test('047: Anthropic streams the text token by token; the whole text and the reply follow; usage recorded once', async () => {
  const before = usageRows().length; const streamsBefore = t.claudeStreams;
  t.script.push(
    [{ type: 'text', text: 'Let me look at the chats.' }, { type: 'tool_use', id: 'v1', name: 'list_visible_chats', input: { days: 3 } }],
    [{ type: 'text', text: 'Anu said the train leaves at 9:10.' }],
  );
  const ev = await stream('who talked about the train?');
  assert.deepEqual(kinds(ev), ['thinking', 'delta', 'text', 'tool', 'thinking', 'delta', 'text', 'done']);
  const ds = deltas(ev);
  assert.ok(ds.length >= 10, `many small pieces, got ${ds.length}`);
  assert.equal(ds.join(''), 'Let me look at the chats.Anu said the train leaves at 9:10.');
  assert.equal(ev.at(-1).reply, 'Anu said the train leaves at 9:10.');
  assert.equal(ev.find((e) => e.type === 'step' && e.step === 'tool').ok, true, 'tool input assembled from the streamed JSON');
  assert.equal(t.claudeStreams - streamsBefore, 2);
  const rows = usageRows().slice(before);
  assert.equal(rows.length, 2, 'one usage row per model call');
  assert.deepEqual(rows.map((r) => [r.provider, r.input, r.output]), [['anthropic', 3, 2], ['anthropic', 3, 2]], 'from the final usage events');
});

test('047: the plain Ask and WhatsApp replies are not streamed', async () => {
  const streamsBefore = t.claudeStreams;
  t.script.push([{ type: 'text', text: 'Hello there.' }]);
  assert.equal((await t.api(owner, 'POST', '/api/owner/ask', { question: 'hi' })).body.reply, 'Hello there.');
  t.script.push([{ type: 'text', text: 'Hi group.' }]);
  await t.route(t.msg({ text: '!help hello', chat: 'g2@g.us', phone: '41790000001' }));
  await t.waitFor(() => t.sent.some((s) => s.text.includes('Hi group.')));
  assert.equal(t.claudeStreams, streamsBefore);
  assert.ok(!t.claudeReqs.slice(-2).some((b) => b.stream), 'no stream flag in the requests');
});

test('047: a stream that fails before its first token falls back as usual; only the answering account streams', async () => {
  t.claudeFail.push({ status: 529, message: 'Overloaded' });
  const ev = await stream('hello?');
  assert.ok(!ev.some((e) => e.type === 'restarted'));
  assert.equal(deltas(ev).join(''), 'alpha (ka) says hi');
  assert.equal(ev.at(-1).reply, 'alpha (ka) says hi');
  assert.equal(alpha.reqs.at(-1).body.stream, true);
  assert.deepEqual(alpha.reqs.at(-1).body.stream_options, { include_usage: true });
  const row = usageRows().at(-1);
  assert.deepEqual([row.account, row.input, row.output], ['alpha', 4, 3]);
  assert.match(row.fallback, /after Claude/);
});

test('047: a stream that breaks mid-way: "restarted", the same account once more without streaming, full text', async () => {
  const before = usageRows().length;
  t.claudeStreamFail.push({ after: 3, network: true });
  t.script.push([{ type: 'text', text: 'The families chose the 9:10 train on Saturday.' }], [{ type: 'text', text: 'The families chose the 9:10 train on Saturday.' }]);
  const ev = await stream('what was decided?');
  assert.deepEqual(kinds(ev), ['thinking', 'delta', 'restarted', 'text', 'done']);
  assert.equal(deltas(ev).length, 3, 'partial text before the break');
  const r = ev.find((e) => e.type === 'restarted');
  assert.deepEqual(Object.keys(r).sort(), ['reason', 'type'], 'a reason code only, no message text');
  assert.equal(r.reason, 'network');
  assert.equal(ev.at(-1).reply, 'The families chose the 9:10 train on Saturday.');
  assert.equal(t.claudeReqs.at(-1).stream, undefined, 'the retry is not streamed');
  assert.equal(breaker.accountState('anthropic').state, 'ok', 'the retry answered: no pause');
  assert.equal(usageRows().length - before, 1, 'usage of the answer that was returned');
});

test('047: mid-stream error event, and the retry fails too: the chain continues without streaming', async () => {
  const streams = alpha.streams;
  t.claudeStreamFail.push({ after: 2, error: { type: 'overloaded_error', message: 'Overloaded' } });
  t.claudeFail.push(null, { status: 500 }); // the streamed request starts fine (null), the plain retry fails
  t.script.push([{ type: 'text', text: 'one two three four five' }]);
  const ev = await stream('status?');
  assert.deepEqual(kinds(ev), ['thinking', 'delta', 'restarted', 'text', 'done']);
  assert.equal(ev.find((e) => e.type === 'restarted').reason, 'server');
  assert.equal(ev.at(-1).reply, 'alpha (ka) says hi');
  assert.equal(alpha.streams, streams, 'the fallback account was asked without streaming');
  assert.equal(alpha.reqs.at(-1).body.stream, undefined);
});

test('047: OpenAI-compatible SSE: tool calls joined from chunks, text streamed, usage from the last chunk', async () => {
  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { model: 'alpha:fake-large' });
  const before = usageRows().length;
  alpha.script.push(
    { content: 'Checking.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_visible_chats', arguments: '{"days":7}' } }] },
    { content: 'Two chats are on.' },
  );
  const ev = await stream('which chats are on?');
  assert.deepEqual(kinds(ev), ['thinking', 'delta', 'text', 'tool', 'thinking', 'delta', 'text', 'done']);
  assert.equal(ev.find((e) => e.type === 'step' && e.step === 'tool').ok, true);
  assert.equal(deltas(ev).join(''), 'Checking.Two chats are on.');
  assert.equal(ev.at(-1).reply, 'Two chats are on.');
  const msgs = alpha.reqs.at(-1).body.messages;
  assert.deepEqual(JSON.parse(msgs.find((m) => m.tool_calls).tool_calls[0].function.arguments), { days: 7 });
  assert.deepEqual(usageRows().slice(before).map((r) => [r.account, r.input, r.output]), [['alpha', 4, 3], ['alpha', 4, 3]]);
});

test('047: OpenAI-compatible mid-stream drop restarts on the same account; a server without streaming answers whole', async () => {
  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { model: 'alpha:fake-large' });
  alpha.streamFail.push({ after: 1, network: true });
  alpha.script.push({ content: 'first try that breaks' }, { content: 'second try, whole' });
  const ev = await stream('again?');
  assert.deepEqual(kinds(ev), ['thinking', 'delta', 'restarted', 'text', 'done']);
  assert.equal(ev.find((e) => e.type === 'restarted').reason, 'network');
  assert.equal(ev.at(-1).reply, 'second try, whole');

  alpha.refuseStream = true;
  alpha.script.push({ content: 'no streaming here' });
  const ev2 = await stream('plain?');
  assert.deepEqual(kinds(ev2), ['thinking', 'text', 'done'], 'a 400 for stream: asked again without it, no restart');
  assert.equal(ev2.at(-1).reply, 'no streaming here');
  assert.equal(alpha.reqs.at(-1).body.stream, undefined);
});

test('047: provider layer: onText from ChatGPT Responses deltas; a JSON answer to a streamed request still works', async () => {
  const chatgpt = await import('../src/core/providers/chatgpt.js');
  const { readChatStream } = await import('../src/core/providers/openai-chat.js');
  process.env.OPENAI_API_BASE = `http://127.0.0.1:${chatgptHttp.address().port}/v1`;
  t.store.setSecret('PROVIDER_CHATGPT_TEST_CREDENTIALS', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3600000 }));
  const got = [];
  const res = await chatgpt.chatgptAdapter('PROVIDER_CHATGPT_TEST_CREDENTIALS').chat({ model: 'gpt-x', system: 's', messages: [{ role: 'user', content: 'when?' }], onText: (d) => got.push(d) });
  assert.deepEqual(got, ['Puja ', 'at ', '10:00.']);
  assert.equal(res.content[0].text, 'Puja at 10:00.');
  assert.deepEqual(res.usage, { input_tokens: 5, output_tokens: 3 });
  delete process.env.OPENAI_API_BASE;

  const pieces = [];
  const json = await readChatStream(new Response(JSON.stringify({ choices: [{ message: { content: 'whole' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }), (d) => pieces.push(d));
  assert.deepEqual(pieces, ['whole']);
  assert.equal(json.choices[0].message.content, 'whole');
  await assert.rejects(readChatStream(new Response('data: {"choices":[{"delta":{"content":"cut"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } }), () => {}), /ended before completion/);
});
