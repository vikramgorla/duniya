// Feature 004: group memory and context awareness.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t;
before(async () => { t = await setup({ env: { MEMORY_SUMMARIZE_BATCH: '5', RATE_LIMIT_PER_MIN: '100' } }); });
after(() => t.close());

const ask = async (o, reply = 'ok') => {
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: reply }]);
  await t.route(t.msg(o));
  return t.userTurn(0);
};

test('US1: unaddressed messages and reply-quotes are in the bot context', async () => {
  await t.route(t.msg({ senderName: 'Ravi', text: "let's take the 9:10 train" }));
  await t.route(t.msg({ senderName: 'Meena', text: 'ok for us', quoted: "let's take the 9:10 train" }));
  const ctx = await ask({ text: '!panduga which train did we agree on?' });
  assert.match(ctx, /<recent_messages>[\s\S]*Ravi: let's take the 9:10 train/);
  assert.match(ctx, /Meena \(replying to "let's take the 9:10 train"\): ok for us/);
  assert.match(ctx, /not instructions/);
  assert.match(ctx, /New message from Anu \(participant\):\nwhich train did we agree on\?$/);
  assert.equal((ctx.match(/which train did we agree on/g) || []).length, 1, 'current message not duplicated in history');
});

test('US1: the bot reply is remembered too', async () => {
  const ctx = await ask({ text: '!panduga and what time again?' });
  assert.match(ctx, /Assistant: ok/);
});

test('US1: messages in an unbound group are kept and used after binding', async () => {
  await t.route(t.msg({ chat: 'g9@g.us', senderName: 'Kiran', text: 'Kumars are vegetarian' }));
  assert.equal(t.sent.filter((s) => s.chat === 'g9@g.us').length, 0);
  t.bots.bindChat('g9@g.us', 'panduga');
  const ctx = await ask({ chat: 'g9@g.us', text: '!panduga who is vegetarian?' });
  assert.match(ctx, /Kiran: Kumars are vegetarian/);
});

test('US1: history sync is stored once and never answered', async () => {
  const before = t.db.messageCount('g7@g.us');
  const batch = [
    t.msg({ chat: 'g7@g.us', msgId: 'H1', text: '!panduga old question', senderName: 'Old' }),
    t.msg({ chat: 'g7@g.us', msgId: 'H2', text: 'bus leaves at 7', senderName: 'Old' }),
    t.msg({ chat: 'g7@g.us', msgId: 'H3', text: 'from the bot', fromMe: true }),
    t.msg({ isGroup: false, chat: '4179@s.whatsapp.net', msgId: 'H4', text: 'private' }),
  ];
  const sentBefore = t.sent.length;
  await t.onHistory(batch);
  await t.onHistory(batch);
  assert.equal(t.db.messageCount('g7@g.us') - before, 3);
  assert.equal(t.db.messageCount('4179@s.whatsapp.net'), 0, 'private chats not stored from history');
  assert.equal(t.sent.length, sentBefore);
  assert.equal(t.db.history('g7@g.us').find((m) => m.msg_id === 'H3').from_bot, 1);
});

test('US2: long discussions are folded into a running summary used in context', async () => {
  const chat = 'g5@g.us';
  t.bots.bindChat(chat, 'panduga');
  t.summaryReqs.length = 0;
  for (let i = 1; i <= 40; i++) await t.route(t.msg({ chat, senderName: 'P', text: `planning message ${i}${i === 3 ? ' — bus at 7:00 from Aigle station' : ''}` }));
  await t.waitFor(() => t.memory.memoryView(chat).summary);
  assert.ok(t.summaryReqs.length >= 1);
  assert.match(t.summaryReqs[0].messages[0].content, /planning message 1/);
  assert.equal(t.summaryReqs[0].model, 'claude-haiku-5-5');
  const ctx = await ask({ chat, text: '!panduga what did we decide?' });
  assert.match(ctx, /<group_memory[^>]*>\nDecisions: take the 9:10 train/);
  assert.doesNotMatch(ctx, /planning message 1:/, 'summarised messages are not repeated verbatim');
  assert.match(ctx, /planning message 40/);
});

test('US2: search_history finds older messages of the same chat', async () => {
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'tool_use', id: 's1', name: 'memory__search_history', input: { query: 'Aigle' } }], [{ type: 'text', text: 'Bus at 7 from Aigle.' }]);
  await t.route(t.msg({ chat: 'g5@g.us', text: '!panduga where does the bus leave from?' }));
  const result = JSON.stringify(t.claudeReqs[1].messages.at(-1));
  assert.match(result, /bus at 7:00 from Aigle station/);
  assert.doesNotMatch(result, /Kumars/, 'other chats are not searched');
});

