// 076: group replies without a wake word — follow-ups after the agent spoke, and "answer when needed".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner;
const G = 'g7@g.us';
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  const r = await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Silku', triggers: ['silku'] } });
  assert.equal(r.body.config.groupReplies, 'followups', 'the default: wake word + follow-ups');
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'silku' });
});
after(() => t.close());

const say = async (text, model) => {
  const n = t.sent.length; const m = t.claudeReqs.length;
  if (model !== undefined) t.script.push([{ type: 'text', text: model }]);
  await t.route(t.msg({ chat: G, text, phone: '41790000002', senderName: 'Anu' }));
  return { reply: t.sent.length > n ? t.sent.at(-1).text : null, asked: t.claudeReqs.length > m };
};
const quietRows = () => t.db.db.prepare("SELECT count FROM silences WHERE chat = ? AND reason = 'not_for_me'").get(G)?.count || 0;

test('follow-ups: after the agent speaks, a reply without the wake word reaches it; it answers or stays quiet', async () => {
  assert.equal((await say('random chatter')).asked, false, 'before the agent spoke: wake word needed');
  assert.equal((await say('silku can you add Bhogi mantalu?', 'Who should take it?')).reply, 'Who should take it?');
  const f = await say('For now assign it to Chary', 'Done, Chary has it.');
  assert.equal(f.reply, 'Done, Chary has it.');
  assert.match(t.userTurn(t.claudeReqs.length - 1), /did not use your wake word/);
  assert.match(t.userTurn(t.claudeReqs.length - 1), /For now assign it to Chary/);
  const q = await say('lol anyone up for cricket', '[quiet]');
  assert.equal(q.asked, true); assert.equal(q.reply, null, '[quiet] is never sent');
  assert.equal(quietRows(), 1);
  // the agent judged the topic moved on: follow-ups close
  assert.equal((await say('weather is nice today', '[done]')).reply, null);
  assert.equal((await say('see you all tomorrow')).asked, false, 'closed: no more model calls');
  assert.equal((await say('silku thanks', 'You are welcome!')).reply, 'You are welcome!', 'the wake word still works');
});

test('wake only: no follow-ups; auto: every message is judged', async () => {
  await t.api(owner, 'PUT', '/api/agents/silku', { groupReplies: 'wake' });
  await say('silku hi', 'Hi!');
  assert.equal((await say('and one more thing')).asked, false);
  await t.api(owner, 'PUT', '/api/agents/silku', { groupReplies: 'auto' });
  const a = await say('does anyone know when the bus leaves?', 'At 8:05.');
  assert.equal(a.reply, 'At 8:05.');
  assert.equal((await say('ok thanks all', '[quiet]')).reply, null);
  const bad = await t.api(owner, 'PUT', '/api/agents/silku', { groupReplies: 'always' });
  assert.equal(bad.status, 400);
  await t.api(owner, 'PUT', '/api/agents/silku', { groupReplies: 'followups' });
});

test('[quiet] is understood in any case and never sent', async () => {
  await t.api(owner, 'PUT', '/api/agents/silku', { groupReplies: 'auto' });
  const n = t.sent.length;
  await say('just chatting', '[QUIET]');
  assert.equal(t.sent.length, n);
  await t.api(owner, 'PUT', '/api/agents/silku', { groupReplies: 'followups' });
});
