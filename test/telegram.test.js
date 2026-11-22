// 077: Telegram as the second channel — a real hub and the real Telegram adapter over a fake Bot API (no network):
// token setup, updates → router → replies, the allow-list, linking a phone with the person's own contact, roles from
// the linked phone, 429 retry_after, polls, supergroup moves, media downloads and lazy loading.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';
import { fakeBotApi, FAKE_TOKEN } from './fake-telegram.js';

const ROOT = resolve(import.meta.dirname, '..');
let t; let fake; let hub; let people; let owner;
const BOT = 7000000001;
const chat = (id) => `tg:${BOT}#${id}`;
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };
const tg = async () => (await hub.channels()).find((c) => c.id === 'telegram');
const ANU = { id: 501, first_name: 'Anu' }; const RAVI = { id: 502, first_name: 'Ravi' }; const ZOE = { id: 503, first_name: 'Zoe' };

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
  fake = fakeBotApi();
  fake.group(-100500, { title: 'Book club', admins: [{ id: 501, first_name: 'Anu', is_bot: false }], members: [502, 503] });
  fake.group(-100600, { title: 'Neighbours', admins: [], members: [502] });
  const { createHub } = await import('../src/channels/hub.js');
  const { createTelegramAdapter } = await import('../src/channels/telegram/index.js');
  people = await import('../src/core/people.js');
  hub = createHub({ loaders: { telegram: async () => createTelegramAdapter({ fetch: fake.fetch, api: 'https://api.telegram.test' }) } });
  await hub.start({ onMessage: t.router.createRouter(hub), onJoin: t.router.createJoinHandler(hub), onChatMoved: t.router.createChatMoveHandler() });
  owner = await t.login();
});
after(async () => { await hub.stop(); t.close(); });

test('077: the token goes in through the one-time secret page, is checked, never returned, and starts Telegram', async () => {
  assert.equal((await tg()).state, 'not_set_up');
  await assert.rejects(hub.setEnabled('telegram', true), (e) => e.status === 409, 'cannot be switched on before a token');
  const bad = await t.api(owner, 'PUT', '/api/secrets', { name: 'TELEGRAM_BOT_TOKEN', value: 'hello' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /@BotFather/);
  const link = await t.api(owner, 'POST', '/api/secret-links', { name: 'TELEGRAM_BOT_TOKEN' });
  const token = /#secret=([a-f0-9]{64})$/.exec(link.body.link)[1];
  assert.equal((await t.api(owner, 'POST', '/api/secret-links/open', { token })).body.for, 'the Telegram bot token');
  assert.equal((await t.api(owner, 'POST', '/api/secret-links/use', { token, value: ` ${FAKE_TOKEN} ` })).status, 200);
  const secrets = await t.api(owner, 'GET', '/api/secrets');
  assert.ok(!JSON.stringify(secrets.body).includes(FAKE_TOKEN), 'the token is never returned');
  assert.ok(await until(async () => (await tg()).connected === 1), 'saving the token connects the bot');
  const row = await tg();
  assert.equal(row.state, 'on');
  assert.equal(row.info.username, 'family_helper_bot');
  assert.equal(row.info.canReadAll, false, 'privacy mode is detected');
  assert.equal(row.info.groupLink, 'https://t.me/family_helper_bot?startgroup=duniya');
  assert.ok(!JSON.stringify(await hub.status()).includes(FAKE_TOKEN), 'nor is it in the status');
});

test('077: a group message that mentions the bot reaches its agent; the reply quotes it, with entities, no HTML', async () => {
  await t.agents.bindChat(chat(-100500), 'panduga');
  t.chatPrefs.setChatPrefs(chat(-100500), { enabled: true });
  t.script.push([{ type: 'text', text: 'Meet at *7 pm* on _Friday_.' }]);
  const before = fake.sent('sendMessage').length;
  fake.say(RAVI, -100500, '@family_helper_bot when do we meet?', { entities: [{ type: 'mention', offset: 0, length: 18 }] });
  assert.ok(await until(() => fake.sent('sendMessage').length > before));
  const reply = fake.sent('sendMessage').at(-1);
  assert.equal(reply.chat_id, '-100500');
  assert.equal(reply.text, 'Meet at 7 pm on Friday.');
  assert.deepEqual(reply.entities.map((e) => e.type), ['bold', 'italic']);
  assert.ok(reply.reply_parameters.message_id > 0, 'quotes the question');
  assert.equal(reply.parse_mode, undefined);
  const turn = JSON.stringify(t.claudeReqs.at(-1));
  assert.match(turn, /when do we meet\?/);
  assert.ok(!turn.includes('@family_helper_bot'), 'the bot mention is dropped from the text');
  assert.match(t.claudeReqs.at(-1).system, /Telegram group/);
  const stored = t.db.listMessages(chat(-100500), {});
  assert.ok(stored.some((m) => /when do we meet/.test(m.text)) && stored.some((m) => m.fromAgent));
  assert.deepEqual((await hub.listChats()).find((c) => c.id === chat(-100500)).name, 'Book club');
});

test('077: a group that is off stores nothing and sends nothing, but shows up in Chats', async () => {
  const reqs = t.claudeReqs.length; const sends = fake.sent('sendMessage').length;
  fake.say(RAVI, -100600, '@family_helper_bot hello?', { entities: [{ type: 'mention', offset: 0, length: 18 }] });
  assert.ok(await until(async () => (await hub.listChats()).some((c) => c.id === chat(-100600))), 'listed (metadata only)');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.claudeReqs.length, reqs, 'no model call');
  assert.equal(fake.sent('sendMessage').length, sends, 'nothing sent');
  assert.equal(t.db.listMessages(chat(-100600), {}).length, 0, 'nothing stored');
});

