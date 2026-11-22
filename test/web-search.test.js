// 2.58: Web search — agents use their AI provider's built-in web search (a module, on by default); who may search is
// the usual per-role tool rules; providers without it never get it; searches are priced under Usage; links are plain.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fakeChatProvider } from './harness.js';

const alt = fakeChatProvider({ name: 'alt' });
const t = await setup();
const owner = await t.login();
after(() => { alt.close(); t.close(); });

const ask = (text, o = {}) => t.route(t.msg({ chat: 'g1@g.us', text: `!panduga ${text}`, phone: '41790000002', senderName: 'Anu', ...o }));
const searchTool = (n) => (t.claudeReqs[n].tools || []).find((x) => x.type?.startsWith('web_search'));
const answer = (text, extra = {}) => ({ content: [{ type: 'text', text }], ...extra });

test('on by default: the agent gets the provider\'s web search (at most 3 per call); the answer cites a page', async () => {
  const n = t.claudeReqs.length;
  t.script.push(answer('The pool opens at 9:00 on Sundays.', { usage: { server_tool_use: { web_search_requests: 2 } } }));
  t.script.at(-1).content[0].citations = [{ type: 'web_search_result_location', url: 'https://pool.example/hours', title: 'Hours' }];
  await ask('when does the pool open on Sunday?');
  assert.deepEqual(searchTool(n), { type: 'web_search_20250305', name: 'web_search', max_uses: 3 });
  assert.ok(!(t.claudeReqs[n].tools || []).some((x) => x.name === 'web__search'), 'never a function the model calls here');
  assert.equal(t.sent.at(-1).text, 'The pool opens at 9:00 on Sundays.\n\nhttps://pool.example/hours', 'the cited page');
  const row = t.db.db.prepare("SELECT input, cost FROM usage WHERE kind = 'web-search' ORDER BY ts DESC LIMIT 1").get();
  assert.deepEqual({ ...row }, { input: 2, cost: 0.02 }, 'two searches at the provider\'s price, under Usage → web searches');
});

test('a paused long search goes on; markdown links become plain; an answer with its own link gets none added', async () => {
  t.script.push(answer('Looking…', { stop_reason: 'pause_turn' }), answer('See [the timetable](https://cff.example/t) for Aigle.'));
  t.script.at(-1).content[0].citations = [{ url: 'https://other.example' }];
  await ask('next train to Aigle?');
  assert.equal(t.sent.at(-1).text, 'See the timetable (https://cff.example/t) for Aigle.');
});

test('per role: "web:-" for participants removes it; switching the module off removes it for everyone', async () => {
  const cfg = t.agents.getAgent('panduga').tools;
  await t.api(owner, 'PUT', '/api/agents/panduga', { tools: { ...cfg, participant: [...cfg.participant, 'web:-'] } });
  let n = t.claudeReqs.length;
  t.script.push(answer('ok'));
  await ask('weather tomorrow?');
  assert.equal(searchTool(n), undefined, 'participants: off');
  await t.api(owner, 'PUT', '/api/agents/panduga', { tools: cfg });
  assert.equal((await t.api(owner, 'PUT', '/api/modules/web', { on: false })).status, 200);
  n = t.claudeReqs.length;
  t.script.push(answer('ok'));
  await ask('weather tomorrow?');
  assert.equal(searchTool(n), undefined, 'module off');
  assert.equal((await t.api(owner, 'GET', '/api/modules')).body.modules.find((m) => m.id === 'web').on, false);
  await t.api(owner, 'PUT', '/api/modules/web', { on: true });
});

test('a provider without built-in search never gets it; search blocks from earlier in the turn are dropped for it', async () => {
  assert.equal((await t.api(owner, 'POST', '/api/providers/compatible', { id: 'alt', name: 'alt', baseUrl: alt.url(), key: 'k' })).status, 200);
  const providers = await import('../src/core/providers/index.js');
  const messages = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
    { type: 'web_search_tool_result', tool_use_id: 's1', content: [] }, { type: 'text', text: 'Found it.' }] }, { role: 'user', content: 'and?' }];
  const r = await providers.chat({ model: 'alt:fake-large', direct: true, system: 's', messages, natives: ['web_search'], usage: { feature: 'test' } });
  assert.match(r.content[0].text, /says hi/);
  const body = alt.reqs.at(-1).body;
  assert.ok(!JSON.stringify(body).includes('web_search'), 'no search tool, no search blocks');
  assert.match(JSON.stringify(body.messages), /Found it\./, 'the text of that answer stays');
});
