// Feature 026: WhatsApp features for agents (media, reactions, polls, groups, profile, block) and the admin panel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './harness.js';
import { toolPhrase } from '../src/panel/public/app/names.js';

let t;
before(async () => { t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); });
after(() => t.close());

const ORG = '41790000001';
const PART = '41790000002';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ALL = ['add_participants', 'block', 'create_poll', 'delete_message', 'demote', 'edit_message', 'edit_my_last_message', 'group_info', 'group_invite_link', 'poll_results',
  'profile_info', 'promote', 'react', 'remove_participants', 'reply', 'revoke_invite_link', 'send_contact', 'send_location', 'send_media',
  'set_group_description', 'set_group_picture', 'set_group_settings', 'set_group_subject', 'unblock'];
const PART_DEFAULT = ['create_poll', 'edit_my_last_message', 'group_info', 'poll_results', 'profile_info', 'react', 'reply', 'send_location', 'send_media'];
const wa = (names) => names.map((n) => `whatsapp__${n}`).sort();
const waNames = (i) => t.toolNames(i).filter((n) => n.startsWith('whatsapp__'));

/** One addressed message; the model calls `name` with `input` and then answers. Returns the tool_result block. */
async function callTool(name, input, o = {}) {
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'tool_use', id: 'tu1', name: `whatsapp__${name}`, input }], [{ type: 'text', text: 'done' }]);
  await t.route(t.msg({ text: '!panduga please', ...o }));
  return t.claudeReqs[1]?.messages.at(-1).content[0];
}
const lastAction = () => t.db.listActivity({ limit: 20 }).find((a) => a.type === 'whatsapp.action');

// ---------- role rules ----------
test('participants get the send/react/poll tools by default, organizers all; powerful ones never reach participants', async () => {
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'hi' }]);
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.deepEqual(waNames(0), wa(PART_DEFAULT));
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'hi' }]);
  await t.route(t.msg({ phone: ORG, text: '!panduga hi' }));
  assert.deepEqual(waNames(0), wa(ALL));
});

test('explicit whatsapp: rules replace the defaults; organizer-only tools stay off participants; deny wins', async () => {
  const orig = structuredClone(t.agents.getAgent('panduga').tools);
  await t.agents.updateAgent('panduga', { tools: { ...orig, participant: [...orig.participant, 'whatsapp:react', 'whatsapp:remove_participants'], deny: ['whatsapp:block'] } });
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]);
  await t.route(t.msg({ text: '!panduga hi' }));
  await t.route(t.msg({ phone: ORG, text: '!panduga hi' }));
  assert.deepEqual(waNames(0), ['whatsapp__react']);
  assert.ok(!waNames(1).includes('whatsapp__block'), 'deny list wins');
  await t.agents.updateAgent('panduga', { tools: { ...orig, participant: [...orig.participant, 'whatsapp:-'] } });
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'c' }]);
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.deepEqual(waNames(0), [], 'whatsapp:- = none');
  await t.agents.updateAgent('panduga', { tools: orig });
});

test('a participant cannot run an organizer-only tool even if the model calls it', async () => {
  const before = t.waCalls.length;
  const res = await callTool('remove_participants', { people: ['+41 79 000 00 03'] });
  assert.equal(res.is_error, true);
  assert.match(res.content, /Not allowed/);
  assert.equal(t.waCalls.length, before);
});

