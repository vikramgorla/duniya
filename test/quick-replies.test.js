// 054 (#102): quick replies, !help, welcome message and FAQ auto-answers — built in, no AI, no tokens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './harness.js';

let t; let owner;
const ORG = '41790000001'; const MEMBER = '41790000002';
const CHAT = 'g7@g.us';
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  const r = await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Rides', triggers: ['carpool'], organizers: [ORG], timezone: 'Europe/Zurich',
    quickReplies: [
      { command: '!rides', text: 'Hi {name}! Rides in {group} on {date}: Anu drives Monday.' },
      { command: '!admin', text: 'Organizer tools: …', who: 'organizers' },
    ],
    faq: { items: [{ questions: ['When does the school bus leave in the morning?'], keywords: ['bus', 'departure'], answer: 'The bus leaves at 8:05 from the school gate.' }] } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await t.api(owner, 'POST', '/api/chats/bind', { chat: CHAT, agent: 'rides' });
  t.channel.chatName = async (chat) => (chat === CHAT ? 'School run' : chat === 'g1@g.us' ? 'Panduga families' : '');
});
after(() => t.close());

const say = async (text, o = {}) => {
  const n = t.sent.length; const m = t.claudeReqs.length;
  await t.route(t.msg({ chat: CHAT, phone: MEMBER, text, ...o }));
  return { reply: t.sent.length > n ? t.sent.at(-1).text : null, model: t.claudeReqs.length > m };
};
const update = (patch) => t.api(owner, 'PUT', '/api/agents/rides', patch);

test('quick reply answers before the model, with placeholders, case-insensitive, as the leading word', async () => {
  const r = await say('!Rides');
  assert.equal(r.model, false);
  assert.match(r.reply, /^Hi Anu! Rides in School run on \w+day \d+ \w+ \d{4}: Anu drives Monday\.$/);
  assert.match((await say('!rides please, for tomorrow')).reply, /^Hi Anu/);
  assert.match((await say('carpool !rides')).reply, /^Hi Anu/, 'after a trigger');
  assert.equal((await say('!ridesx')).reply, null, 'a different word is not the command');
  assert.equal((await say('who has !rides')).reply, null, 'only as the first word');
});

test('organizer-only quick reply: participants get nothing built in, organizers get the answer', async () => {
  assert.equal((await say('!admin')).reply, null);
  assert.equal((await say('!admin', { phone: ORG })).reply, 'Organizer tools: …');
  // Addressed to the agent: a participant's message goes to the model as usual.
  t.script.push([{ type: 'text', text: 'Ask an organizer.' }]);
  const r = await say('carpool !admin');
  assert.equal(r.model, true); assert.equal(r.reply, 'Ask an organizer.');
});

test('!help lists the commands this person may use and the triggers, only when switched on', async () => {
  assert.equal((await say('!help')).reply, null);
  await update({ help: true });
  const p = (await say('!help')).reply;
  assert.match(p, /!rides/); assert.doesNotMatch(p, /!admin/); assert.match(p, /"carpool"/);
  assert.match((await say('!help', { phone: ORG })).reply, /!admin \(organizers\)/);
});

test('FAQ: answers matching messages that wake the agent; strictness; no match goes to the model with the FAQ as context', async () => {
  assert.equal((await say('carpool bus departure?')).reply, 'The bus leaves at 8:05 from the school gate.', 'all keywords');
  assert.equal((await say('carpool when does the school bus leave?')).reply, 'The bus leaves at 8:05 from the school gate.', 'most of the question (normal)');
  assert.equal((await say('when does the school bus leave?')).reply, null, 'not addressed: silent');
  await update({ faq: { items: (await t.api(owner, 'GET', '/api/agents/rides')).body.config.faq.items, strictness: 'strict' } });
  t.script.push([{ type: 'text', text: 'Let me check.' }]);
  let r = await say('carpool when does the school bus leave?');
  assert.equal(r.model, true, 'strict: three of four words is not enough');
  const system = JSON.stringify(t.claudeReqs.at(-1).system);
  assert.match(system, /Reference answers/); assert.match(system, /8:05 from the school gate/);
  assert.equal((await say('carpool when does the school bus leave in the morning, please?')).reply, 'The bus leaves at 8:05 from the school gate.', 'strict: the whole question');
  t.script.push([{ type: 'text', text: 'No idea.' }]);
  r = await say('carpool what about lunch?');
  assert.equal(r.model, true); assert.equal(r.reply, 'No idea.');
  // "Answer FAQ in the whole group": no trigger needed; other messages stay silent.
  await update({ faq: { items: (await t.api(owner, 'GET', '/api/agents/rides')).body.config.faq.items, strictness: 'normal', wholeGroup: true } });
  assert.equal((await say('bus departure today?')).reply, 'The bus leaves at 8:05 from the school gate.');
  r = await say('nice weather today');
  assert.equal(r.reply, null); assert.equal(r.model, false);
});

