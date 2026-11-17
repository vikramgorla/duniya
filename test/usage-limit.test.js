// A provider's usage limit (#144, #146): when ChatGPT says the plan's usage limit is reached, the account pauses until
// the reset it reports, the fallback answers and Activity says why. Duniya shows no plan quota (#146): only this pause.
// Fakes only: a fake ChatGPT backend (Responses API) and the fake Claude API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup } from './harness.js';

// Fake ChatGPT backend; `cg.fail` queues refusals.
const cg = { fail: [] };
cg.server = http.createServer(async (req, res) => {
  for await (const _ of req) { /* drain the request */ }
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ slug: 'gpt-x', display_name: 'GPT X' }] })); }
  const f = cg.fail.shift();
  if (f) { res.writeHead(f.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: f.error })); }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const item = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'chatgpt says hi' }] };
  ev({ type: 'response.output_item.done', item });
  ev({ type: 'response.completed', response: { output: [item], usage: { input_tokens: 5, output_tokens: 2 } } });
  res.end();
}).listen(0);

let t; let owner; let breaker;
const H = 3600000;

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' }, beforeImport: () => { process.env.OPENAI_API_BASE = `http://127.0.0.1:${cg.server.address().port}/v1`; } });
  owner = await t.login();
  breaker = await import('../src/core/providers/breaker.js');
  t.store.setSecret('CHATGPT_CREDENTIALS', JSON.stringify({ access_token: 'cg-token', refresh_token: 'r', expires_at: Date.now() + 30 * 24 * H, email: 'me@example.org', client_id: 'c', scopes: [] }));
});
after(() => { cg.server.close(); t.close(); });

test('ChatGPT: a usage-limit error pauses the account until the reset it reports and the fallback answers', async () => {
  await t.agents.updateAgent('panduga', { model: 'chatgpt:gpt-x' });
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.equal(t.sent.at(-1).text, 'chatgpt says hi');
  const p = (await t.api(owner, 'GET', '/api/providers')).body.find((x) => x.id === 'chatgpt');
  assert.equal(p.connected, true);
  assert.equal(p.usage, undefined, 'no plan quota is shown');
  // used up: ChatGPT refuses with the reset time; Claude answers; the account waits for that reset
  cg.fail.push({ status: 429, error: { code: 'usage_limit_reached', type: 'usage_limit_reached', message: 'The usage limit has been reached', resets_in_seconds: 7200 } });
  t.script.push([{ type: 'text', text: 'claude answers' }]);
  await t.route(t.msg({ text: '!panduga again' }));
  assert.equal(t.sent.at(-1).text, 'claude answers');
  const h = breaker.accountState('chatgpt');
  assert.equal(h.state, 'paused');
  assert.ok(h.until > Date.now() + 1.9 * H && h.until < Date.now() + 2.1 * H, 'waits for the reported reset');
  assert.match(h.text, /^Paused until \d\d:\d\d — usage limit reached$/);
  assert.ok(t.db.listActivity({ limit: 50 }).some((a) => a.type === 'model.fallback' && /after ChatGPT.* failed \(usage limit reached\)/.test(a.summary)));
});