// ---------- each tool reaches the right channel function ----------
test('every tool calls the matching channel function on the current chat and is logged as whatsapp.action', async () => {
  // an agent message to react to / edit / delete
  t.script.push([{ type: 'text', text: 'Bus leaves at 9:10' }]);
  await t.route(t.msg({ phone: ORG, text: '!panduga when is the bus?' }));
  const agentMsg = t.db.lastAgentMessage('g1@g.us');
  assert.equal(agentMsg.text, 'Bus leaves at 9:10');
  const cases = [
    ['send_media', { kind: 'image', url: 'https://example.com/flyer.png', caption: 'Flyer' }, 'sendMedia', (a) => a[0].kind === 'image' && a[0].url === 'https://example.com/flyer.png' && a[0].caption === 'Flyer'],
    ['send_location', { latitude: 46.317, longitude: 6.966, name: 'Aigle station' }, 'sendLocation', (a) => a[0].latitude === 46.317 && a[0].name === 'Aigle station'],
    ['send_contact', { name: 'Ravi', phone: '+41 79 111 22 33' }, 'sendContact', (a) => a[0].name === 'Ravi'],
    ['react', { emoji: '👍', message: 'Bus leaves' }, 'react', (a) => a[0].msgId === agentMsg.msg_id && a[0].fromMe === true && a[1] === '👍'],
    ['reply', { text: 'Yes, 9:10', message: agentMsg.msg_id }, null, null],
    ['edit_message', { text: 'Bus leaves at 9:15', message: 'Bus leaves' }, 'editMessage', (a) => a[0] === agentMsg.msg_id && a[1] === 'Bus leaves at 9:15'],
    ['create_poll', { question: 'Lunch?', options: ['Pizza', 'Dosa'] }, 'sendPoll', (a) => a[0].name === 'Lunch?' && a[0].multi === false],
    ['group_info', {}, 'groupInfo', () => true],
    ['group_invite_link', {}, 'groupInviteLink', () => true],
    ['revoke_invite_link', {}, 'groupRevokeInvite', () => true],
    ['add_participants', { people: ['+41 79 555 00 01'] }, 'groupParticipants', (a) => a[1] === 'add' && a[0][0] === '+41 79 555 00 01'],
    ['remove_participants', { people: ['41795550001'] }, 'groupParticipants', (a) => a[1] === 'remove'],
    ['promote', { people: ['41790000002'] }, 'groupParticipants', (a) => a[1] === 'promote'],
    ['demote', { people: ['41790000002'] }, 'groupParticipants', (a) => a[1] === 'demote'],
    ['set_group_subject', { subject: 'Panduga 2027' }, 'groupSubject', (a) => a[0] === 'Panduga 2027'],
    ['set_group_description', { description: 'All about the event' }, 'groupDescription', (a) => a[0] === 'All about the event'],
    ['set_group_picture', { url: 'https://example.com/p.jpg' }, 'groupPicture', (a) => a[0].url === 'https://example.com/p.jpg'],
    ['set_group_settings', { only_admins_send: true, join_approval: false }, 'groupSettings', (a) => a[0].announcement === true && a[0].joinApproval === false && !('locked' in a[0])],
    ['profile_info', { person: '+41 79 000 00 02' }, 'profile', (a) => a[0] === '+41 79 000 00 02'],
    ['block', { person: '+41 79 666 00 00' }, 'block', (a) => a[0] === '+41 79 666 00 00'],
    ['unblock', { person: '+41 79 666 00 00' }, 'unblock', (a) => a[0] === '+41 79 666 00 00'],
    ['delete_message', { message: agentMsg.msg_id }, 'deleteMessage', (a) => a[0].fromMe === true && a[0].msgId === agentMsg.msg_id],
  ];
  for (const [tool, input, fn, check] of cases) {
    const n = t.waCalls.length; const sent = t.sent.length;
    const res = await callTool(tool, input, { phone: ORG });
    assert.equal(res.is_error, false, `${tool}: ${res.content}`);
    if (fn) {
      const call = t.waCalls.slice(n).find((c) => c.fn === fn);
      assert.ok(call, `${tool} → ${fn}`);
      assert.equal(call.chat, 'g1@g.us', `${tool} acts on the current chat`);
      assert.ok(check(call.args), `${tool} args ${JSON.stringify(call.args)}`);
    } else {
      assert.equal(t.sent[sent].text, 'Yes, 9:10', 'reply sends the text');
    }
    const act = lastAction();
    assert.ok(act.summary.startsWith(`${toolPhrase(tool)} by `), `${tool} logged in plain words: ${act.summary}`); // 073
    assert.equal(act.detail.tool, tool);
  }
  assert.ok(t.db.history('g1@g.us', 50).some((m) => m.from_agent && m.text.startsWith('[poll: Lunch?')), 'own sends are stored for context');
  assert.equal(t.db.messageByMsgId('g1@g.us', agentMsg.msg_id).text, '[deleted]');
  assert.equal(t.events.categoryOf('whatsapp.action'), 'whatsapp');
  assert.equal(t.events.LOG_CATEGORIES.whatsapp, 'Chat actions (polls, reactions, group changes)');
});

test('group_info hides phone numbers from participants; profile_info is limited to people of the chat', async () => {
  const p = await callTool('group_info', {});
  const info = JSON.parse(p.content);
  assert.equal(info.members, 3);
  assert.ok(!JSON.stringify(info).includes('4179'), 'no phone numbers for participants');
  const o = JSON.parse((await callTool('group_info', {}, { phone: ORG })).content);
  assert.ok(o.people.some((m) => m.phone === '+41790000003' && m.admin));
  const stranger = await callTool('profile_info', { person: '+44 7700 900000' });
  assert.equal(stranger.is_error, true);
  assert.match(stranger.content, /people of this chat/);
});

