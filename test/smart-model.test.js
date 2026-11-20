// 088: Smart model choice (light for simple, strong when needed) and the self-check of facts from People and modules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner;
const G = 'g9@g.us';
const LIGHT = 'claude-haiku-5-5'; const STRONG = 'claude-sonnet-5-5';
const ANU = '41790000002';
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Mira', triggers: ['mira'], groupReplies: 'wake', model: 'smart' } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'mira' });
});
after(() => t.close());

const ask = async (text, ...answers) => {
  const n = t.claudeReqs.length;
  for (const a of answers) t.script.push(typeof a === 'string' ? [{ type: 'text', text: a }] : a);
  await t.route(t.msg({ chat: G, text, phone: ANU, senderName: 'Anu' }));
  return t.claudeReqs.slice(n);
};
const lastUsage = () => t.db.db.prepare("SELECT summary, detail FROM activity WHERE type = 'model.usage' AND agent = 'mira' ORDER BY id DESC LIMIT 1").get();

test('rules first: a greeting goes to the light model, a long multi-step message to the strong one; Activity says why', async () => {
  let reqs = await ask('mira hi!', 'Hello Anu!');
  assert.deepEqual(reqs.map((r) => r.model), [LIGHT]);
  assert.match(lastUsage().summary, /light: a greeting or thanks/);
  assert.equal(t.sent.at(-1).text, 'Hello Anu!');
  reqs = await ask('mira first check who drives on Saturday and then plan the pickups for everyone, and also explain why', 'Here is the plan.');
  assert.deepEqual(reqs.map((r) => r.model), [STRONG]);
  assert.deepEqual(JSON.parse(lastUsage().detail).tier, 'strong');
});

test('unsure: one tiny classifier call on the light model decides; with it off, the strong model answers', async () => {
  const text = 'mira what do you think about the weather for our walk around the lake this coming weekend with everyone';
  let reqs = await ask(text, 'LIGHT', 'Looks sunny.');
  assert.deepEqual(reqs.map((r) => r.model), [LIGHT, LIGHT]);
  assert.equal(reqs[0].max_tokens, 4, 'the classifier is bounded');
  assert.match(lastUsage().summary, /judged simple/);
  const kinds = t.db.db.prepare("SELECT kind FROM usage WHERE agent = 'mira' ORDER BY id DESC LIMIT 2").all().map((r) => r.kind);
  assert.deepEqual(kinds, ['reply', 'model-choice'], 'the classifier shows as its own kind in Usage');
  await t.api(owner, 'POST', '/api/models/defaults', { smart: { classifier: false } });
  reqs = await ask(text, 'Looks sunny.');
  assert.deepEqual(reqs.map((r) => r.model), [STRONG]);
  await t.api(owner, 'POST', '/api/models/defaults', { smart: { classifier: true } });
});

test('the light model fails → the strong model answers the same turn', async () => {
  t.claudeFail.push({ status: 404, message: 'model not found' });
  const reqs = await ask('mira thanks!', 'You are welcome.');
  assert.deepEqual(reqs.map((r) => r.model), [LIGHT, STRONG]);
  assert.equal(t.sent.at(-1).text, 'You are welcome.');
  assert.match(lastUsage().summary, /strong: the light model failed/);
});

test('per agent: its own light model; a fixed model ignores the tiers; settings and models list show Smart choice', async () => {
  await t.api(owner, 'PUT', '/api/agents/mira', { modelTiers: { light: `anthropic:${STRONG}` } });
  let reqs = await ask('mira hello', 'Hi.');
  assert.deepEqual(reqs.map((r) => r.model), [STRONG]);
  assert.equal((await t.api(owner, 'PUT', '/api/agents/mira', { modelTiers: { light: 'nonsense' } })).status, 400);
  await t.api(owner, 'PUT', '/api/agents/mira', { modelTiers: { light: '' }, model: `anthropic:${LIGHT}` });
  reqs = await ask('mira first plan and then compare everything in detail please', 'Done.');
  assert.deepEqual(reqs.map((r) => r.model), [LIGHT], 'a fixed model is used as is');
  await t.api(owner, 'PUT', '/api/agents/mira', { model: 'smart' });
  const m = await t.api(owner, 'GET', '/api/models');
  assert.deepEqual([m.body.smart.light, m.body.smart.strong, m.body.smart.resolvedLight, m.body.smart.resolvedStrong], ['auto', 'auto', `anthropic:${LIGHT}`, `anthropic:${STRONG}`]);
  assert.equal((await t.api(owner, 'POST', '/api/models/defaults', { smart: { light: 'bad ref' } })).status, 400);
  // the test console says which tier answered
  t.script.push([{ type: 'text', text: 'Hi from the console' }]);
  const r = await t.api(owner, 'POST', '/api/agents/mira/test', { text: 'hello' });
  assert.deepEqual(r.body.tier, { tier: 'light', reason: 'a greeting or thanks' });
});

