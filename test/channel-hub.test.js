// 075: the channel hub — adapters load only when set up and on, chat ids route to their channel, tools follow the
// channel's capabilities, people join across channels by phone, and a fresh install never loads Baileys.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';

const ROOT = resolve(import.meta.dirname, '..');
let t; let channels; let people; let hubMod;
// A second, made-up channel ("fk:<account>#<id>", groups start with g): only reactions and quotes, no phone numbers.
const FAKE = { id: 'fake', label: 'Fake chat', prefix: 'fk', setup: 'token', secret: { name: 'FAKE_CHAT_TOKEN', pattern: /^fake-/, hint: 'Not a fake token' },
  caps: { groups: true, media: false, voiceNotes: false, location: false, contactCards: false, reactions: true, quotes: true, edit: false, delete: false, polls: false,
    groupInvite: false, groupMembers: false, groupAdmin: false, profile: false, block: false, history: false, memberTags: false, typing: true, phoneNumbers: false, markup: 'plain', maxText: 4096 },
  ids: { isChat: () => false, isGroup: (c) => String(c).split('#')[1]?.startsWith('g'), isDirect: (c) => !String(c).split('#')[1]?.startsWith('g'),
    phoneOf: () => '', personOf: (c) => (String(c).split('#')[1]?.startsWith('g') ? '' : String(c).split('#')[1]) } };

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
  channels = await import('../src/channels/index.js');
  channels.CHANNELS.push(FAKE);
  people = await import('../src/core/people.js');
  hubMod = await import('../src/channels/hub.js');
});
after(() => t.close());

/** A fake adapter: records calls, emits messages through the hub's handlers. */
function fakeAdapter(log) {
  let on = null;
  return {
    async start(h) { on = h; log.push('start'); }, async stop() { log.push('stop'); },
    async status() { return { status: 'open', numbers: [{ id: 'a', label: 'Bot', status: 'open' }] }; },
    async listChats() { return [{ id: 'fk:a#g1', name: 'Fake group', size: 3 }]; },
    async send(chat, text) { log.push(`send ${chat} ${text}`); return { msgId: 'x1' }; },
    async react(chat, ref, emoji) { log.push(`react ${chat} ${emoji}`); return { ok: true }; },
    async upkeep() { log.push('upkeep'); return { ok: true }; },
    emit: (m) => on.onMessage(m),
  };
}

test('075: ids — WhatsApp ids unchanged, prefixed ids parse, helpers ask the channel', () => {
  const c = channels;
  assert.equal(c.channelOf('g1@g.us'), 'whatsapp');
  assert.equal(c.channelOf('shop#41790000555@s.whatsapp.net'), 'whatsapp');
  assert.equal(c.channelOf('fk:a#g1'), 'fake');
  assert.equal(c.channelOf('xx:bot1#-1001'), '', 'an unknown prefix belongs to no channel');
  assert.equal(c.channelOf('panel test'), '');
  // the test console's chats look like WhatsApp ids at the end but belong to no channel: nothing is ever sent for them
  const test = c.testChatId('mochi', 'g1@g.us');
  assert.equal(c.channelOf(test), '');
  assert.ok(!c.isGroup(test) && !c.isDirect(test));
  assert.deepEqual(c.testChatOf(test), { agent: 'mochi', chat: 'g1@g.us' });
  assert.deepEqual(c.testChatOf(c.testChatId('mochi')), { agent: 'mochi', chat: '' });
  assert.equal(c.testChatOf('g1@g.us'), null);
  assert.deepEqual(c.splitChatId('fk:a#g1'), { channel: 'fake', account: 'a', native: 'g1' });
  assert.deepEqual(c.splitChatId('shop#g1@g.us'), { channel: 'whatsapp', account: 'shop', native: 'g1@g.us' });
  assert.equal(c.chatKey('whatsapp', 'main', 'g1@g.us'), 'g1@g.us');
  assert.equal(c.chatKey('whatsapp', 'shop', 'g1@g.us'), 'shop#g1@g.us');
  assert.equal(c.chatKey('fake', 'a', 'u7'), 'fk:a#u7');
  assert.ok(c.isGroup('shop#g1@g.us') && c.isGroup('fk:a#g1') && !c.isGroup('fk:a#u7') && !c.isGroup('41790000001@s.whatsapp.net'));
  assert.equal(c.phoneOf('shop#41790000555@s.whatsapp.net'), '41790000555');
  assert.equal(c.phoneOf('123@lid'), '');
  assert.equal(c.displayId('41790000555@s.whatsapp.net'), '+41790000555');
  assert.equal(c.phoneChat('+41 79 000 00 01'), '41790000001@s.whatsapp.net');
  assert.throws(() => c.phoneChat('41790000001', { channel: 'fake' }), /no phone numbers/);
  assert.equal(c.capsOf('fk:a#g1').polls, false);
  assert.equal(c.capsOf('nothing'), null);
});

