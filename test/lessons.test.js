// 089: lessons from the owner's corrections (👎, corrections in a chat), approved by the owner, used in turns; and
// learning when to join in (feedback on judged answers and on staying quiet).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner;
const G = 'g5@g.us'; const J = 'g6@g.us';
const OWNER_PHONE = '41790000005';
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Raju', triggers: ['raju'], groupReplies: 'wake' } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'raju' });
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Nila', triggers: ['nila'], groupReplies: 'auto' } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: J, agent: 'nila' });
  t.db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, linked_at) SELECT 'default', id, ?, 'linked', ? FROM users WHERE username = 'admin'").run(OWNER_PHONE, Date.now());
});
after(() => t.close());

const lessons = async (agent) => (await t.api(owner, 'GET', `/api/agents/${agent}/lessons`)).body;
const say = async (chat, text, reply, phone = '41790000002') => {
  if (reply !== undefined) t.script.push([{ type: 'text', text: reply }]);
  await t.route(t.msg({ chat, text, phone, senderName: phone === OWNER_PHONE ? 'Vik' : 'Anu' }));
};
const proposalReqs = () => t.claudeReqs.filter((r) => /one short (lesson|rule)/.test(String(r.system)));

test('a 👎 proposes a lesson; it is used only after the owner approves it, the most relevant first', async () => {
  await say(G, 'raju who drives on Saturday?', 'Rao drives on Saturday.');
  const ans = t.db.lastAgentMessage(G);
  t.script.push([{ type: 'text', text: '{"lesson": "Chary drives on Saturdays, not Rao.", "scope": "agent"}' }]);
  const r = await t.api(owner, 'PUT', `/api/agents/raju/review/${ans.id}`, { rating: -1 });
  assert.equal(r.body.proposing, true);
  const proposed = await t.waitFor(async () => (await lessons('raju')).proposed[0]);
  assert.equal(proposed.text, 'Chary drives on Saturdays, not Rao.');
  assert.deepEqual([proposed.source, proposed.msg, proposed.chat, proposed.kind], ['thumbs', ans.id, '', 'answer']);
  assert.match(JSON.stringify(proposalReqs().at(-1).messages), /Rao drives on Saturday/);
  assert.equal(t.db.db.prepare("SELECT kind FROM usage WHERE kind = 'lessons'").get()?.kind, 'lessons', 'its own kind in Usage');
  assert.equal((await t.api(owner, 'GET', '/api/agents/raju')).body.lessonsToApprove, 1);
  // not used while proposed
  await say(G, 'raju who drives Saturday?', 'Chary.');
  assert.doesNotMatch(t.userTurn(t.claudeReqs.length - 1), /<lessons/);
  // approved: in the turn
  assert.equal((await t.api(owner, 'PUT', `/api/agents/raju/lessons/${proposed.id}`, { status: 'active' })).status, 200);
  await say(G, 'raju who drives on saturday this week?', 'Chary.');
  assert.match(t.userTurn(t.claudeReqs.length - 1), /<lessons[^>]*>\n- Chary drives on Saturdays, not Rao\./);
  // many lessons: the relevant one still makes it within the budget
  for (let i = 0; i < 12; i++) await t.api(owner, 'POST', '/api/agents/raju/lessons', { text: `Lesson number ${i} about the picnic menu and the weather forecast for the outing` });
  await say(G, 'raju who drives on saturday?', 'Chary.');
  const turn = t.userTurn(t.claudeReqs.length - 1);
  assert.match(turn, /Chary drives on Saturdays/);
  assert.ok(turn.match(/<lessons[\s\S]*?<\/lessons>/)[0].length < 1000, 'bounded');
});

test('the owner corrects the agent in the chat → a chat lesson; auto-approve saves at once; off → nothing', async () => {
  await say(G, 'raju can you post the menu?', 'Here is the menu: dosa, idli.');
  t.script.push([{ type: 'text', text: '{"lesson": "Do not post the menu in this group.", "scope": "chat"}' }]);
  const before = proposalReqs().length;
  await say(G, "don't post the menu here", undefined, OWNER_PHONE);
  const l = await t.waitFor(async () => (await lessons('raju')).proposed.find((x) => x.source === 'correction'));
  assert.deepEqual([l.chat, l.text], [G, 'Do not post the menu in this group.']);
  assert.equal(proposalReqs().length, before + 1);
  // a non-owner saying "no" proposes nothing; an owner message that is not a correction neither
  await say(G, 'no, that is wrong', undefined, '41790000002');
  await say(G, 'great, thanks', undefined, OWNER_PHONE);
  assert.equal(proposalReqs().length, before + 1);
  // auto-approve
  await t.api(owner, 'PUT', '/api/agents/raju', { lessons: { enabled: true, autoApprove: true } });
  await say(G, 'raju where is pickup?', 'Pickup is at Lausanne.');
  t.script.push([{ type: 'text', text: '{"lesson": "Pickup is at Morges station, not Lausanne.", "scope": "agent"}' }]);
  await say(G, 'no, Morges station', undefined, OWNER_PHONE);
  await t.waitFor(async () => (await lessons('raju')).active.some((x) => /Morges station/.test(x.text)));
  // switched off
  await t.api(owner, 'PUT', '/api/agents/raju', { lessons: { enabled: false, autoApprove: false } });
  const n = proposalReqs().length;
  await say(G, 'raju where is pickup?', 'Pickup is at Morges.');
  await say(G, 'no, the station', undefined, OWNER_PHONE);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(proposalReqs().length, n);
  assert.doesNotMatch(t.userTurn(t.claudeReqs.length - 1), /<lessons/, 'lessons off: not used either');
  await t.api(owner, 'PUT', '/api/agents/raju', { lessons: { enabled: true, autoApprove: false } });
});

