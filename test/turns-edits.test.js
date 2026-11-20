// 087: one turn at a time per agent and chat, no double answers, and edited messages (agent's own, the owner's from
// the panel, and people's edits coming in).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner;
const G = 'g8@g.us';
const enc = encodeURIComponent(G);
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Raju', triggers: ['raju'] } }); // follow-ups (the default)
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'raju' });
});
after(() => t.close());

const gif = (url, id) => ({ type: 'tool_use', id, name: 'whatsapp__send_media', input: { kind: 'gif', url } });
const gifs = () => t.waCalls.filter((c) => c.fn === 'sendMedia' && c.chat === G && c.args[0].kind === 'gif');
const silence = (reason) => t.db.db.prepare('SELECT SUM(count) AS n FROM silences WHERE chat = ? AND reason = ?').get(G, reason)?.n || 0;

test('the car-pooling case: two messages at once → one turn, then one follow-up that sees the GIF; exactly one GIF', async () => {
  // the agent spoke before: both messages are follow-ups
  t.script.push([{ type: 'text', text: 'Ride for Saturday is set: Vik drives.' }]);
  await t.route(t.msg({ chat: G, text: 'raju who drives on Saturday?' }));
  const before = gifs().length; const reqs = t.claudeReqs.length;
  // turn 1 sends a GIF; the follow-up turn (the second message waited) tries another GIF, then stays quiet
  t.script.push([gif('https://example.com/party.mp4', 'g1')], [{ type: 'text', text: '🎉' }], [gif('https://example.com/cheers.mp4', 'g2')], [{ type: 'text', text: '[quiet]' }]);
  await Promise.all([
    t.route(t.msg({ chat: G, text: 'Just message? No celebratory gif?', phone: '41790000001', senderName: 'Vik' })),
    t.route(t.msg({ chat: G, text: 'Well said raju', phone: '41790000003', senderName: 'Chary' })),
  ]);
  assert.equal(gifs().length - before, 1, 'exactly one GIF');
  assert.equal(t.claudeReqs.length - reqs, 4, 'one turn, then one follow-up turn (two model calls each)');
  const follow = JSON.stringify(t.claudeReqs[reqs + 2].messages[0].content);
  assert.match(follow, /arrived while you were answering/);
  assert.match(follow, /\[gif\]/, 'the follow-up sees the GIF it just sent');
  assert.match(follow, /Well said raju/);
  const res = JSON.stringify(t.claudeReqs[reqs + 3].messages.at(-1).content);
  assert.match(res, /already sent this here/, 'the second GIF was not sent; the model is told why');
  assert.ok(silence('already_answered') >= 1, 'counted as "already answered"');
});

test('messages that wait are handled together: three at once → two turns, not three', async () => {
  t.script.push([{ type: 'text', text: 'Pickup is at the station at 8.' }]);
  await t.route(t.msg({ chat: G, text: 'raju where is pickup?' }));
  const reqs = t.claudeReqs.length; const sent = t.sent.length;
  t.script.push([{ type: 'text', text: 'At 8:15 then.' }], [{ type: 'text', text: 'Noted: Anu brings snacks.' }]);
  await Promise.all([
    t.route(t.msg({ chat: G, text: 'raju can we make it 8:15?' })),
    t.route(t.msg({ chat: G, text: 'ok 8:15 works for me', phone: '41790000003', senderName: 'Chary' })),
    t.route(t.msg({ chat: G, text: 'I will bring snacks', phone: '41790000002', senderName: 'Anu' })),
  ]);
  assert.equal(t.claudeReqs.length - reqs, 2);
  const follow = JSON.stringify(t.claudeReqs.at(-1).messages[0].content);
  assert.match(follow, /8:15 works for me/); assert.match(follow, /I will bring snacks/);
  assert.deepEqual(t.sent.slice(sent).map((s) => s.text), ['At 8:15 then.', 'Noted: Anu brings snacks.']);
});

test('the same answer twice from racing turns is sent once; asking again later is answered again', async () => {
  const sent = t.sent.length;
  t.script.push([{ type: 'text', text: 'The car leaves at nine sharp.' }], [{ type: 'text', text: 'The car leaves at nine sharp!' }]);
  await Promise.all([
    t.route(t.msg({ chat: G, text: 'raju when do we leave?' })),
    t.route(t.msg({ chat: G, text: 'raju what time again?', phone: '41790000003', senderName: 'Chary' })),
  ]);
  assert.equal(t.sent.length - sent, 1, 'the near-identical second answer was dropped');
  t.script.push([{ type: 'text', text: 'The car leaves at nine sharp.' }]);
  await t.route(t.msg({ chat: G, text: 'raju when do we leave?' }));
  assert.equal(t.sent.length - sent, 2, 'a later question gets its answer');
});