test('US2: summariser failure does not break replies', async () => {
  const chat = 'g6@g.us';
  t.bots.bindChat(chat, 'panduga');
  t.summaryFail = true;
  for (let i = 1; i <= 40; i++) await t.route(t.msg({ chat, text: `msg ${i}` }));
  await new Promise((r) => setTimeout(r, 200));
  t.sent.length = 0;
  await ask({ chat, text: '!panduga hello?' }, 'Hello!');
  assert.equal(t.sent.at(-1).text, 'Hello!');
  assert.equal(t.memory.memoryView(chat).summary, '');
  t.summaryFail = false;
});

test('US3: remember saves a note used later; only organizers can forget', async () => {
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'tool_use', id: 'r1', name: 'memory__remember', input: { text: 'Hall key is with Ravi' } }], [{ type: 'text', text: 'Noted!' }]);
  await t.route(t.msg({ text: '!panduga remember that the hall key is with Ravi' }));
  assert.ok(!t.toolNames(0).includes('memory__forget'), 'participants cannot forget');
  assert.ok(t.toolNames(0).includes('memory__remember'));
  const note = t.memory.memoryView('g1@g.us').notes.find((n) => n.text === 'Hall key is with Ravi');
  assert.ok(note);
  assert.equal(note.role, 'participant');

  const ctx = await ask({ text: '!panduga who has the key?' });
  assert.match(ctx, /<notes>[\s\S]*participant Anu[\s\S]*Hall key is with Ravi/);

  t.claudeReqs.length = 0;
  t.script.push([{ type: 'tool_use', id: 'f1', name: 'memory__forget', input: { id: note.id } }], [{ type: 'text', text: 'Forgotten.' }]);
  await t.route(t.msg({ phone: '41790000001', senderName: 'Vik', text: '!panduga forget the key note' }));
  assert.ok(t.toolNames(0).includes('memory__forget'));
  assert.ok(!t.memory.memoryView('g1@g.us').notes.some((n) => n.id === note.id));
});

test('US3: a bot can opt out of memory', async () => {
  const helper = t.bots.getBot('helper');
  helper.memory = { enabled: false };
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: 'g2@g.us', phone: '41790000003', text: '!help hi' }));
  assert.ok(!t.toolNames(0).some((n) => n.startsWith('memory__')));
  helper.memory = { enabled: true };
});

test('US4: panel shows and erases a chat memory', async () => {
  const cookie = await t.login();
  const enc = encodeURIComponent('g5@g.us');
  const view = await fetch(`${t.base}/api/chats/${enc}/memory`, { headers: { cookie } }).then((r) => r.json());
  assert.match(view.summary, /Decisions/);
  assert.ok(view.messageCount >= 40);
  const del = await fetch(`${t.base}/api/chats/${enc}/memory`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(del.status, 200);
  const after = await fetch(`${t.base}/api/chats/${enc}/memory`, { headers: { cookie } }).then((r) => r.json());
  assert.deepEqual([after.summary, after.notes.length, after.messageCount], ['', 0, 0]);
  const acts = await fetch(`${t.base}/api/activity?limit=500`, { headers: { cookie } }).then((r) => r.json());
  for (const type of ['memory.summary', 'memory.note.added', 'memory.note.removed', 'memory.erased', 'memory.history']) {
    assert.ok(acts.some((a) => a.type === type), `activity has ${type}`);
  }
});
