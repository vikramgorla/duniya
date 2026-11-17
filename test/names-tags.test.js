// 057 (#110): contact names (address book vs profile name, LID → phone), one resolver everywhere, automatic name
// refresh on the shared upkeep tick, and group member tags (message contextInfo, tag changes, history, member list).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './harness.js';

const t = await setup({ env: { NAMES_REFRESH_FIRST_MS: '0' } });
const owner = await t.login();
after(() => t.close());
const c = await import('../src/core/contacts.js');
const tags = await import('../src/core/member-tags.js');
const { upkeepTick, resetUpkeep } = await import('../src/core/upkeep.js');
const baileys = await import('baileys');
const enc = encodeURIComponent;
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** A fake Baileys socket with what 057 uses: app-state resync, auth keys, LID mapping, group metadata. */
function fakeSocket(log) {
  return () => {
    const sock = { ev: new EventEmitter(), user: { id: '41790000099:3@s.whatsapp.net', lid: '99999@lid' } };
    const lids = new Map([['888@lid', '41790000208@s.whatsapp.net']]);
    Object.assign(sock, {
      authState: { keys: { set: async (v) => { log.push({ fn: 'keys.set', v }); } } },
      resyncAppState: async (names, initial) => {
        log.push({ fn: 'resyncAppState', names, initial });
        sock.ev.emit('contacts.upsert', [{ id: '41790000204@s.whatsapp.net', name: 'Meera (phone)', lid: '204@lid' }]);
      },
      signalRepository: { lidMapping: { getPNForLID: async (lid) => lids.get(lid) || null } },
      groupMetadata: async (jid) => {
        log.push({ fn: 'groupMetadata', to: jid });
        return { id: jid, subject: 'Trip', participants: [
          { id: '555@lid', phoneNumber: '41790000201@s.whatsapp.net', admin: 'admin' },
          { id: '41790000202@s.whatsapp.net' }, { id: '41790000203@s.whatsapp.net' },
        ] };
      },
      sendPresenceUpdate: async () => {}, end: () => {}, logout: async () => {},
    });
    fakeSocket.last = sock;
    return sock;
  };
}
async function channel(log = []) {
  const { createWhatsAppChannel } = await import('../src/channels/whatsapp.js');
  const ch = createWhatsAppChannel({ authDir: mkdtempSync(join(tmpdir(), 'wa-auth-')), deps: { makeSocket: fakeSocket(log), fetchVersion: async () => ({ version: [2, 3000, 1] }) } });
  const got = { msgs: [], active: [], groups: [] };
  await ch.start(async (m) => { got.msgs.push(m); }, { onMemberTag: tags.createMemberTagHandler(), onPhoneActive: (e) => got.active.push(e), onGroupChange: (e) => got.groups.push(e) });
  fakeSocket.last.ev.emit('connection.update', { connection: 'open' });
  return { ch, sock: fakeSocket.last, got, log };
}

test('a profile-name update never replaces the address-book name; precedence own > book > business > profile > number', () => {
  c.syncWhatsAppContacts([{ id: '41790000101@s.whatsapp.net', name: 'Priya Sharma' }]);
  c.syncWhatsAppContacts([{ id: '41790000101@s.whatsapp.net', notify: 'priya 🌸' }]); // contacts.update from a message
  const p = c.getContact('41790000101');
  assert.deepEqual([p.name, p.bookName, p.profileName, p.source], ['Priya Sharma', 'Priya Sharma', 'priya 🌸', 'whatsapp']);
  c.syncWhatsAppContacts([{ id: '41790000102@s.whatsapp.net', notify: 'Ravi', verifiedName: 'Ravi Tours' }]);
  assert.equal(c.personInfo({ phone: '41790000102' }).name, 'Ravi Tours');
  assert.equal(c.personInfo({ phone: '41790000102' }).source, 'business');
  c.saveContact({ phone: '41790000101', name: 'Priya (treasurer)' });
  assert.deepEqual(c.personInfo({ phone: '41790000101' }), { phone: '41790000101', name: 'Priya (treasurer)', label: 'Priya (treasurer)', source: 'own', hidden: false });
  assert.equal(c.personInfo({ phone: '41790000999' }).label, '+41790000999');
  assert.equal(c.personInfo({ phone: '41790000999', fallbackName: '+41790000999' }).name, '', 'a fallback that is only the number is no name');
  assert.equal(c.personInfo({ phone: '41790000999', fallbackName: 'Seen Name' }).source, 'seen');
  assert.ok(c.listContacts({ q: 'sharma' }).some((x) => x.phone === '41790000101'), 'search finds address-book names');
});