test('acting on another chat needs that chat to be bound to the same agent (id or group name)', async () => {
  const n = t.waCalls.length;
  const res = await callTool('set_group_subject', { subject: 'X', chat: 'g2@g.us' }, { phone: ORG });
  assert.equal(res.is_error, true);
  assert.match(res.content, /only act in this chat or in other chats this agent is in/);
  assert.equal(t.waCalls.length, n);
  // from a direct message, by group name
  const ok = await callTool('set_group_settings', { only_admins_edit_info: true, chat: 'Panduga families' }, { phone: ORG, isGroup: false, chat: `${ORG}@s.whatsapp.net` });
  assert.equal(ok.is_error, false, ok.content);
  const call = t.waCalls.at(-1);
  assert.equal(call.fn, 'groupSettings');
  assert.equal(call.chat, 'g1@g.us');
  const notGroup = await callTool('set_group_subject', { subject: 'Y' }, { phone: ORG, isGroup: false, chat: `${ORG}@s.whatsapp.net` });
  assert.match(notGroup.content, /only works in a group/);
});

// ---------- incoming reactions and poll votes reach the context ----------
test('reactions to the agent and in bound groups are stored and summarised for the agent; others are ignored', async () => {
  t.script.push([{ type: 'text', text: 'Dinner is at 7' }]);
  await t.route(t.msg({ text: '!panduga dinner?' }));
  const agent = t.db.lastAgentMessage('g1@g.us');
  await t.route(t.msg({ kind: 'reaction', text: '', target: agent.msg_id, emoji: '👍', senderName: 'Meena', phone: '41790000004' }));
  await t.route(t.msg({ chat: 'g8@g.us', text: 'unbound chatter', msgId: 'U1' }));
  await t.route(t.msg({ chat: 'g8@g.us', kind: 'reaction', text: '', target: 'U1', emoji: '😂' }));
  assert.equal(t.db.recentReactions('g8@g.us').length, 0, 'unbound group reactions to others are not kept');
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ text: '!panduga anything new?' }));
  assert.match(t.userTurn(0), /<reactions_and_polls>[\s\S]*Meena reacted 👍 to your message "Dinner is at 7"/);
  assert.ok(t.db.listActivity({ limit: 30 }).some((a) => a.type === 'whatsapp.reaction' && /Meena reacted/.test(a.summary)));
  // removing the reaction
  await t.route(t.msg({ kind: 'reaction', text: '', target: agent.msg_id, emoji: '', senderName: 'Meena', phone: '41790000004' }));
  assert.ok(!t.db.recentReactions('g1@g.us').some((r) => r.name === 'Meena' && r.msg_id === agent.msg_id));
});

test('poll votes are tallied (latest vote per person), shown in context and returned by poll_results', async () => {
  await callTool('create_poll', { question: 'Saturday trip?', options: ['Lake', 'Mountain'] }, { phone: ORG });
  const poll = t.db.latestPoll('g1@g.us');
  assert.equal(poll.name, 'Saturday trip?');
  const vote = (phone, name, selected) => t.route(t.msg({ kind: 'poll_vote', text: '', pollId: poll.msg_id, selected, phone, senderName: name }));
  await vote('41790000002', 'Anu', ['Lake']);
  await vote('41790000003', 'Ravi', ['Lake']);
  await vote('41790000004', 'Meena', ['Mountain']);
  await vote('41790000003', 'Ravi', ['Mountain']); // changed mind
  const res = JSON.parse((await callTool('poll_results', {})).content);
  assert.equal(res.question, 'Saturday trip?');
  assert.deepEqual(res.options.map((o) => [o.name, o.votes]), [['Lake', 1], ['Mountain', 2]]);
  assert.deepEqual(res.options[1].voters.sort(), ['Meena', 'Ravi']);
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ text: '!panduga results?' }));
  assert.match(t.userTurn(0), /Poll "Saturday trip\?" \([^)]*3 voters\): Lake 1, Mountain 2/);
  assert.ok(t.db.listActivity({ limit: 30 }).some((a) => a.type === 'whatsapp.vote' && /Ravi voted Mountain/.test(a.summary)));
});

test('media messages are stored as placeholders; a caption can still address the agent', async () => {
  t.claudeReqs.length = 0;
  t.script.push([{ type: 'text', text: 'Looks like a flyer' }]);
  await t.route(t.msg({ text: '[image: !panduga what is this?]', caption: '!panduga what is this?', media: true, msgId: 'IMG1' }));
  assert.equal(t.db.messageByMsgId('g1@g.us', 'IMG1').text, '[image: !panduga what is this?]');
  assert.match(t.userTurn(0), /New message from Anu \(participant\):\n\[image\] what is this\?$/);
  await t.route(t.msg({ text: '[voice note]', msgId: 'VN1' }));
  assert.equal(t.db.messageByMsgId('g1@g.us', 'VN1').text, '[voice note]');
});

