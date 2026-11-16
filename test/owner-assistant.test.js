// 044 owner assistant (#50): linking, scope, roles, confirmations, Ask box, privacy notice.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ privacyNotice: true, env: { RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const admin = await t.login('ada', 'admin password 123');
const viewer = await t.login('vera', 'viewer password 123');
const oa = await import('../src/core/owner-assistant.js');
const notice = await import('../src/core/privacy-notice.js');
const { TOOLS } = await import('../src/panel/admin-tools.js');
after(() => t.close());

const OWNER_PHONE = '41790000001'; // also an organizer of both agents (trigger passthrough)
const ownerDm = `${OWNER_PHONE}@s.whatsapp.net`;
const dm = (phone, text, o = {}) => t.msg({ isGroup: false, chat: `${phone}@s.whatsapp.net`, phone, senderName: 'Vik', text, ...o });
const isOwnerReq = (r) => String(r.system || '').startsWith('You are the owner assistant');
const ownerReqs = () => t.claudeReqs.filter(isOwnerReq);
const sentTo = (chat) => t.sent.filter((m) => m.chat === chat);
const lastTo = (chat) => sentTo(chat).at(-1)?.text || '';
const acts = (type) => t.db.listActivity({ limit: 300 }).filter((a) => a.type === type);
const toolResult = (req) => req.messages.at(-1).content.find((b) => b.type === 'tool_result');

test('044: privacy notice — first agent reply in a DM carries the DM notice once per person', async () => {
  t.script.push([{ type: 'text', text: 'helper here' }], [{ type: 'text', text: 'again' }]);
  await t.route(dm(OWNER_PHONE, '!help hi'));
  assert.equal(lastTo(ownerDm), `helper here\n\n_${notice.DEFAULT_DM_TEXT}_`);
  await t.route(dm(OWNER_PHONE, '!help again'));
  assert.equal(lastTo(ownerDm), 'again', 'only once per person');
});

test('044: linking — code from the panel, sent from WhatsApp, confirmed in the panel; expiry and wrong codes', async () => {
  assert.equal((await t.api(owner, 'GET', '/api/owner-assistant')).body.link.status, 'none');
  // a code that expires
  const old = (await t.api(owner, 'POST', '/api/owner-assistant/link')).body;
  assert.match(old.code, /^[A-Z2-9]{6}$/);
  assert.equal(old.message, `link ${old.code}`);
  t.db.db.prepare('UPDATE owner_links SET expires_at = ?').run(Date.now() - 1);
  await t.route(dm(OWNER_PHONE, `link ${old.code}`));
  assert.equal((await t.api(owner, 'GET', '/api/owner-assistant')).body.link.status, 'none', 'expired');

  const { code } = (await t.api(owner, 'POST', '/api/owner-assistant/link')).body;
  assert.equal((await t.api(owner, 'POST', '/api/owner-assistant/link/confirm')).status, 409, 'nothing sent yet');
  await t.route(dm(OWNER_PHONE, 'link ZZZZZZ'));
  assert.match(lastTo(ownerDm), /not valid or has expired/);
  // WhatsApp hides the number (LID): never linked
  await t.route(t.msg({ isGroup: false, chat: 'abc@lid', phone: '', senderJid: 'abc@lid', text: `link ${code}` }));
  assert.match(lastTo('abc@lid'), /did not share your phone number/);
  // LID sender whose number the channel resolved: linked by that number
  await t.route(dm(OWNER_PHONE, `link ${code.toLowerCase()}`, { chat: ownerDm, senderJid: '123@lid' }));
  assert.match(lastTo(ownerDm), /confirm in the panel/);
  const st = (await t.api(owner, 'GET', '/api/owner-assistant')).body.link;
  assert.equal(st.status, 'pending');
  assert.equal(st.phone, OWNER_PHONE);
  assert.equal(oa.userForPhone(OWNER_PHONE), null, 'not active before the panel confirms');
  const ok = await t.api(owner, 'POST', '/api/owner-assistant/link/confirm');
  assert.equal(ok.body.status, 'linked');
  assert.equal(oa.userForPhone(`+${OWNER_PHONE}`).username, 'admin');
  assert.equal((await t.api(owner, 'GET', '/api/owner-assistant')).body.links.length, 1, 'owners see every link');
  assert.equal((await t.api(admin, 'GET', '/api/owner-assistant')).body.links, undefined);
  assert.ok(acts('owner.link').some((a) => /linked to admin/.test(a.summary)));
});