test('075: the hub loads a channel only when set up and on; switching off stops and drops it', async () => {
  const log = [];
  const loaded = [];
  const hub = hubMod.createHub({ loaders: { whatsapp: async () => { loaded.push('whatsapp'); return fakeAdapter(log); }, fake: async () => { loaded.push('fake'); return fakeAdapter(log); } } });
  const got = [];
  await hub.start({ onMessage: async (m) => { got.push(m.chat); } });
  assert.deepEqual(loaded, [], 'nothing is set up: nothing loads');
  const st = await hub.status();
  assert.equal(st.status, 'not_set_up');
  assert.deepEqual(st.numbers, []);
  assert.deepEqual(st.channels.map((c) => [c.id, c.state]), [['whatsapp', 'not_set_up'], ['telegram', 'not_set_up'], ['fake', 'not_set_up']]);
  await assert.rejects(hub.send('fk:a#g1', 'hi'), (e) => e.status === 409 && /not set up/.test(e.message));
  await assert.rejects(hub.send('nothing', 'hi'), (e) => e.status === 400);
  assert.equal(await hub.isMember('fk:a#g1', '1', 'x'), false, 'membership questions never throw');

  await assert.rejects(hub.setEnabled('fake', true), (e) => e.status === 409 && /paste its token first/.test(e.message), 'a token channel needs its token first');
  t.store.setSecret('FAKE_CHAT_TOKEN', 'fake-1'); // saving the token starts it (077)
  const row = await hub.setEnabled('fake', true, 'admin');
  assert.equal(row.state, 'on');
  assert.deepEqual(loaded, ['fake']);
  assert.ok(log.includes('start'));
  await hub.send('fk:a#g1', 'hello');
  await hub.react('fk:a#g1', { msgId: 'm' }, '👍');
  await assert.rejects(hub.sendPoll('fk:a#g1', {}), (e) => e.status === 501 && /Fake chat cannot sendPoll/.test(e.message));
  assert.deepEqual((await hub.listChats()).map((c) => c.id), ['fk:a#g1']);

  // upkeep: one channel per tick; the load cost is measured a minute after start
  assert.equal((await hub.upkeep()).ok, true);
  assert.equal((await hub.channels()).find((c) => c.id === 'fake').measuring, true);
  await hub.upkeep(Date.now() + 61000);
  const fake = (await hub.channels()).find((c) => c.id === 'fake');
  assert.equal(fake.measuring, false);
  assert.equal(typeof fake.memoryMb, 'number');

  await hub.setEnabled('fake', false, 'admin');
  assert.ok(log.includes('stop'));
  assert.equal((await hub.channels()).find((c) => c.id === 'fake').state, 'off');
  assert.deepEqual(t.store.getSetting('channelsOff'), ['fake']);
  await assert.rejects(hub.send('fk:a#g1', 'again'), (e) => e.status === 409);
  await hub.setEnabled('fake', true);
  assert.deepEqual(loaded, ['fake', 'fake'], 'switched on again: a new adapter instance');
  t.store.setSecret('FAKE_CHAT_TOKEN', 'fake-2'); // a new token: stopped and started again
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(loaded, ['fake', 'fake', 'fake']);
  t.store.setSecret('FAKE_CHAT_TOKEN', ''); // token removed: stopped, not set up
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await hub.channels()).find((c) => c.id === 'fake').state, 'not_set_up');
  t.store.updateSettings({ channelsOff: [] });
});