// ---------- admin panel ----------
test('admin panel: group info, invite link, edits and settings use the channel and are logged; viewers are refused', async () => {
  const owner = await t.login();
  const g = encodeURIComponent('g1@g.us');
  const info = await t.api(owner, 'GET', `/api/chats/${g}/whatsapp`);
  assert.equal(info.status, 200);
  assert.equal(info.body.subject, 'Panduga families');
  assert.equal(info.body.participants[0].admin, 'superadmin', 'admins first');
  assert.equal(info.body.participants.find((p) => p.phone === PART).name, 'Anu');
  const link = await t.api(owner, 'GET', `/api/chats/${g}/whatsapp/invite`);
  assert.equal(link.body.link, 'https://chat.whatsapp.com/AbC123');
  assert.match(lastAction().summary, /Invite link viewed \(panel, admin\)/);
  const rev = await t.api(owner, 'POST', `/api/chats/${g}/whatsapp/invite/revoke`, {});
  assert.equal(rev.body.link, 'https://chat.whatsapp.com/NeW456');
  const n = t.waCalls.length;
  const upd = await t.api(owner, 'PUT', `/api/chats/${g}/whatsapp`, { subject: 'Panduga 2027', description: 'Hi', announcement: true, joinApproval: true });
  assert.equal(upd.status, 200);
  const fns = t.waCalls.slice(n).map((c) => c.fn);
  assert.deepEqual(fns, ['groupSubject', 'groupDescription', 'groupSettings']);
  assert.deepEqual(t.waCalls.at(-1).args[0], { announcement: true, joinApproval: true });
  assert.match(lastAction().summary, /Group updated: name “Panduga 2027”, description, only admins send on, approve new members on/);
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${g}/whatsapp`, {})).status, 400);
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${g}/whatsapp`, { subject: '  ' })).status, 400);
  assert.equal((await t.api(owner, 'GET', `/api/chats/${encodeURIComponent('4179@s.whatsapp.net')}/whatsapp`)).status, 400);
  const tools = await t.api(owner, 'GET', '/api/whatsapp/tools');
  assert.deepEqual(tools.body.map((x) => x.name).sort(), ALL);
  assert.equal(tools.body.find((x) => x.name === 'block').organizerOnly, true);
  assert.equal(tools.body.find((x) => x.name === 'react').participantDefault, true);
  await t.api(owner, 'POST', '/api/users', { username: 'wanda', role: 'viewer', password: 'viewer password 9' });
  const viewer = await t.login('wanda', 'viewer password 9');
  assert.equal((await t.api(viewer, 'GET', `/api/chats/${g}/whatsapp`)).status, 403);
  assert.equal((await t.api(viewer, 'PUT', `/api/chats/${g}/whatsapp`, { announcement: false })).status, 403);
});

test('admin MCP has the WhatsApp group tools (reset needs confirmation)', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const by = Object.fromEntries(TOOLS.map((x) => [x.name, x]));
  for (const n of ['get_group_info', 'get_group_invite_link', 'reset_group_invite_link', 'update_group']) assert.ok(by[n], n);
  assert.equal(by.reset_group_invite_link.risky, true);
  assert.equal(by.get_group_info.readOnly, true);
});

// ---------- SSRF guard and media checks ----------
test('media: SSRF guard blocks internal addresses and non-http(s) URLs', async () => {
  const { isBlockedAddress, checkUrl, loadMedia, guardedLookup } = await import('../src/core/media.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'nonsense']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip);
  for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'http://127.0.0.1/x.png', 'http://[::1]/x', 'http://169.254.169.254/latest/meta-data',
    'http://localhost:3000/x', 'http://printer.local/x', 'https://user:pw@example.com/x', 'gopher://x', 'not a url']) {
    assert.throws(() => checkUrl(url), /internal|http|user name|valid/, url);
  }
  await assert.rejects(loadMedia('image', { url: 'http://10.0.0.5/a.png' }), /internal address/);
  await assert.rejects(new Promise((res, rej) => guardedLookup()('localhost', {}, (e, a) => (e ? rej(e) : res(a)))), /internal address/);
});