test('044: linked DMs go to the owner assistant, stored in its own scope; triggers still reach agents', async () => {
  const before = t.claudeReqs.length;
  t.script.push([{ type: 'text', text: 'All quiet today.' }]);
  await t.route(dm(OWNER_PHONE, 'anything new?'));
  assert.equal(lastTo(ownerDm), 'All quiet today.');
  assert.ok(isOwnerReq(t.claudeReqs.at(-1)));
  assert.equal(t.claudeReqs.length, before + 1);
  assert.ok(!t.db.listMessages(ownerDm, { limit: 200 }).some((m) => /anything new|All quiet/.test(m.text)), 'not in chat memory');
  assert.deepEqual(oa.ownerHistory(1, 'whatsapp').map((m) => m.text), ['anything new?', 'All quiet today.']);
  assert.ok(acts('owner.question').some((a) => /admin \(owner, WhatsApp\) asked: anything new\?/.test(a.summary)));

  t.script.push([{ type: 'text', text: 'dice ready' }]);
  await t.route(dm(OWNER_PHONE, '!help roll'));
  assert.equal(lastTo(ownerDm), 'dice ready');
  assert.ok(!isOwnerReq(t.claudeReqs.at(-1)), '"!help …" reached the Helper agent');

  // groups are never answered by the owner assistant
  const n = ownerReqs().length;
  t.script.push([{ type: 'text', text: 'agent reply' }]);
  await t.route(t.msg({ phone: OWNER_PHONE, text: 'hello group' }));
  await t.route(t.msg({ phone: OWNER_PHONE, text: '!panduga hi' }));
  assert.equal(ownerReqs().length, n);
});

test('044: numbers that are not linked are ignored by the owner assistant', async () => {
  const n = ownerReqs().length;
  t.script.push([{ type: 'text', text: 'member answer' }]);
  await t.route(dm('41790000002', 'what is new in all chats?'));
  assert.equal(ownerReqs().length, n);
  await t.route(dm('41799999999', 'hello?'));
  assert.equal(ownerReqs().length, n);
  assert.ok(!sentTo('41799999999@s.whatsapp.net').length);
});

test('044: private and switched-off chats are invisible to cross-chat tools', async () => {
  t.db.logMessage({ chat: 'g1@g.us', sender: '41790000002', name: 'Anu', text: 'We take the 9:10 train' });
  t.db.logMessage({ chat: 'g2@g.us', sender: '41790000003', name: 'Ravi', text: 'Secret train surprise for Anu' });
  t.db.logMessage({ chat: 'g7@g.us', sender: '41790000003', name: 'Ravi', text: 'Train in an off chat' });
  t.chatPrefs.setChatPrefs('g7@g.us', { enabled: false });
  assert.equal((await t.api(admin, 'PUT', `/api/chats/${encodeURIComponent('g2@g.us')}/prefs`, { private: true })).body.private, true);
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => /private to members/.test(a.summary)));
  assert.equal((await t.api(owner, 'GET', '/api/chats')).body.find((c) => c.id === 'g2@g.us').private, true);

  t.script.push([{ type: 'tool_use', id: 's1', name: 'search_messages', input: { query: 'train' } }], [{ type: 'text', text: 'Anu said 9:10.' }]);
  const r = await t.api(owner, 'POST', '/api/owner/ask', { question: 'who talked about the train?' });
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, 'Anu said 9:10.');
  const out = toolResult(t.claudeReqs.at(-1)).content;
  assert.match(out, /9:10 train/);
  assert.doesNotMatch(out, /Secret|off chat/);

  t.script.push([{ type: 'tool_use', id: 's2', name: 'chat_recap', input: { chat: 'g2@g.us' } }, { type: 'tool_use', id: 's3', name: 'list_chats', input: {} },
    { type: 'tool_use', id: 's4', name: 'list_chat_messages', input: { chat: 'g2@g.us' } }], [{ type: 'text', text: 'ok' }]);
  await t.api(owner, 'POST', '/api/owner/ask', { question: 'recap the carpool' });
  const res = t.claudeReqs.at(-1).messages.at(-1).content;
  assert.ok(res[0].is_error && /not visible/.test(res[0].content));
  assert.ok(!res[1].is_error && /g1@g\.us/.test(res[1].content) && !/g2@g\.us/.test(res[1].content), 'list_chats hides private chats');
  assert.ok(res[2].is_error, 'admin tools with a chat argument are guarded too');

  t.script.push([{ type: 'tool_use', id: 's5', name: 'list_visible_chats', input: {} }], [{ type: 'text', text: 'ok' }]);
  await t.api(owner, 'POST', '/api/owner/ask', { question: 'which chats are quiet?' });
  const vis = JSON.parse(toolResult(t.claudeReqs.at(-1)).content);
  assert.ok(vis.some((c) => c.chat === 'g1@g.us' && c.name === 'Panduga families' && c.messages >= 1));
  assert.ok(!vis.some((c) => ['g2@g.us', 'g7@g.us'].includes(c.chat)));
});

