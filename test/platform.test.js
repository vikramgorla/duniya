// Features 001 (multi-bot platform) and 002 (admin panel).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t;
before(async () => { t = await setup(); });
after(() => t.close());

test('001/US3: loads bots from folders, ignores _template', () => {
  assert.deepEqual(t.bots.listBots().map((b) => b.id).sort(), ['helper', 'panduga']);
});

test('001/US1: group message without trigger is stored but not answered', async () => {
  t.sent.length = 0; t.claudeReqs.length = 0;
  await t.route(t.msg({ text: 'see you all tomorrow' }));
  assert.equal(t.sent.length, 0);
  assert.equal(t.claudeReqs.length, 0);
});

test('001/US1: participant asks via trigger: read-only tools, reply posted to the group', async () => {
  t.sent.length = 0; t.claudeReqs.length = 0;
  t.script.push([{ type: 'tool_use', id: 't1', name: 'panduga__agenda_list', input: {} }], [{ type: 'text', text: 'Puja is at 10:00.' }]);
  await t.route(t.msg({ text: '!panduga when is puja?' }));
  assert.deepEqual(t.sent, [{ chat: 'g1@g.us', text: 'Puja is at 10:00.' }]);
  assert.ok(t.toolNames(0).includes('panduga__agenda_list'));
  assert.ok(!t.toolNames(0).some((n) => /preview|confirm|registrations|forget/.test(n)), 'no write/private tools for participants');
  assert.match(t.userTurn(0), /when is puja\?$/);
  assert.match(t.claudeReqs[0].system, /named "Panduga families"/);
});

test('001/US1: participant cannot run a write tool even if the model asks', async () => {
  t.mcpCalls.length = 0;
  t.script.push([{ type: 'tool_use', id: 't2', name: 'panduga__room_assign_preview', input: {} }], [{ type: 'text', text: 'Ask an organizer.' }]);
  await t.route(t.msg({ text: '!panduga move me to room 4' }));
  assert.equal(t.mcpCalls.filter((c) => c.name === 'room_assign_preview').length, 0);
});

test('001/US2: organizer change is held until "confirm CODE"; participants cannot confirm', async () => {
  t.sent.length = 0; t.mcpCalls.length = 0; t.claudeReqs.length = 0;
  t.script.push([{ type: 'tool_use', id: 't3', name: 'panduga__room_assign_preview', input: { family: 'Rao' } }], [{ type: 'text', text: 'Preview: Rao -> Room 4.' }]);
  await t.route(t.msg({ phone: '41790000001', senderName: 'Vik', mentioned: true, text: '@41790000099 put Rao in room 4' }));
  assert.ok(!t.toolNames(0).includes('panduga__confirm'), 'confirm tool hidden from model');
  assert.ok(!JSON.stringify(t.claudeReqs[1].messages.at(-1)).includes('cf_SECRET123'), 'confirm id hidden from model');
  const code = t.sent[0].text.match(/confirm ([A-Z0-9]{4})/)[1];

  await t.route(t.msg({ text: `confirm ${code}` }));
  assert.equal(t.sent.at(-1).text, 'Only organizers can confirm or cancel changes.');
  assert.equal(t.mcpCalls.filter((c) => c.name === 'confirm').length, 0);

  await t.route(t.msg({ phone: '41790000001', text: `confirm ${code}` }));
  const confirms = t.mcpCalls.filter((c) => c.name === 'confirm');
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].arguments.confirm_id, 'cf_SECRET123');
  assert.match(t.sent.at(-1).text, /^Done/);
  const before = t.sent.length;
  await t.route(t.msg({ phone: '41790000001', text: `confirm ${code}` }));
  assert.equal(t.sent.length, before, 'single use');
});

test('001/US2: "no idea" style replies are not treated as commands', async () => {
  t.sent.length = 0;
  await t.route(t.msg({ text: 'cancel ABCD' }));
  await t.route(t.msg({ text: 'no idea' }));
  assert.equal(t.sent.length, 0);
});

test('001/US3: hook-based bot: local tool + onMessage shortcut', async () => {
  t.sent.length = 0; t.claudeReqs.length = 0;
  await t.route(t.msg({ chat: 'g2@g.us', phone: '41790000001', text: '!ping', mentioned: true }));
  assert.equal(t.sent.at(-1).text, 'pong');
  assert.equal(t.claudeReqs.length, 0);
  t.script.push([{ type: 'tool_use', id: 't4', name: 'local__roll_dice', input: { sides: 6 } }], [{ type: 'text', text: 'You rolled it.' }]);
  await t.route(t.msg({ chat: 'g2@g.us', phone: '41790000003', text: '!help roll a die' }));
  assert.ok(t.toolNames(0).includes('local__roll_dice'));
  assert.match(JSON.stringify(t.claudeReqs[1].messages.at(-1)), /result/);
});

test('001/US4: DM routing: group member reaches panduga; strangers get nothing', async () => {
  t.sent.length = 0;
  t.script.push([{ type: 'text', text: 'Hi Anu!' }]);
  await t.route(t.msg({ isGroup: false, chat: '41790000002@s.whatsapp.net', text: 'hello' }));
  assert.equal(t.sent.at(-1).text, 'Hi Anu!');
  const before = t.sent.length;
  await t.route(t.msg({ isGroup: false, chat: '41799999999@s.whatsapp.net', phone: '41799999999', text: 'hello' }));
  assert.equal(t.sent.length, before);
});

test('001: paused stops replies', async () => {
  t.sent.length = 0;
  t.config.updateSettings({ paused: true });
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.equal(t.sent.length, 0);
  t.config.updateSettings({ paused: false });
});

test('002: panel auth, CSRF guard, bot edit validation, secrets never returned, activity', async () => {
  assert.equal((await fetch(`${t.base}/api/status`)).status, 401);
  assert.equal((await fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"nope"}' })).status, 401);
  const cookie = await t.login();
  const get = (p) => fetch(t.base + p, { headers: { cookie } }).then((r) => r.json());
  const json = (method, p, body) => fetch(t.base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await get('/api/status')).channel.status, 'open');
  assert.equal((await fetch(`${t.base}/api/settings`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'paused=1' })).status, 415);
  const updated = await (await json('PUT', '/api/bots/panduga', { triggers: ['!pd', '!panduga'], organizers: ['+41 79 000 00 01', '+91 98450 00000'] })).json();
  assert.deepEqual(updated.triggers, ['!pd', '!panduga']);
  assert.deepEqual(updated.organizers, ['41790000001', '919845000000']);
  assert.equal((await json('PUT', '/api/bots/panduga', { mcpServers: {} })).status, 400, 'MCP config not editable');
  assert.equal((await json('PUT', '/api/bots/panduga', { schedules: [{ at: '8am' }] })).status, 400, 'bad schedule rejected');
  const secrets = await get('/api/secrets');
  assert.ok(secrets.find((s) => s.name === 'PANDUGA_TOKEN_MEMBER' && s.usedByBots && !s.set));
  assert.ok(!JSON.stringify(secrets).includes('"org"'), 'secret values never returned');
  assert.equal((await get('/api/chats')).find((c) => c.id === 'g1@g.us').bot, 'panduga');
  const acts = await get('/api/activity?limit=500');
  assert.ok(acts.some((a) => a.type === 'confirm.applied'));
  assert.ok(acts.some((a) => a.type === 'tool.call' && a.summary.startsWith('panduga:agenda_list')));
  assert.match(await fetch(`${t.base}/`).then((r) => r.text()), /Duniya/);
});