test('media: base64 and downloads are size- and type-checked; redirects to internal addresses are refused', async () => {
  const { loadMedia } = await import('../src/core/media.js');
  const ok = await loadMedia('image', { base64: `data:image/png;base64,${PNG}` });
  assert.equal(ok.mimetype, 'image/png');
  await assert.rejects(loadMedia('sticker', { base64: PNG, mimetype: 'image/png' }), /sticker needs image\/webp/);
  await assert.rejects(loadMedia('image', { base64: PNG, mimetype: 'image/png' }, { maxBytes: 20 }), /too large/);
  await assert.rejects(loadMedia('image', {}), /url or base64/);
  const png = Buffer.from(PNG, 'base64');
  const srv = http.createServer((req, res) => {
    if (req.url === '/a.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
    if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); return; }
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'image/png' }); res.write(png); res.end(Buffer.alloc(5000)); return; }
    if (req.url === '/hop') { res.writeHead(302, { location: 'http://10.0.0.1/a.png' }); res.end(); return; }
    res.writeHead(404); res.end();
  }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const local = { allow: (ip) => ip === '127.0.0.1' }; // tests only: let the guard reach this test server
  try {
    await assert.rejects(loadMedia('image', { url: `${base}/a.png` }), /internal address/, 'default guard refuses loopback');
    const got = await loadMedia('image', { url: `${base}/a.png` }, local);
    assert.equal(got.mimetype, 'image/png'); assert.equal(got.fileName, 'a.png');
    await assert.rejects(loadMedia('document', { url: `${base}/page` }, local), /Web pages/);
    await assert.rejects(loadMedia('image', { url: `${base}/page` }, local), /image needs/);
    await assert.rejects(loadMedia('image', { url: `${base}/big` }, { ...local, maxBytes: 1000 }), /too large/);
    await assert.rejects(loadMedia('image', { url: `${base}/hop` }, local), /internal address/);
    await assert.rejects(loadMedia('image', { url: `${base}/nope` }, local), /answered 404/);
  } finally { srv.close(); }
});

// ---------- the real channel with a fake Baileys socket ----------
function fakeSocket(calls) {
  return (opts) => {
    const sock = { ev: new EventEmitter(), user: { id: '41790000099:3@s.whatsapp.net', lid: '99999@lid' }, opts };
    const rec = (fn, result) => async (...args) => { calls.push({ fn, args }); return typeof result === 'function' ? result(...args) : result; };
    let n = 0;
    Object.assign(sock, {
      sendMessage: rec('sendMessage', async (jid, content) => {
        const key = { remoteJid: jid, id: `S${++n}`, fromMe: true };
        if (content.poll) {
          const { randomBytes } = await import('node:crypto');
          return { key, message: { messageContextInfo: { messageSecret: randomBytes(32) }, pollCreationMessageV3: { name: content.poll.name, selectableOptionsCount: content.poll.selectableCount, options: content.poll.values.map((optionName) => ({ optionName })) } } };
        }
        return { key, message: {} };
      }),
      groupMetadata: rec('groupMetadata', async (jid) => ({ id: jid, subject: 'Test group', desc: 'd', announce: true, restrict: false, joinApprovalMode: true, size: 2,
        participants: [{ id: '41790000001@s.whatsapp.net', admin: 'superadmin' }, { id: '777@lid', phoneNumber: '41790000002@s.whatsapp.net', admin: null }] })),
      groupInviteCode: rec('groupInviteCode', 'CODE1'), groupRevokeInvite: rec('groupRevokeInvite', 'CODE2'),
      groupParticipantsUpdate: rec('groupParticipantsUpdate', async (jid, list) => list.map((j) => ({ jid: j, status: '200' }))),
      groupUpdateSubject: rec('groupUpdateSubject'), groupUpdateDescription: rec('groupUpdateDescription'), groupSettingUpdate: rec('groupSettingUpdate'),
      groupJoinApprovalMode: rec('groupJoinApprovalMode'), groupLeave: rec('groupLeave'), groupCreate: rec('groupCreate', async (subject) => ({ id: 'new@g.us', subject })),
      updateProfilePicture: rec('updateProfilePicture'), profilePictureUrl: rec('profilePictureUrl', 'https://pps.whatsapp.net/p.jpg'),
      fetchStatus: rec('fetchStatus', [{ status: { status: 'Available', setAt: new Date('2026-01-01') } }]), updateBlockStatus: rec('updateBlockStatus'),
      readMessages: rec('readMessages'), sendPresenceUpdate: rec('sendPresenceUpdate'), updateProfileName: rec('updateProfileName'), updateProfileStatus: rec('updateProfileStatus'),
      groupFetchAllParticipating: rec('groupFetchAllParticipating', {}), end: () => {}, logout: async () => {},
      signalRepository: { lidMapping: { getPNForLID: async () => null } },
    });
    fakeSocket.last = sock;
    return sock;
  };
}

