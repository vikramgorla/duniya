// #91 (spec 048): chats that are off keep only the newest message key; switching a chat on loads recent messages
// from the phone (on demand), stores them before what is stored and builds the summary; agents say what they have.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ chatsOn: false, env: { RATE_LIMIT_PER_MIN: '100', HISTORY_WAIT_MS: '300' } });
const owner = await t.login();
after(() => t.close());
const { db } = await import('../src/core/db.js');
const hl = await import('../src/core/history-load.js');
const { TOOLS } = await import('../src/panel/admin-tools.js');
const enc = encodeURIComponent;
const G = 'g1@g.us';
const DAY = 86400000;
const stored = (chat) => db.prepare('SELECT * FROM messages WHERE chat = ? ORDER BY id').all(chat);
const status = async (chat) => (await t.api(owner, 'GET', `/api/chats/${enc(chat)}/history`)).body.status;
const settle = (chat) => t.waitFor(async () => { const s = await status(chat); return s && s.state !== 'loading' ? s : null; });
const phoneMsgs = (chat, n, { from = Date.now() - 2 * DAY, prefix = 'p' } = {}) => Array.from({ length: n }, (_, i) =>
  t.msg({ chat, isGroup: chat.endsWith('@g.us'), msgId: `${prefix}${i + 1}`, ts: from + i * 60000, text: `earlier message ${i + 1}`, senderJid: `p${i % 3}@lid`, phone: `4179000000${i % 3}` }));

test('a chat that is off: history at linking and live messages keep only the newest key, never text', async () => {
  const msgs = phoneMsgs(G, 60);
  t.phone.chats[G] = msgs;
  // link-time sync: WhatsApp sends the last 10; keys come from the raw messages (here: the normalized ones)
  await t.onHistory(msgs.slice(-10));
  assert.equal(stored(G).length, 0, 'nothing stored while off');
  let k = t.chatPrefs.latestKey(G);
  assert.equal(k.msgId, 'p60');
  assert.equal(k.participant, msgs.at(-1).senderJid);
  // a live message while off: ignored, but its key becomes the newest
  const live = t.msg({ chat: G, msgId: 'live-off', ts: Date.now() - 1000, text: 'hello while off' });
  t.phone.chats[G].push(live);
  await t.route(live);
  assert.equal(stored(G).length, 0);
  k = t.chatPrefs.latestKey(G);
  assert.equal(k.msgId, 'live-off');
  const row = db.prepare('SELECT * FROM chats_seen WHERE chat = ?').get(G);
  assert.ok(!JSON.stringify(row).includes('hello while off') && !JSON.stringify(row).includes('earlier message'), 'no text in metadata');
  assert.equal(row.name, null, 'no sender names');
  // a chat known only from history stays off the People list
  await t.onHistory([t.msg({ chat: '41790000777@s.whatsapp.net', isGroup: false, msgId: 'dm1', text: 'private', ts: Date.now() - DAY })]);
  assert.ok(t.chatPrefs.latestKey('41790000777@s.whatsapp.net'));
  assert.ok(!(await t.api(owner, 'GET', '/api/chats')).body.some((c) => c.id === '41790000777@s.whatsapp.net'));
  // an on-demand batch for an off chat is not stored either
  await t.onHistory(msgs.slice(0, 5), { onDemand: true, chats: [G] });
  assert.equal(stored(G).length, 0);
});

test('switching a group on asks the phone for recent messages, stores them before newer ones and builds a summary', async () => {
  const sums = t.summaryReqs.length;
  const r = await t.api(owner, 'PUT', `/api/chats/${enc(G)}/prefs`, { enabled: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.history.state, 'loading');
  assert.equal(t.historyAsks.length, 1);
  assert.deepEqual({ ...t.historyAsks[0], anchor: { msgId: t.historyAsks[0].anchor.msgId } }, { chat: G, count: 50, anchor: { msgId: 'live-off' } });
  // a live message right after switching on, before the phone answers
  await t.route(t.msg({ chat: G, msgId: 'live-on', text: 'first message after switching on' }));
  const s = await settle(G);
  assert.equal(s.state, 'loaded');
  assert.equal(s.loaded, 50);
  const rows = stored(G);
  assert.equal(rows.length, 51);
  assert.equal(rows.at(-1).msg_id, 'live-on', 'loaded messages go before newer ones');
  assert.deepEqual(rows.slice(0, 50).map((m) => m.ts), rows.slice(0, 50).map((m) => m.ts).sort((a, b) => a - b), 'oldest first');
  assert.equal(rows[0].msg_id, 'p11');
  await t.waitFor(() => t.summaryReqs.length > sums);
  assert.match(t.summaryReqs.at(-1).messages[0].content, /earlier message 11/);
  await t.waitFor(() => t.memory.memoryView(G).summary);
  // the Chats page shows it
  const row = (await t.api(owner, 'GET', '/api/chats')).body.find((c) => c.id === G);
  assert.equal(row.history.state, 'loaded');
  assert.equal(row.history.loaded, 50);
  assert.ok(t.db.listActivity({ limit: 30 }).some((a) => /Loaded 50 earlier message/.test(a.summary)));
  assert.ok(!t.db.listActivity({ limit: 30 }).some((a) => /earlier message \d/.test(a.summary)), 'no message text in activity');
});

test('the agent is told what history it has', async () => {
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: G, msgId: 'ask1', text: '!panduga what did we decide earlier?' }));
  assert.match(t.userTurn(t.claudeReqs.length - 1), /Stored history of this chat: 51 messages since .*running summary/);
  // a chat that is on with nothing stored: no guessing, and the owner can load messages
  t.chatPrefs.setChatPrefs('g2@g.us', { enabled: true });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: 'g2@g.us', msgId: 'ask2', text: '!help what happened before?', phone: '41790000001' }));
  assert.match(t.userTurn(t.claudeReqs.length - 1), /Stored history of this chat: none yet.*Load recent messages/s);
});

