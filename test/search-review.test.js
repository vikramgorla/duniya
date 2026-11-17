// 070: Search messages across chats (owner, chats that are on and not private, full-text index kept in step by
// triggers) and Review & teach (an agent's answers with the question, 👍 / 👎, counts; private chats left out).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
const owner = await t.login();
await t.api(owner, 'POST', '/api/users', { username: 'adm', role: 'admin', password: 'admin-password-12' });
const admin = await t.login('adm', 'admin-password-12');
t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vic', 'viewer password 123');
const { TOOLS } = await import('../src/panel/admin-tools.js');
const { db } = await import('../src/core/db.js');
after(() => t.close());

const tool = (name) => TOOLS.find((x) => x.name === name);
const ctx = (cookie) => ({ call: async (m, p, b) => { const r = await t.api(cookie, m, p, b); if (r.status >= 400) throw new Error(r.body.error); return r.body; } });
const search = (q, who = owner, extra = '') => t.api(who, 'GET', `/api/search/messages?q=${encodeURIComponent(q)}${extra}`);

test('070 search: words in any order, word beginnings, accents ignored; owner only; newest first; logged', async () => {
  t.script.push([{ type: 'text', text: 'The rides leave at 9 from the café.' }]);
  await t.route(t.msg({ text: '!panduga who drives to the picnic on Sunday?', msgId: 's1' }));
  await t.route(t.msg({ chat: 'g2@g.us', text: 'Sunday picnic: I can drive two kids', msgId: 's2', phone: '41790000003', senderName: 'Ravi' }));
  const r = (await search('picnic sunday')).body;
  assert.deepEqual(r.results.map((m) => m.chat), ['g2@g.us', 'g1@g.us'], 'both chats, newest first');
  assert.equal(r.results[1].chatName, 'Panduga families');
  assert.equal(r.results[0].name.length > 0, true);
  assert.equal((await search('ride')).body.results[0].fromAgent, true, '"ride" finds "rides" (the agent’s answer)');
  assert.equal((await search('CAFE')).body.results.length, 1, 'case and accents do not matter');
  assert.equal((await search('picnic tuesday')).body.results.length, 0, 'every word must appear');
  assert.deepEqual((await search('a')).body, { results: [], more: false }, 'two characters at least');
  assert.equal((await search('picnic', admin)).status, 403, 'owner only');
  assert.equal((await search('picnic', viewer)).status, 403);
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => /Messages searched by admin \(“picnic sunday”, 2 found in \d+ chats\)/.test(a.summary)));
});