test('channel (fake Baileys socket): sends, reactions, edits, groups, profile and block use the Baileys 7 calls', async () => {
  const { createWhatsAppSession } = await import('../src/channels/whatsapp/session.js');
  const calls = [];
  const ch = createWhatsAppSession({ authDir: mkdtempSync(join(tmpdir(), 'wa-auth-')), deps: { makeSocket: fakeSocket(calls), fetchVersion: async () => ({ version: [2, 3000, 1] }), media: { allow: () => true } } });
  const got = [];
  await ch.start(async (m) => { got.push(m); });
  await assert.rejects(ch.sendLocation('g@g.us', { latitude: 1, longitude: 2 }), /not connected/);
  fakeSocket.last.ev.emit('connection.update', { connection: 'open' });
  const sent = () => calls.filter((c) => c.fn === 'sendMessage').at(-1).args;

  await ch.sendMedia('g@g.us', { kind: 'image', base64: PNG, mimetype: 'image/png', caption: 'Flyer' });
  assert.ok(Buffer.isBuffer(sent()[1].image)); assert.equal(sent()[1].caption, 'Flyer');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]).toString('base64');
  await ch.sendMedia('g@g.us', { kind: 'gif', base64: mp4, mimetype: 'video/mp4' });
  assert.equal(sent()[1].gifPlayback, true); assert.ok(sent()[1].video);
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)]).toString('base64');
  await ch.sendMedia('g@g.us', { kind: 'audio', base64: ogg, mimetype: 'audio/ogg' });
  assert.equal(sent()[1].ptt, true);
  await ch.sendMedia('g@g.us', { kind: 'document', base64: Buffer.from('%PDF-1.4 hello world').toString('base64'), fileName: 'plan.pdf' });
  assert.equal(sent()[1].mimetype, 'application/pdf'); assert.equal(sent()[1].fileName, 'plan.pdf');
  await ch.sendLocation('g@g.us', { latitude: 46.3, longitude: 6.9, name: 'Aigle' });
  assert.equal(sent()[1].location.degreesLatitude, 46.3);
  await ch.sendContact('g@g.us', { name: 'Ravi', phone: '+41 79 111 22 33' });
  assert.match(sent()[1].contacts.contacts[0].vcard, /waid=41791112233:\+41791112233/);
  await ch.react('g@g.us', { msgId: 'M1', fromMe: false, participant: '41790000002@s.whatsapp.net' }, '👍');
  assert.deepEqual(sent()[1], { react: { text: '👍', key: { remoteJid: 'g@g.us', id: 'M1', fromMe: false, participant: '41790000002@s.whatsapp.net' } } });
  await ch.editMessage('g@g.us', 'S1', 'fixed');
  assert.deepEqual(sent()[1], { edit: { remoteJid: 'g@g.us', id: 'S1', fromMe: true }, text: 'fixed' });
  await ch.deleteMessage('g@g.us', { msgId: 'S1', fromMe: true });
  assert.deepEqual(sent()[1], { delete: { remoteJid: 'g@g.us', id: 'S1', fromMe: true } });
  await ch.send('g@g.us', 'answer', { quote: { msgId: 'M1', participant: 'p@s.whatsapp.net', text: 'question' } });
  assert.equal(sent()[2].quoted.message.conversation, 'question');
  await ch.markRead('g@g.us', [{ msgId: 'M1', participant: 'p@s.whatsapp.net' }]);
  await ch.presence('g@g.us', 'recording');
  assert.ok(calls.some((c) => c.fn === 'readMessages') && calls.some((c) => c.fn === 'sendPresenceUpdate' && c.args[0] === 'recording'));

  const info = await ch.groupInfo('g@g.us');
  assert.equal(info.announcement, true); assert.equal(info.joinApproval, true);
  assert.deepEqual(info.participants.map((p) => [p.phone, p.admin]), [['41790000001', 'superadmin'], ['41790000002', null]]);
  assert.equal((await ch.groupInviteLink('g@g.us')).link, 'https://chat.whatsapp.com/CODE1');
  assert.equal((await ch.groupRevokeInvite('g@g.us')).link, 'https://chat.whatsapp.com/CODE2');
  const r = await ch.groupParticipants('g@g.us', ['+41 79 000 00 05'], 'remove');
  assert.deepEqual(calls.at(-1).args, ['g@g.us', ['41790000005@s.whatsapp.net'], 'remove']);
  assert.equal(r[0].ok, true);
  await ch.groupSettings('g@g.us', { announcement: false, locked: true, joinApproval: false });
  assert.deepEqual(calls.filter((c) => c.fn === 'groupSettingUpdate').slice(-2).map((c) => c.args[1]), ['not_announcement', 'locked']);
  assert.deepEqual(calls.at(-1), { fn: 'groupJoinApprovalMode', args: ['g@g.us', 'off'] });
  await ch.groupSubject('g@g.us', 'New name'); await ch.groupDescription('g@g.us', 'New desc');
  await ch.groupPicture('g@g.us', { base64: PNG, mimetype: 'image/png' });
  assert.ok(calls.some((c) => c.fn === 'updateProfilePicture' && Buffer.isBuffer(c.args[1])));
  await assert.rejects(ch.groupSubject('41790000001@s.whatsapp.net', 'x'), /only works in a group/);
  assert.deepEqual(await ch.groupCreate('Trip', ['41790000001']), { id: 'new@g.us', subject: 'Trip' });
  const prof = await ch.profile('+41 79 000 00 02');
  assert.equal(prof.about, 'Available'); assert.equal(prof.pictureUrl, 'https://pps.whatsapp.net/p.jpg'); assert.equal(prof.phone, '41790000002');
  await ch.block('+41 79 666 00 00');
  assert.deepEqual(calls.at(-1), { fn: 'updateBlockStatus', args: ['41796660000@s.whatsapp.net', 'block'] });
  await ch.unblock('41796660000');
  assert.equal(calls.at(-1).args[1], 'unblock');
  await ch.setProfileName('Duniya'); await ch.setProfileStatus('Agent');
});