test('Load recent messages: pages further back, is rate-limited, needs the chat on, and admins only', async () => {
  hl.resetHistoryLoads();
  const before = stored(G).length;
  const r = await t.api(owner, 'POST', `/api/chats/${enc(G)}/history`, { count: 120 });
  assert.equal(r.status, 200);
  assert.equal(r.body.status.state, 'loading');
  assert.equal(t.historyAsks.at(-1).anchor.msgId, 'p11', 'anchored at the oldest stored message');
  const s = await settle(G);
  assert.equal(s.state, 'loaded');
  assert.equal(s.loaded, 10, 'the phone only had 10 older ones');
  assert.equal(stored(G).length, before + 10);
  assert.equal(stored(G)[0].msg_id, 'p1');
  assert.equal((await t.api(owner, 'POST', `/api/chats/${enc(G)}/history`, {})).status, 429, 'once per 30 s');
  assert.equal((await t.api(owner, 'POST', `/api/chats/${enc('g3@g.us')}/history`, {})).status, 409, 'off chats: never');
  await t.api(owner, 'POST', '/api/users', { username: 'vera', password: 'viewer password 123', role: 'viewer' });
  const viewer = await t.login('vera', 'viewer password 123');
  assert.equal((await t.api(viewer, 'POST', `/api/chats/${enc(G)}/history`, {})).status, 403);
});

test('paging: more than 50 messages are asked for in pages of 50', async () => {
  hl.resetHistoryLoads();
  const C = 'g4@g.us';
  t.phone.chats[C] = phoneMsgs(C, 130, { prefix: 'q' });
  await t.onHistory(t.phone.chats[C].slice(-1));
  await t.api(owner, 'POST', '/api/settings', { historyLoadCount: 120 });
  const asks = t.historyAsks.length;
  await t.api(owner, 'PUT', `/api/chats/${enc(C)}/prefs`, { enabled: true });
  const s = await settle(C);
  assert.equal(s.loaded, 120);
  assert.deepEqual(t.historyAsks.slice(asks).map((a) => a.count), [50, 50, 20]);
  assert.equal(stored(C).length, 120);
  await t.api(owner, 'POST', '/api/settings', { historyLoadCount: 50 });
});

test('phone offline: no answer → the status says so; a person\'s chat is loaded too when switched on', async () => {
  hl.resetHistoryLoads();
  const D = '41790000002@s.whatsapp.net';
  t.phone.chats[D] = phoneMsgs(D, 5, { prefix: 'd' });
  await t.route(t.msg({ chat: D, isGroup: false, msgId: 'd-live', ts: Date.now() - 5000, text: 'hi' })); // off: key only (and People list)
  assert.equal(stored(D).length, 0);
  t.phone.online = false;
  await t.api(owner, 'PUT', `/api/chats/${enc(D)}/prefs`, { enabled: true });
  const s = await settle(D);
  assert.equal(s.state, 'no_response');
  assert.equal(stored(D).length, 0);
  t.phone.online = true;
  hl.resetHistoryLoads();
  await t.api(owner, 'POST', `/api/chats/${enc(D)}/history`, {});
  assert.equal((await settle(D)).loaded, 5);
  // no key known at all
  hl.resetHistoryLoads();
  t.chatPrefs.setChatPrefs('g5@g.us', { enabled: true });
  assert.equal((await t.api(owner, 'POST', `/api/chats/${enc('g5@g.us')}/history`, {})).body.status.state, 'no_anchor');
  // switched on with the setting at 0: nothing asked
  await t.api(owner, 'POST', '/api/settings', { historyLoadCount: 0 });
  const asks = t.historyAsks.length;
  await t.api(owner, 'PUT', `/api/chats/${enc('g6@g.us')}/prefs`, { enabled: true });
  assert.equal(t.historyAsks.length, asks);
  await t.api(owner, 'POST', '/api/settings', { historyLoadCount: 50 });
});

test('admin MCP tool load_chat_history; the owner assistant runs it without a confirm code (logged)', async () => {
  hl.resetHistoryLoads();
  const tool = TOOLS.find((x) => x.name === 'load_chat_history');
  assert.ok(tool && !tool.risky && tool.noConfirm);
  assert.ok(TOOLS.some((x) => x.name === 'set_history_on_switch_on'));
  const C = 'g4@g.us';
  t.phone.chats[C].unshift(...phoneMsgs(C, 3, { from: Date.now() - 9 * DAY, prefix: 'z' }));
  t.script.push([{ type: 'tool_use', id: 'h1', name: 'load_chat_history', input: { chat: C } }], [{ type: 'text', text: 'Asked your phone.' }]);
  const r = await t.api(owner, 'POST', '/api/owner/ask', { question: 'load the history of g4' });
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, 'Asked your phone.');
  assert.ok(!r.body.confirms?.length, 'no confirm code');
  assert.equal((await settle(C)).loaded, 12, 'q1–q9 and three older ones');
  assert.ok(t.db.listActivity({ limit: 40 }).some((a) => a.type === 'owner.tool' && /load_chat_history/.test(a.summary)));
});
