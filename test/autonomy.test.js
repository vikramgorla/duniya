// 093: "How sure before changing things" — an agent's autonomy (ask | clear | act), enforced in code. The Killi
// conversation from the owner's server replayed with a fake preview → confirm tool service: an organizer's clear request
// is applied in the same turn (one reply, no "Shall I save?"), a tweak too; deletes, participants and Ask first wait for a
// later yes (a same-turn confirm is blocked in code); Duniya's own held changes follow the risk table; Activity lists
// every change made without asking; the panel, admin MCP and validation know the setting.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, serveFakeMcp } from './harness.js';

const calls = []; let seq = 0;
const tracker = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  return serveFakeMcp(req, res, d, { name: 'tracker', tools: ['shopping_list', 'shopping_item_preview', 'agenda_delete_preview', 'confirm', 'undo_list', 'undo_preview'],
    call: (name, args) => {
      calls.push({ name, args });
      if (name.endsWith('_preview')) return JSON.stringify({ preview: `${name}: ${JSON.stringify(args)}`, confirm_id: `cf_${++seq}`, note: 'If the user does not clearly agree, do not confirm.' });
      return name === 'confirm' ? `Saved (${args.confirm_id})` : '[]';
    } });
}).listen(0);
const t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
const owner = await t.login();
after(() => { tracker.close(); t.close(); });

const ORG = '41790000001'; const MEMBER = '41790000002';
await t.agents.createAgent({ id: 'silk', config: {
  name: 'Silk Smitha', prompt: 'You keep the event tracker.', model: 'anthropic:claude-sonnet-5-5', triggers: ['silku'], groupReplies: 'wake', chats: ['g3@g.us'], organizers: [ORG],
  mcpServers: { tracker: { url: `http://127.0.0.1:${tracker.address().port}/mcp` } },
  tools: { organizer: ['tracker:*'], participant: ['tracker:shopping_list', 'tracker:shopping_item_preview', 'tracker:confirm'], deny: [] },
} });
const say = (phone, text) => t.route(t.msg({ chat: 'g3@g.us', phone, senderJid: `${phone}@s.whatsapp.net`, senderName: phone === ORG ? 'Vik' : 'Anu', text }));
const use = (name, input) => ({ type: 'tool_use', id: `tu${Math.random().toString(36).slice(2)}`, name: `tracker__${name}`, input });
const confirms = () => calls.filter((c) => c.name === 'confirm');
const lastResult = () => JSON.stringify(t.claudeReqs.at(-1).messages.at(-1).content);
const autoEntries = () => t.db.listActivity({ type: 'change.auto' });
const fresh = () => { t.sent.length = 0; t.claudeReqs.length = 0; calls.length = 0; };

test('new and existing agents act on clear requests by default; the setting is in the instructions, once', async () => {
  assert.equal(t.agents.getAgent('silk').autonomy, 'clear');
  assert.equal(t.agents.getAgent('panduga').autonomy, 'clear');
  fresh();
  t.script.push([{ type: 'text', text: 'Hi!' }]);
  await say(ORG, 'silku hi');
  const sys = t.claudeReqs[0].system;
  assert.match(sys, /that request is their approval/);
  assert.equal(sys.match(/They are an organizer/g).length, 1);
  t.script.push([{ type: 'text', text: 'Hi!' }]);
  await say(MEMBER, 'silku hi');
  assert.match(t.claudeReqs.at(-1).system, /They are a participant/);
  assert.doesNotMatch(t.claudeReqs.at(-1).system, /request is their approval/);
});