test('075: WhatsApp switched on for the first time gets its first number; messages are noted for the Chats list', async () => {
  const log = [];
  let a;
  const hub = hubMod.createHub({ loaders: { whatsapp: async () => (a = fakeAdapter(log)) } });
  const got = [];
  await hub.start({ onMessage: async (m) => { got.push(m.text); } });
  assert.equal(a, undefined);
  t.store.updateSettings({ whatsappNumbers: null });
  await hub.setEnabled('whatsapp', true);
  assert.deepEqual(t.store.getSetting('whatsappNumbers'), [{ id: 'main', label: 'Main' }]);
  await a.emit({ ...t.msg({ chat: '41790000777@s.whatsapp.net', isGroup: false, phone: '41790000777', senderName: 'Zoe', text: 'hi' }), number: 'main' });
  assert.deepEqual(got, ['hi']);
  const seen = (await import('../src/core/chat-prefs.js')).seenChats({ groups: false });
  assert.ok(seen.some((c) => c.id === '41790000777@s.whatsapp.net' && c.name === 'Zoe'));
  const owner = await t.login();
  const r = await t.api(owner, 'GET', '/api/channels');
  assert.equal(r.status, 200);
});

test('075: the channel API — admins switch a channel on, only the owner switches it off; Health lists memory per channel', async () => {
  const owner = await t.login();
  t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
  const admin = await t.login('ada', 'admin password 123');
  assert.equal((await t.api(admin, 'PUT', '/api/channels/whatsapp', { enabled: false })).status, 403);
  assert.equal((await t.api(admin, 'PUT', '/api/channels/whatsapp', { enabled: true })).status, 200);
  assert.equal((await t.api(owner, 'PUT', '/api/channels/whatsapp', { enabled: false })).status, 200);
  const h = await t.api(owner, 'GET', '/api/server/health');
  assert.equal(h.body.channels[0].id, 'whatsapp');
  assert.equal(h.body.channels[0].memoryMb, 21);
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const tool = TOOLS.find((x) => x.name === 'set_channel_enabled');
  assert.equal(tool.risky({ enabled: false }), true, 'switching off needs confirm_action');
  assert.equal(tool.risky({ enabled: true }), false);
  assert.ok(TOOLS.some((x) => x.name === 'list_channels' && x.readOnly));
});

test('075: agents only get the chat tools the chat\'s channel can do; acting on another chat checks that channel', async () => {
  const { toolsFor } = await import('../src/core/tools.js');
  const agent = t.agents.getAgent('panduga');
  const names = async (chat) => (await toolsFor(agent, 'organizer', { chat })).defs.map((d) => d.name).filter((n) => n.startsWith('whatsapp__')).sort();
  const onWa = await names('g1@g.us');
  assert.equal(onWa.length, 24, 'a WhatsApp chat: every chat tool');
  assert.deepEqual(await names('fk:a#g1'), ['whatsapp__group_info', 'whatsapp__react', 'whatsapp__reply'], 'the fake channel: groups, reactions and quotes only');
  assert.equal((await names('')).length, 24, 'the test console: what any channel can do');
  const media = async (chat) => (await toolsFor(agent, 'organizer', { chat })).defs.some((d) => d.name === 'media__create_image');
  assert.equal(await media('fk:a#g1'), false, 'no pictures where the channel cannot send media');

  // from a WhatsApp group, sending media into a bound chat of a channel without media is refused
  const { chatTools } = await import('../src/core/chat-tools.js');
  const send = chatTools.find((x) => x.name === 'send_media');
  const ctx = { agent: { ...agent, chats: ['g1@g.us', 'fk:a#g1'] }, role: 'organizer', chat: 'g1@g.us', senderName: 'Org' };
  await assert.rejects(send.run({ kind: 'image', url: 'https://example.org/a.png', chat: 'fk:a#g1' }, ctx), /Fake chat cannot do this/);
});

test('075: people — one person per human; the same phone joins identities, also across channels', () => {
  const { personFor, personById, personByPhone } = people;
  const pn = personFor({ channel: 'whatsapp', externalId: '41790000801@s.whatsapp.net', phone: '41790000801' });
  const lid = personFor({ channel: 'whatsapp', externalId: '99801@lid', phone: '41790000801' });
  assert.equal(pn, lid, 'phone jid and LID of one person');
  assert.equal(personFor({ channel: 'whatsapp', externalId: '41790000801@s.whatsapp.net', phone: '41790000801' }), pn, 'stable');
  const other = personFor({ channel: 'fake', externalId: 'u801' });
  assert.notEqual(other, pn, 'no phone yet: a person of its own');
  assert.equal(personFor({ channel: 'fake', externalId: 'u801', phone: '+41 79 000 08 01' }), pn, 'a verified phone joins them');
  assert.equal(personById(other), null, 'the phoneless person merged away');
  const p = personByPhone('41790000801');
  assert.deepEqual(p.identities.map((i) => i.channel).sort(), ['fake', 'whatsapp', 'whatsapp']);
  assert.equal(personFor({ channel: 'fake', externalId: '' }), '');
});

