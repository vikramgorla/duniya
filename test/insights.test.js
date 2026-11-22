// #36 first-run checklist, #34 why an agent stayed silent, #37 test console "Test as…".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '3' } });
const owner = await t.login();
t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vic', 'viewer password 123');
after(() => t.close());

const silences = async (q = '') => (await t.api(owner, 'GET', `/api/silences?${q}`)).body.silences;
const silenceActs = (chat) => t.db.listActivity({ limit: 500, chat }).filter((a) => a.type === 'silence');

// ---------- #36, 062 ----------
test('#36/062: Getting started shows live setup state in first-run order, links each step and can be dismissed (admins only)', async () => {
  let c = (await t.api(viewer, 'GET', '/api/checklist')).body;
  assert.deepEqual(c.steps.map((s) => s.id), ['whatsapp', 'provider', 'agent', 'chat', 'reply']);
  const by = Object.fromEntries(c.steps.map((s) => [s.id, s]));
  assert.equal(by.provider.done, true, 'the fake Claude key lists models');
  assert.equal(by.whatsapp.done, true);
  assert.equal(by.agent.done, true);
  assert.equal(by.chat.done, true);
  assert.equal(by.reply.done, false, 'no reply yet');
  assert.equal(c.complete, false);
  assert.equal(by.provider.href, '#models');
  assert.equal(by.chat.href, '#chats');
  assert.match(by.reply.href, /^#agents\/[a-z-]+\/test$/);
  assert.equal(c.agent.id, 'panduga', 'the agent the inline steps use: one with a chat that is on');

  // a chat switched off everywhere → the step is open again
  const on = t.chatPrefs.enabledChats();
  for (const ch of on) t.chatPrefs.setChatPrefs(ch, { enabled: false });
  assert.equal((await t.api(owner, 'GET', '/api/checklist')).body.steps.find((s) => s.id === 'chat').done, false);
  for (const ch of on) t.chatPrefs.setChatPrefs(ch, { enabled: true });

  // 062: a step can be skipped (it counts) and brought back; unknown steps are refused; viewers cannot change it
  c = (await t.api(owner, 'PUT', '/api/checklist', { skip: 'reply' })).body;
  assert.equal(c.steps.find((s) => s.id === 'reply').skipped, true);
  assert.equal(c.complete, true);
  assert.equal((await t.api(owner, 'PUT', '/api/checklist', { skip: 'nope' })).status, 400);
  assert.equal((await t.api(viewer, 'PUT', '/api/checklist', { skip: 'reply' })).status, 403);
  c = (await t.api(owner, 'PUT', '/api/checklist', { unskip: 'reply' })).body;
  assert.equal(c.steps.find((s) => s.id === 'reply').skipped, false);
  assert.equal(c.complete, false);

  // the owner assistant's own answers do not count as the first reply (it is built in, not "your agent")
  t.db.logMessage({ chat: 'owner@s.whatsapp.net', agent: 'owner-assistant', msgId: 'oa1', sender: '', name: 'Owner assistant', text: 'Hi', addressed: false, fromAgent: true, ts: Date.now() });
  assert.equal((await t.api(owner, 'GET', '/api/checklist')).body.steps.find((s) => s.id === 'reply').done, false);

  // a test console reply completes the last step
  t.script.push([{ type: 'text', text: 'Hello!' }]);
  assert.equal((await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'hi' })).body.reply, 'Hello!');
  c = (await t.api(owner, 'GET', '/api/checklist')).body;
  assert.equal(c.complete, true);
  assert.equal(c.done, 5);

  assert.equal((await t.api(viewer, 'PUT', '/api/checklist', { dismissed: true })).status, 403);
  c = (await t.api(owner, 'PUT', '/api/checklist', { dismissed: true })).body;
  assert.equal(c.dismissed, true);
  assert.equal(t.store.getSettings().checklistDismissed, true);
  assert.equal((await t.api(owner, 'PUT', '/api/checklist', { dismissed: false })).body.dismissed, false);
});