test('070 search: chats that are off or private are never searched; erased and pruned messages leave the index', async () => {
  t.chatPrefs.setChatPrefs('g2@g.us', { private: true });
  assert.deepEqual((await search('picnic')).body.results.map((m) => m.chat), ['g1@g.us'], 'private to members: left out');
  t.chatPrefs.setChatPrefs('g2@g.us', { private: false, enabled: false });
  assert.deepEqual((await search('picnic')).body.results.map((m) => m.chat), ['g1@g.us'], 'off: left out');
  t.chatPrefs.setChatPrefs('g2@g.us', { enabled: true });
  assert.equal((await t.api(owner, 'DELETE', `/api/chats/${encodeURIComponent('g2@g.us')}/memory`)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'kids'").get().n, 0, 'erased messages are gone from the index');
  // paging: 35 matches → 30 + more, then the rest
  for (let i = 0; i < 35; i++) t.db.logMessage({ chat: 'g3@g.us', text: `lantern number ${i}`, ts: Date.now() + i });
  const p1 = (await search('lantern')).body;
  assert.equal(p1.results.length, 30); assert.equal(p1.more, true);
  const p2 = (await search('lantern', owner, `&before=${p1.results.at(-1).id}`)).body;
  assert.equal(p2.results.length, 5); assert.equal(p2.more, false);
  // the per-chat search on a chat's Messages and the agents' search_history use the same index
  const own = (await t.api(owner, 'GET', `/api/chats/${encodeURIComponent('g3@g.us')}/messages?q=lanter`)).body;
  assert.equal(own.length, 35);
  // admin MCP: owner only
  const hits = await tool('search_messages').run({ query: 'lantern' }, ctx(owner));
  assert.equal(hits.results.length, 30);
  await assert.rejects(tool('search_messages').run({ query: 'lantern' }, ctx(admin)), /owner|Forbidden|Requires/i);
});

test('070 review: answers with their question, 👍 / 👎 with counts, filters, private chats left out', async () => {
  t.script.push([{ type: 'text', text: 'Dinner is at 7.' }]);
  await t.route(t.msg({ text: '!panduga when is dinner?', msgId: 'r1' }));
  const r = (await t.api(admin, 'GET', '/api/agents/panduga/review')).body;
  const a = r.answers[0];
  assert.equal(a.text, 'Dinner is at 7.');
  assert.equal(a.question.text, '!panduga when is dinner?');
  assert.equal(a.chatName, 'Panduga families');
  assert.equal(a.rating, 0);
  assert.ok(r.counts.answers >= 2);
  assert.ok(t.db.listActivity({ limit: 20 }).some((x) => /Answers of .* reviewed by adm/.test(x.summary)));

  const down = (await t.api(admin, 'PUT', `/api/agents/panduga/review/${a.id}`, { rating: -1 })).body;
  assert.deepEqual([down.rating, down.counts.down, down.counts.up], [-1, 1, 0]);
  assert.deepEqual((await t.api(admin, 'GET', '/api/agents/panduga/review?only=down')).body.answers.map((x) => x.id), [a.id]);
  assert.ok(!(await t.api(admin, 'GET', '/api/agents/panduga/review?only=unrated')).body.answers.some((x) => x.id === a.id));
  assert.deepEqual((await t.api(owner, 'GET', '/api/agents/panduga')).body.review, { up: 0, down: 1, answers: r.counts.answers }, 'counts on the agent for its Review row');
  assert.equal((await t.api(admin, 'PUT', `/api/agents/panduga/review/${a.id}`, { rating: 0 })).body.counts.down, 0, '0 clears');

  // refused: viewers, someone else's answer, an incoming message
  assert.equal((await t.api(viewer, 'GET', '/api/agents/panduga/review')).status, 403);
  assert.equal((await t.api(viewer, 'PUT', `/api/agents/panduga/review/${a.id}`, { rating: 1 })).status, 403);
  assert.equal((await t.api(admin, 'PUT', `/api/agents/helper/review/${a.id}`, { rating: 1 })).status, 404);
  const incoming = db.prepare("SELECT id FROM messages WHERE msg_id = 'r1'").get().id;
  assert.equal((await t.api(admin, 'PUT', `/api/agents/panduga/review/${incoming}`, { rating: 1 })).status, 404);

  // private to members: left out of the review and cannot be rated
  await t.api(admin, 'PUT', `/api/agents/panduga/review/${a.id}`, { rating: 1 });
  t.chatPrefs.setChatPrefs('g1@g.us', { private: true });
  assert.ok(!(await t.api(admin, 'GET', '/api/agents/panduga/review')).body.answers.some((x) => x.chat === 'g1@g.us'));
  assert.equal((await t.api(admin, 'PUT', `/api/agents/panduga/review/${a.id}`, { rating: -1 })).status, 404);
  t.chatPrefs.setChatPrefs('g1@g.us', { private: false });

  // the rating goes with the answer (erase memory, retention)
  await t.api(owner, 'DELETE', `/api/chats/${encodeURIComponent('g1@g.us')}/memory`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reply_ratings WHERE msg = ?').get(a.id).n, 0);

  // admin MCP: list and rate
  t.script.push([{ type: 'text', text: 'Bring a torch.' }]);
  await t.route(t.msg({ text: '!panduga what to bring?', msgId: 'r2' }));
  const listed = await tool('list_agent_answers').run({ agent_id: 'panduga' }, ctx(admin));
  const b = listed.answers[0];
  assert.equal(b.text, 'Bring a torch.');
  assert.equal((await tool('rate_agent_answer').run({ agent_id: 'panduga', answer_id: b.id, rating: 1 }, ctx(admin))).counts.up, 1);
  await assert.rejects(tool('rate_agent_answer').run({ agent_id: 'panduga', answer_id: b.id, rating: 1 }, ctx(viewer)), /Read-only|Requires|admin/i);
});

test('072 one answer everywhere: messages and Activity carry the agent and its rating; opened around an answer', async () => {
  t.script.push([{ type: 'text', text: 'Meet at the gate at 10.' }]);
  await t.route(t.msg({ text: '!panduga where do we meet?', msgId: 'x1' }));
  const enc = encodeURIComponent('g1@g.us');
  const msgs = async (qs = '') => (await t.api(admin, 'GET', `/api/chats/${enc}/messages?limit=50${qs}`)).body;
  const ans = (await msgs()).find((m) => m.fromAgent && m.text === 'Meet at the gate at 10.');
  assert.equal(ans.agent, 'panduga', 'the answer says which agent gave it');
  assert.equal(ans.rating, 0); assert.equal(ans.rateable, true);
  // rated in Review → the same rating in the chat's messages and in Activity
  await t.api(admin, 'PUT', `/api/agents/panduga/review/${ans.id}`, { rating: -1 });
  assert.equal((await msgs()).find((m) => m.id === ans.id).rating, -1);
  const reply = (await t.api(admin, 'GET', `/api/activity?limit=50&chat=${enc}`)).body.find((a) => a.type === 'message.out' && a.detail?.msg === ans.id);
  assert.ok(reply, 'the reply in Activity points at the stored answer');
  assert.equal(reply.rating, -1);
  assert.ok((await t.api(admin, 'GET', `/api/activity?limit=50&chat=${encodeURIComponent('g2@g.us')}`)).body.every((a) => a.chat === 'g2@g.us'), 'Activity of one chat');
  // around: the answer with messages on both sides (Review → In chat, Activity → See in messages)
  for (let i = 0; i < 40; i++) t.db.logMessage({ chat: 'g1@g.us', text: `after ${i}`, ts: Date.now() + i });
  const around = await msgs(`&around=${ans.id}`);
  assert.ok(around.some((m) => m.id === ans.id) && around.some((m) => m.id > ans.id) && around.some((m) => m.id < ans.id));
  assert.ok(around.length <= 50 && around[0].id > around.at(-1).id, 'newest first, at most a page');
  // private to members: shown in the chat's own messages, but not rateable (as in Review)
  t.chatPrefs.setChatPrefs('g1@g.us', { private: true });
  assert.equal((await msgs(`&around=${ans.id}`)).find((m) => m.id === ans.id).rateable, false);
  t.chatPrefs.setChatPrefs('g1@g.us', { private: false });
  assert.equal((await t.api(viewer, 'GET', `/api/chats/${enc}/messages`)).status, 403, 'stored messages stay admin-only');
});