test('the Killi conversation: a clear request is previewed and applied in the same turn, one reply; a tweak applies without asking', async () => {
  fresh();
  t.script.push([use('shopping_item_preview', { item: 'Killi', list: 'shopping' })], [{ type: 'text', text: 'Added Killi to the shopping list. Say undo to revert.' }]);
  await say(ORG, 'silku add Killi to tracker, it should go to the shopping list');
  assert.deepEqual(calls.map((c) => c.name), ['shopping_item_preview', 'confirm'], 'Duniya confirmed the preview itself');
  assert.equal(confirms()[0].args.confirm_id, 'cf_1');
  assert.match(lastResult(), /applied without an extra confirmation/);
  assert.match(lastResult(), /say undo to revert/);
  assert.doesNotMatch(lastResult(), /cf_1/, 'the used confirm id is not shown to the model');
  assert.equal(t.sent.length, 1, 'one reply');
  assert.doesNotMatch(t.sent[0].text, /confirm [A-Z0-9]{4}|Shall I/);
  const entry = autoEntries().at(-1);
  assert.match(entry.summary, /^Changed without asking \(clear request\): .* · say undo to revert$/);
  assert.equal(entry.detail.tool, 'tracker:shopping_item_preview');
  assert.equal(entry.detail.undo, 'tracker:undo_list');
  // the tweak: "Qty must match 3× adults" → applied again without asking
  t.script.push([use('shopping_item_preview', { item: 'Killi', qty: '3x adults' })], [{ type: 'text', text: 'Killi now 3× adults.' }]);
  await say(ORG, 'silku qty must match 3x adults');
  assert.equal(confirms().length, 2);
  assert.equal(t.sent.length, 2);
  assert.equal(autoEntries().length, 2);
  // a model that still calls confirm itself after Duniya applied it gets "already applied", no second confirm
  t.script.push([use('shopping_item_preview', { item: 'Rice' })], [use('confirm', { confirm_id: 'cf_3' })], [{ type: 'text', text: 'Rice added.' }]);
  await say(ORG, 'silku add rice to shopping');
  assert.equal(confirms().length, 3);
  assert.match(lastResult(), /Already applied/);
});

test('an unclear request gets one question and changes nothing', async () => {
  fresh();
  t.script.push([{ type: 'text', text: 'Which list should Killi go to: shopping or the tracker?' }]);
  await say(ORG, 'silku Killi?');
  assert.equal(calls.length, 0);
  assert.equal(t.sent.length, 1);
});

test('a delete always asks: the same-turn confirm is blocked in code; a later yes from the organizer confirms it', async () => {
  fresh();
  t.script.push([use('agenda_delete_preview', { item: 'Puja' })], [use('confirm', { confirm_id: `cf_${seq + 1}` })], [{ type: 'text', text: 'Delete Puja from the agenda?' }]);
  await say(ORG, 'silku remove puja from the agenda');
  const id = `cf_${seq}`;
  assert.equal(confirms().length, 0, 'not confirmed in the same turn');
  const results = JSON.stringify(t.claudeReqs.at(-2).messages.at(-1).content);
  assert.match(results, /wait for an explicit yes in a later message/);
  assert.match(lastResult(), /Not confirmed: Duniya allows this only after/);
  // "Qty …" is not agreement: still blocked
  t.script.push([use('confirm', { confirm_id: id })], [{ type: 'text', text: 'Shall I delete it?' }]);
  await say(ORG, 'silku and add rice');
  assert.equal(confirms().length, 0);
  t.script.push([use('confirm', { confirm_id: id })], [{ type: 'text', text: 'Deleted.' }]);
  await say(ORG, 'silku yes');
  assert.equal(confirms().length, 1);
  assert.equal(confirms()[0].args.confirm_id, id);
});

test('a participant asks: their preview waits and a same-turn confirm is blocked', async () => {
  fresh();
  t.script.push([use('shopping_item_preview', { item: 'Chips' })], [use('confirm', { confirm_id: `cf_${seq + 1}` })], [{ type: 'text', text: 'An organizer will confirm.' }]);
  await say(MEMBER, 'silku add chips to the shopping list');
  assert.equal(calls.filter((c) => c.name === 'shopping_item_preview').length, 1);
  assert.equal(confirms().length, 0);
  assert.match(lastResult(), /Not confirmed/);
});

test('Ask first: the preview waits for a later yes even for a clear, low-risk request', async () => {
  await t.agents.updateAgent('silk', { autonomy: 'ask' });
  fresh();
  t.script.push([use('shopping_item_preview', { item: 'Killi' })], [use('confirm', { confirm_id: `cf_${seq + 1}` })], [{ type: 'text', text: 'Shall I save Killi?' }]);
  await say(ORG, 'silku add Killi to the shopping list');
  assert.match(t.claudeReqs[0].system, /wait for their explicit yes in a later message/);
  assert.equal(confirms().length, 0);
  t.script.push([use('confirm', { confirm_id: `cf_${seq}` })], [{ type: 'text', text: 'Saved.' }]);
  await say(ORG, 'silku Yes');
  assert.equal(confirms().length, 1);
  assert.equal(autoEntries().filter((a) => a.agent === 'silk').length, 3, 'a confirmed yes is not "without asking"');
  await t.agents.updateAgent('silk', { autonomy: 'act' });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say(ORG, 'silku hi');
  assert.match(t.claudeReqs.at(-1).system, /reasonable changes that clearly follow/);
  await t.agents.updateAgent('silk', { autonomy: 'clear' });
});