// ---------- #34 ----------
test('#34: not mentioned → one row per chat+agent+reason with a count, no message text; activity at most hourly', async () => {
  await t.route(t.msg({ text: 'see you all at the station', senderName: 'Anu' }));
  await t.route(t.msg({ text: 'secret plans for saturday', senderName: 'Ravi', phone: '41790000003' }));
  const rows = t.db.db.prepare("SELECT * FROM silences WHERE chat = 'g1@g.us' AND reason = 'not_addressed'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].agent, 'panduga');
  assert.equal(rows[0].sample_sender, 'Ravi');
  const dump = JSON.stringify(t.db.db.prepare('SELECT * FROM silences').all());
  assert.ok(!dump.includes('secret plans') && !dump.includes('station'), 'never message text');
  const acts = silenceActs('g1@g.us');
  assert.equal(acts.length, 1, 'one activity entry per chat+reason per hour');
  assert.match(acts[0].summary, /Stayed quiet: not mentioned/);
  assert.equal(t.events.categoryOf('silence'), 'silences');

  const s = (await silences('chat=g1%40g.us')).find((x) => x.reason === 'not_addressed');
  assert.equal(s.count, 2);
  assert.equal(s.label, 'not mentioned');
  assert.equal(s.chatName, 'Panduga families');
  assert.equal(s.agentName, 'Panduga');
  assert.equal(s.fix, 'triggers');
});

test('#34: chat off is recorded only when the message addressed an agent; one-click fix clears it', async () => {
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: false });
  await t.route(t.msg({ chat: 'g3@g.us', text: 'just chatting' }));
  assert.equal((await silences('chat=g3%40g.us')).length, 0, 'ordinary talk in a chat that is off is not a silence');
  await t.route(t.msg({ chat: 'g3@g.us', text: '!panduga are you there?' }));
  await t.route(t.msg({ chat: 'g3@g.us', text: 'hello', mentioned: true }));
  const [s] = await silences('chat=g3%40g.us');
  assert.equal(s.reason, 'chat_off');
  assert.equal(s.count, 2);
  assert.equal(s.fix, 'chat_on');
  assert.equal(t.sent.filter((m) => m.chat === 'g3@g.us').length, 0);
  assert.equal((await t.api(viewer, 'DELETE', '/api/silences?chat=g3%40g.us&reason=chat_off')).status, 403);
  assert.equal((await t.api(owner, 'DELETE', '/api/silences?chat=g3%40g.us&reason=chat_off')).body.removed, 1);
  assert.equal((await silences('chat=g3%40g.us')).length, 0);
  assert.equal((await t.api(owner, 'DELETE', '/api/silences?reason=nope')).status, 400);
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: true });
});

test('#34: paused, agent off, no agent, direct messages not allowed, rate limit, budget hook', async () => {
  t.store.updateSettings({ paused: true });
  await t.route(t.msg({ text: '!panduga agenda?' }));
  t.store.updateSettings({ paused: false });
  assert.equal((await silences('reason=paused'))[0]?.chat, 'g1@g.us');

  await t.agents.updateAgent('helper', { enabled: false });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help roll' }));
  await t.agents.updateAgent('helper', { enabled: true });
  const off = (await silences('reason=agent_disabled'))[0];
  assert.equal(off.chat, 'g2@g.us');
  assert.equal(off.agent, 'helper');

  await t.route(t.msg({ chat: 'g4@g.us', text: '!panduga hello?' }));
  assert.equal((await silences('reason=no_agent'))[0]?.chat, 'g4@g.us');

  // a direct message from someone who is neither organizer nor member of the agent's groups
  await t.route(t.msg({ isGroup: false, chat: '41790000005@s.whatsapp.net', phone: '41790000005', text: 'hi there' }));
  const dm = (await silences('chat=41790000005%40s.whatsapp.net'))[0];
  assert.equal(dm.reason, 'role_not_allowed');
  assert.equal(dm.fix, 'agent');

  // rate limit (3 a minute in this file)
  for (let i = 0; i < 3; i++) t.script.push([{ type: 'text', text: `ok ${i}` }]);
  for (let i = 0; i < 4; i++) await t.route(t.msg({ chat: 'g5@g.us', text: '!help hi', phone: '41790000009' }));
  t.script.length = 0;
  assert.ok((await silences('reason=rate_limited')).length === 0, 'g5 has no agent: no rate limit reached');
  for (let i = 0; i < 4; i++) { t.script.push([{ type: 'text', text: `ok ${i}` }]); await t.route(t.msg({ chat: 'g2@g.us', text: '!help hi', phone: '41790000001' })); }
  t.script.length = 0;
  const rl = (await silences('reason=rate_limited'))[0];
  assert.equal(rl.chat, 'g2@g.us');
  assert.equal(rl.count, 1);

  // usage caps (#35) call the hook exported by the router
  assert.equal(typeof t.router.silenceReason, 'function');
  t.router.silenceReason('budget', { chat: 'g1@g.us', agent: 'panduga', sender: 'Anu' });
  t.router.silenceReason('nonsense', { chat: 'g1@g.us' });
  assert.equal((await silences('reason=budget'))[0].label, 'budget cap reached');
  assert.equal((await silences('reason=nonsense')).length, 0);
});

