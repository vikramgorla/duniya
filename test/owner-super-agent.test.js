// 059 (#119): the owner assistant as a super agent — the built-in agent record, global tool services, WhatsApp actions
// in the owner's own chat, sends into other chats held for confirm, role limits, photos, memory, character.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, serveFakeMcp } from './harness.js';

const gifCalls = [];
const gifs = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  await serveFakeMcp(req, res, d, { name: 'gifs', tools: ['search_gifs', 'trending_gifs', 'confirm'],
    call: (n) => { gifCalls.push(n); return n === 'search_gifs' ? JSON.stringify([{ id: 'g1', mp4: 'https://media.example/dance.mp4' }]) : 'done'; } });
}).listen(0);

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const owner = await t.login();
const viewerCookie = await t.login('vera', 'viewer password 123');
const { saveGlobalServer } = await import('../src/core/global-mcp.js');
const { drain } = await import('../src/core/media-queue.js');
saveGlobalServer('gifs', { url: `http://127.0.0.1:${gifs.address().port}/mcp` }, 'test');
after(() => { gifs.close(); t.close(); });

// linked people: the owner (chat switched OFF: the assistant still answers), an admin and a viewer
const OWNER = '41790000007'; const ADMIN = '41790000008'; const VIEWER = '41790000006';
const link = (userId, phone) => t.db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, linked_at) VALUES ('default', ?, ?, 'linked', ?)").run(userId, phone, Date.now());
const ids = Object.fromEntries(t.store.listUsers().map((u) => [u.username, u.id]));
link(ids.admin, OWNER); link(ids.ada, ADMIN); link(ids.vera, VIEWER);
const dmOf = (p) => `${p}@s.whatsapp.net`;
const dm = (phone, text, o = {}) => t.msg({ isGroup: false, chat: dmOf(phone), phone, senderName: 'Vik', text, ...o });
const ownerReqs = () => t.claudeReqs.filter((r) => String(r.system || '').startsWith('You are the owner assistant'));
const lastReq = () => ownerReqs().at(-1);
const toolNames = (r = lastReq()) => r.tools.map((x) => x.name);
const lastTo = (chat) => t.sent.filter((m) => m.chat === chat).at(-1)?.text || '';
const results = (r = lastReq()) => r.messages.at(-1).content.filter((b) => b.type === 'tool_result');
const codeIn = (text) => /confirm ([A-Z0-9]{4})/.exec(text)?.[1];

test('059: the owner assistant is a built-in agent record — always there, fixed reach, editable character', async () => {
  const a = (await t.api(owner, 'GET', '/api/agents')).body.find((x) => x.id === 'owner-assistant');
  assert.equal(a.builtin, true);
  const r = await t.api(owner, 'PUT', '/api/agents/owner-assistant', { prompt: 'Call me Vik. Answer in English.', chats: ['g1@g.us'], triggers: ['!boss'], dm: 'anyone', enabled: false, organizers: ['41790000001'] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.config.chats, r.body.config.triggers, r.body.config.dm, r.body.config.enabled, r.body.config.organizers], [[], [], 'none', true, []], 'reach is code');
  assert.equal((await t.api(owner, 'POST', '/api/agents/owner-assistant/test', { text: 'hi' })).status, 400, 'tried in the Ask box instead');
  t.script.push([{ type: 'text', text: 'Hi Vik' }]);
  await t.route(dm(OWNER, 'hello'));
  assert.equal(lastTo(dmOf(OWNER)), 'Hi Vik', 'answers although the owner chat is off');
  assert.match(lastReq().system, /Character and instructions from the owner[^]*Call me Vik/);
  assert.match(lastReq().system, /system holds them and asks the user to confirm/, 'built-in rules stay');
  assert.equal(t.db.listMessages(dmOf(OWNER), { limit: 50 }).length, 0, 'nothing stored in chat memory');
});

test('059: "send me a gif" — global tool service search, then WhatsApp send_media into the own chat, no confirm', async () => {
  t.waCalls.length = 0;
  t.script.push(
    [{ type: 'tool_use', id: 'a', name: 'gifs__search_gifs', input: { q: 'dance' } }],
    [{ type: 'tool_use', id: 'b', name: 'whatsapp__send_media', input: { kind: 'gif', url: 'https://media.example/dance.mp4' } }],
    [{ type: 'text', text: 'Here you go!' }]);
  await t.route(dm(OWNER, 'Send me a gif'));
  const names = toolNames();
  for (const n of ['gifs__search_gifs', 'gifs__trending_gifs', 'whatsapp__send_media', 'whatsapp__create_poll', 'send_message', 'list_agents']) assert.ok(names.includes(n), n);
  for (const n of ['whatsapp__block', 'whatsapp__add_participants', 'whatsapp__set_group_subject', 'contacts__find_contact', 'memory__search_history']) assert.ok(!names.includes(n), `never: ${n}`);
  assert.ok(gifCalls.includes('search_gifs'));
  const sm = t.waCalls.find((c) => c.fn === 'sendMedia');
  assert.equal(sm.chat, dmOf(OWNER));
  assert.equal(sm.args[0].kind, 'gif');
  assert.equal(lastTo(dmOf(OWNER)), 'Here you go!');
  assert.ok(!/confirm [A-Z0-9]{4}/.test(lastTo(dmOf(OWNER))), 'own chat: no confirm');
  assert.equal(t.db.listMessages(dmOf(OWNER), { limit: 50 }).length, 0, 'own sends are not stored either');
});