test('077: /start offers "Share my number"; only the sender\'s own contact links it, a forwarded one never does', async () => {
  fake.say(ANU, 501, '/start');
  assert.ok(await until(() => fake.sent('sendMessage').some((m) => m.chat_id === '501' && m.reply_markup?.keyboard)));
  assert.equal(fake.sent('sendMessage').find((m) => m.chat_id === '501').reply_markup.keyboard[0][0].request_contact, true);

  fake.say(RAVI, 502, null, { contact: { phone_number: '+41 79 000 00 01', first_name: 'Anu', user_id: 501 } }); // Ravi forwards Anu's card
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(people.phoneOfIdentity('telegram', '502'), '', 'a forwarded contact links nothing');
  assert.equal(people.phoneOfIdentity('telegram', '501'), '');

  fake.say(ANU, 501, null, { contact: { phone_number: '+41 79 000 00 01', first_name: 'Anu', user_id: 501 } });
  assert.ok(await until(() => people.phoneOfIdentity('telegram', '501') === '41790000001'));
  assert.ok(fake.sent('sendMessage').some((m) => m.chat_id === '501' && /number is linked/.test(m.text) && m.reply_markup?.remove_keyboard));
  const person = people.personByPhone('41790000001');
  assert.ok(person.identities.some((i) => i.channel === 'telegram' && i.externalId === '501'), 'the same person as on WhatsApp');
});

test('077: roles come from the linked phone; someone unknown is offered "Share my number" instead', async () => {
  t.chatPrefs.setChatPrefs(chat(501), { enabled: true });
  t.chatPrefs.setChatPrefs(chat(503), { enabled: true });
  t.script.push([{ type: 'text', text: 'Hi Anu, organizer here.' }]);
  const reqs = t.claudeReqs.length;
  fake.say(ANU, 501, '!help what can you do?');
  assert.ok(await until(() => fake.sent('sendMessage').some((m) => m.chat_id === '501' && /organizer here/.test(m.text))), 'Helper answers its organizer (DMs: organizers only)');
  assert.match(JSON.stringify(t.claudeReqs[reqs]), /\(organizer\)/);

  const reqs2 = t.claudeReqs.length;
  fake.say(ZOE, 503, '!help what can you do?');
  assert.ok(await until(() => fake.sent('sendMessage').some((m) => m.chat_id === '503' && m.reply_markup?.keyboard)), 'offered to link the number');
  assert.equal(t.claudeReqs.length, reqs2, 'no model call for someone unknown');
  const asks = fake.sent('sendMessage').filter((m) => m.chat_id === '503').length;
  fake.say(ZOE, 503, '!help again?');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fake.sent('sendMessage').filter((m) => m.chat_id === '503').length, asks, 'asked at most once a day');
});