test('the agent corrects itself with edit_my_last_message instead of a second message', async () => {
  t.script.push([{ type: 'text', text: 'Rao drives on Sunday.' }]);
  await t.route(t.msg({ chat: G, text: 'raju who drives Sunday?' }));
  const last = t.db.lastAgentMessage(G);
  const sent = t.sent.length;
  t.script.push([{ type: 'tool_use', id: 'e1', name: 'whatsapp__edit_my_last_message', input: { text: 'Chary drives on Sunday.' } }], [{ type: 'text', text: '[quiet]' }]);
  await t.route(t.msg({ chat: G, text: "no raju, it's Chary" }));
  const call = t.waCalls.filter((c) => c.fn === 'editMessage').at(-1);
  assert.deepEqual([call.chat, call.args[0], call.args[1]], [G, last.msg_id, 'Chary drives on Sunday.']);
  assert.equal(t.sent.length, sent, 'no second message');
  const page = await t.api(owner, 'GET', `/api/chats/${enc}/messages?limit=5`);
  const row = page.body.find((m) => m.id === last.id);
  assert.equal(row.text, 'Chary drives on Sunday.'); assert.ok(row.edited, 'marked edited');
  // outside the window it refuses (WhatsApp: 15 minutes)
  t.db.db.prepare('UPDATE messages SET ts = ? WHERE id = ?').run(Date.now() - 20 * 60000, last.id);
  t.script.push([{ type: 'tool_use', id: 'e2', name: 'whatsapp__edit_my_last_message', input: { text: 'x' } }], [{ type: 'text', text: 'Sorry: Chary drives.' }]);
  await t.route(t.msg({ chat: G, text: 'raju fix it again' }));
  assert.match(JSON.stringify(t.claudeReqs.at(-1).messages.at(-1).content), /only within 15 minutes/);
});

test('the owner edits an agent message from the panel within the window; later a correction is sent instead', async () => {
  t.script.push([{ type: 'text', text: 'Meet at Aigle station at 7.' }]);
  await t.route(t.msg({ chat: G, text: 'raju where do we meet?' }));
  const m = t.db.lastAgentMessage(G);
  let page = await t.api(owner, 'GET', `/api/chats/${enc}/messages?limit=3`);
  assert.equal(page.body.find((x) => x.id === m.id).editable, true);
  const r = await t.api(owner, 'PUT', `/api/chats/${enc}/messages/${m.id}`, { text: 'Meet at Aigle station at 7:30.' });
  assert.equal(r.status, 200);
  assert.deepEqual(t.waCalls.filter((c) => c.fn === 'editMessage').at(-1).args.slice(0, 2), [m.msg_id, 'Meet at Aigle station at 7:30.']);
  // too late
  t.db.db.prepare('UPDATE messages SET ts = ? WHERE id = ?').run(Date.now() - 16 * 60000, m.id);
  page = await t.api(owner, 'GET', `/api/chats/${enc}/messages?limit=3`);
  assert.equal(page.body.find((x) => x.id === m.id).editable, false);
  const late = await t.api(owner, 'PUT', `/api/chats/${enc}/messages/${m.id}`, { text: 'Meet at 8' });
  assert.equal(late.status, 409); assert.equal(late.body.code, 'edit_window');
  const n = t.sent.length;
  const fix = await t.api(owner, 'POST', `/api/chats/${enc}/messages/${m.id}/correction`, { text: 'Correction: meet at 8.' });
  assert.equal(fix.status, 200);
  assert.equal(t.sent.length, n + 1); assert.equal(t.sent.at(-1).text, 'Correction: meet at 8.');
  // a person's message cannot be edited
  const theirs = t.db.db.prepare('SELECT id FROM messages WHERE chat = ? AND from_agent = 0 ORDER BY id DESC LIMIT 1').get(G);
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${enc}/messages/${theirs.id}`, { text: 'x' })).status, 400);
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  assert.equal(TOOLS.find((x) => x.name === 'edit_chat_message').risky, true);
});

test('a person edits a message the agent answered: stored copy updated; a changed meaning gets one judged turn', async () => {
  const q = t.msg({ chat: G, text: 'raju is the trip on Saturday?' });
  t.script.push([{ type: 'text', text: 'Yes, Saturday at 9.' }]);
  await t.route(q);
  const reqs = t.claudeReqs.length;
  // a typo fix: stored, no turn
  await t.route({ ...t.msg({ chat: G, text: 'raju is the trip on Saturday ?' }), kind: 'edited', target: q.msgId });
  assert.equal(t.claudeReqs.length, reqs);
  assert.equal(t.db.db.prepare('SELECT text FROM messages WHERE chat = ? AND msg_id = ?').get(G, q.msgId).text, 'raju is the trip on Saturday ?');
  // a new meaning: one turn, told what changed; it may correct itself or stay quiet
  t.script.push([{ type: 'text', text: '[quiet]' }]);
  const sent = t.sent.length;
  await t.route({ ...t.msg({ chat: G, text: 'raju is the hike on Sunday morning?' }), kind: 'edited', target: q.msgId });
  assert.equal(t.claudeReqs.length, reqs + 1);
  assert.match(JSON.stringify(t.claudeReqs.at(-1).messages[0].content), /edited the message you answered/);
  assert.equal(t.sent.length, sent, '[quiet] is never sent');
  // a chat that is off: nothing stored, no turn
  t.chatPrefs.setChatPrefs(G, { enabled: false });
  await t.route({ ...t.msg({ chat: G, text: 'changed again' }), kind: 'edited', target: q.msgId });
  assert.equal(t.db.db.prepare('SELECT text FROM messages WHERE chat = ? AND msg_id = ?').get(G, q.msgId).text, 'raju is the hike on Sunday morning?');
  t.chatPrefs.setChatPrefs(G, { enabled: true });
});
