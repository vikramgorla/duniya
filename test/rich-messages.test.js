// Feature 096 (issue #303): rich messages — a stored message keeps what its media is (never the file); the panel shows
// photos, stickers, GIFs, videos and voice notes from the chat app on demand. Fake WhatsApp, fake model.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, FAKE_PNG, FAKE_OGG } from './harness.js';

let t; let owner; let viewer;
const G = 'g1@g.us';
const OFF = 'g20@g.us'; // never switched on
const messages = async (chat = G) => (await t.api(owner, 'GET', `/api/chats/${encodeURIComponent(chat)}/messages?limit=50`)).body;
const file = (id, { cookie = owner, chat = G, range } = {}) => fetch(`${t.base}/api/chats/${encodeURIComponent(chat)}/messages/${id}/media`, { headers: { cookie, ...(range ? { range } : {}) } });

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
  owner = await t.login();
  t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
  viewer = await t.login('vera', 'viewer password 123');
});
after(() => t.close());
beforeEach(() => { t.downloads.length = 0; });

test('a photo in a chat that is on: stored with what it is (never the reference), shown from the chat app with safe headers', async () => {
  await t.route(t.mediaMsg({ type: 'image', caption: 'at the lake' }));
  const m = (await messages()).find((x) => x.text === '[image: at the lake]');
  assert.ok(m, 'stored with its words');
  assert.deepEqual(m.media, { type: 'image', mimetype: 'image/png', size: FAKE_PNG.length, shown: true });
  assert.ok(!JSON.stringify(await messages()).includes('media-'), 'the channel reference never leaves the server');

  const r = await file(m.id);
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), FAKE_PNG);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.match(r.headers.get('cache-control'), /^private, max-age=\d+, immutable$/);
  assert.equal(t.downloads.length, 1);

  // shown again (a second device, a reload): from the server's memory, the chat app is not asked again
  assert.equal((await file(m.id)).status, 200);
  assert.equal(t.downloads.length, 1);

  // a video player asks for parts
  const part = await file(m.id, { range: 'bytes=0-9' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-9/${FAKE_PNG.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), FAKE_PNG.subarray(0, 10));
  assert.equal((await file(m.id, { range: `bytes=${FAKE_PNG.length + 5}-` })).status, 416);

  // admins and owners only, as the messages themselves
  assert.equal((await file(m.id, { cookie: viewer })).status, 403);
  assert.equal((await file(m.id, { chat: OFF })).status, 404, 'the id belongs to another chat');
});

test('a voice note, a sticker and a GIF are shown; a document and a file too large for the panel are not', async () => {
  await t.route(t.mediaMsg({ type: 'audio', buffer: FAKE_OGG, seconds: 7 }));
  await t.route(t.mediaMsg({ type: 'sticker' }));
  await t.route(t.mediaMsg({ type: 'gif', mimetype: 'video/mp4', text: '[GIF]' }));
  await t.route(t.mediaMsg({ type: 'document', fileName: 'menu.pdf' }));
  await t.route(t.mediaMsg({ type: 'image', size: 40 * 1024 * 1024, text: '[image: huge]' }));
  const list = await messages();
  const of = (text) => list.find((x) => x.text === text)?.media;
  assert.deepEqual(of('[voice note]'), { type: 'audio', mimetype: 'audio/ogg', size: FAKE_OGG.length, seconds: 7, shown: true });
  assert.equal(of('[sticker]').shown, true);
  assert.equal(of('[GIF]').type, 'gif');
  assert.equal(of('[GIF]').shown, true);
  assert.deepEqual(of('[document: menu.pdf]'), { type: 'document', mimetype: 'application/pdf', size: FAKE_PNG.length, fileName: 'menu.pdf', shown: false });
  assert.equal(of('[image: huge]').shown, false, 'larger than this server shows');

  const doc = list.find((x) => x.text === '[document: menu.pdf]');
  const r = await file(doc.id);
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /no picture, video or sound/);
  assert.equal(t.downloads.length, 0, 'nothing was asked of the chat app');
});

test('what the chat app no longer has says so, and is not asked for again and again', async () => {
  const msg = t.mediaMsg({ type: 'image', text: '[image: gone soon]' });
  await t.route(msg);
  t.mediaStore.delete(msg.mediaRef);
  const m = (await messages()).find((x) => x.text === '[image: gone soon]');
  const r = await file(m.id);
  assert.equal(r.status, 410);
  assert.match((await r.json()).error, /WhatsApp no longer has it/);
  assert.equal((await file(m.id)).status, 410);
  assert.equal(t.downloads.length, 1, 'asked once');
});

test('chats that are off store nothing; plain messages have no media', async () => {
  await t.route(t.mediaMsg({ type: 'image', chat: OFF, text: '[image: off chat]' }));
  assert.ok(!(await messages(OFF)).some((x) => x.text === '[image: off chat]'));
  await t.route(t.msg({ text: 'just words' }));
  const m = (await messages()).find((x) => x.text === 'just words');
  assert.equal(m.media, undefined);
});

test('media an agent sends (a GIF, a picture) is stored with its message and shows in Review and Activity', async () => {
  const sendMedia = t.channel.sendMedia;
  t.channel.sendMedia = async (chat, o) => { await sendMedia(chat, o); t.mediaStore.set('sent-gif', FAKE_PNG); return { msgId: 'out-gif', mimetype: 'image/png', bytes: FAKE_PNG.length, mediaInfo: { type: 'image', mimetype: 'image/png', size: FAKE_PNG.length }, mediaRef: 'sent-gif' }; };
  try {
    t.script.push([{ type: 'tool_use', id: 'a', name: 'whatsapp__send_media', input: { kind: 'image', url: 'https://media.example/lake.png', caption: 'the lake' } }], [{ type: 'text', text: 'Sent.' }]);
    await t.route(t.msg({ text: '!panduga send the lake picture', phone: '41790000001' }));
    const sent = await t.waitFor(async () => (await messages()).find((x) => x.text === '[image: the lake]'));
    assert.equal(sent.fromAgent, true);
    assert.equal(sent.media.shown, true);
    assert.equal((await file(sent.id)).status, 200);
  } finally { t.channel.sendMedia = sendMedia; }
});

test('a photo addressed to the agent: its Activity entry points at the stored message and says what it is', async () => {
  t.script.push([{ type: 'text', text: 'Nice photo.' }]);
  await t.route(t.mediaMsg({ type: 'image', caption: '!panduga look', phone: '41790000001' }));
  const entry = await t.waitFor(() => t.db.listActivity({ limit: 20 }).find((a) => a.type === 'message.in' && a.detail?.media));
  const d = entry.detail;
  assert.equal(d.media.type, 'image');
  assert.ok(Number(d.msg) !== 0, 'the stored message');
  assert.equal((await file(d.msg)).status, 200);
});