test('#34: model errors and empty answers are recorded', async () => {
  t.script.push([]); // the model answers nothing
  await t.route(t.msg({ text: '!panduga anything?', phone: '41790000004' }));
  assert.equal((await silences('reason=no_reply'))[0]?.chat, 'g1@g.us');
  t.chatPrefs.setChatPrefs('g6@g.us', { model: 'nosuchprovider:model', fallback: { mode: 'off' } }); // 042: no fallback to another model
  await t.agents.bindChat('g6@g.us', 'helper', 'test');
  await t.route(t.msg({ chat: 'g6@g.us', text: '!help hi', phone: '41790000004' }));
  assert.equal((await silences('reason=model_error'))[0]?.chat, 'g6@g.us');
});

test('#34: silence activity follows the logging policy; admin MCP list_silences', async () => {
  await t.api(owner, 'PUT', '/api/logging', { level: 'minimal' });
  t.router.silenceReason('paused', { chat: 'g7@g.us', agent: 'panduga' });
  assert.equal(silenceActs('g7@g.us').length, 0, 'minimal logging keeps no silence entries');
  assert.equal((await silences('chat=g7%40g.us'))[0].count, 1, 'the counter is still kept');
  await t.api(owner, 'PUT', '/api/logging', { level: 'normal' });

  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const tool = TOOLS.find((x) => x.name === 'list_silences');
  assert.ok(tool?.readOnly);
  const x = { call: async (m, p, b) => (await t.api(owner, m, p, b)).body };
  const out = await tool.run({ chat: 'g1@g.us' }, x);
  assert.ok(out.some((r) => r.reason === 'not_addressed' && r.count >= 2 && r.label === 'not mentioned'));
  assert.ok(out.every((r) => !('text' in r)));
});

// ---------- #37 ----------
test('#37: tools per role for the test console', async () => {
  const p = (await t.api(viewer, 'GET', '/api/agents/panduga/test-tools?role=participant')).body;
  const o = (await t.api(owner, 'GET', '/api/agents/panduga/test-tools?role=organizer')).body;
  const names = (r) => r.services.flatMap((s) => s.tools.map((x) => `${s.service}:${x.name}`));
  assert.equal(o.role, 'organizer');
  assert.ok(names(o).includes('panduga:room_assign_preview'));
  assert.ok(!names(o).includes('panduga:confirm'), 'confirming is never the model’s job');
  assert.ok(!names(p).includes('panduga:room_assign_preview'));
  assert.ok(names(p).includes('whatsapp:send_media') && !names(p).includes('whatsapp:block'));
  assert.ok(names(o).includes('whatsapp:block'));
  assert.equal(o.count, names(o).length);
  assert.equal(o.services.find((s) => s.service === 'whatsapp').name, 'Chat actions');
  assert.equal((await t.api(owner, 'GET', '/api/agents/nope/test-tools')).status, 404);
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const lt = TOOLS.find((x) => x.name === 'list_agent_tools');
  assert.equal((await lt.run({ agent_id: 'panduga', as: 'organizer' }, { call: async (m, path) => (await t.api(owner, m, path)).body })).role, 'organizer');
});

