// 049 (#92): prepare a direct chat by phone number before the person writes; the first message (phone or LID form,
// any WhatsApp number) goes to the prepared agent with the prepared settings; optional intro behind a confirm.
// 2.57.2: one chat per person — the chat WhatsApp writes from (the LID) is the chat; a phone-form chat set up first
// joins it (settings, agent, memory) and stays as an alias.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fakeNumbers, fakeWhatsAppHub } from './harness.js';

const t = await setup({ privacyNotice: true, chatsOn: true, env: { RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vera', 'viewer password 123');
const notice = await import('../src/core/privacy-notice.js');
const oa = await import('../src/core/owner-assistant.js');
const dc = await import('../src/core/direct-chats.js');
const { TOOLS } = await import('../src/panel/admin-tools.js');
after(() => t.close());

// The panel's channel can check numbers: 4179000099x are "not on WhatsApp"; 41790000704 has a known LID.
t.lookups = [];
t.channel.lookupNumber = async (number, phone) => {
  t.lookups.push({ number, phone });
  return { jid: `${phone}@s.whatsapp.net`, exists: !phone.startsWith('4179000099'), lid: phone === '41790000704' ? '99704@lid' : '' };
};

// The channel hub with two fake numbers, to send messages through the real multi-number path.
const sessions = {};
const fakeFactory = fakeNumbers(sessions);
const reg = await fakeWhatsAppHub(fakeFactory);
await reg.start({ onMessage: t.router.createRouter(reg), onHistory: async () => {} });
await reg.addNumber({ id: 'shop', label: 'Shop' });

const dm = (o) => ({ channel: 'whatsapp', raw: {}, isGroup: false, senderName: 'Vedika', mentioned: false, replyToAgent: false, quoted: '', msgId: `m${Math.random()}`, ts: Date.now(), ...o });
const prepare = (body, cookie = owner) => t.api(cookie, 'POST', '/api/direct-chats', body);
const chatRow = async (id) => (await t.api(owner, 'GET', '/api/chats')).body.find((c) => c.id === id);
const stored = (chat) => t.db.db.prepare('SELECT * FROM messages WHERE chat = ? ORDER BY id').all(chat);

test('049: invalid numbers, unknown agents and numbers are rejected; viewers cannot prepare', async () => {
  for (const phone of ['', 'vedika', '079 123 45 67', '+41 79', '+1234567890123456', '+41 79 12a 45 67']) {
    const r = await prepare({ phone, agent: 'helper' });
    assert.equal(r.status, 400, `${phone}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.field, 'phone');
  }
  assert.equal((await prepare({ phone: '+41 79 000 07 00', agent: 'nope' })).status, 404);
  assert.equal((await prepare({ phone: '+41 79 000 07 00', number: 'nope' })).body.field, 'number');
  assert.equal((await prepare({ phone: '+41 79 000 07 00', agent: 'helper' }, viewer)).status, 403);
  assert.equal(dc.normalizePhone('0041 79 000 07 00'), '41790000700');
  assert.equal(dc.listDirectChats().length, 0, 'nothing saved by failed attempts');
});

test('049: prepared before any message; the first message arrives from the LID and goes to the prepared agent', async () => {
  const r = await prepare({ phone: '+41 79 000 07 01', agent: 'helper', private: true, model: 'anthropic:claude-haiku-5-5', logging: 'minimal' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const chat = '41790000701@s.whatsapp.net';
  assert.equal(r.body.chat, chat);
  assert.equal(r.body.enabled, true, 'on by default when an agent is given');
  assert.equal(r.body.onWhatsApp, true);
  assert.equal(r.body.warning, '');
  let row = await chatRow(chat);
  assert.ok(row, 'listed on the Chats page before any message');
  assert.equal(row.waiting, true);
  assert.equal(row.agent, 'helper');
  assert.equal(row.private, true);
  assert.equal(row.logging, 'minimal');

  // helper only answers organizers in DMs — but an assigned chat always goes to its agent
  t.script.push([{ type: 'text', text: 'Hi Vedika, Helper here.' }]);
  await sessions.main.handler(dm({ chat: 'v701@lid', phone: '41790000701', senderJid: 'v701@lid', text: 'hello' }));
  const lid = 'v701@lid';
  assert.equal(sessions.main.sent.at(-1).jid, lid, 'the reply goes to the chat WhatsApp writes from');
  assert.match(sessions.main.sent.at(-1).text, /^Hi Vedika, Helper here\./);
  assert.equal(t.claudeReqs.at(-1).model, 'claude-haiku-5-5', 'prepared model used');
  assert.equal(stored(lid).length, 2, 'message + reply stored under the one chat');
  row = await chatRow(lid);
  assert.ok(!row.waiting);
  assert.equal(row.agent, 'helper'); assert.equal(row.private, true);
  assert.ok(!(await chatRow(chat)), 'the phone-form chat is not listed separately');
  assert.ok(dc.isChatAlias(chat));

  // later messages from the phone form find the same chat (alias)
  t.script.push([{ type: 'text', text: 'Again' }]);
  await sessions.main.handler(dm({ chat, phone: '41790000701', text: 'still me' }));
  assert.equal(sessions.main.sent.at(-1).jid, lid);
  assert.equal(stored(lid).length, 4);

  // private to members: the owner assistant never sees it
  assert.ok(!oa.visibleChats().includes(lid));
  assert.equal(oa.isVisible(lid), false);
});

test('049: phone form, second WhatsApp number, and a LID learned when the number was checked', async () => {
  // plain phone form
  await prepare({ phone: '+41 79 000 07 02', agent: 'panduga' });
  t.script.push([{ type: 'text', text: 'Panduga here' }]);
  await t.route(dm({ chat: '41790000702@s.whatsapp.net', phone: '41790000702', text: 'hi' }));
  assert.equal(t.sent.at(-1).chat, '41790000702@s.whatsapp.net');
  assert.match(t.sent.at(-1).text, /^Panduga here/);

  // second number: chat key prefixed with the number id, matched from that number's LID only
  const r = await prepare({ phone: '41790000703', number: 'shop', agent: 'helper' });
  assert.equal(r.body.chat, 'shop#41790000703@s.whatsapp.net');
  assert.deepEqual(t.lookups.at(-1), { number: 'shop', phone: '41790000703' });
  t.script.push([{ type: 'text', text: 'Shop helper' }]);
  await sessions.shop.handler(dm({ chat: 's703@lid', phone: '41790000703', text: 'hi shop' }));
  assert.equal(sessions.shop.sent.at(-1).jid, 's703@lid');
  assert.equal(sessions.shop.sent.at(-1).text.split('\n')[0], 'Shop helper');
  assert.equal(stored('shop#s703@lid').length, 2);
  const mainBefore = sessions.main.sent.length;
  await sessions.main.handler(dm({ chat: 's703@lid', phone: '41790000703', text: 'same person, main number' }));
  assert.equal(sessions.main.sent.length, mainBefore, 'not prepared on the main number: stays off there');
  assert.equal(stored('s703@lid').length, 0);

  // LID known from the number check: the chat is set up under it, so the first message finds it even without a phone
  const k = await prepare({ phone: '+41 79 000 07 04', agent: 'helper' });
  assert.equal(k.body.chat, '99704@lid');
  assert.ok(dc.isChatAlias('41790000704@s.whatsapp.net'));
  t.script.push([{ type: 'text', text: 'Found you' }]);
  await t.route(dm({ chat: '99704@lid', phone: '', senderJid: '99704@lid', text: 'hi' }));
  assert.equal(t.sent.at(-1).chat, '99704@lid');
});

test('049: nothing is stored or sent to a model before the prepared chat is on', async () => {
  const r = await prepare({ phone: '+41 79 000 07 05', agent: 'helper', enabled: false });
  assert.equal(r.body.enabled, false);
  const reqs = t.claudeReqs.length; const sent = t.sent.length;
  await t.route(dm({ chat: 'v705@lid', phone: '41790000705', text: 'hello?' }));
  await t.route(dm({ chat: '41790000705@s.whatsapp.net', phone: '41790000705', text: 'hello??' }));
  assert.equal(t.claudeReqs.length, reqs);
  assert.equal(t.sent.length, sent);
  assert.equal(stored('41790000705@s.whatsapp.net').length + stored('v705@lid').length, 0);
  const row = await chatRow('v705@lid');
  assert.ok(!row.enabled, 'still off after joining the LID chat');
  assert.ok(!row.waiting, 'it did arrive (time only, no text)');
});

test('a chat set up on its chat page under the phone number (no prepared entry) and a LID chat seen before become one', async () => {
  const phoneChat = '41790000720@s.whatsapp.net'; const lid = 'v720@lid';
  t.chatPrefs.setChatPrefs(lid, { enabled: false }); // the LID chat was seen and left off
  t.chatPrefs.setChatPrefs(phoneChat, { enabled: true, private: true }); await t.agents.bindChat(phoneChat, 'helper');
  t.script.push([{ type: 'text', text: 'Hi, Helper here.' }]);
  await t.route(dm({ chat: lid, phone: '41790000720', senderJid: lid, text: 'hello' }));
  assert.match(t.sent.at(-1).text, /^Hi, Helper here/, 'answered at once: no second switch-on');
  assert.equal(t.sent.at(-1).chat, lid);
  const row = await chatRow(lid);
  assert.equal(row.agent, 'helper'); assert.equal(row.enabled, true); assert.equal(row.private, true, 'private kept (the stricter choice)');
  assert.ok(!(await chatRow(phoneChat)), 'one chat, not two');
  assert.ok(!t.agents.getAgent('helper').chats.includes(phoneChat));
});

test('049: a number that is not on WhatsApp gets a warning but is still prepared', async () => {
  const r = await prepare({ phone: '+41 79 000 09 91', agent: 'helper' });
  assert.equal(r.status, 200);
  assert.equal(r.body.onWhatsApp, false);
  assert.match(r.body.warning, /not seem to be on WhatsApp/);
  const c = await t.api(owner, 'POST', '/api/direct-chats/check', { phone: '+41 79 000 07 06' });
  assert.equal(c.body.onWhatsApp, true);
  assert.equal(c.body.existing, null);
  assert.equal(dc.getDirectChat('41790000706@s.whatsapp.net'), null, 'check saves nothing');
});

test('049: the intro needs the preview\'s confirm token, the chat on and an agent; carries the DM notice once', async () => {
  t.store.updateSettings({ privacyNotice: { enabled: true, dmFirstReply: true } });
  await prepare({ phone: '+41 79 000 07 07', agent: 'helper' });
  const chat = '41790000707@s.whatsapp.net';
  const enc = encodeURIComponent(chat);
  const sent = t.sent.length;
  assert.equal((await t.api(owner, 'POST', `/api/chats/${enc}/intro`, {})).status, 409, 'no token, no message');
  assert.equal((await t.api(owner, 'POST', `/api/chats/${enc}/intro`, { token: 'made-up' })).status, 409);
  const p = (await t.api(owner, 'POST', `/api/chats/${enc}/intro/preview`, {})).body;
  assert.match(p.text, /^Hi! I'm Helper/);
  assert.equal(p.notice, notice.DEFAULT_DM_TEXT);
  assert.equal(t.sent.length, sent, 'the preview sends nothing');
  assert.equal((await t.api(viewer, 'POST', `/api/chats/${enc}/intro`, { token: p.token })).status, 403);
  const ok = await t.api(owner, 'POST', `/api/chats/${enc}/intro`, { token: p.token });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(t.sent.at(-1).chat, chat);
  assert.equal(t.sent.at(-1).text, `${p.text}\n\n_${notice.DEFAULT_DM_TEXT}_`);
  assert.equal((await t.api(owner, 'POST', `/api/chats/${enc}/intro`, { token: p.token })).status, 409, 'single use');
  const p2 = (await t.api(owner, 'POST', `/api/chats/${enc}/intro/preview`, { text: 'Hello again' })).body;
  assert.equal(p2.notice, '', 'the DM line only once per person');
  // allow-list: a chat that is off never gets an intro; neither does a chat without an agent, or a group
  await t.api(owner, 'PUT', `/api/chats/${enc}/prefs`, { enabled: false });
  assert.equal((await t.api(owner, 'POST', `/api/chats/${enc}/intro/preview`, {})).status, 409);
  await prepare({ phone: '+41 79 000 07 08' });
  assert.equal((await t.api(owner, 'POST', `/api/chats/${encodeURIComponent('41790000708@s.whatsapp.net')}/intro/preview`, {})).status, 409);
  assert.equal((await t.api(owner, 'POST', '/api/chats/g1%40g.us/intro/preview', {})).status, 400);
});

test('049: owner assistant — "assign Mochi to Vedika" in one go, held for confirm; intro only with confirm', async () => {
  await t.agents.createAgent({ id: 'mochi', config: { name: 'Mochi', prompt: 'You are Mochi.', model: 'anthropic:claude-sonnet-5-5', description: 'Helps with homework' } });
  await t.api(owner, 'POST', '/api/people', { phone: '41790000709', name: 'Vedika' });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.api(owner, 'POST', '/api/owner/ask', { question: 'hi' });
  assert.match(t.claudeReqs.at(-1).system, /prepare_direct_chat/, 'the assistant knows to prepare instead of asking them to write first');
  assert.ok(t.claudeReqs.at(-1).tools.some((x) => x.name === 'prepare_direct_chat'));
  t.script.push([{ type: 'tool_use', id: 'a1', name: 'prepare_direct_chat', input: { phone: '+41790000709', agent_id: 'mochi', private: true } }], [{ type: 'text', text: 'Ready to assign Mochi.' }]);
  const r = (await t.api(owner, 'POST', '/api/owner/ask', { question: 'assign Mochi to Vedika' })).body;
  assert.equal(r.confirms.length, 1);
  assert.match(r.confirms[0].preview, /41790000709.*mochi.*switched on.*private/);
  assert.equal(dc.getDirectChat('41790000709@s.whatsapp.net'), null, 'not done before confirm');
  assert.match((await t.api(owner, 'POST', '/api/owner/ask/confirm', { code: r.confirms[0].code })).body.reply, /^Done/);
  const d = dc.getDirectChat('41790000709@s.whatsapp.net');
  assert.equal(d.agent, 'mochi'); assert.equal(d.name, 'Vedika'); assert.equal(d.private, true); assert.equal(d.enabled, true);

  // with an intro: one confirm does both, and the message goes out only then
  const sent = t.sent.length;
  t.script.push([{ type: 'tool_use', id: 'a2', name: 'prepare_direct_chat', input: { phone: '+41790000710', agent_id: 'mochi', send_intro: true, intro_text: 'Hi, I am Mochi!' } }], [{ type: 'text', text: 'Ready.' }]);
  const r2 = (await t.api(owner, 'POST', '/api/owner/ask', { question: 'set up Mochi for +41790000710 and say hi' })).body;
  assert.match(r2.confirms[0].preview, /sends them: "Hi, I am Mochi!"/);
  assert.equal(t.sent.length, sent);
  await t.api(owner, 'POST', '/api/owner/ask/confirm', { code: r2.confirms[0].code });
  assert.equal(t.sent.at(-1).chat, '41790000710@s.whatsapp.net');
  assert.match(t.sent.at(-1).text, /^Hi, I am Mochi!/);
  assert.ok(dc.getDirectChat('41790000710@s.whatsapp.net').introAt);
});

test('049: admin tools — prepare_direct_chat is risky only with send_intro; send_chat_intro always', () => {
  const by = Object.fromEntries(TOOLS.map((x) => [x.name, x]));
  assert.equal(by.prepare_direct_chat.risky({ phone: '1' }), false);
  assert.equal(by.prepare_direct_chat.risky({ phone: '1', send_intro: true }), true);
  assert.equal(by.send_chat_intro.risky, true);
  assert.ok(!by.prepare_direct_chat.readOnly);
});