test('075: the router notes who wrote, only for chats that are on', async () => {
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ phone: '41790000802', senderJid: '41790000802@s.whatsapp.net', text: '!panduga hi' }));
  assert.ok(people.personByPhone('41790000802'), 'g1 is on');
  t.chatPrefs.setChatPrefs('g7@g.us', { enabled: false });
  await t.route(t.msg({ chat: 'g7@g.us', phone: '41790000803', senderJid: '41790000803@s.whatsapp.net', text: 'hello' }));
  assert.equal(people.personByPhone('41790000803'), null, 'a chat that is off stores nothing, not even who wrote');
  const owner = await t.login();
  const r = await t.api(owner, 'GET', '/api/people/41790000802');
  assert.deepEqual(r.body.apps, ['whatsapp']);
});

test('075: a fresh install never loads Baileys; switching WhatsApp on does', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'duniya-lazy-'));
  // The hook refuses Baileys, so any import of it (static anywhere in the app's startup modules, or the adapter) fails.
  const hook = `data:text/javascript,${encodeURIComponent("export async function resolve(s, c, next) { if (s === 'baileys' || s.startsWith('baileys/')) throw new Error('BAILEYS_IMPORTED'); return next(s, c); }")}`;
  const script = `
    import { register } from 'node:module';
    register(${JSON.stringify(hook)});
    const { createHub } = await import('./src/channels/hub.js');
    await import('./src/core/router.js'); await import('./src/core/tools.js'); await import('./src/panel/server.js'); await import('./src/core/scheduler.js');
    const hub = createHub();
    await hub.start({ onMessage: async () => {} });
    const before = (await hub.status()).status;
    let after = '';
    try { await hub.setEnabled('whatsapp', true); after = 'loaded'; } catch (e) { after = e.message; }
    console.log(JSON.stringify({ before, after }));
    process.exit(0);`;
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script],
    { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir, PANEL_PORT: '0' }, encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').at(-1));
  assert.equal(r.before, 'not_set_up');
  assert.match(r.after, /BAILEYS_IMPORTED/, 'the hook works: switching WhatsApp on is what imports Baileys');
});

test('a read a channel never answers fails in plain words instead of holding the caller', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const silent = { ...fakeAdapter([]), groupInfo: () => new Promise(() => {}), chatName: () => new Promise(() => {}), listChats: () => new Promise(() => {}) };
    const hub = hubMod.createHub({ loaders: { fake: async () => silent } });
    t.store.setSecret('FAKE_CHAT_TOKEN', 'fake-2');
    await hub.start({ onMessage: async () => {} });
    await hub.setEnabled('fake', true, 'admin');
    const info = assert.rejects(hub.groupInfo('fk:a#g1'), (e) => e.status === 504 && /Fake chat did not answer in time/.test(e.message));
    const name = hub.chatName('fk:a#g1');
    const list = hub.listChats();
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(10 * 1000);
    await info;
    assert.equal(await name, '', 'a name that never comes is no name');
    assert.deepEqual(await list, [], 'a list that never comes is an empty list');
    await hub.setEnabled('fake', false, 'admin');
  } finally { mock.timers.reset(); }
});

test('a send refused while the channel reconnects is tried again; any other failure is not', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let offline = 2; const sent = [];
    const flaky = { ...fakeAdapter([]),
      async send(chat, text) { if (offline-- > 0) throw Object.assign(new Error('Fake chat is not connected'), { offline: true }); sent.push(text); return { msgId: 'm1' }; },
      async react() { throw new Error('refused'); } };
    const hub = hubMod.createHub({ loaders: { fake: async () => flaky } });
    t.store.setSecret('FAKE_CHAT_TOKEN', 'fake-3');
    await hub.start({ onMessage: async () => {} });
    await hub.setEnabled('fake', true, 'admin');
    const going = hub.send('fk:a#g1', 'the answer');
    for (const ms of [2000, 5000]) { await new Promise((r) => setImmediate(r)); mock.timers.tick(ms); }
    assert.deepEqual(await going, { msgId: 'm1' });
    assert.deepEqual(sent, ['the answer'], 'sent once');
    await assert.rejects(hub.react('fk:a#g1', { msgId: 'm' }, '👍'), /refused/);
    await hub.setEnabled('fake', false, 'admin');
  } finally { mock.timers.reset(); }
});