test('LID-only address-book entries wait for the mapping; raw LIDs are never shown as numbers', async () => {
  c.syncWhatsAppContacts([{ id: '777@lid', name: 'Kiran Book', lid: '777@lid' }]);
  let p = c.personInfo({ jid: '777@lid' });
  assert.deepEqual([p.name, p.phone, p.hidden, p.label], ['Kiran Book', '', true, 'Kiran Book']);
  assert.equal(c.personInfo({ jid: '12345@lid' }).label, 'Unknown (hidden number)');
  assert.equal((await import('../src/core/chat-names.js')).chatLabel('12345@lid'), 'Unknown (hidden number)');
  assert.ok(c.contactSummary().hiddenNumbers >= 1);
  assert.ok(c.mapLid('777@lid', '41790000105@s.whatsapp.net'), 'mapping arrives later');
  p = c.personInfo({ jid: '777@lid' });
  assert.deepEqual([p.name, p.phone, p.hidden], ['Kiran Book', '41790000105', false]);
  assert.equal(c.getContact('41790000105').bookName, 'Kiran Book', 'the name moved to the phone row');
  // contact with both lid and phone: mapping stored right away
  c.syncWhatsAppContacts([{ id: '41790000106@s.whatsapp.net', name: 'Asha', lid: '606@lid' }]);
  assert.equal(c.lidPhone('606@lid'), '41790000106');
});

test('names refresh automatically on the shared tick: one snapshot of the contacts collection, then light updates', async () => {
  const { ch, log, sock } = await channel();
  resetUpkeep();
  await upkeepTick(ch);
  const sets = log.filter((x) => x.fn === 'keys.set');
  assert.equal(sets.length, 1, 'first time: fresh snapshot (names lost to the old bug come back)');
  assert.deepEqual(sets[0].v, { 'app-state-sync-version': { critical_unblock_low: null } });
  assert.deepEqual(log.find((x) => x.fn === 'resyncAppState').names, ['critical_unblock_low']);
  await wait();
  assert.equal(c.getContact('41790000204').bookName, 'Meera (phone)');
  assert.equal(c.lidPhone('204@lid'), '41790000204');
  await upkeepTick(ch);
  assert.equal(log.filter((x) => x.fn === 'resyncAppState').length, 1, 'not due again until tomorrow');
  // the optional button (and admin MCP) can ask now; no second snapshot
  const r = await t.api(owner, 'GET', '/api/contacts/summary');
  assert.equal(r.status, 200);
  assert.ok(r.body.book >= 1 && r.body.automatic);
  await ch.refreshNames();
  assert.equal(log.filter((x) => x.fn === 'keys.set').length, 1);
  assert.equal(log.filter((x) => x.fn === 'resyncAppState').length, 2);
  // lid-mapping.update resolves names stored under a LID; an unmapped LID is asked from Baileys' store
  c.syncWhatsAppContacts([{ id: '321@lid', name: 'Dev Book' }]);
  sock.ev.emit('lid-mapping.update', { lid: '321@lid', pn: '41790000207@s.whatsapp.net' });
  assert.equal(c.personInfo({ phone: '41790000207' }).name, 'Dev Book');
  sock.ev.emit('contacts.upsert', [{ id: '888@lid', name: 'Lata Book' }]);
  await t.waitFor(() => c.lidPhone('888@lid') === '41790000208');
  assert.equal(c.getContact('41790000208').bookName, 'Lata Book');
  // a profile name pushed for a LID sender (contacts.update) does not replace the book name
  sock.ev.emit('contacts.update', [{ id: '888@lid', notify: 'lata_x' }]);
  assert.equal(c.personInfo({ jid: '888@lid' }).name, 'Lata Book');
});