test('077: the owner assistant answers the owner\'s Telegram once their Telegram is linked to their phone', async () => {
  t.db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, code_hash, expires_at, linked_at) SELECT 'default', id, '41790000009', 'linked', NULL, 0, ? FROM users WHERE username = 'admin'").run(Date.now());
  const OWNER = { id: 509, first_name: 'Vik' };
  t.chatPrefs.setChatPrefs(chat(509), { enabled: false });
  fake.say(OWNER, 509, null, { contact: { phone_number: '+41790000009', first_name: 'Vik', user_id: 509 } });
  assert.ok(await until(() => people.phoneOfIdentity('telegram', '509') === '41790000009'));
  t.script.push([{ type: 'text', text: 'All quiet today.' }]);
  fake.say(OWNER, 509, 'anything new?');
  assert.ok(await until(() => fake.sent('sendMessage').some((m) => m.chat_id === '509' && /All quiet today/.test(m.text))));
});

test('077: a 429 waits retry_after and the send goes through; sends keep their order per chat', async () => {
  fake.failNext('sendMessage', { error_code: 429, description: 'Too Many Requests: retry after 1', retry_after: 1 });
  const n = fake.calls.length;
  const started = Date.now();
  const [a, b] = await Promise.all([hub.send(chat(-100500), 'first'), hub.send(chat(-100500), 'second')]);
  assert.ok(Date.now() - started >= 900, 'waited the second Telegram asked for');
  assert.ok(a.msgId && b.msgId);
  const texts = fake.calls.slice(n).filter((c) => c.method === 'sendMessage').map((c) => c.params.text);
  assert.deepEqual(texts, ['first', 'first', 'second'], 'retried, then the next message');
  await assert.rejects(hub.react(chat(-100500), { msgId: '5' }, '🦖'), /only some reactions/);
  await hub.react(chat(-100500), { msgId: '5' }, '✅');
  assert.deepEqual(fake.sent('setMessageReaction').at(-1).reaction, [{ type: 'emoji', emoji: '👌' }], 'mapped to an emoji Telegram allows');
  const long = 'word '.repeat(1500);
  await hub.send(chat(-100500), long);
  assert.ok(fake.sent('sendMessage').slice(-2).every((m) => m.text.length <= 4096), 'long texts are split');
});

test('077: polls: votes arrive as poll answers and are counted; agents only get the tools Telegram has', async () => {
  const { msgId } = await hub.sendPoll(chat(-100500), { name: 'Pizza or pasta?', options: ['Pizza', 'Pasta'] });
  assert.equal(fake.sent('sendPoll').at(-1).is_anonymous, false);
  const poll = t.db.getPoll(chat(-100500), msgId);
  fake.push({ poll_answer: { poll_id: poll.message.slice(3), user: RAVI, option_ids: [1] } });
  assert.ok(await until(() => t.db.pollTally(t.db.getPoll(chat(-100500), msgId)).find((o) => o.name === 'Pasta').votes === 1));
  const { toolsFor } = await import('../src/core/tools.js');
  const names = (await toolsFor(t.agents.getAgent('panduga'), 'organizer', { chat: chat(-100500) })).defs.map((d) => d.name);
  assert.ok(names.includes('whatsapp__create_poll') && names.includes('whatsapp__set_group_subject'));
  assert.ok(!names.includes('whatsapp__add_participants') && !names.includes('whatsapp__block') && !names.includes('whatsapp__profile_info'), 'no adding by phone, blocking or profiles');
  const info = await hub.groupInfo(chat(-100500));
  assert.equal(info.subject, 'Book club');
  assert.equal(info.participants[0].phone, '41790000001', 'an admin who linked their phone shows it');
});