test('#37: "Test as" in a chat uses that chat’s memory and type, never sends to WhatsApp', async () => {
  t.db.logMessage({ chat: 'g1@g.us', agent: 'panduga', msgId: 'mem-1', sender: '41790000002', name: 'Anu', text: 'The Rao family brings the drums' });
  const sentBefore = t.sent.length; const waBefore = t.waCalls.length;
  t.script.push([{ type: 'tool_use', id: 'tu1', name: 'whatsapp__send_location', input: { chat: 'g1@g.us', latitude: 46.3, longitude: 6.9, name: 'Hall' } }]);
  t.script.push([{ type: 'tool_use', id: 'tu2', name: 'whatsapp__group_info', input: {} }]);
  t.script.push([{ type: 'text', text: 'Shared the hall location.' }]);
  const n = t.claudeReqs.length;
  const r = (await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'where is the hall?', role: 'participant', chat: 'g1@g.us' })).body;
  assert.equal(r.reply, 'Shared the hall location.');
  assert.equal(r.chat, 'g1@g.us');
  assert.equal(r.chatOn, true);
  assert.equal(t.sent.length, sentBefore, 'nothing sent to WhatsApp');
  assert.ok(!t.waCalls.slice(waBefore).some((c) => c.fn === 'sendLocation'), 'WhatsApp actions are simulated');
  assert.ok(t.waCalls.slice(waBefore).some((c) => c.fn === 'groupInfo' && c.chat === 'g1@g.us'), 'read-only actions look at the chat being tested');
  const req = t.claudeReqs[n];
  assert.match(req.system, /WhatsApp group/);
  assert.match(req.system, /Panduga families/);
  assert.match(t.userTurn(n), /Rao family brings the drums/);
  assert.match(t.userTurn(n), /\(participant\)/);
  const toolResult = JSON.stringify(t.claudeReqs[n + 1].messages.at(-1).content);
  assert.match(toolResult, /not carried out/);

  // organizer in a new direct chat: a DM context, organizer tools
  t.script.push([{ type: 'text', text: 'Hi organizer' }]);
  const m = t.claudeReqs.length;
  const r2 = (await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'hello', role: 'organizer', chat: 'new' })).body;
  assert.equal(r2.chat, 'new');
  assert.match(t.claudeReqs[m].system, /WhatsApp direct message/);
  assert.ok(t.toolNames(m).includes('panduga__room_assign_preview'));
  assert.ok(!t.userTurn(m).includes('Rao family brings the drums'));

  // a chat that is off still tests, and says so; a chat of another agent is refused
  t.chatPrefs.setChatPrefs('g1@g.us', { enabled: false });
  t.script.push([{ type: 'text', text: 'ok' }]);
  assert.equal((await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'hi', chat: 'g1@g.us' })).body.chatOn, false);
  t.chatPrefs.setChatPrefs('g1@g.us', { enabled: true });
  assert.equal((await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'hi', chat: 'g2@g.us' })).status, 400);
  assert.equal(t.sent.length, sentBefore);
});

// Last: it removes and re-imports the agents.
test('062: the built-in owner assistant alone is not "your first agent"; choosing an agent with enable switches the chat on', async () => {
  const saved = t.agents.listAgents().filter((a) => a.id !== 'owner-assistant').map((a) => a.id);
  // Without any agent of your own the step is open, even though the owner assistant exists.
  const exported = [];
  for (const id of saved) { exported.push((await t.api(owner, 'GET', `/api/agents/${id}/export`)).body); await t.api(owner, 'DELETE', `/api/agents/${id}`); }
  let c = (await t.api(owner, 'GET', '/api/checklist')).body;
  assert.equal(c.steps.find((s) => s.id === 'agent').done, false);
  assert.equal(c.steps.find((s) => s.id === 'chat').done, false);
  assert.equal(c.agent, null);
  for (const e of exported) await t.api(owner, 'POST', '/api/agents/import', e);

  // bind + enable: one call binds the agent and switches an Off chat on (recorded like the switch)
  const chat = 'g-new@g.us';
  assert.equal(t.chatPrefs.isChatEnabled(chat), false);
  let r = (await t.api(owner, 'POST', '/api/chats/bind', { chat, agent: 'panduga', enable: true })).body;
  assert.equal(r.enabled, true);
  assert.equal(t.chatPrefs.isChatEnabled(chat), true);
  assert.ok(t.db.listActivity({ limit: 50, chat }).some((a) => /Chat switched ON/.test(a.summary)));
  // without enable an Off chat stays off
  const other = 'g-other@g.us';
  r = (await t.api(owner, 'POST', '/api/chats/bind', { chat: other, agent: 'panduga' })).body;
  assert.equal(r.enabled, false);
  assert.equal(t.chatPrefs.isChatEnabled(other), false);
  c = (await t.api(owner, 'GET', '/api/checklist')).body;
  assert.equal(c.steps.find((s) => s.id === 'agent').done, true);
});