test('member tags: from each message\'s own contextInfo, tag changes and history — chats that are on only', async () => {
  const { ch, sock, got, log } = await channel();
  const ts = Math.floor(Date.now() / 1000);
  const msg = (chat, participant, message, extra = {}) => ({ key: { remoteJid: chat, id: `M${Math.random()}`, participant, participantAlt: extra.alt, fromMe: false }, message, pushName: 'Anu', messageTimestamp: extra.ts || ts });
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [
    msg('g1@g.us', '444@lid', { extendedTextMessage: { text: 'hi', contextInfo: { memberLabel: { label: 'Driver' }, quotedMessage: { conversation: 'q' }, participant: '41790000001@s.whatsapp.net' } } }, { alt: '41790000002@s.whatsapp.net' }),
    msg('g3@g.us', '41790000003@s.whatsapp.net', { imageMessage: { caption: 'x', contextInfo: { memberLabel: { label: 'Cook' } } } }),
    msg('g-off@g.us', '41790000004@s.whatsapp.net', { extendedTextMessage: { text: 'x', contextInfo: { memberLabel: { label: 'Secret' } } } }),
    // a quoted message's tag is someone else's: not read
    msg('g1@g.us', '41790000005@s.whatsapp.net', { extendedTextMessage: { text: 'reply', contextInfo: { quotedMessage: { extendedTextMessage: { text: 'q', contextInfo: { memberLabel: { label: 'Wrong' } } } } } } }),
  ] });
  await wait();
  assert.equal(tags.memberTag('g1@g.us', { phone: '41790000002' }), 'Driver');
  assert.equal(tags.memberTag('g1@g.us', { jid: '444@lid' }), 'Driver');
  assert.equal(c.lidPhone('444@lid'), '41790000002', 'participantAlt maps the LID');
  assert.equal(tags.memberTag('g3@g.us', { phone: '41790000003' }), 'Cook');
  assert.equal(tags.memberTag('g1@g.us', { phone: '41790000005' }), '');
  const { db } = await import('../src/core/db.js');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM member_tags WHERE chat = 'g-off@g.us'").get().n, 0, 'chat off: nothing stored');
  // tag change event and protocol message; an older one never wins; empty label = removed
  sock.ev.emit('group.member-tag.update', { groupId: 'g3@g.us', label: 'Chef', participant: '41790000003@s.whatsapp.net', messageTimestamp: ts + 5 });
  await wait();
  assert.equal(tags.memberTag('g3@g.us', { phone: '41790000003' }), 'Chef');
  sock.ev.emit('messaging-history.set', { messages: [msg('g3@g.us', '41790000003@s.whatsapp.net', { conversation: 'old', extendedTextMessage: { text: 'old', contextInfo: { memberLabel: { label: 'Cook', labelTimestamp: ts - 100 } } } }, { ts: ts - 50 })], contacts: [], chats: [] });
  await wait();
  assert.equal(tags.memberTag('g3@g.us', { phone: '41790000003' }), 'Chef', 'older history does not override');
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [msg('g3@g.us', '41790000003@s.whatsapp.net', { protocolMessage: { type: baileys.proto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE, memberLabel: { label: '', labelTimestamp: ts + 10 } } }, { ts: ts + 10 })] });
  await wait();
  assert.equal(tags.memberTag('g3@g.us', { phone: '41790000003' }), '', 'tag removed');
  // history-sync group metadata (Conversation.participant[].memberLabel)
  sock.ev.emit('messaging-history.set', { messages: [], contacts: [], chats: [{ id: 'g4@g.us', participant: [{ userJid: '41790000006@s.whatsapp.net', memberLabel: { label: 'Treasurer', labelTimestamp: ts } }] }] });
  await wait();
  assert.equal(tags.memberTag('g4@g.us', { phone: '41790000006' }), 'Treasurer');
  // the group member list: read on the upkeep tick for chats that are on, a few per tick. It carries no member tags
  // (#117, checked on a real server), but it tells us which number a hidden id (LID) belongs to.
  resetUpkeep();
  const before = got.groups.length;
  sock.ev.emit('group-participants.update', { id: 'g9@g.us', participants: ['41790000203@s.whatsapp.net'], action: 'remove' });
  assert.equal(got.groups.length, before + 1, 'a member change marks the group for a refresh');
  for (let i = 0; i < 6; i++) await upkeepTick(ch);
  assert.ok(log.some((x) => x.fn === 'groupMetadata' && x.to === 'g9@g.us'), 'member list refreshed on the tick');
  assert.equal(c.lidPhone('555@lid'), '41790000201');
  assert.equal(tags.memberTag('g9@g.us', { phone: '41790000201' }), '');
});