test('077: photos are downloaded through getFile (refused above the limit); a group upgraded to a supergroup keeps its agent and memory', async () => {
  fake.files.set('PHOTO1', Buffer.from('fake-jpeg-bytes'));
  assert.equal(String(await hub.downloadMedia(chat(-100500), 'PHOTO1', 15)), 'fake-jpeg-bytes');
  await assert.rejects(hub.downloadMedia(chat(-100500), 'PHOTO1', 30 * 1048576), (e) => e.status === 413);

  const notes = t.db.listMessages(chat(-100500), {}).length;
  await t.agents.updateAgent('panduga', { schedules: [{ id: 'book', at: '09:00', days: 'mon', prompt: 'What are we reading?', chats: [chat(-100500)] }] }, 'test');
  // both ids have rows with the same key: its own memory, a tag for the same member, a reaction to the same message
  const [oldId, newId] = [chat(-100500), chat(-1009999)];
  const sql = t.db.db;
  t.db.setChatMemory(oldId, 'They read one book a month.', 5);
  sql.prepare('UPDATE chat_memory SET updated_at = updated_at - 60000 WHERE chat = ?').run(oldId); // written a minute earlier
  t.db.setChatMemory(newId, 'The supergroup starts here.', 9);
  t.db.addNote({ chat: oldId, agent: 'panduga', text: 'Next book: Malgudi Days', author: 'Anu', role: 'organizer' });
  for (const id of [oldId, newId]) {
    sql.prepare('INSERT OR REPLACE INTO member_tags (chat, member, label) VALUES (?, ?, ?)').run(id, 'tg:77', id === oldId ? 'host' : 'reader');
    t.db.saveReaction({ chat: id, msgId: 'r1', sender: 'tg:77', name: 'Anu', emoji: id === oldId ? '👍' : '🎉' });
  }
  sql.prepare("INSERT INTO commitments (agent, chat, person, who, what, due, status, by, created_at, updated_at) VALUES ('panduga', ?, '', 'Anu', 'bring the book', '', 'open', 'agent', 1, 1)").run(oldId);
  sql.prepare("INSERT INTO person_chats (tenant_id, person, chat, wrote, member, last_at) VALUES ('default', 'p_reader', ?, 1, 1, 1)").run(oldId);
  sql.prepare("INSERT INTO usage (ts, agent, chat, provider, model, kind, input, output, cost, priced, account, fallback) VALUES (1, 'moved', ?, 'anthropic', 'm', 'reply', 1, 1, NULL, NULL, 'anthropic', '')").run(oldId);
  fake.push({ message: { message_id: 1, date: 1, from: ANU, chat: { id: -100500, type: 'group', title: 'Book club' }, migrate_to_chat_id: -1009999 } });
  assert.ok(await until(() => t.agents.getAgent('panduga').chats.includes(chat(-1009999))));
  // every table that keeps rows per chat, whatever it is for
  const perChat = sql.prepare("SELECT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) c ON c.name = 'chat' WHERE m.type = 'table'").all().map((r) => r.name);
  assert.ok(['messages', 'commitments', 'person_chats', 'usage', 'activity'].every((x) => perChat.includes(x)), perChat.join(' '));
  const left = perChat.filter((table) => sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE chat = ?`).get(oldId).n);
  assert.deepEqual(left, [], 'nothing is left under the old id, in any table');
  const { listCommitments } = await import('../src/core/commitments.js');
  assert.deepEqual(listCommitments({ chat: newId }).map((c) => c.what), ['bring the book'], 'an open promise follows the chat');
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM person_chats WHERE chat = ? AND person = 'p_reader'").get(newId).n, 1, 'who is in the chat');
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM usage WHERE chat = ? AND agent = 'moved'").get(newId).n, 1, 'what the chat cost so far');
  const memory = t.db.getChatMemory(newId);
  assert.equal(memory.summary, 'They read one book a month.\n\nThe supergroup starts here.', 'both summaries are kept, the older first');
  assert.equal(memory.upto_id, 5, 'summarised up to the earlier mark: the next summary misses no message');
  assert.deepEqual(t.db.listNotes(newId).map((n) => n.text), ['Next book: Malgudi Days'], 'what only the old id had moves');
  assert.equal(sql.prepare('SELECT emoji FROM wa_reactions WHERE chat = ? AND msg_id = ?').get(newId, 'r1').emoji, '🎉');
  assert.ok(!t.agents.getAgent('panduga').chats.includes(chat(-100500)));
  assert.deepEqual(t.agents.getAgent('panduga').schedules[0].chats, [chat(-1009999)], 'a schedule limited to this chat follows it');
  assert.equal(t.chatPrefs.isChatEnabled(chat(-1009999)), true, 'still on');
  assert.equal(t.db.listMessages(chat(-1009999), {}).length, notes, 'memory moved');
});

test('077: a fresh install never loads the Telegram adapter; a stored token does', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'duniya-lazy-tg-'));
  const hook = `data:text/javascript,${encodeURIComponent("export async function resolve(s, c, next) { if (s.endsWith('telegram/index.js')) throw new Error('TELEGRAM_IMPORTED'); return next(s, c); }")}`;
  const script = `
    import { register } from 'node:module';
    register(${JSON.stringify(hook)});
    const { createHub } = await import('./src/channels/hub.js');
    await import('./src/core/router.js'); await import('./src/core/tools.js'); await import('./src/panel/server.js');
    const hub = createHub();
    await hub.start({ onMessage: async () => {} });
    const before = (await hub.channels()).find((c) => c.id === 'telegram');
    (await import('./src/core/store.js')).setSecret('TELEGRAM_BOT_TOKEN', '${FAKE_TOKEN}');
    await new Promise((r) => setTimeout(r, 100));
    const after = (await hub.channels()).find((c) => c.id === 'telegram');
    console.log(JSON.stringify({ before: before.state, after: after.error }));
    process.exit(0);`;
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script],
    { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir, PANEL_PORT: '0' }, encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').at(-1));
  assert.equal(r.before, 'not_set_up');
  assert.match(r.after, /TELEGRAM_IMPORTED/, 'the token is what imports the adapter');
});

test('087: an edited Telegram message updates the stored copy (marked edited); the bot edits its own with editMessageText', async () => {
  const c = chat(-1009999); // the supergroup of the test above (on, bound)
  fake.push({ message: { message_id: 4242, date: Math.floor(Date.now() / 1000), from: ANU, chat: { id: -1009999, type: 'supergroup', title: 'Book club' }, text: 'see you at 7' } });
  assert.ok(await until(() => t.db.messageByMsgId(c, '4242')));
  const id = t.db.messageByMsgId(c, '4242').id;
  fake.push({ edited_message: { message_id: 4242, date: 1, edit_date: 2, from: ANU, chat: { id: -1009999, type: 'supergroup', title: 'Book club' }, text: 'see you at 8' } });
  assert.ok(await until(() => t.db.messageByMsgId(c, '4242').text === 'see you at 8'));
  assert.ok(t.db.editsOf([id]).has(id), 'marked edited');
  await hub.editMessage(c, '77', 'fixed text');
  assert.equal(fake.sent('editMessageText').at(-1).text, 'fixed text');
});

// ---- 2.58.18: what the audit of the adapter found ----
const SUPER = -1009999; // the supergroup of the tests above (on, bound to an agent)
const addedTo = (id, title) => {
  fake.group(id, { title });
  fake.push({ my_chat_member: { chat: { id, type: 'supergroup', title }, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member' } } });
  return until(async () => (await hub.listChats()).some((c) => c.id === chat(id)));
};

test('Telegram: a message keeps its paragraphs; only the bot\'s own @handle is cut out', async () => {
  t.script.push([{ type: 'text', text: 'Noted.' }]);
  const sends = fake.sent('sendMessage').length;
  fake.say(RAVI, SUPER, 'hello @family_helper_bot two things:\n\n1. bring  chairs\n2. bring tea', { entities: [{ type: 'mention', offset: 6, length: 18 }] });
  assert.ok(await until(() => fake.sent('sendMessage').length > sends));
  assert.ok(t.db.listMessages(chat(SUPER), {}).some((m) => m.text === 'hello two things:\n\n1. bring  chairs\n2. bring tea'), 'as written, without the handle');
});

test('Telegram: a welcome links each name where it stands, also after bold text', async () => {
  await hub.send(chat(SUPER), '*Welcome* @502 and @503!', { mentions: ['502', '503'] });
  const m = fake.sent('sendMessage').at(-1);
  assert.equal(m.text, 'Welcome Ravi and Zoe!');
  assert.deepEqual(m.entities, [{ type: 'bold', offset: 0, length: 7 },
    { type: 'text_mention', offset: 8, length: 4, user: { id: 502 } }, { type: 'text_mention', offset: 17, length: 3, user: { id: 503 } }]);
});

test('Telegram: a GIF goes out as an animation, so it plays', async () => {
  const r = await hub.sendMedia(chat(SUPER), { kind: 'gif', base64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', mimetype: 'image/gif' });
  assert.equal(fake.calls.at(-1).method, 'sendAnimation');
  assert.ok(r.msgId && !r.asStill);
});

test('Telegram: upkeep gives every group its turn; a group the bot was removed from while the server was off leaves Chats', async () => {
  while ((await hub.upkeep()).ok) { /* every group known so far is fresh */ }
  assert.ok(await addedTo(-100701, 'Hikers') && await addedTo(-100702, 'Cooks'));
  fake.failNext('getChat', { error_code: 500, description: 'Internal Server Error' });
  const n = fake.calls.length;
  assert.equal((await hub.upkeep()).ok, true);
  assert.equal((await hub.upkeep()).ok, true);
  const asked = fake.calls.slice(n).filter((c) => c.method === 'getChat').map((c) => c.params.chat_id);
  assert.deepEqual([...asked].sort(), ['-100701', '-100702'], 'the group Telegram did not answer for waits; the other one is asked next');
  assert.equal((await hub.upkeep()).ok, false, 'and it is not asked again at every tick');

  assert.ok(await addedTo(-100703, 'Movers'));
  fake.failNext('getChat', { error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' });
  await hub.upkeep();
  assert.ok(!(await hub.listChats()).some((c) => c.id === chat(-100703)), 'gone from Chats');
  assert.ok(t.db.listActivity({ chat: chat(-100703) }).some((a) => /The Telegram bot left “Movers”/.test(a.summary)));
});

test('Telegram: a group that became a supergroup while the server was off is followed at the next send', async () => {
  assert.ok(await addedTo(-100704, 'Runners'));
  await t.agents.bindChat(chat(-100704), 'panduga');
  t.chatPrefs.setChatPrefs(chat(-100704), { enabled: true });
  fake.failNext('sendMessage', { error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', migrate_to_chat_id: -1007040 });
  const n = fake.calls.length;
  assert.ok((await hub.send(chat(-100704), 'Run at 7')).msgId);
  assert.deepEqual(fake.calls.slice(n).filter((c) => c.method === 'sendMessage').map((c) => c.params.chat_id), ['-100704', '-1007040'], 'sent to the group\'s new id');
  assert.ok(await until(() => t.agents.getAgent('panduga').chats.includes(chat(-1007040))), 'its agent moved with it');
  assert.equal(t.chatPrefs.isChatEnabled(chat(-1007040)), true, 'still on');
  await hub.send(chat(-100704), 'again');
  assert.equal(fake.sent('sendMessage').at(-1).chat_id, '-1007040', 'a send that still names the old id goes straight to the new one');
});

test('Telegram: unreachable at the start is tried again; a webhook that stays and silent long polls show in the status, without a busy loop', async () => {
  const { createTelegramAdapter } = await import('../src/channels/telegram/index.js');
  const f = fakeBotApi();
  const bot = createTelegramAdapter({ fetch: f.fetch, token: () => FAKE_TOKEN, api: 'https://api.telegram.test' });
  const state = async () => (await bot.status());
  f.down = true;
  await bot.start({ onMessage: async () => {} });
  assert.equal((await state()).status, 'error');
  assert.match((await state()).lastError, /could not be reached/);
  f.down = false;
  assert.ok(await until(async () => (await state()).status === 'open', 6000), 'connects by itself once Telegram answers');
  assert.equal((await state()).info.username, 'family_helper_bot');
  const lines = t.db.listActivity({}).map((a) => a.summary);
  assert.ok(lines.some((x) => /^Telegram connection: Telegram could not be reached/.test(x)) && lines.includes('Telegram is connected again'), 'Activity says when it broke and when it was back');

  f.failNext('getUpdates', { error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first' });
  f.failNext('deleteWebhook', { error_code: 500, description: 'Internal Server Error' });
  const polls = f.polls;
  f.stall(0); // the waiting long poll ends; the next one meets the webhook
  assert.ok(await until(async () => /webhook could not be removed/.test((await state()).lastError)));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(f.polls - polls <= 2, `waits before it asks again (${f.polls - polls} long polls)`);
  assert.ok(await until(async () => (await state()).status === 'open', 6000), 'and takes the bot back at the next try');

  f.stall(3);
  assert.ok(await until(async () => /has not answered/.test((await state()).lastError), 3000), 'three long polls in a row without any answer');
  assert.ok(await until(async () => (await state()).status === 'open', 6000));
  await bot.stop();
});

test('Telegram: a bot that is not connected for 15 minutes is reported to the owner once, with the reason', async () => {
  const { upkeepTick, resetUpkeep } = await import('../src/core/upkeep.js');
  resetUpkeep();
  assert.deepEqual((await hub.accounts()).map((a) => [a.app, a.label, a.status]), [['Telegram', '@family_helper_bot', 'open']]);
  fake.down = true;
  fake.stall(0); // the waiting long poll ends; the next one cannot reach Telegram
  assert.ok(await until(async () => (await hub.accounts())[0].status === 'error'));
  const t0 = Date.now();
  await upkeepTick(hub, t0);
  await upkeepTick(hub, t0 + 16 * 60000);
  await upkeepTick(hub, t0 + 20 * 60000);
  const lines = t.db.listActivity({ limit: 200 }).map((a) => a.summary).filter((x) => /^Telegram \(@family_helper_bot\) has not been connected for 16 minutes: Telegram could not be reached \(ENOTFOUND\)/.test(x));
  assert.equal(lines.length, 1);
  fake.down = false;
  assert.ok(await until(async () => (await hub.accounts())[0].status === 'open', 12000), 'and it reconnects by itself');
});