test('the test console never applies without asking', async () => {
  fresh();
  t.script.push([use('shopping_item_preview', { item: 'Killi' })], [{ type: 'text', text: 'Preview ready.' }]);
  const r = await t.api(owner, 'POST', '/api/agents/silk/test', { text: 'add Killi', role: 'organizer' });
  assert.equal(r.status, 200);
  assert.equal(confirms().length, 0);
});

test('the agent\'s own confirm settings: high-risk previews keep "confirm CODE"; a low-risk override applies at once', async () => {
  fresh();
  t.script.push([{ type: 'tool_use', id: 'r1', name: 'panduga__room_assign_preview', input: { family: 'Rao' } }], [{ type: 'text', text: 'Preview: Rao -> Room 4.' }]);
  await t.route(t.msg({ phone: ORG, senderName: 'Vik', text: '!panduga put Rao in room 4' }));
  assert.match(t.sent.at(-1).text, /confirm [A-Z0-9]{4}/, 'assigning someone is high risk');
  assert.ok(!t.mcpCalls.some((c) => c.name === 'confirm' && t.sent.length === 1));
  await t.agents.updateAgent('panduga', { risk: { low: ['panduga:room_assign_preview'], high: [] } });
  const before = t.mcpCalls.filter((c) => c.name === 'confirm').length;
  t.script.push([{ type: 'tool_use', id: 'r2', name: 'panduga__room_assign_preview', input: { family: 'Rao' } }], [{ type: 'text', text: 'Rao is in room 4.' }]);
  await t.route(t.msg({ phone: ORG, senderName: 'Vik', text: '!panduga put Rao in room 4' }));
  assert.equal(t.mcpCalls.filter((c) => c.name === 'confirm').length, before + 1);
  assert.doesNotMatch(t.sent.at(-1).text, /confirm [A-Z0-9]{4}/);
  assert.equal((await t.api(owner, 'PUT', '/api/agents/panduga', { risk: { low: [], high: ['bad rule'] } })).status, 400);
  await t.agents.updateAgent('panduga', { risk: { low: [], high: [] } });
});

test('Duniya\'s own changes by risk: registering someone else stays behind the confirm code in clear mode', async () => {
  await t.api(owner, 'PUT', '/api/modules/events', { on: true });
  await t.api(owner, 'POST', '/api/module/events', { name: 'Picnic 2027', starts: '2027-06-01', per: 'household' });
  await t.api(owner, 'POST', '/api/households', { name: 'Rao family' });
  fresh();
  t.script.push([{ type: 'tool_use', id: 'e1', name: 'events__register_someone', input: { event: 'picnic', who: 'Rao family' } }], [{ type: 'text', text: 'Held.' }]);
  await say(ORG, 'silku register the Rao family for the picnic');
  assert.match(lastResult(), /Held for an organizer's confirmation/);
  assert.match(t.sent.at(-1).text, /confirm [A-Z0-9]{4}/);
});

test('panel, Activity filter, validation and admin MCP know the setting', async () => {
  assert.equal((await t.api(owner, 'PUT', '/api/agents/silk', { autonomy: 'sometimes' })).status, 400);
  const r = await t.api(owner, 'PUT', '/api/agents/silk', { autonomy: 'ask' });
  assert.equal(r.body.config.autonomy, 'ask');
  const only = await t.api(owner, 'GET', '/api/activity?type=change.auto&limit=50');
  assert.ok(only.body.length >= 3 && only.body.every((a) => a.type === 'change.auto'));
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  assert.match(TOOLS.find((x) => x.name === 'update_agent').description, /"autonomy": "ask" \| "clear" \| "act"/);
  const list = TOOLS.find((x) => x.name === 'list_activity');
  assert.ok(list.input.type, 'list_activity filters by type');
  const out = await list.run({ type: 'change.auto' }, { call: async (m, p) => (await t.api(owner, m, p)).body });
  assert.ok(JSON.stringify(out).includes('Changed without asking'));
  await t.api(owner, 'PUT', '/api/agents/silk', { autonomy: 'clear' });
});