test('when to join in: a judged answer can be marked "didn\'t need to answer"; a quiet one "should have answered"', async () => {
  await say(J, 'anyone got jumper cables?', 'I can ask around for jumper cables.');
  const ans = t.db.lastAgentMessage(J);
  const page = await t.api(owner, 'GET', `/api/chats/${encodeURIComponent(J)}/messages?limit=3`);
  assert.equal(page.body.find((m) => m.id === ans.id).judged, true, 'answered by itself');
  t.script.push([{ type: 'text', text: '{"lesson": "Stay out of small talk about car trouble between members."}' }]);
  const r = await t.api(owner, 'POST', '/api/agents/nila/join-feedback', { kind: 'needless', msg: ans.id });
  assert.equal(r.body.proposing, true);
  const l = await t.waitFor(async () => (await lessons('nila')).proposed.find((x) => x.kind === 'join'));
  assert.deepEqual([l.chat, l.source], [J, 'needless']);
  assert.match(JSON.stringify(proposalReqs().at(-1).messages), /jumper cables/);
  await t.api(owner, 'PUT', `/api/agents/nila/lessons/${l.id}`, { status: 'active' });
  // the next judged turn carries the join-in lesson in its note
  await say(J, 'my car battery died again lol', '[quiet]');
  assert.match(t.userTurn(t.claudeReqs.length - 1), /What the owner taught you about joining in here:\n- Stay out of small talk about car trouble/);
  // stayed quiet, but should have answered
  t.script.push([{ type: 'text', text: '{"lesson": "Answer questions about the meeting time even without your name."}' }]);
  await t.api(owner, 'POST', '/api/agents/nila/join-feedback', { kind: 'missed', chat: J });
  await t.waitFor(async () => (await lessons('nila')).proposed.some((x) => x.source === 'missed'));
  // 👍 on a judged answer counts as good
  await say(J, 'what time do we meet?', 'At 9.');
  await t.api(owner, 'PUT', `/api/agents/nila/review/${t.db.lastAgentMessage(J).id}`, { rating: 1 });
  const fb = (await lessons('nila')).feedback;
  assert.deepEqual(fb.map((f) => f.kind).sort(), ['good', 'missed', 'needless']);
  assert.equal((await t.api(owner, 'POST', '/api/agents/nila/join-feedback', { kind: 'missed', chat: 'nowhere@g.us' })).status, 400);
});

test('edit, scope, delete; erase a chat\'s memory removes its lessons; admin MCP has the tools', async () => {
  const { active } = await lessons('nila');
  const l = active.find((x) => x.kind === 'join');
  assert.equal((await t.api(owner, 'PUT', `/api/agents/nila/lessons/${l.id}`, { text: 'x' })).status, 400, 'too short');
  await t.api(owner, 'PUT', `/api/agents/nila/lessons/${l.id}`, { text: 'Stay out of car trouble chatter.', chat: '' });
  assert.equal((await lessons('nila')).active.find((x) => x.id === l.id).chat, '');
  const added = (await t.api(owner, 'POST', '/api/agents/nila/lessons', { text: 'Only in this group: say hello in Telugu.', chat: J })).body;
  await t.api(owner, 'DELETE', `/api/chats/${encodeURIComponent(J)}/memory`);
  const after = await lessons('nila');
  assert.ok(!after.active.some((x) => x.id === added.id), 'chat lesson erased with the chat memory');
  assert.ok(after.active.some((x) => x.id === l.id), 'lessons for all its chats stay');
  assert.equal(after.feedback.length, 0);
  assert.equal((await t.api(owner, 'DELETE', `/api/agents/nila/lessons/${l.id}`)).status, 200);
  assert.equal((await t.api(owner, 'DELETE', `/api/agents/raju/lessons/${l.id}`)).status, 404, 'another agent\'s lesson');
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  for (const n of ['list_lessons', 'add_lesson', 'edit_lesson', 'delete_lesson', 'join_in_feedback']) assert.ok(TOOLS.find((x) => x.name === n), n);
});