test('channel (fake socket): incoming media placeholders, reactions and encrypted poll votes', async () => {
  const baileys = await import('baileys');
  const { createWhatsAppSession } = await import('../src/channels/whatsapp/session.js');
  const calls = [];
  const ch = createWhatsAppSession({ authDir: mkdtempSync(join(tmpdir(), 'wa-auth-')), deps: { makeSocket: fakeSocket(calls), fetchVersion: async () => ({ version: [2, 3000, 1] }) } });
  const got = [];
  await ch.start(async (m) => { got.push(m); await t.route(m); });
  const sock = fakeSocket.last;
  sock.ev.emit('connection.update', { connection: 'open' });
  await assert.rejects(ch.sendMedia('g1@g.us', { kind: 'image', url: 'http://169.254.169.254/x.png' }), /internal address/, 'channel never fetches internal URLs');
  await assert.rejects(ch.groupPicture('g1@g.us', { url: 'http://10.0.0.2/p.png' }), /internal address/);
  const upsert = async (message, key, pushName = 'Anu') => {
    sock.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: 'g1@g.us', participant: '41790000002@s.whatsapp.net', ...key }, message, pushName, messageTimestamp: Math.floor(Date.now() / 1000) }] });
    await new Promise((r) => setTimeout(r, 30));
  };
  await upsert({ imageMessage: { caption: 'our venue', mimetype: 'image/jpeg' } }, { id: 'IN1' });
  assert.equal(got.at(-1).text, '[image: our venue]'); assert.equal(got.at(-1).caption, 'our venue');
  // 096: a stored reference keeps only what a download needs: no preview, no context, no caption
  await upsert({ imageMessage: { caption: 'big', mimetype: 'image/jpeg', mediaKey: Buffer.alloc(32, 1), directPath: '/v/t62/x', fileLength: 900,
    jpegThumbnail: Buffer.alloc(4000, 2), contextInfo: { quotedMessage: { conversation: 'x'.repeat(3000) } } } }, { id: 'IN1b' });
  const ref = JSON.parse(got.at(-1).mediaRef, baileys.BufferJSON.reviver);
  assert.deepEqual(Object.keys(ref.message.imageMessage).sort(), ['directPath', 'fileLength', 'mediaKey', 'mimetype']);
  assert.equal(ref.key.id, 'IN1b');
  assert.ok(got.at(-1).mediaRef.length < 600, 'about half a kilobyte');
  await upsert({ videoMessage: { gifPlayback: true, mimetype: 'video/mp4', seconds: 3 } }, { id: 'IN1c' });
  assert.equal(got.at(-1).text, '[GIF]');
  assert.deepEqual(got.at(-1).mediaInfo, { type: 'gif', mimetype: 'video/mp4', size: 0, seconds: 3 });
  await upsert({ documentMessage: { fileName: 'menu.pdf' } }, { id: 'IN2' });
  assert.equal(got.at(-1).text, '[document: menu.pdf]');
  await upsert({ locationMessage: { degreesLatitude: 46.3, degreesLongitude: 6.9, name: 'Hall' } }, { id: 'IN3' });
  assert.match(got.at(-1).text, /^\[location: Hall \(46\.30000, 6\.90000\)\]$/);
  await upsert({ reactionMessage: { key: { remoteJid: 'g1@g.us', id: 'IN1', fromMe: false }, text: '❤️' } }, { id: 'R1' });
  assert.equal(got.at(-1).kind, 'reaction'); assert.equal(got.at(-1).target, 'IN1'); assert.equal(got.at(-1).emoji, '❤️');
  assert.ok(t.db.recentReactions('g1@g.us').some((r) => r.msg_id === 'IN1' && r.emoji === '❤️'), 'stored via the router');

  // the agent posts a poll; a member votes (encrypted like WhatsApp does)
  const { msgId } = await ch.sendPoll('g1@g.us', { name: 'Dinner?', options: ['Pizza', 'Dosa'] });
  assert.equal(calls.filter((c) => c.fn === 'sendMessage').at(-1).args[1].poll.selectableCount, 1);
  const secret = baileys.BufferJSON && JSON.parse(t.db.getPoll('g1@g.us', msgId).message, baileys.BufferJSON.reviver).messageContextInfo.messageSecret;
  const voter = '41790000002@s.whatsapp.net'; const creator = '41790000099@s.whatsapp.net';
  const encVote = (option) => {
    const plain = baileys.proto.Message.PollVoteMessage.encode({ selectedOptions: [baileys.sha256(Buffer.from(option))] }).finish();
    const sign = Buffer.concat([Buffer.from(msgId), Buffer.from(creator), Buffer.from(voter), Buffer.from('Poll Vote'), new Uint8Array([1])]);
    const key = baileys.hmacSign(sign, baileys.hmacSign(secret, new Uint8Array(32), 'sha256'), 'sha256');
    const iv = Buffer.alloc(12, 7);
    return { encPayload: baileys.aesEncryptGCM(plain, key, iv, Buffer.from(`${msgId}\u0000${voter}`)), encIv: iv };
  };
  await upsert({ pollUpdateMessage: { pollCreationMessageKey: { remoteJid: 'g1@g.us', id: msgId, fromMe: true }, vote: encVote('Dosa') } }, { id: 'V1' });
  assert.equal(got.at(-1).kind, 'poll_vote');
  assert.deepEqual(got.at(-1).selected, ['Dosa']);
  assert.deepEqual(t.db.pollTally(t.db.getPoll('g1@g.us', msgId)).map((o) => o.votes), [0, 1]);
  // Baileys can re-send the poll on request (getMessage)
  const again = await sock.opts.getMessage({ remoteJid: 'g1@g.us', id: msgId });
  assert.ok(again.pollCreationMessageV3 && again.messageContextInfo.messageSecret);
});

