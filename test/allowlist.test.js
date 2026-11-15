// #10 (spec 032): silent by default — chats are off until switched on; off chats cost nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ chatsOn: false, env: { RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
after(() => t.close());
const chats = async () => (await t.api(owner, 'GET', '/api/chats')).body;
const stored = (chat) => t.db.listMessages(chat, { limit: 50 });

test('a group that is off: nothing stored, no model call, no reply; the Chats page shows it as ignored', async () => {
  const n = t.claudeReqs.length; const sent = t.sent.length;
  await t.route(t.msg({ text: '!panduga hello?' }));
  await t.route(t.msg({ text: 'just chatting' }));
  assert.equal(t.claudeReqs.length, n, 'no model call');
  assert.equal(t.sent.length, sent, 'no reply');
  assert.equal(stored('g1@g.us').length, 0, 'nothing stored');
  const row = (await chats()).find((c) => c.id === 'g1@g.us');
  assert.equal(row.enabled, false);
  assert.equal(row.ignored, 2);
  assert.equal((await t.api(owner, 'GET', '/api/status')).body.enabledChats, 0);
});

test('switching a group on makes its agent answer; switching it off again silences it', async () => {
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent('g1@g.us')}/prefs`, { enabled: true })).status, 200);
  t.script.push([{ type: 'text', text: 'Hi, I am on now' }]);
  await t.route(t.msg({ text: '!panduga hello?' }));
  assert.equal(t.sent.at(-1).text, 'Hi, I am on now');
  assert.ok(stored('g1@g.us').length >= 1);
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => /Chat switched ON/.test(a.summary)));
  await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent('g1@g.us')}/prefs`, { enabled: false });
  const n = t.claudeReqs.length;
  await t.route(t.msg({ text: '!panduga still there?' }));
  assert.equal(t.claudeReqs.length, n);
});

test('direct messages: off = ignored, even from organizers; an agent set to answer "anyone" still answers', async () => {
  const dm = (phone, text) => t.msg({ isGroup: false, chat: `${phone}@s.whatsapp.net`, phone, text });
  const n = t.claudeReqs.length;
  await t.route(dm('41790000001', 'hello organizer here'));
  await t.route(dm('41790000777', 'hello stranger here'));
  assert.equal(t.claudeReqs.length, n, 'nobody answered');
  await t.bots.updateBot('helper', { dm: 'anyone' });
  t.script.push([{ type: 'text', text: 'Open helper here' }]);
  await t.route(dm('41790000777', 'hello again'));
  assert.equal(t.sent.at(-1).text, 'Open helper here');
  await t.bots.updateBot('helper', { dm: 'organizers' });
});

test('organizer helpers still work in an off group, and store nothing', async () => {
  await t.route(t.msg({ text: '!groupid', phone: '41790000001' }));
  assert.match(t.sent.at(-1).text, /Group id: g1@g\.us/);
  assert.equal(stored('g1@g.us').filter((m) => m.text === '!groupid').length, 0);
});

test('scheduled posts and history sync skip chats that are off', async () => {
  await t.bots.updateBot('panduga', { schedules: [{ id: 'daily', at: '09:00', days: 'daily', prompt: 'Post the agenda', enabled: true }] });
  const n = t.claudeReqs.length;
  const r = await t.api(owner, 'POST', '/api/bots/panduga/schedules/daily/run');
  assert.equal(r.status, 200);
  assert.equal(t.claudeReqs.length, n, 'no model call for an off chat');
  await t.onHistory([{ channel: 'whatsapp', isGroup: true, chat: 'g1@g.us', phone: '41790000002', senderName: 'Anu', text: 'old message', msgId: 'h1', ts: Date.now() - 1e6 }]);
  assert.equal(stored('g1@g.us').filter((m) => m.text === 'old message').length, 0);
});

test('reactions and poll votes in a chat that is off are ignored too', async () => {
  const before = t.db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'wa_reactions'").get().n
    ? t.db.db.prepare('SELECT COUNT(*) n FROM wa_reactions').get().n : 0;
  await t.route(t.msg({ kind: 'reaction', chat: 'g1@g.us', text: '', emoji: '👍', targetId: 'x', senderName: 'Anu' }));
  const after = t.db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'wa_reactions'").get().n
    ? t.db.db.prepare('SELECT COUNT(*) n FROM wa_reactions').get().n : 0;
  assert.equal(after, before);
});
