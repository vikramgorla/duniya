// 073: one chat-name resolver (never a raw id), a person's page (People), plain tool words.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup();
const owner = await t.login();
t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vic', 'viewer password 123');
after(() => t.close());
const names = await import('../src/core/chat-names.js');
const { silenceReason } = await import('../src/core/silences.js');
const { recordUsage } = await import('../src/core/usage.js');
const { TOOLS } = await import('../src/panel/admin-tools.js');
const x = { call: async (m, p, b) => { const r = await t.api(owner, m, p, b); if (r.status >= 400) throw new Error(r.body.error); return r.body; } };
const tool = (name, a = {}) => TOOLS.find((y) => y.name === name).run(a, x);

const GROUP = '120363169191099017@g.us'; // a group WhatsApp knows but the app has never listed
test('073: a group only WhatsApp knows is named in the background, remembered, and never shown as its id', async () => {
  let asks = 0;
  const orig = t.channel.chatName;
  t.channel.chatName = async (chat) => { if (chat === GROUP) { asks++; return 'Morges rides'; } return orig(chat); };
  silenceReason('not_addressed', { chat: GROUP, agent: 'panduga', sender: 'Ravi' });
  const silence = async () => (await t.api(owner, 'GET', '/api/silences')).body.silences.find((r) => r.chat === GROUP);
  assert.equal((await silence()).chatName, 'Unnamed group', 'a list never asks WhatsApp: no name yet, never the id');
  assert.equal(asks, 0);
  assert.equal(await names.namesTick(t.channel), 1, 'upkeep asks for the name the list was missing');
  assert.equal((await silence()).chatName, 'Morges rides');
  // remembered: WhatsApp is not asked again, and the name survives WhatsApp being offline
  assert.equal(await names.namesTick(t.channel), 0);
  t.channel.chatName = async () => '';
  assert.equal((await silence()).chatName, 'Morges rides');
  assert.equal(names.chatLabel(GROUP), 'Morges rides');
  assert.equal(asks, 1);
  t.channel.chatName = orig;
  // a group nobody can name, a person, a hidden number and another number's group: names, never ids
  assert.equal(names.chatLabel('999@g.us'), 'Unnamed group');
  assert.equal(names.chatLabel(`panel:mochi:${GROUP}`), 'Panel test in Morges rides', 'the test console, in words');
  assert.equal(names.chatLabel('panel:mochi'), 'Panel test');
  assert.equal(names.chatLabel('41790000777@s.whatsapp.net'), '+41790000777');
  assert.equal(names.chatLabel('55555@lid'), 'Unknown (hidden number)');
  names.rememberGroupNames([{ id: 'shop#777@g.us', name: 'Shop team' }]);
  assert.equal(names.chatLabel('shop#777@g.us'), 'Shop team');
  // the admin MCP and the owner assistant read the same names
  const rows = await tool('list_silences');
  assert.equal(rows.find((r) => r.chat === GROUP).chatName, 'Morges rides');
});

test('a group WhatsApp does not name is asked again only after ten minutes, a few groups per tick', async () => {
  const quiet = Array.from({ length: 5 }, (_, i) => `12036300000000077${i}@g.us`);
  const orig = t.channel.chatName;
  const askedFor = [];
  t.channel.chatName = async (chat) => { askedFor.push(chat); return ''; };
  for (const chat of quiet) t.events.activity('config', { chat, summary: 'a group with no name yet' });
  const rows = (await t.api(owner, 'GET', '/api/activity?limit=5')).body;
  assert.ok(rows.every((r) => r.chatName === 'Unnamed group'));
  const now = Date.now();
  assert.equal(await names.namesTick(t.channel, now), 3, 'bounded per tick');
  assert.equal(await names.namesTick(t.channel, now + 30000), 2, 'the rest on the next tick');
  assert.equal(await names.namesTick(t.channel, now + 60000), 0, 'not asked again so soon');
  assert.equal(await names.namesTick(t.channel, now + 11 * 60000), 3, 'asked again after ten minutes');
  assert.equal(new Set(askedFor).size, 5);
  t.channel.chatName = orig;
});

test('073: activity (API and live stream), pending changes and usage by chat carry the chat name', async () => {
  t.events.activity('config', { chat: GROUP, summary: 'something about the group' });
  const a = (await t.api(owner, 'GET', `/api/activity?chat=${encodeURIComponent(GROUP)}`)).body[0];
  assert.equal(a.chatName, 'Morges rides');
  assert.equal((await tool('list_activity', { chat: GROUP }))[0].chatName, 'Morges rides');
  t.db.addPending({ code: 'ABC123', agent: 'panduga', server: 'panduga', confirmTool: 'confirm', confirmId: 'x', tool: 'panduga:agenda_create_preview', chat: GROUP, requester: '', summary: 'add', expires: Date.now() + 60000 });
  assert.equal((await t.api(owner, 'GET', '/api/pending')).body.find((p) => p.code === 'ABC123').chatName, 'Morges rides');
  recordUsage({ agent: 'panduga', chat: GROUP, provider: 'anthropic', model: 'claude-haiku-5-5', feature: 'reply', input: 10, output: 5 });
  const u = (await t.api(owner, 'GET', '/api/usage?groupBy=chat&period=1d')).body.rows.find((r) => r.key === GROUP);
  assert.equal(u.chatName, 'Morges rides');
  // live: the event stream names the chat too
  const res = await fetch(`${t.base}/api/events`, { headers: { cookie: owner } });
  const reader = res.body.getReader();
  t.events.activity('config', { chat: GROUP, summary: 'live one' });
  let text = '';
  for (let i = 0; i < 20 && !text.includes('live one'); i++) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  assert.match(text, /"summary":"live one"[^\n]*"chatName":"Morges rides"|"chatName":"Morges rides"[^\n]*"summary":"live one"/);
});

test('073: a person\'s page — their direct chat, the groups they wrote in, also when not in People; admins only', async () => {
  const pr = (await t.api(owner, 'POST', '/api/people', { phone: '41790000002', name: 'Priya' })).body;
  await t.api(owner, 'POST', `/api/people/${pr.id}/notes`, { text: 'treasurer' });
  await t.agents.bindChat('41790000002@s.whatsapp.net', 'panduga');
  t.chatPrefs.noteChat({ chat: '41790000002@s.whatsapp.net', isGroup: false, name: 'Priya', phone: '41790000002' });
  await t.route(t.msg({ chat: 'g1@g.us', msgId: 'p1', phone: '41790000002', senderJid: '41790000002@s.whatsapp.net', senderName: 'Priya', text: 'hello' })); // 079: noted as a chat of theirs
  const p = (await t.api(owner, 'GET', '/api/people/41790000002')).body;
  assert.equal(p.name, 'Priya');
  assert.equal(p.timeline.find((n) => n.kind === 'note').text, 'treasurer');
  assert.deepEqual(p.direct.map((c) => [c.id, c.name, c.agentName]), [['41790000002@s.whatsapp.net', 'Priya', 'Panduga']]);
  assert.deepEqual(p.groups.map((c) => [c.id, c.name]), [['g1@g.us', 'Panduga families']]);
  assert.ok(p.groups[0].lastAt);
  // a number that is not in People still has a page
  const q = (await t.api(owner, 'GET', '/api/people/41790000888')).body;
  assert.equal(q.notInPeople, true);
  assert.equal(q.name, '+41790000888');
  assert.equal((await t.api(viewer, 'GET', '/api/people/41790000002')).status, 403);
  assert.equal((await tool('get_person', { person: '+41 79 000 00 02' })).name, 'Priya');
});
