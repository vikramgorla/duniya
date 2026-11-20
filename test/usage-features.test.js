// 092: every model call is tagged with the feature that made it (one helper at the call site); Usage → Cost per feature
// and the admin MCP's get_usage show tokens and cost per feature with a label and one line each.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner;
const G = 'g5@g.us';
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Lila', triggers: ['lila'], groupReplies: 'auto' } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'lila' });
  await t.api(owner, 'PUT', '/api/usage/prices', { model: 'anthropic:claude-sonnet-5-5', input: 3, output: 15 });
});
after(() => t.close());

const features = async () => (await t.api(owner, 'GET', '/api/usage?groupBy=feature&period=1d')).body.rows;

test('answers and judged group messages count as their own features, with a label and a line', async () => {
  t.script.push([{ type: 'text', text: 'Saturday at nine.' }]);
  await t.route(t.msg({ chat: G, text: 'lila when do we meet?', isGroup: true }));
  t.script.push([{ type: 'text', text: 'I can help with that.' }]);
  await t.route(t.msg({ chat: G, text: 'does anyone know a good plumber near the station', isGroup: true, msgId: 'm-judge' }));
  const rows = await features();
  const reply = rows.find((r) => r.key === 'reply'); const judge = rows.find((r) => r.key === 'judge');
  assert.ok(reply && judge, JSON.stringify(rows.map((r) => r.key)));
  assert.deepEqual([reply.label, judge.label], ['Agent answers', 'Judged group messages']);
  assert.match(judge.line, /not addressed/);
  assert.ok(reply.cost > 0 && reply.calls === 1);
  assert.equal((await t.api(owner, 'GET', '/api/usage?groupBy=kind')).status, 400, 'one way: feature replaces kind');
});

test('admin MCP get_usage carries the cost per feature, the most expensive first', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const x = { call: async (m, path, body) => (await t.api(owner, m, path, body)).body };
  const r = await TOOLS.find((y) => y.name === 'get_usage').run({ period: '1d' }, x);
  assert.equal(r.groupBy, 'agent');
  assert.ok(r.features.length >= 2 && r.features.every((f) => f.label && 'cost' in f));
  assert.ok(r.features[0].cost >= r.features.at(-1).cost);
});

test('an untagged or unknown feature is refused (every call site tags its call)', async () => {
  const usage = await import('../src/core/usage.js');
  assert.throws(() => usage.recordUsage({ provider: 'anthropic', model: 'm', input: 1, output: 1 }), /Unknown usage feature/);
  assert.throws(() => usage.usageTag('typo'), /Unknown usage feature/);
});