test('the hub routes WhatsApp actions to the right number', async () => {
  const { fakeWhatsAppHub } = await import('./harness.js');
  const seen = [];
  const factory = ({ number }) => ({
    id: 'whatsapp', number, start: async () => {}, status: async () => ({ status: 'open' }), listChats: async () => [],
    react: async (jid, ref, emoji) => { seen.push({ number, fn: 'react', jid, emoji }); return { ok: true }; },
    block: async (who) => { seen.push({ number, fn: 'block', who }); return { jid: who }; },
    groupCreate: async (subject) => ({ id: 'n@g.us', subject }),
  });
  t.store.updateSettings({ whatsappNumbers: [{ id: 'main', label: 'Main' }, { id: 'carpool', label: 'Carpool' }] });
  try {
    const reg = await fakeWhatsAppHub(factory);
    await reg.start({ onMessage: async () => {} });
    await reg.react('carpool#g@g.us', { msgId: 'X' }, '👍');
    await reg.react('g0@g.us', { msgId: 'Y' }, '✅');
    await reg.block('carpool#41790000001@s.whatsapp.net', '+41 79 1');
    assert.deepEqual(seen, [{ number: 'carpool', fn: 'react', jid: 'g@g.us', emoji: '👍' }, { number: 'main', fn: 'react', jid: 'g0@g.us', emoji: '✅' }, { number: 'carpool', fn: 'block', who: '+41 79 1' }]);
    assert.equal((await reg.groupCreate('carpool', 'Trip', [])).id, 'carpool#n@g.us');
    await assert.rejects(reg.sendPoll('carpool#g@g.us', {}), /cannot sendPoll/);
  } finally { t.store.updateSettings({ whatsappNumbers: [{ id: 'main', label: 'Main' }] }); }
});