test('059: a service "confirm" tool is held for the owner\'s code; switching a service off removes its tools', async () => {
  t.script.push([{ type: 'tool_use', id: 'c', name: 'gifs__confirm', input: { confirm_id: 'x1' } }], [{ type: 'text', text: 'Waiting for you.' }]);
  const before = gifCalls.length;
  await t.route(dm(OWNER, 'apply it'));
  const code = codeIn(lastTo(dmOf(OWNER)));
  assert.ok(code, 'held');
  assert.equal(gifCalls.length, before, 'not called yet');
  await t.route(dm(OWNER, `confirm ${code}`));
  assert.equal(gifCalls.at(-1), 'confirm');

  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { globalMcp: { disabled: ['gifs'] } });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(dm(OWNER, 'tools?'));
  assert.ok(!toolNames().some((n) => n.startsWith('gifs__')));
  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { globalMcp: { disabled: [] } });
});

test('059: sending into another chat — by name, preview + confirm, never into chats that are off or private', async () => {
  t.waCalls.length = 0;
  // a poll in "Carpool" (g2, on): held, then confirmed
  t.script.push([{ type: 'tool_use', id: 'p', name: 'whatsapp__create_poll', input: { chat: 'carpool', question: 'Pizza or dosa?', options: ['Pizza', 'Dosa'] } }], [{ type: 'text', text: 'Ready to post.' }]);
  await t.route(dm(OWNER, 'post a poll in carpool'));
  let reply = lastTo(dmOf(OWNER));
  assert.match(reply, /Post a poll \(question: Pizza or dosa\?.*\) in "Carpool"/);
  assert.ok(!t.waCalls.some((c) => c.fn === 'sendPoll'), 'nothing sent before confirm');
  await t.route(dm(OWNER, `confirm ${codeIn(reply)}`));
  assert.deepEqual(t.waCalls.filter((c) => c.fn === 'sendPoll').map((c) => c.chat), ['g2@g.us']);

  // a text to a person whose chat is on: the DM privacy line once
  t.store.updateSettings({ privacyNotice: { enabled: true } });
  t.script.push([{ type: 'tool_use', id: 's', name: 'send_message', input: { chat: '41790000002@s.whatsapp.net', text: 'See you at 9' } }], [{ type: 'text', text: 'Prepared.' }]);
  await t.route(dm(OWNER, 'tell Anu see you at 9'));
  reply = lastTo(dmOf(OWNER));
  assert.match(reply, /Send "See you at 9" in .*with the privacy line, first time/);
  await t.route(dm(OWNER, `confirm ${codeIn(reply)}`));
  assert.match(lastTo('41790000002@s.whatsapp.net'), /^See you at 9\n\n_Messages in this chat are stored/);
  assert.ok(t.db.listMessages('41790000002@s.whatsapp.net', { limit: 5 }).some((m) => m.text.startsWith('See you at 9')), 'stored like an agent send (chat is on)');
  t.store.updateSettings({ privacyNotice: { enabled: false } });

  // off and private chats are refused before anything is held
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: false });
  t.chatPrefs.setChatPrefs('g4@g.us', { private: true });
  t.script.push([{ type: 'tool_use', id: 'o1', name: 'send_message', input: { chat: 'g3@g.us', text: 'hi' } }, { type: 'tool_use', id: 'o2', name: 'whatsapp__send_location', input: { chat: 'g4@g.us', latitude: 46.3, longitude: 6.9 } }], [{ type: 'text', text: 'Cannot.' }]);
  await t.route(dm(OWNER, 'send to g3 and g4'));
  const rs = results();
  assert.ok(rs.every((r) => r.is_error && /off or private/.test(r.content)), JSON.stringify(rs));
  assert.ok(!/confirm [A-Z0-9]{4}/.test(lastTo(dmOf(OWNER))));
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: true });
  t.chatPrefs.setChatPrefs('g4@g.us', { private: false });

  // a chat switched off between the preview and the confirm: nothing is sent
  t.script.push([{ type: 'tool_use', id: 'm', name: 'send_message', input: { chat: 'Panduga families', text: 'Hello all' } }], [{ type: 'text', text: 'Prepared.' }]);
  await t.route(dm(OWNER, 'say hello to panduga'));
  const code = codeIn(lastTo(dmOf(OWNER)));
  t.chatPrefs.setChatPrefs('g1@g.us', { enabled: false });
  await t.route(dm(OWNER, `confirm ${code}`));
  assert.match(lastTo(dmOf(OWNER)), /off or private to members now: nothing was sent/);
  assert.ok(!t.sent.some((m) => m.chat === 'g1@g.us' && m.text === 'Hello all'));
  t.chatPrefs.setChatPrefs('g1@g.us', { enabled: true });
});

