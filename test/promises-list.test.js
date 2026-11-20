// 092: People → Promises — every agent's promises with filters (open, overdue, done, all; person, agent, chat), names
// and links; the owner and admins mark done, reopen, re-date and delete; an agent's organizers do it from the chat for
// its chats, participants only mark their own done; the admin MCP (and so the owner assistant) lists, updates, deletes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner; let viewer; let config;
const G = 'g7@g.us'; const G2 = 'g8@g.us';
const ANU = '41790000012'; const RAVI = '41790000013'; const ORG = '41790000014';
const jid = (p) => `${p}@s.whatsapp.net`;
const day = (n) => config.localParts(config.env.timezone, Date.now() + n * 86400000).date;
const list = async (q = '') => (await t.api(owner, 'GET', `/api/commitments${q ? `?${q}` : ''}`)).body;
const ids = {};

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login(); config = t.config;
  for (const [id, name, chat, extra] of [['raju', 'Raju', G, { organizers: [ORG] }], ['tara', 'Tara', G2, {}]]) {
    await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name, triggers: [id], groupReplies: 'wake', promises: { track: true, followUp: 'chat' }, ...extra } });
    await t.api(owner, 'POST', '/api/chats/bind', { chat, agent: id });
  }
  await t.api(owner, 'POST', '/api/users', { username: 'vera', role: 'viewer', password: 'viewer-password-1' });
  viewer = await t.login('vera', 'viewer-password-1');
  // people write in the groups (so they are in People), then promises as the agents noticed them
  for (const [phone, name, chat] of [[ANU, 'Anu', G], [RAVI, 'Ravi', G], [RAVI, 'Ravi', G2], [ORG, 'Org', G]]) await t.route(t.msg({ chat, text: 'hello all', phone, senderJid: jid(phone), senderName: name, isGroup: true }));
  const pid = async (phone) => (await t.api(owner, 'GET', `/api/people/${phone}`)).body.id;
  const ins = t.db.db.prepare('INSERT INTO commitments (agent, chat, person, who, what, due, status, msg, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  const add = (k, agent, chat, person, who, what, due, status = 'open') => { ids[k] = Number(ins.run(agent, chat, person, who, what, due, status, 7, now, now).lastInsertRowid); };
  const anu = await pid(ANU); const ravi = await pid(RAVI);
  add('late', 'raju', G, anu, 'Anu', 'bring the speakers', day(-3));
  add('soon', 'raju', G, ravi, '', 'pay for the hall', day(2));
  add('undated', 'tara', G2, ravi, 'Ravi', 'call the caterer', '');
  add('done', 'raju', G, anu, 'Anu', 'send the photos', day(-1), 'done');
  ids.anu = anu; ids.ravi = ravi;
});
after(() => t.close());

test('the list across agents: overdue first, then by due date, undated last; names, chat and agent; filters', async () => {
  const open = await list();
  assert.deepEqual(open.map((c) => c.id), [ids.late, ids.soon, ids.undated]);
  const late = open[0];
  assert.deepEqual([late.overdue, late.who, late.agentName, late.chatName, late.msg], [true, 'Anu', 'Raju', late.chatName, 7]);
  assert.ok(late.chatName && !late.chatName.includes('@'), 'a chat name, never an id');
  assert.equal(open[1].who, 'Ravi', 'the person\'s name when the promise has none');
  assert.equal(open[1].overdue, false);
  assert.deepEqual((await list('status=overdue')).map((c) => c.id), [ids.late]);
  assert.deepEqual((await list('status=done')).map((c) => c.id), [ids.done]);
  assert.equal((await list('status=all')).length, 4);
  assert.deepEqual((await list('agent=tara')).map((c) => c.id), [ids.undated]);
  assert.deepEqual((await list(`chat=${encodeURIComponent(G)}`)).map((c) => c.id), [ids.late, ids.soon]);
  assert.deepEqual((await list(`person=${ids.ravi}`)).map((c) => c.id), [ids.soon, ids.undated]);
  assert.equal((await t.api(owner, 'GET', '/api/commitments?status=later')).status, 400);
  // the Promises tab shows when an agent tracks promises
  const st = (await t.api(owner, 'GET', '/api/status')).body;
  assert.deepEqual(st.agents.filter((a) => a.promises).map((a) => a.id).sort(), ['raju', 'tara']);
});