test('built-in answers are counted as 0-cost usage (quick reply / faq)', async () => {
  const u = (await t.api(owner, 'GET', '/api/usage?groupBy=kind&agent=rides')).body;
  const row = (k) => u.rows.find((x) => x.key === k);
  assert.ok(row('quick reply')?.calls >= 3); assert.equal(row('quick reply').cost, 0); assert.equal(row('quick reply').input, 0);
  assert.ok(row('faq')?.calls >= 2); assert.equal(row('faq').cost, 0);
});

test('test console shows which path answered: quick reply, FAQ or model', async () => {
  const tryIt = async (text, role = 'participant') => (await t.api(owner, 'POST', '/api/agents/rides/test', { role, text })).body;
  let r = await tryIt('!rides');
  assert.equal(r.path, 'quick'); assert.match(r.reply, /^Hi Panel admin! Rides in this chat/); assert.equal(r.answeredBy, 'quick reply !rides');
  r = await tryIt('bus departure');
  assert.equal(r.path, 'faq'); assert.equal(r.answeredBy, 'FAQ');
  t.script.push([{ type: 'text', text: 'Model here.' }]);
  r = await tryIt('hello there');
  assert.equal(r.path, 'model'); assert.equal(r.reply, 'Model here.');
});

test('validation: one-word commands, no duplicates, FAQ needs a question or keywords', async () => {
  assert.equal((await update({ quickReplies: [{ command: 'two words', text: 'x' }] })).status, 400);
  assert.equal((await update({ quickReplies: [{ command: '!a1', text: 'x' }, { command: '!A1', text: 'y' }] })).status, 400);
  assert.equal((await update({ quickReplies: [{ command: '!x', text: 'x', who: 'admins' }] })).status, 400);
  assert.equal((await update({ faq: { items: [{ answer: 'x' }] } })).status, 400);
  assert.equal((await update({ faq: { items: [], strictness: 'loose' } })).status, 400);
});

// ---------- welcome ----------
const person = (n) => ({ jid: `4179000010${n}@s.whatsapp.net`, phone: `4179000010${n}` });
const sentSince = (n) => t.sent.slice(n);
const settle = () => new Promise((r) => setTimeout(r, 120));

test('welcome: off by default; on → one welcome per person per group, with a mention, group name and rules', async () => {
  let n = t.sent.length;
  await t.onJoin({ chat: CHAT, participants: [person(1)] });
  await settle();
  assert.equal(sentSince(n).length, 0, 'welcome is off');
  await update({ welcome: { enabled: true, text: 'Welcome {name} to {group}!', rules: 'Be kind. No spam.' } });
  n = t.sent.length;
  await t.onJoin({ chat: CHAT, participants: [person(1)] });
  await t.waitFor(() => t.sent.length > n);
  const w = t.sent.at(-1);
  assert.equal(w.text, 'Welcome @41790000101 to School run!\n\nBe kind. No spam.');
  assert.deepEqual(w.mentions, ['41790000101@s.whatsapp.net']);
  n = t.sent.length;
  await t.onJoin({ chat: CHAT, participants: [person(1)] });
  await settle();
  assert.equal(sentSince(n).length, 0, 'once per person per group');
  const rows = t.db.db.prepare('SELECT key FROM welcome_seen').all();
  assert.ok(rows.length >= 1 && rows.every((r) => /^[0-9a-f]{64}$/.test(r.key)), 'only hashes are stored');
});

test('welcome: bulk adds get one combined message', async () => {
  const n = t.sent.length;
  await t.onJoin({ chat: CHAT, participants: [person(2), person(3)] });
  await t.onJoin({ chat: CHAT, participants: [person(4)] });
  await t.waitFor(() => t.sent.length > n);
  await settle();
  const out = sentSince(n);
  assert.equal(out.length, 1);
  assert.match(out[0].text, /^Welcome @41790000102, @41790000103 and @41790000104 to School run!/);
  assert.equal(out[0].mentions.length, 3);
});