test('059: roles — admins act like owners; viewers only in their own chat, with the services\' participant defaults', async () => {
  t.script.push([{ type: 'text', text: 'hi ada' }]);
  await t.route(dm(ADMIN, 'hi'));
  assert.ok(toolNames().includes('send_message') && toolNames().includes('gifs__search_gifs'));

  t.script.push([{ type: 'tool_use', id: 'v', name: 'whatsapp__send_location', input: { chat: 'Carpool', latitude: 1, longitude: 2 } }], [{ type: 'text', text: 'no' }]);
  await t.route(dm(VIEWER, 'send a pin to carpool'));
  const names = toolNames();
  assert.ok(!names.includes('send_message'), 'viewers: no sends to other chats');
  assert.ok(!names.some((n) => n.startsWith('gifs__')), 'participant defaults of the service: none');
  assert.ok(names.includes('whatsapp__send_media') && !names.includes('whatsapp__delete_message'));
  assert.match(results()[0].content, /read-only: I can act only in our own chat/);
  saveGlobalServer('gifs', { url: `http://127.0.0.1:${gifs.address().port}/mcp`, defaults: { organizer: ['*'], participant: ['search_*'] } }, 'test');
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.api(viewerCookie, 'POST', '/api/owner/ask', { question: 'gifs?' });
  assert.deepEqual(toolNames().filter((n) => n.startsWith('gifs__')), ['gifs__search_gifs']);
  assert.ok(!toolNames().includes('media__create_image'), 'the Ask box has no chat for pictures');
});

test('059: Ask box — WhatsApp actions need a chat, and a send is confirmed with the panel button', async () => {
  t.waCalls.length = 0;
  t.script.push([{ type: 'tool_use', id: 'k', name: 'whatsapp__send_location', input: { chat: 'Carpool', latitude: 46.3, longitude: 6.9, name: 'Station' } }], [{ type: 'text', text: 'Prepared.' }]);
  const r = (await t.api(owner, 'POST', '/api/owner/ask', { question: 'send the station pin to carpool' })).body;
  assert.equal(r.confirms.length, 1);
  assert.equal((await t.api(owner, 'POST', '/api/owner/ask/confirm', { code: r.confirms[0].code })).status, 200);
  assert.deepEqual(t.waCalls.filter((c) => c.fn === 'sendLocation').map((c) => c.chat), ['g2@g.us']);
});

test('059: memory — notes are the user\'s own, shown in later turns, never in a chat\'s memory', async () => {
  t.script.push([{ type: 'tool_use', id: 'n', name: 'memory__remember', input: { text: 'Vedika likes ILLIT' } }], [{ type: 'text', text: 'Noted.' }]);
  await t.route(dm(OWNER, 'remember Vedika likes ILLIT'));
  assert.ok(t.db.listNotes(`owner:${ids.admin}`).some((n) => n.text === 'Vedika likes ILLIT'));
  assert.equal(t.db.listNotes(dmOf(OWNER)).length, 0);
  t.script.push([{ type: 'text', text: 'ILLIT' }]);
  await t.route(dm(OWNER, 'what does Vedika like?'));
  assert.match(JSON.stringify(lastReq().messages.at(-1).content), /Vedika likes ILLIT/);
});

test('059: a photo goes through the media queue (also while the owner chat is off) and reaches the model as an image', async () => {
  t.script.push([{ type: 'text', text: 'A cat on a sofa.' }]);
  await t.route(t.mediaMsg({ isGroup: false, chat: dmOf(OWNER), phone: OWNER, caption: 'what is this?' }));
  await drain(5000);
  await t.waitFor(() => lastTo(dmOf(OWNER)) === 'A cat on a sofa.');
  const content = lastReq().messages.at(-1).content;
  assert.ok(Array.isArray(content) && content.some((b) => b.type === 'image'));
  const { ownerHistory } = await import('../src/core/owner-assistant.js');
  assert.ok(ownerHistory(ids.admin, 'whatsapp').some((m) => m.text === '[image] what is this?'), 'history keeps the placeholder only');
});

test('059: its own schedules go to linked owners and admins in their own chat (viewers not); SKIP sends nothing', async () => {
  const cur = t.agents.getAgent('owner-assistant').schedules;
  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { schedules: [...cur, { id: 'brief', at: '07:30', days: 'daily', prompt: 'Morning brief of my groups' }] });
  t.script.push([{ type: 'text', text: 'Brief for Vik' }], [{ type: 'text', text: 'SKIP' }]);
  const r = (await t.api(owner, 'POST', '/api/agents/owner-assistant/schedules/brief/run')).body;
  assert.equal(r.length, 2);
  assert.equal(lastTo(dmOf(OWNER)), 'Brief for Vik');
  assert.ok(!t.sent.some((m) => m.chat === dmOf(VIEWER) && /Brief|SKIP/.test(m.text)));
  assert.ok(!t.sent.some((m) => m.text === 'SKIP'));
  assert.match(lastReq().messages.at(-1).content, /Morning brief of my groups/);
});