test('Usage: answers per tier, cost per answer and what the strong model alone would have cost', async () => {
  await t.api(owner, 'PUT', '/api/usage/prices', { model: `anthropic:${LIGHT}`, input: 1, output: 5 });
  await t.api(owner, 'PUT', '/api/usage/prices', { model: `anthropic:${STRONG}`, input: 3, output: 15 });
  await ask('mira good morning', 'Morning!');
  await ask('mira first list who comes and then plan the seats and also explain why', 'Plan done.');
  const r = (await t.api(owner, 'GET', '/api/usage/smart?period=1d')).body;
  assert.ok(r.answers >= 6);
  assert.ok(r.tiers.light.answers >= 3 && r.tiers.strong.answers >= 2);
  assert.ok(r.compared >= 2 && r.saved > 0, 'light answers cost less than the strong model would have');
  assert.ok(r.perAnswerStrong > r.perAnswer);
  assert.ok(r.reasons.some((x) => x.reason === 'a greeting or thanks'));
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  assert.ok(TOOLS.find((x) => x.name === 'get_smart_model_savings').readOnly);
});

// ---------- self-check ----------
test('self-check: a wrong amount is rewritten once; still wrong → a plain answer; right → checked; off → not checked', async () => {
  await t.api(owner, 'PUT', '/api/modules/orders', { on: true });
  const anu = (await t.api(owner, 'GET', `/api/people/${ANU}`)).body; // she wrote above: already in People
  await t.api(owner, 'PUT', `/api/people/${anu.id}`, { name: 'Anu Rao' });
  const ravi = (await t.api(owner, 'POST', '/api/people', { name: 'Ravi Chary', phone: '41790000011' })).body;
  for (const [p, price] of [[anu, 120], [ravi, 40]]) {
    const r = await t.api(owner, 'POST', '/api/orders', { person: p.id, title: 'Sankranti', due: '2027-01-08', lines: [{ item: 'Family', qty: 1, price }] });
    assert.equal(r.status, 201);
  }
  await t.api(owner, 'PUT', '/api/agents/mira', { model: `anthropic:${STRONG}` });
  const owe = [{ type: 'tool_use', id: 'o1', name: 'orders__what_do_i_owe', input: {} }];
  // wrong amount → one rewrite (no tools) → the rewrite is right
  let reqs = await ask('mira what do I owe?', owe, 'You owe CHF 40.00, due 8 January.', 'You owe CHF 120.00, due 8 January.');
  assert.equal(reqs.length, 3);
  assert.match(JSON.stringify(reqs[2].messages.at(-1).content), /CHF 40\.00/);
  assert.ok(!reqs[2].tools?.length, 'the rewrite has no tools');
  assert.equal(t.sent.at(-1).text, 'You owe CHF 120.00, due 8 January.');
  assert.deepEqual(JSON.parse(lastUsage().detail).check, { facts: 2, ok: false, wrong: 1, rewritten: true, plain: false });
  // still wrong → plain answer, never the wrong amount
  await ask('mira what do I owe?', owe, 'You owe CHF 99.00.', 'Sorry: CHF 98.00.');
  assert.doesNotMatch(t.sent.at(-1).text, /99|98/);
  assert.match(t.sent.at(-1).text, /could not double-check/);
  // a wrong date is caught too
  await ask('mira when is it due?', owe, 'It is due on 9 January.', 'It is due on 8 January.');
  assert.equal(t.sent.at(-1).text, 'It is due on 8 January.');
  // right → no extra call, "checked" in Activity
  reqs = await ask('mira what do I owe?', owe, 'You owe CHF 120.00 for Sankranti.');
  assert.equal(reqs.length, 2);
  assert.deepEqual(JSON.parse(lastUsage().detail).check, { facts: 1, ok: true });
  // switched off: the answer goes out as written
  await t.api(owner, 'PUT', '/api/agents/mira', { selfCheck: false });
  await ask('mira what do I owe?', owe, 'You owe CHF 40.00.');
  assert.equal(t.sent.at(-1).text, 'You owe CHF 40.00.');
  await t.api(owner, 'PUT', '/api/agents/mira', { selfCheck: true, model: 'smart' });
});

test('self-check: an amount next to the wrong person is caught (organizer list)', async () => {
  await t.api(owner, 'PUT', '/api/agents/mira', { organizers: [`+${ANU}`], model: `anthropic:${STRONG}` });
  const list = [{ type: 'tool_use', id: 'w1', name: 'orders__who_has_not_paid', input: {} }];
  await ask('mira who has not paid?', list, 'Ravi Chary owes CHF 120.00 and Anu Rao owes CHF 40.00.', 'Anu Rao owes CHF 120.00 and Ravi Chary owes CHF 40.00.');
  assert.equal(t.sent.at(-1).text, 'Anu Rao owes CHF 120.00 and Ravi Chary owes CHF 40.00.');
  await t.api(owner, 'PUT', '/api/agents/mira', { model: 'smart', organizers: [] });
});