test('the owner marks done, reopens, re-dates (the reminder can go again), edits and deletes; viewers cannot', async () => {
  t.db.db.prepare('UPDATE commitments SET followed_up_at = ? WHERE id = ?').run(Date.now(), ids.late);
  let c = (await t.api(owner, 'PUT', `/api/commitments/${ids.late}`, { status: 'done' })).body;
  assert.equal(c.status, 'done');
  assert.ok(c.followedUpAt, 'done keeps when it was reminded');
  c = (await t.api(owner, 'PUT', `/api/commitments/${ids.late}`, { status: 'open' })).body;
  assert.deepEqual([c.status, c.followedUpAt], ['open', null], 'reopened: it may be reminded again');
  t.db.db.prepare('UPDATE commitments SET followed_up_at = ? WHERE id = ?').run(Date.now(), ids.late);
  c = (await t.api(owner, 'PUT', `/api/commitments/${ids.late}`, { due: day(1) })).body;
  assert.deepEqual([c.due, c.overdue, c.followedUpAt], [day(1), false, null], 'a new due date: reminded again when due');
  assert.equal((await t.api(owner, 'PUT', `/api/commitments/${ids.late}`, { what: 'bring the big speakers' })).body.what, 'bring the big speakers');
  assert.equal((await t.api(owner, 'PUT', `/api/commitments/${ids.late}`, { what: ' ' })).status, 400);
  assert.equal((await t.api(owner, 'PUT', `/api/commitments/${ids.late}`, { due: 'soon' })).status, 400);
  assert.equal((await t.api(viewer, 'DELETE', `/api/commitments/${ids.late}`)).status, 403);
  assert.equal((await t.api(viewer, 'PUT', `/api/commitments/${ids.late}`, { status: 'done' })).status, 403);
  const extra = Number(t.db.db.prepare("INSERT INTO commitments (agent, chat, person, who, what, due, created_at, updated_at) VALUES ('raju', ?, '', 'X', 'a mistake', '', 1, 1)").run(G).lastInsertRowid);
  assert.equal((await t.api(owner, 'DELETE', `/api/commitments/${extra}`)).body.ok, true);
  assert.equal((await t.api(owner, 'DELETE', `/api/commitments/${extra}`)).status, 404);
  assert.match(t.db.db.prepare("SELECT summary FROM activity WHERE summary LIKE 'Promise deleted%' ORDER BY id DESC LIMIT 1").get().summary, /Promise deleted \(admin\)/);
});

const toolResult = () => {
  const msgs = t.claudeReqs.at(-1).messages;
  return msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result').map((b) => (typeof b.content === 'string' ? b.content : b.content.map((x) => x.text).join(''))).at(-1);
};
const ask = async (phone, name, calls) => {
  for (const c of calls) t.script.push([{ type: 'tool_use', id: `tu${Math.random().toString(36).slice(2, 8)}`, name: c[0], input: c[1] }]);
  t.script.push([{ type: 'text', text: 'Okay.' }]);
  await t.route(t.msg({ chat: G, text: 'raju about the promises', phone, senderJid: jid(phone), senderName: name, isGroup: true }));
  return toolResult();
};

test('in the chat: organizers see and change the promises of the agent\'s chats; participants see and mark done only their own', async () => {
  const names = (await t.agents.getAgent('raju'));
  assert.ok(names.promises.track);
  let r = await ask(ORG, 'Org', [['promises__list_promises', {}]]);
  const seen = JSON.parse(r);
  assert.deepEqual(seen.map((c) => c.id).sort(), [ids.late, ids.soon].sort(), 'only Raju\'s chats (not Tara\'s group)');
  r = await ask(ORG, 'Org', [['promises__update_promise', { id: ids.soon, status: 'done' }]]);
  assert.equal(JSON.parse(r).status, 'done');
  r = await ask(ORG, 'Org', [['promises__update_promise', { id: ids.undated, status: 'done' }]]);
  assert.match(r, /No such promise here/, 'another agent\'s chat');
  r = await ask(ORG, 'Org', [['promises__update_promise', { id: ids.soon, status: 'open', due: day(5) }]]);
  assert.deepEqual([JSON.parse(r).status, JSON.parse(r).due], ['open', day(5)]);
  // Anu (a participant): her own only
  r = await ask(ANU, 'Anu', [['promises__list_promises', {}]]);
  assert.deepEqual(JSON.parse(r).map((c) => c.id), [ids.late]);
  r = await ask(ANU, 'Anu', [['promises__update_promise', { id: ids.soon, status: 'done' }]]);
  assert.match(r, /No such promise here/, 'not hers');
  r = await ask(ANU, 'Anu', [['promises__update_promise', { id: ids.late, due: day(9) }]]);
  assert.match(r, /Only organizers/);
  r = await ask(ANU, 'Anu', [['promises__update_promise', { id: ids.late, status: 'done' }]]);
  assert.equal(JSON.parse(r).status, 'done');
  // an agent that does not track promises has no such tools
  await t.api(owner, 'PUT', '/api/agents/raju', { promises: { track: false, followUp: 'chat' } });
  t.script.push([{ type: 'text', text: 'Hi.' }]);
  await t.route(t.msg({ chat: G, text: 'raju hi', phone: ORG, senderJid: jid(ORG), senderName: 'Org', isGroup: true }));
  assert.ok(!t.claudeReqs.at(-1).tools?.some((x) => x.name.startsWith('promises__')));
  await t.api(owner, 'PUT', '/api/agents/raju', { promises: { track: true, followUp: 'chat' } });
});

test('admin MCP (and the owner assistant): list with overdue and filters, update, delete behind a confirm', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const x = { call: async (m, path, body) => { const r = await t.api(owner, m, path, body); if (r.status >= 400) throw new Error(r.body.error); return r.body; } };
  const tool = (n) => TOOLS.find((y) => y.name === n);
  await t.api(owner, 'PUT', `/api/commitments/${ids.undated}`, { due: day(-2) });
  const over = await tool('list_commitments').run({ status: 'overdue' }, x);
  assert.deepEqual(over.map((c) => [c.id, c.agentName]), [[ids.undated, 'Tara']]);
  assert.equal((await tool('update_commitment').run({ commitment_id: ids.undated, status: 'done' }, x)).status, 'done');
  const del = tool('delete_commitment');
  assert.ok(del.risky, 'deleting needs confirm_action');
  assert.match(await del.preview({ commitment_id: ids.undated }, x), /Delete the promise "Ravi: call the caterer"/);
  await del.run({ commitment_id: ids.undated }, x);
  assert.equal((await list('status=all')).some((c) => c.id === ids.undated), false);
});