test('the panel and the agent use the resolver and tags', async () => {
  // agent page: names from contacts (address book), tags, hidden numbers are not digits
  c.syncWhatsAppContacts([{ id: '41790000003@s.whatsapp.net', name: 'Chitra Book' }, { id: 'x@lid', notify: 'Mystery' }]);
  tags.saveMemberTag({ chat: 'g1@g.us', participant: '41790000001@s.whatsapp.net', phone: '41790000001', label: 'Host' });
  const pp = (await t.api(owner, 'GET', '/api/agents/panduga/people')).body;
  const ms = pp.groups[0].members;
  const by = (p) => ms.find((m) => m.phone === p);
  assert.equal(by('41790000003').name, 'Chitra Book');
  assert.equal(by('41790000001').tag, 'Host');
  const hidden = ms.find((m) => !m.phone);
  assert.deepEqual([hidden.label, hidden.hidden], ['Mystery', true]);
  // stored messages show the resolved name and the tag; no raw jid is returned
  await t.route(t.msg({ chat: 'g1@g.us', phone: '41790000003', senderName: 'chitra_p', text: 'hello all' }));
  const rows = (await t.api(owner, 'GET', `/api/chats/${enc('g1@g.us')}/messages`)).body;
  const row = rows.find((m) => m.text === 'hello all');
  assert.equal(row.name, 'Chitra Book');
  assert.ok(!('senderJid' in row));
  // #113: by default the agent sees the name the owner knows them by (phone contact name), with the member tag
  tags.saveMemberTag({ chat: 'g1@g.us', participant: '41790000002@s.whatsapp.net', phone: '41790000002', label: 'Driver' });
  c.syncWhatsAppContacts([{ id: '41790000002@s.whatsapp.net', name: 'Anu Private Book Name' }]);
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: 'g1@g.us', text: '!panduga who drives?' }));
  let turn = t.userTurn(t.claudeReqs.length - 1);
  assert.match(turn, /New message from Anu Private Book Name \(tag: Driver\) \(participant\)/);
  assert.match(turn, /Chitra Book: hello all/, 'history lines use the same names');
  // switched off on the Contacts page (owner only): agents get profile names, never the phone contact names
  assert.equal((await t.api(owner, 'PUT', '/api/contacts/agent-names', { enabled: 'yes' })).status, 400);
  assert.equal((await t.api(owner, 'PUT', '/api/contacts/agent-names', { enabled: false })).body.namesForAgents, false);
  assert.equal((await t.api(owner, 'GET', '/api/contacts/summary')).body.namesForAgents, false);
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: 'g1@g.us', text: '!panduga who drives?' }));
  turn = t.userTurn(t.claudeReqs.length - 1);
  assert.match(turn, /New message from Anu \(tag: Driver\) \(participant\)/);
  assert.match(turn, /chitra_p: hello all/);
  assert.ok(!/Anu Private Book Name|Chitra Book/.test(turn), 'switched off: phone contact names never reach a model');
  await t.api(owner, 'PUT', '/api/contacts/agent-names', { enabled: true });
  // Activity names the sender as the panel knows them
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => /^Anu Private Book Name \(participant\)/.test(a.summary)));
  // a chat switched off: tags not used
  t.chatPrefs.setChatPrefs('g1@g.us', { enabled: false });
  assert.equal(tags.memberTag('g1@g.us', { phone: '41790000002' }), '');
  t.chatPrefs.setChatPrefs('g1@g.us', { enabled: true });
  // erased with the chat's memory
  t.db.eraseChat('g1@g.us');
  assert.equal(tags.memberTag('g1@g.us', { phone: '41790000002' }), '');
});

test('admin MCP covers the names status and the optional refresh', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  assert.ok(TOOLS.find((x) => x.name === 'contact_names_status')?.readOnly);
  assert.ok(TOOLS.some((x) => x.name === 'refresh_contact_names'));
  t.channel.refreshNames = async () => [{ number: 'main', ok: true }];
  const r = await t.api(owner, 'POST', '/api/contacts/refresh');
  assert.equal(r.status, 200);
  assert.equal(r.body.numbers[0].ok, true);
});

test('#159: a group renamed on WhatsApp shows its new name at once (groups.update), also a newly joined group', async () => {
  const { sock } = await channel();
  const names = await import('../src/core/chat-names.js');
  sock.ev.emit('groups.upsert', [{ id: '999000111@g.us', subject: 'Carpool' }]);
  await wait();
  assert.equal(names.chatLabel('999000111@g.us'), 'Carpool');
  sock.ev.emit('groups.update', [{ id: '999000111@g.us', subject: 'Carpool Vevey' }]);
  await wait();
  assert.equal(names.chatLabel('999000111@g.us'), 'Carpool Vevey');
  sock.ev.emit('groups.update', [{ id: '999000111@g.us', announce: true }]); // other group changes keep the name
  await wait();
  assert.equal(names.chatLabel('999000111@g.us'), 'Carpool Vevey');
});