test('044: tool sets follow the panel role; no tool takes secret values (060)', async () => {
  const toolsOf = async (cookie) => { t.script.push([{ type: 'text', text: 'hi' }]); await t.api(cookie, 'POST', '/api/owner/ask', { question: 'hi' }); return t.claudeReqs.at(-1).tools.map((x) => x.name); };
  const v = await toolsOf(viewer);
  assert.ok(v.includes('list_visible_chats') && v.includes('list_agents') && v.includes('get_usage'));
  for (const name of ['search_messages', 'chat_recap', 'list_chat_messages', 'update_agent', 'set_agent_enabled']) assert.ok(!v.includes(name), `viewer: ${name}`);
  const a = await toolsOf(admin);
  assert.ok(a.includes('search_messages') && a.includes('update_agent') && a.includes('set_chat_private'));
  assert.ok(!a.includes('list_users') && !a.includes('restart_app'), 'owner-only tools');
  const o = await toolsOf(owner);
  assert.ok(o.includes('list_users') && o.includes('restart_app'));
  for (const name of ['set_secret', 'add_user', 'send_signup_link', 'restore_backup']) assert.ok(o.includes(name), `offered: ${name}`);
  assert.ok(!o.includes('confirm_action'), 'confirmations come from the user, not the model');
  for (const tl of TOOLS) for (const k of Object.keys(tl.input || {})) assert.ok(!['value', 'password', 'passphrase', 'key', 'token'].includes(k), `${tl.name} takes a secret: ${k}`);
  // a tool the role does not have is refused even if the model calls it
  t.script.push([{ type: 'tool_use', id: 'v1', name: 'search_messages', input: { query: 'train' } }], [{ type: 'text', text: 'no' }]);
  await t.api(viewer, 'POST', '/api/owner/ask', { question: 'search' });
  assert.ok(toolResult(t.claudeReqs.at(-1)).is_error);
});

