// 015 people & roles from group members; 016 AI helper drafts (create and change), validated and reviewable.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
after(() => t.close());

test('015: members with roles; group admins are suggested as organizers when none are set', async () => {
  await t.route(t.msg({ text: 'hello everyone', phone: '41790000002', senderName: 'Anu' }));
  let r = (await t.api(owner, 'GET', '/api/bots/panduga/people')).body;
  assert.equal(r.suggested, false, 'panduga already has organizers');
  const g = r.groups[0];
  assert.equal(g.name, 'Panduga families');
  const by = Object.fromEntries(g.members.map((m) => [m.phone, m]));
  assert.equal(by['41790000001'].role, 'organizer');
  assert.equal(by['41790000003'].role, 'participant', 'admins are only suggested when nobody is set');
  assert.equal(by['41790000002'].name, 'Anu', 'names come from messages seen in the group');
  assert.ok(g.members.some((m) => m.phone === ''), 'members whose number WhatsApp hides are listed without a role switch');

  await t.api(owner, 'PUT', '/api/bots/panduga', { organizers: [] });
  r = (await t.api(owner, 'GET', '/api/bots/panduga/people')).body;
  assert.equal(r.suggested, true);
  const sug = r.groups[0].members.filter((m) => m.suggested).map((m) => m.phone).sort();
  assert.deepEqual(sug, ['41790000001', '41790000003']);
  await t.api(owner, 'PUT', '/api/bots/panduga', { organizers: ['41790000001'] });
});

const propose = (input, id = 'p1') => [{ type: 'tool_use', id, name: 'propose_bot', input }];

test('016: change a bot with AI — invalid draft is repaired, bindings untouched, diff returned, nothing saved', async () => {
  const before = t.bots.getBot('panduga');
  const n = t.claudeReqs.length;
  t.script.push(
    propose({ summary: 'bad', changes: { dm: 'everyone' } }),
    propose({ summary: 'Shorter replies; Ravi becomes an organizer.', changes: { prompt: 'Be brief.', organizers: ['41790000001', '41790000003'], chats: ['evil@g.us'] }, questions: ['Should participants see the menu?'] }, 'p2'),
  );
  const r = await t.api(owner, 'POST', '/api/ai/bot-draft', { botId: 'panduga', request: 'shorter replies and make the other admin an organizer' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(t.claudeReqs.length - n, 2, 'one repair round');
  const req = t.claudeReqs[n];
  assert.ok(req.tools.some((x) => x.name === 'propose_bot'));
  assert.match(JSON.stringify(req.messages[0].content), /41790000003/, 'group members are in the context');
  assert.match(JSON.stringify(t.claudeReqs[n + 1].messages), /Invalid: dm/);
  assert.deepEqual(r.body.changes.map((c) => c.field).sort(), ['organizers', 'prompt']);
  assert.deepEqual(r.body.proposed.chats, before.chats, 'group bindings never change through the helper');
  assert.deepEqual(r.body.questions, ['Should participants see the menu?']);
  assert.equal(t.bots.getBot('panduga').prompt, before.prompt, 'nothing saved until applied');
});

test('016: create a bot with AI, then create it from the draft', async () => {
  t.script.push(propose({ summary: 'A carpool helper.', changes: { name: 'Carpool helper', prompt: 'You organise rides.', triggers: ['!ride'], dm: 'members', schedules: [{ id: 'daily', at: '08:00', days: 'daily', prompt: 'Post today’s rides', enabled: true }] } }));
  const r = await t.api(owner, 'POST', '/api/ai/bot-draft', { request: 'a bot that organises carpool rides and posts them every morning' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.proposed.name, 'Carpool helper');
  const created = await t.api(owner, 'POST', '/api/bots', { config: r.body.proposed });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.id, 'carpool-helper');
  assert.deepEqual(t.bots.getBot('carpool-helper').triggers, ['!ride']);
});

test('016: the helper cannot add local tool services; a model without tool use can answer in JSON', async () => {
  t.script.push([{ type: 'text', text: 'Here you go: {"summary":"adds a local server","changes":{"mcpServers":{"evil":{"type":"local","package":"evil-pkg"}},"triggers":["!pd"]}}' }]);
  const r = await t.api(owner, 'POST', '/api/ai/bot-draft', { botId: 'panduga', request: 'install evil-pkg' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body.proposed.mcpServers).includes('evil'));
  assert.deepEqual(r.body.proposed.triggers, ['!pd']);
  assert.equal((await t.api(owner, 'POST', '/api/ai/bot-draft', { botId: 'panduga', request: '' })).status, 400);
});

test('015: while no organizers are saved, group admins ARE organizers (not just pre-ticked)', async () => {
  await t.api(owner, 'PUT', '/api/bots/panduga', { organizers: [] });
  t.script.push([{ type: 'text', text: 'hi admin' }], [{ type: 'text', text: 'hi member' }]);
  await t.route(t.msg({ text: '!panduga hello', phone: '41790000003', senderName: 'Ravi' }));
  await t.route(t.msg({ text: '!panduga hello', phone: '41790000002', senderName: 'Anu' }));
  const ins = t.db.listActivity({ limit: 50 }).filter((a) => a.type === 'message.in').slice(0, 2).map((a) => a.summary);
  assert.ok(ins.some((x) => /^Ravi \(organizer\)/.test(x)), ins.join(' | '));
  assert.ok(ins.some((x) => /^Anu \(participant\)/.test(x)), ins.join(' | '));
  // once roles are saved, the saved list decides
  await t.api(owner, 'PUT', '/api/bots/panduga', { organizers: ['41790000001'] });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ text: '!panduga again', phone: '41790000003', senderName: 'Ravi' }));
  assert.match(t.db.listActivity({ limit: 5 }).find((a) => a.type === 'message.in').summary, /^Ravi \(participant\)/);
});