test('welcome: nothing when the chat is off, the agent is off or the chat override says off; the override can switch it on', async () => {
  const n = t.sent.length;
  t.chatPrefs.setChatPrefs(CHAT, { enabled: false });
  await t.onJoin({ chat: CHAT, participants: [person(5)] });
  t.chatPrefs.setChatPrefs(CHAT, { enabled: true });
  await update({ enabled: false });
  await t.onJoin({ chat: CHAT, participants: [person(5)] });
  await update({ enabled: true });
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(CHAT)}/prefs`, { welcome: 'off' })).status, 200);
  await t.onJoin({ chat: CHAT, participants: [person(5)] });
  await settle();
  assert.equal(sentSince(n).length, 0);
  const chats = (await t.api(owner, 'GET', '/api/chats')).body;
  assert.equal(chats.find((c) => c.id === CHAT)?.welcome, 'off');
  // Agent welcome off, chat override on → welcomed (default text when the agent has none).
  await update({ welcome: { enabled: false, text: '', rules: '' } });
  await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(CHAT)}/prefs`, { welcome: 'on' });
  await t.onJoin({ chat: CHAT, participants: [person(5)] });
  await t.waitFor(() => t.sent.length > n);
  assert.equal(t.sent.at(-1).text, 'Welcome @41790000105 to School run! 👋');
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(CHAT)}/prefs`, { welcome: 'maybe' })).status, 400);
  await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(CHAT)}/prefs`, { welcome: 'inherit' });
});

test('welcome: the privacy notice comes first when the group was just switched on', async () => {
  t.store.updateSettings({ privacyNotice: { enabled: true } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: 'g8@g.us', agent: 'rides' });
  await update({ welcome: { enabled: true, text: 'Hello {name}!', rules: '' } });
  t.chatPrefs.setChatPrefs('g8@g.us', { enabled: true }); // switched on without the panel: notice not posted yet
  const n = t.sent.length;
  await t.onJoin({ chat: 'g8@g.us', participants: [person(6)] });
  await t.waitFor(() => t.sent.length >= n + 2);
  const out = sentSince(n);
  assert.match(out[0].text, /Messages in this group are stored/);
  assert.equal(out[1].text, 'Hello @41790000106!');
  t.store.updateSettings({ privacyNotice: { enabled: false } });
});

test('welcome is counted as 0-cost usage and logged without names', async () => {
  const u = (await t.api(owner, 'GET', '/api/usage?groupBy=kind&agent=rides')).body;
  assert.ok(u.rows.find((x) => x.key === 'welcome')?.calls >= 3);
  const w = t.db.listActivity({ agent: 'rides', limit: 200 }).filter((a) => /^Welcome posted/.test(a.summary));
  assert.ok(w.length >= 3);
  assert.ok(w.every((a) => !/@|4179/.test(a.summary)), 'counts only, no people');
});

test('WhatsApp channel: group-participants.update (add) reaches the join handler; the number itself is skipped', async () => {
  const { createWhatsAppChannel } = await import('../src/channels/whatsapp.js');
  let sock;
  const ch = createWhatsAppChannel({ authDir: mkdtempSync(join(tmpdir(), 'wa-auth-')), deps: {
    makeSocket: () => (sock = { ev: new EventEmitter(), user: { id: '41790000099:3@s.whatsapp.net', lid: '99999@lid' }, sendMessage: async () => ({ key: { id: 'S1' } }), end: () => {}, logout: async () => {} }),
    fetchVersion: async () => ({ version: [2, 3000, 1] }) } });
  const joins = [];
  await ch.start(async () => {}, { onJoin: async (ev) => { joins.push(ev); } });
  sock.ev.emit('connection.update', { connection: 'open' });
  sock.ev.emit('group-participants.update', { id: 'g1@g.us', author: 'x', action: 'add', participants: [
    { id: '777@lid', phoneNumber: '41790000107@s.whatsapp.net' }, { id: '41790000099@s.whatsapp.net' }, '41790000108@s.whatsapp.net'] });
  sock.ev.emit('group-participants.update', { id: 'g1@g.us', author: 'x', action: 'remove', participants: [{ id: '41790000109@s.whatsapp.net' }] });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(joins, [{ chat: 'g1@g.us', participants: [{ jid: '777@lid', phone: '41790000107' }, { jid: '41790000108@s.whatsapp.net', phone: '41790000108' }] }]);
});

test('admin MCP / owner assistant tool set_agent_quick_answers changes only the parts given; set_chat_settings sets the welcome override', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const x = { call: async (m, p, b) => (await t.api(owner, m, p, b)).body };
  const tool = (n) => TOOLS.find((d) => d.name === n);
  const before = (await x.call('GET', '/api/agents/rides')).config;
  const out = await tool('set_agent_quick_answers').run({ agent_id: 'rides', quick_replies: [{ command: '!rules', text: 'Be on time.' }], faq: { whole_group: false } }, x);
  assert.deepEqual(out.config.quickReplies, [{ command: '!rules', text: 'Be on time.', who: 'everyone' }]);
  assert.equal(out.config.faq.wholeGroup, false);
  assert.deepEqual(out.config.faq.items, before.faq.items, 'FAQ items kept');
  assert.deepEqual(out.config.welcome, before.welcome, 'welcome kept');
  await tool('set_chat_settings').run({ chat: CHAT, welcome: 'off' }, x);
  assert.equal((await x.call('GET', '/api/chats')).find((c) => c.id === CHAT).welcome, 'off');
});