test('044: changes need "confirm XXXX" in WhatsApp (or Confirm in the panel), single-use and bound to the surface', async () => {
  t.script.push([{ type: 'tool_use', id: 'c1', name: 'set_agent_enabled', input: { agent_id: 'helper', enabled: false } }], [{ type: 'text', text: 'I can turn Helper off.' }]);
  await t.route(dm(OWNER_PHONE, 'turn helper off'));
  const text = lastTo(ownerDm);
  const code = /confirm ([A-Z2-9]{4})/.exec(text)[1];
  assert.match(text, /I can turn Helper off\.[\s\S]*set_agent_enabled/);
  assert.equal(t.agents.getAgent('helper').enabled, true, 'not done before confirm');
  assert.match(toolResult(t.claudeReqs.at(-1)).content, /held_for_confirmation/);
  // not from the panel
  assert.match((await t.api(owner, 'POST', '/api/owner/ask/confirm', { code })).body.reply, /in WhatsApp/);
  await t.route(dm(OWNER_PHONE, `confirm ${code.toLowerCase()}`));
  assert.match(lastTo(ownerDm), new RegExp(`^Done \\(${code}\\)`));
  assert.equal(t.agents.getAgent('helper').enabled, false);
  assert.ok(acts('owner.action').some((a) => a.summary.includes(code)));
  await t.route(dm(OWNER_PHONE, `confirm ${code}`));
  assert.match(lastTo(ownerDm), /unknown or expired/, 'single use');

  // panel: Confirm / Cancel buttons
  t.script.push([{ type: 'tool_use', id: 'c2', name: 'set_agent_enabled', input: { agent_id: 'helper', enabled: true } }], [{ type: 'text', text: 'Ready.' }]);
  const r = (await t.api(admin, 'POST', '/api/owner/ask', { question: 'turn helper on' })).body;
  assert.equal(r.confirms.length, 1);
  assert.doesNotMatch(r.reply, /confirm [A-Z2-9]{4}/, 'the panel shows buttons instead');
  assert.match((await t.api(owner, 'POST', '/api/owner/ask/confirm', { code: r.confirms[0].code })).body.reply, /another person/);
  assert.match((await t.api(admin, 'POST', '/api/owner/ask/confirm', { code: r.confirms[0].code })).body.reply, /^Done/);
  assert.equal(t.agents.getAgent('helper').enabled, true);
  assert.equal((await t.api(admin, 'POST', '/api/owner/ask/confirm', { code: r.confirms[0].code })).status, 404);

  t.script.push([{ type: 'tool_use', id: 'c3', name: 'set_agents_paused', input: { paused: true } }], [{ type: 'text', text: 'Ready.' }]);
  const c = (await t.api(admin, 'POST', '/api/owner/ask', { question: 'pause all' })).body.confirms[0];
  assert.match((await t.api(admin, 'POST', '/api/owner/ask/confirm', { code: c.code, cancel: true })).body.reply, /Cancelled/);
  assert.equal(t.store.getSettings().paused, false);
});

test('044: an agent\'s own confirm code still reaches the agent', async () => {
  t.script.push([{ type: 'tool_use', id: 'p1', name: 'panduga__room_assign_preview', input: {} }], [{ type: 'text', text: 'Preview ready' }]);
  await t.route(dm(OWNER_PHONE, '!panduga put Rao in room 4'));
  const m = /confirm ([A-Z2-9]{4})/.exec(lastTo(ownerDm));
  assert.ok(m, 'the agent prepared a change')
  const n = ownerReqs().length;
  await t.route(dm(OWNER_PHONE, `confirm ${m[1]}`));
  assert.equal(ownerReqs().length, n);
  assert.match(lastTo(ownerDm), /^Done/);
});