test('#163: the test console sends its conversation so far, so a follow-up is understood', async () => {
  t.script.push([{ type: 'text', text: 'Whom should I assign it to?' }]);
  const thread = [{ from: 'me', text: 'Can you assign Bhogi mantalu to someone?' }, { from: 'agent', text: 'Whom should I assign it to?' }];
  const r = await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'To Chary', role: 'organizer', thread });
  assert.equal(r.status, 200);
  const turn = t.userTurn(t.claudeReqs.length - 1);
  assert.match(turn, /Earlier in this test conversation:\nPanel admin: Can you assign Bhogi mantalu to someone\?\nYou: Whom should I assign it to\?/);
  assert.match(turn, /New message from Panel admin \(organizer\):\nTo Chary/);
  // bounded: at most 20 earlier turns, each cut to 2000 characters
  t.script.push([{ type: 'text', text: 'ok' }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ from: i % 2 ? 'agent' : 'me', text: `turn ${i} ${'x'.repeat(3000)}` }));
  await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'next', thread: many });
  const last = t.userTurn(t.claudeReqs.length - 1);
  assert.ok(!last.includes('turn 9 ') && last.includes('turn 10 ') && last.includes('turn 29 '));
  assert.ok(!last.includes('x'.repeat(2001)));
});

test('#165: "Everyone: all tools" (service:* for both roles) gives participants every tool, never the confirm tool', async () => {
  const before = (await t.api(owner, 'GET', '/api/agents/panduga')).body.config.tools;
  const r = await t.api(owner, 'PUT', '/api/agents/panduga', { tools: { ...before, participant: [...before.participant.filter((x) => !x.startsWith('panduga:')), 'panduga:*'], organizer: [...before.organizer.filter((x) => !x.startsWith('panduga:')), 'panduga:*'] } });
  assert.equal(r.status, 200);
  const names = (role) => t.api(owner, 'GET', `/api/agents/panduga/test-tools?role=${role}`).then((x) => x.body.services.find((s) => s.service === 'panduga').tools.map((y) => y.name));
  const [p, o] = [await names('participant'), await names('organizer')];
  assert.ok(p.includes('room_assign_preview') && !p.includes('confirm'));
  assert.deepEqual(p.sort(), o.sort());
  await t.api(owner, 'PUT', '/api/agents/panduga', { tools: before });
});

test('086: Getting started step 1 is done by a connected Telegram bot as well as by a linked WhatsApp number', async () => {
  const real = t.channel.status;
  const step = async () => (await t.api(owner, 'GET', '/api/checklist')).body.steps.find((s) => s.id === 'whatsapp');
  try {
    t.channel.status = async () => ({ numbers: [{ id: 'main', status: 'qr' }], channels: [{ id: 'whatsapp', connected: 0 }, { id: 'telegram', connected: 0 }] });
    assert.equal((await step()).done, false, 'nothing linked yet');
    t.channel.status = async () => ({ numbers: [{ id: 'main', status: 'qr' }], channels: [{ id: 'whatsapp', connected: 0 }, { id: 'telegram', connected: 1 }] });
    const s = await step();
    assert.equal(s.done, true, 'a Telegram bot alone completes the first step');
    assert.match(s.title, /Telegram/);
  } finally { t.channel.status = real; }
});