test('044: Ask box API — sign-in required, history, long answers chunked for WhatsApp', async () => {
  const r = await fetch(`${t.base}/api/owner/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"question":"hi"}' });
  assert.equal(r.status, 401);
  assert.equal((await t.api(viewer, 'POST', '/api/owner/ask', { question: '' })).status, 400);
  const h = (await t.api(admin, 'GET', '/api/owner/ask/history')).body;
  assert.ok(h.some((m) => m.role === 'user' && m.text === 'turn helper on'));

  const parts = oa.chunkText(`${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}\n\n${'c'.repeat(500)}`);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= 3000));
  const long = `${'Line one. '.repeat(400)}`;
  t.script.push([{ type: 'text', text: long }]);
  const before = sentTo(ownerDm).length;
  await t.route(dm(OWNER_PHONE, 'give me everything'));
  assert.ok(sentTo(ownerDm).length - before >= 2, 'sent in several messages');
});

test('044: privacy notice — posted once when a group is switched on; text change, 90 days, opt-out, DMs and off chats', async () => {
  const g = 'g5@g.us';
  const enc = encodeURIComponent;
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: false });
  assert.equal(sentTo(g).length, 0, 'switching off posts nothing');
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: true });
  assert.deepEqual(sentTo(g).map((m) => m.text), [notice.DEFAULT_GROUP_TEXT]);
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: false });
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: true });
  assert.equal(sentTo(g).length, 1, 'not again for the same text within 90 days');
  assert.ok(notice.noticePostedAt(g));
  assert.equal((await t.api(owner, 'GET', '/api/chats')).body.find((c) => c.id === 'g1@g.us').noticePostedAt, null);

  assert.equal((await t.api(viewer, 'PUT', '/api/privacy-notice', { text: 'x' })).status, 403);
  assert.equal((await t.api(admin, 'PUT', '/api/privacy-notice', { text: 'Stored for context. Ask Vik.' })).body.text, 'Stored for context. Ask Vik.');
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: false });
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: true });
  assert.equal(lastTo(g), 'Stored for context. Ask Vik.', 'text changed: posted again');
  t.db.db.prepare('UPDATE privacy_notices SET posted_at = ? WHERE chat = ?').run(Date.now() - 91 * 86400000, g);
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: false });
  await t.api(admin, 'PUT', `/api/chats/${enc(g)}/prefs`, { enabled: true });
  assert.equal(sentTo(g).length, 3, 'over 90 days: posted again');

  const g6 = 'g6@g.us';
  await t.api(admin, 'PUT', `/api/chats/${enc(g6)}/prefs`, { enabled: false });
  assert.equal((await t.api(admin, 'PUT', `/api/chats/${enc(g6)}/prefs`, { noticeOff: true })).body.noticeOff, true);
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => a.chat === g6 && /Privacy notice switched OFF/.test(a.summary)), 'opt-out recorded');
  await t.api(admin, 'PUT', `/api/chats/${enc(g6)}/prefs`, { enabled: true });
  assert.equal(sentTo(g6).length, 0);

  const person = '41790000555@s.whatsapp.net';
  await t.api(admin, 'PUT', `/api/chats/${enc(person)}/prefs`, { enabled: true });
  assert.equal(sentTo(person).length, 0, 'never posted in direct messages');

  assert.deepEqual(notice.noticeDecision('g8@g.us'), notice.noticeDecision('g8@g.us'));
  t.chatPrefs.setChatPrefs('g9@g.us', { enabled: false });
  assert.equal((await notice.maybePostNotice('g9@g.us', t.channel)).posted, false, 'chats that are off never get anything');
  await t.api(admin, 'PUT', '/api/privacy-notice', { enabled: false, text: '' });
  assert.equal(notice.noticeSettings().text, notice.DEFAULT_GROUP_TEXT, 'empty text restores the default');
  await t.api(admin, 'PUT', `/api/chats/${enc('g9@g.us')}/prefs`, { enabled: true });
  assert.equal(sentTo('g9@g.us').length, 0, 'notice off');
});

test('044/059: admin MCP tools, its model (the built-in agent record) and unlinking', async () => {
  const names = TOOLS.map((x) => x.name);
  for (const n of ['get_owner_assistant', 'set_chat_private', 'get_privacy_notice', 'set_privacy_notice', 'set_chat_privacy_notice']) assert.ok(names.includes(n), n);
  assert.equal((await t.api(viewer, 'PUT', '/api/agents/owner-assistant', { model: 'auto' })).status, 403);
  assert.equal((await t.api(admin, 'PUT', '/api/agents/owner-assistant', { model: 'nope' })).status, 400);
  assert.equal((await t.api(admin, 'PUT', '/api/agents/owner-assistant', { model: 'anthropic:claude-haiku-5-5' })).body.config.model, 'anthropic:claude-haiku-5-5');
  assert.equal((await t.api(owner, 'GET', '/api/owner-assistant')).body.agent, 'owner-assistant');
  t.script.push([{ type: 'text', text: 'haiku here' }]);
  await t.api(admin, 'POST', '/api/owner/ask', { question: 'which model?' });
  assert.equal(t.claudeReqs.at(-1).model, 'claude-haiku-5-5');

  assert.equal((await t.api(owner, 'DELETE', '/api/owner-assistant/link')).body.ok, true);
  assert.equal(oa.userForPhone(OWNER_PHONE), null);
  const n = ownerReqs().length;
  t.script.push([{ type: 'text', text: 'helper' }]);
  await t.route(dm(OWNER_PHONE, 'hello after unlink'));
  assert.equal(ownerReqs().length, n, 'normal routing again');
});
