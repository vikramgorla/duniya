// Feature 043 (issue #48): photos & voice — photos in, voice notes in, create images, voice replies — plus the
// small-server guardrails and the persisted media queue. Fake providers, fake WhatsApp, fake on-server engine.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fakeChatProvider, FAKE_PNG, FAKE_OGG } from './harness.js';

const oa = fakeChatProvider({ name: 'openai', models: ['gpt-4o', 'gpt-3.5-turbo', 'gpt-4o-mini-transcribe', 'whisper-1'] });
const or = fakeChatProvider({ name: 'openrouter', models: ['vision/model', 'text/only'] });

let t; let owner; let media; let queue; let res; let speech; let providers; let usage; let budget;
const DM = '41790000001@s.whatsapp.net'; // organizer of panduga
const ORG = '41790000001';
const lastSent = () => t.sent.at(-1)?.text || '';
const waCalls = (fn) => t.waCalls.filter((c) => c.fn === fn);
const userContent = (req) => req.messages[0].content;
const textOf = (content) => (typeof content === 'string' ? content : content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
const agentReqs = () => t.claudeReqs;
async function route(msg) { await t.route(msg); await queue.drain(); }
const groupPhoto = (o = {}) => t.mediaMsg({ type: 'image', caption: '!panduga what is in this photo?', phone: ORG, ...o });
const voice = (o = {}) => t.mediaMsg({ type: 'audio', buffer: FAKE_OGG, isGroup: false, chat: DM, phone: ORG, senderName: 'Vik', ...o });
async function setAgent(patch) { const r = await t.api(owner, 'PUT', '/api/agents/panduga', patch); assert.equal(r.status, 200, JSON.stringify(r.body)); }
async function refreshModels() { providers.clearModelCache(); media.clearImageModelCache(); await t.api(owner, 'GET', '/api/providers?refresh=1'); }

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' }, beforeImport: () => { process.env.OPENAI_API_BASE = oa.url(); process.env.OPENROUTER_API_BASE = or.url(); } });
  owner = await t.login();
  media = await import('../src/core/media-ai.js');
  queue = await import('../src/core/media-queue.js');
  res = await import('../src/core/resources.js');
  speech = await import('../src/core/speech-local.js');
  providers = await import('../src/core/providers/index.js');
  usage = await import('../src/core/usage.js');
  budget = await import('../src/core/budget.js');
  res.setResourceProbe({ totalMb: 8192, availableMb: 4000, cpus: 4, rssMb: 200, cgroupLimitMb: null });
  speech.setFfmpeg(true);
  speech.setConverter(async (buf, target) => (target === 'ogg' ? FAKE_OGG : Buffer.from('RIFF....WAVEfake')));
  t.store.setSecret('OPENAI_API_KEY', 'sk-test');
  await refreshModels();
});
after(() => { oa.close(); or.close(); t.close(); });
beforeEach(() => {
  t.script.length = 0; t.sent.length = 0; t.waCalls.length = 0; t.downloads.length = 0;
  for (const f of [oa, or]) { f.media.length = 0; f.mediaFail.length = 0; f.reqs.length = 0; f.script.length = 0; f.mediaCost = null; }
  speech.setLocalEngine(null);
  media.setMediaSettings({ visionFallback: '', imageModel: '', imagePrices: {}, local: { listen: false, speak: false } });
  res.setResourceProbe({ totalMb: 8192, availableMb: 4000, cpus: 4, rssMb: 200, cgroupLimitMb: null });
  queue.setQueueTiming({ signalMs: 10000, noteMs: 60000, maxAgeMs: 15 * 60000 });
});

// ---------- photos in ----------
test('a photo addressed to the agent reaches a vision model as an image block; history keeps only the placeholder', async () => {
  t.script.push([{ type: 'text', text: 'That is the temple hall.' }]);
  const before = agentReqs().length;
  const m = groupPhoto();
  await route(m);
  const req = agentReqs()[before];
  assert.ok(req, 'the agent was called');
  const content = userContent(req);
  assert.ok(Array.isArray(content));
  const img = content.find((b) => b.type === 'image');
  assert.equal(img.source.media_type, 'image/png');
  assert.equal(img.source.data, FAKE_PNG.toString('base64'));
  assert.match(textOf(content), /\[image\] what is in this photo\?/);
  assert.equal(lastSent(), 'That is the temple hall.');
  // no photo bytes in the database: only the placeholder and caption
  const rows = t.db.db.prepare('SELECT text FROM messages WHERE chat = ?').all('g1@g.us');
  assert.ok(rows.some((r) => r.text.startsWith('[image')));
  assert.ok(!rows.some((r) => r.text.includes(FAKE_PNG.toString('base64').slice(0, 20))));
  assert.ok(!t.db.db.prepare('SELECT payload FROM media_jobs').all().length, 'queue is empty after the job');
});

test('a photo not addressed to the agent, or in a chat that is off, is never downloaded or queued', async () => {
  await route(groupPhoto({ caption: 'look at this' }));
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: false });
  await route(groupPhoto({ chat: 'g3@g.us' }));
  assert.equal(t.downloads.length, 0);
  assert.equal(queue.queueStats().queued + queue.queueStats().running, 0);
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: true });
});

test('model that cannot see images: polite note, or the vision fallback model (Settings)', async () => {
  await setAgent({ model: 'openai:gpt-3.5-turbo' });
  oa.script.push({ content: 'Sorry, I can’t look at photos right now.' });
  await route(groupPhoto());
  const req = oa.reqs.at(-1).body;
  const user = req.messages.find((x) => x.role === 'user');
  assert.equal(typeof user.content, 'string', 'no image parts sent to a text-only model');
  assert.match(user.content, /cannot look at photos/);
  assert.equal(lastSent(), 'Sorry, I can’t look at photos right now.');
  // with a vision fallback, the photo goes to that model instead
  media.setMediaSettings({ visionFallback: 'anthropic:claude-sonnet-5-5' });
  t.script.push([{ type: 'text', text: 'A temple hall.' }]);
  const n = agentReqs().length;
  await route(groupPhoto());
  assert.ok(userContent(agentReqs()[n]).some((b) => b.type === 'image'));
  await setAgent({ model: 'claude-sonnet-5-5' });
});

test('OpenAI-compatible adapters get image_url parts; ChatGPT gets input_image; PDFs become file parts', async () => {
  await setAgent({ model: 'openai:gpt-4o' });
  oa.script.push({ content: 'A hall.' });
  await route(groupPhoto());
  const user = oa.reqs.at(-1).body.messages.find((x) => x.role === 'user');
  assert.ok(Array.isArray(user.content));
  assert.match(user.content.find((p) => p.type === 'image_url').image_url.url, /^data:image\/png;base64,/);
  oa.script.push({ content: 'A menu.' });
  await route(t.mediaMsg({ type: 'document', buffer: Buffer.from('%PDF-1.4 fake pdf body here'), fileName: 'menu.pdf', caption: '!panduga summarise', phone: ORG }));
  const u2 = oa.reqs.at(-1).body.messages.find((x) => x.role === 'user');
  assert.equal(u2.content.find((p) => p.type === 'file').file.filename, 'menu.pdf');
  await setAgent({ model: 'claude-sonnet-5-5' });
  const { toResponsesInput } = await import('../src/core/providers/chatgpt.js');
  const items = toResponsesInput([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'hi' }] }]);
  assert.deepEqual(items[0].content[0], { type: 'input_image', image_url: 'data:image/png;base64,AAA' });
});

test('oversized photos and voice notes are refused by WhatsApp’s declared size, before any download', async () => {
  t.script.push([{ type: 'text', text: 'Too big, sorry.' }]);
  await route(groupPhoto({ size: 200 * 1024 * 1024 }));
  await route(voice({ size: 200 * 1024 * 1024 }));
  assert.equal(t.downloads.length, 0);
  assert.match(lastSent(), /too large/);
});

// ---------- voice notes in ----------
test('voice notes: transcribed by OpenAI, handled as text, stored as 🎤 transcript', async () => {
  t.script.push([{ type: 'text', text: 'Great, see you there.' }]);
  const n = agentReqs().length;
  const m = voice();
  await route(m);
  assert.equal(oa.media.at(-1).path, '/audio/transcriptions');
  assert.equal(oa.media.at(-1).body.model, 'gpt-4o-mini-transcribe');
  assert.match(textOf(userContent(agentReqs()[n])), /see you at the station at nine/);
  assert.equal(t.db.messageByMsgId(DM, m.msgId).text, '🎤 see you at the station at nine');
  assert.ok(t.db.listActivity({ limit: 50 }).some((a) => a.type === 'media.voice' && a.summary.startsWith('🎤')));
  assert.ok(usage.usageReport({ groupBy: 'kind' }).rows.some((r) => r.key === 'transcribe'));
});

test('transcription fallback order: OpenAI → OpenRouter → on-server engine → polite "please type"', async () => {
  // OpenAI fails: OpenRouter (JSON input_audio) answers
  await t.api(owner, 'POST', '/api/providers/openrouter', { key: 'sk-or-test', freeOnly: false });
  await refreshModels();
  oa.mediaFail.push({ status: 500 });
  t.script.push([{ type: 'text', text: 'ok 1' }]);
  await route(voice());
  assert.equal(or.media.at(-1).path, '/audio/transcriptions');
  assert.equal(or.media.at(-1).body.input_audio.format, 'ogg');
  assert.equal(or.media.at(-1).body.model, 'openai/gpt-4o-mini-transcribe');
  // both fail: the on-server engine (when on) answers
  speech.setLocalEngine({ installed: { stt: true, tts: true }, transcribe: async () => 'local words', speak: async () => FAKE_OGG });
  media.setMediaSettings({ local: { listen: true } });
  oa.mediaFail.push({ status: 500 }); or.mediaFail.push({ status: 500 });
  const n = agentReqs().length;
  t.script.push([{ type: 'text', text: 'ok 2' }]);
  await route(voice());
  assert.match(textOf(userContent(agentReqs()[n])), /local words/);
  // nothing can listen: a polite reply, no model call
  providers.removeCompatible('openrouter');
  t.store.setSecret('OPENAI_API_KEY', '');
  media.setMediaSettings({ local: { listen: false } });
  const m = agentReqs().length;
  await route(voice());
  assert.equal(agentReqs().length, m);
  assert.match(lastSent(), /can’t listen to voice notes/);
  t.store.setSecret('OPENAI_API_KEY', 'sk-test');
  await refreshModels();
});

test('ChatGPT sign-in is not used for transcription or images (OpenAI lists both as unsupported for plan usage)', async () => {
  const caps = (await t.api(owner, 'GET', '/api/media')).body;
  assert.ok(caps.providers.every((p) => p.type !== 'chatgpt' || (!p.hears && !p.creates)));
  const oaRow = caps.providers.find((p) => p.id === 'openai');
  assert.equal(oaRow.hears, true); assert.equal(oaRow.speaks, true);
  assert.equal(caps.providers.find((p) => p.id === 'anthropic').sees, 'yes');
});

// ---------- create images ----------
test('create_image is exposed only when a provider can create images, organizers only by default; result sent as an image, counted', async () => {
  t.script.push([{ type: 'text', text: 'hi' }]);
  await route(t.msg({ text: '!panduga hi', phone: ORG }));
  assert.ok(!t.toolNames(agentReqs().length - 1).includes('media__create_image'), 'no image models listed yet');
  oa.models.push('gpt-image-1');
  await refreshModels();
  t.script.push([{ type: 'text', text: 'hi' }]);
  await route(t.msg({ text: '!panduga hi', phone: '41790000002' })); // participant
  assert.ok(!t.toolNames(agentReqs().length - 1).includes('media__create_image'));
  media.setMediaSettings({ imagePrices: { 'openai:gpt-image-1': 0.04 } });
  t.script.push([{ type: 'tool_use', id: 'img1', name: 'media__create_image', input: { prompt: 'a festive poster with diyas', caption: 'Diwali!' } }], [{ type: 'text', text: 'Here it comes!' }]);
  await route(t.msg({ text: '!panduga make a poster', phone: ORG }));
  assert.ok(t.toolNames(agentReqs().length - 2).includes('media__create_image'));
  assert.equal(oa.media.at(-1).path, '/images/generations');
  assert.equal(oa.media.at(-1).body.model, 'gpt-image-1');
  const sent = waCalls('sendMedia').at(-1);
  assert.equal(sent.args[0].kind, 'image'); assert.equal(sent.args[0].caption, 'Diwali!');
  assert.equal(sent.args[0].base64, FAKE_PNG.toString('base64'));
  const row = t.db.db.prepare("SELECT * FROM usage WHERE kind = 'image' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.cost, 0.04); assert.equal(row.agent, 'panduga');
  assert.ok(budget.spendOf('agent', 'panduga').cost >= 0.04, 'counted toward the agent’s spending');
  // participants when the agent allows it
  await setAgent({ media: { createImages: { organizer: true, participant: true } } });
  t.script.push([{ type: 'text', text: 'hi' }]);
  await route(t.msg({ text: '!panduga hi', phone: '41790000002' }));
  assert.ok(t.toolNames(agentReqs().length - 1).includes('media__create_image'));
  await setAgent({ media: { createImages: { organizer: true, participant: false } } });
});

test('create_image: edit of the last photo; spending cap reached refuses; OpenRouter image models', async () => {
  if (!oa.models.includes('gpt-image-1')) { oa.models.push('gpt-image-1'); await refreshModels(); }
  t.script.push([{ type: 'text', text: 'Nice photo.' }]);
  await route(groupPhoto());
  t.script.push([{ type: 'tool_use', id: 'img2', name: 'media__create_image', input: { prompt: 'make it a cartoon', edit_of: 'last_photo' } }], [{ type: 'text', text: 'On its way.' }]);
  await route(t.msg({ text: '!panduga make it a cartoon', phone: ORG }));
  assert.equal(oa.media.at(-1).path, '/images/edits');
  assert.equal(oa.media.at(-1).body.hasImage, true);
  // cap reached: the tool refuses, nothing is created
  budget.setCap('agent', 'panduga', { cost: 0.01 });
  usage.recordUsage({ agent: 'panduga', chat: 'g1@g.us', provider: 'openai', model: 'gpt-image-1', kind: 'image', cost: 0.5 });
  const before = oa.media.length;
  t.script.push([{ type: 'tool_use', id: 'img3', name: 'media__create_image', input: { prompt: 'x' } }], [{ type: 'text', text: 'Cannot.' }]);
  await t.route(t.msg({ text: '!panduga picture please', phone: ORG }));
  await queue.drain();
  assert.equal(oa.media.length, before);
  budget.setCap('agent', 'panduga', {});
  // OpenRouter only (OpenAI key removed): its /images endpoint with an image model from /images/models
  t.store.setSecret('OPENAI_API_KEY', '');
  or.imageModels = ['google/gemini-image'];
  await t.api(owner, 'POST', '/api/providers/openrouter', { key: 'sk-or-test', freeOnly: false });
  await refreshModels();
  or.mediaCost = 0.02;
  t.script.push([{ type: 'tool_use', id: 'img4', name: 'media__create_image', input: { prompt: 'a lamp' } }], [{ type: 'text', text: 'Done.' }]);
  await route(t.msg({ text: '!panduga lamp picture', phone: ORG }));
  assert.equal(or.media.at(-1).path, '/images');
  assert.equal(or.media.at(-1).body.model, 'google/gemini-image', JSON.stringify(or.media.map((x) => [x.path, x.body.model])));
  assert.equal(t.db.db.prepare("SELECT cost FROM usage WHERE kind = 'image' ORDER BY id DESC LIMIT 1").get().cost, 0.02);
  // free-only OpenRouter: no paid media
  await t.api(owner, 'POST', '/api/providers/openrouter', { freeOnly: true });
  assert.equal(await media.canCreateImages(), false);
  providers.removeCompatible('openrouter');
  t.store.setSecret('OPENAI_API_KEY', 'sk-test');
  await refreshModels();
});

test('test console never creates pictures', async () => {
  t.script.push([{ type: 'tool_use', id: 'img5', name: 'media__create_image', input: { prompt: 'x' } }], [{ type: 'text', text: 'would make it' }]);
  const before = oa.media.length;
  const r = await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'make a picture', role: 'organizer' });
  assert.equal(r.status, 200);
  await queue.drain();
  assert.equal(oa.media.length, before);
});

// ---------- voice replies ----------
test('voice replies: never / when they send a voice note / always; text kept in history; codes stay text', async () => {
  await setAgent({ media: { voiceReply: 'voice' } });
  t.script.push([{ type: 'text', text: 'See you at nine.' }]);
  await route(voice());
  const v = waCalls('sendMedia').at(-1);
  assert.equal(v.args[0].kind, 'audio'); assert.equal(v.args[0].voiceNote, true); assert.equal(v.args[0].mimetype, 'audio/ogg');
  assert.equal(oa.media.at(-1).path, '/audio/speech'); assert.equal(oa.media.at(-1).body.response_format, 'opus');
  assert.equal(t.db.db.prepare("SELECT text FROM messages WHERE chat = ? AND from_agent = 1 ORDER BY id DESC LIMIT 1").get(DM).text, 'See you at nine.');
  // a typed message gets a typed answer in "voice" mode
  t.script.push([{ type: 'text', text: 'Typed answer.' }]);
  const calls = waCalls('sendMedia').length;
  await route(t.msg({ text: 'hello', isGroup: false, chat: DM, phone: ORG }));
  assert.equal(lastSent(), 'Typed answer.'); assert.equal(waCalls('sendMedia').length, calls);
  // always: typed messages get a voice note too (made in the media queue)
  await setAgent({ media: { voiceReply: 'always' } });
  t.script.push([{ type: 'text', text: 'Spoken answer.' }]);
  await route(t.msg({ text: 'hello again', isGroup: false, chat: DM, phone: ORG }));
  assert.equal(waCalls('sendMedia').length, calls + 1);
  // a reply that carries a link stays text
  t.script.push([{ type: 'text', text: 'Details: https://example.com/x' }]);
  await route(t.msg({ text: 'link?', isGroup: false, chat: DM, phone: ORG }));
  assert.equal(lastSent(), 'Details: https://example.com/x');
  // TTS fails everywhere: the text is sent instead
  oa.mediaFail.push({ status: 500 });
  t.script.push([{ type: 'text', text: 'Fallback text.' }]);
  await route(t.msg({ text: 'again', isGroup: false, chat: DM, phone: ORG }));
  assert.equal(lastSent(), 'Fallback text.');
  await setAgent({ media: { voiceReply: 'never' } });
  t.script.push([{ type: 'text', text: 'Never voice.' }]);
  await route(voice());
  assert.equal(lastSent(), 'Never voice.');
});

test('agent media settings are validated', async () => {
  const r = await t.api(owner, 'PUT', '/api/agents/panduga', { media: { voiceReply: 'sometimes' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /voiceReply/);
});

// ---------- the media queue ----------
test('queue: jobs survive a restart, run in order per chat, ⏳ when waiting, apology when stale, polite when full', async () => {
  res.setResourceProbe({ totalMb: 1000, availableMb: 300, cpus: 1, rssMb: 200 }); // small server: 1 worker, 20 max
  let release; const gate = new Promise((r) => { release = r; });
  const order = [];
  queue.registerJobHandler('test-slow', { async run(p) { order.push(p.n); if (p.wait) await gate; } });
  queue.enqueue({ kind: 'test-slow', chat: 'g2@g.us', payload: { n: 'block', wait: true } });
  // wait until the blocking job really runs (a fixed delay was flaky on a busy CI machine)
  for (let i = 0; i < 200 && !order.includes('block'); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(order.includes('block'), 'blocking job started');
  // a photo turn waits behind it
  t.script.push([{ type: 'text', text: 'Late but here.' }]);
  const m = groupPhoto();
  await t.route(m);
  assert.equal(queue.queueStats().queued, 1);
  queue.setQueueTiming({ signalMs: 0, noteMs: 0 });
  await queue.checkSignals();
  // the background ticker may be sending the same signal concurrently: wait for it to land
  for (let i = 0; i < 200 && !waCalls('react').some((c) => c.args[1] === '⏳'); i++) await new Promise((r) => setTimeout(r, 10));
  for (let i = 0; i < 200 && !/I’m on it/.test(lastSent() || ''); i++) await new Promise((r) => setTimeout(r, 10));
  const hourglass = waCalls('react').find((c) => c.args[1] === '⏳');
  assert.equal(hourglass.chat, 'g1@g.us'); assert.equal(hourglass.args[0].msgId, m.msgId);
  assert.match(lastSent(), /I’m on it/);
  release();
  await queue.drain();
  assert.equal(lastSent(), 'Late but here.');
  assert.ok(waCalls('react').some((c) => c.args[1] === '' && c.args[0].msgId === m.msgId), '⏳ taken back');
  // order per chat
  queue.enqueue({ kind: 'test-slow', chat: 'g5@g.us', payload: { n: 1 } });
  queue.enqueue({ kind: 'test-slow', chat: 'g5@g.us', payload: { n: 2 } });
  await queue.drain();
  assert.deepEqual(order.slice(-2), [1, 2]);
  // restart: a job that was running when the app stopped runs again
  t.db.db.prepare("INSERT INTO media_jobs (tenant_id, chat, kind, payload, created_at, attempts, state) VALUES ('default', 'g5@g.us', 'test-slow', ?, ?, 1, 'running')").run(JSON.stringify({ n: 'after-restart' }), Date.now());
  queue.startQueue();
  await queue.drain();
  assert.equal(order.at(-1), 'after-restart');
  // stale: older than the max age → short apology, recorded as a quiet reason
  queue.setQueueTiming({ maxAgeMs: 1000 });
  const stale = groupPhoto();
  t.db.db.prepare("INSERT INTO media_jobs (tenant_id, chat, msg_id, kind, agent, payload, created_at) VALUES ('default', 'g1@g.us', ?, 'turn', 'panduga', ?, ?)")
    .run(stale.msgId, JSON.stringify({ msg: { chat: 'g1@g.us', msgId: stale.msgId, mediaInfo: stale.mediaInfo, mediaRef: stale.mediaRef, text: '[image]' }, agent: 'panduga', role: 'organizer', addressed: true }), Date.now() - 60000);
  queue.pump();
  await queue.drain();
  assert.match(lastSent(), /couldn’t get to your photo in time/);
  const { listSilences } = await import('../src/core/silences.js');
  assert.ok((listSilences?.() || t.db.db.prepare("SELECT * FROM silences WHERE reason = 'stale'").all()).length);
  queue.setQueueTiming({ maxAgeMs: 15 * 60000 });
  // full: 20 jobs waiting → one polite "overloaded" reply, nothing queued
  let release2; const gate2 = new Promise((r) => { release2 = r; });
  queue.registerJobHandler('test-gate', { async run() { await gate2; } });
  for (let i = 0; i < 20; i++) queue.enqueue({ kind: 'test-gate', chat: `x${i}@g.us`, payload: {} });
  await t.route(groupPhoto());
  assert.match(lastSent(), /overloaded right now/);
  assert.throws(() => queue.enqueue({ kind: 'test-gate', chat: 'y@g.us', payload: {} }), { code: 'overloaded' });
  release2();
  await queue.drain(10000);
});

// ---------- small-server guardrails ----------
test('small servers: size in status, on-server engines and Copilot refused, low memory falls back, pressure pauses optional work', async () => {
  res.setResourceProbe({ totalMb: 958, availableMb: 250, cpus: 1, rssMb: 180 });
  const st = (await t.api(owner, 'GET', '/api/status')).body;
  assert.equal(st.server.size, 'small'); assert.equal(st.server.effectiveMb, 958);
  const on = await t.api(owner, 'PUT', '/api/media/settings', { local: { listen: true } });
  assert.equal(on.status, 400); assert.match(on.body.error, /normally needs 2048 MB/);
  const inst = await t.api(owner, 'POST', '/api/media/local/stt/install');
  assert.equal(inst.status, 400);
  const co = await t.api(owner, 'POST', '/api/providers/copilot', { token: 'github_pat_abcdefghijklmnop' });
  assert.equal(co.status, 400); assert.match(co.body.error, /2 GB/);
  assert.equal(res.maxLocalServices(), 2);
  // a container limit counts as the server's size
  res.setResourceProbe({ totalMb: 16000, cgroupLimitMb: 900, availableMb: 500, cpus: 4, rssMb: 100 });
  assert.equal(res.serverSize().size, 'small');
  // big enough to enable, but not enough free memory right now: the on-server engine is skipped
  res.setResourceProbe({ totalMb: 4096, availableMb: 200, cpus: 2, rssMb: 200 });
  assert.equal((await t.api(owner, 'PUT', '/api/media/settings', { local: { listen: true } })).status, 200);
  speech.setLocalEngine({ installed: { stt: true }, transcribe: async () => 'should not run' });
  t.store.setSecret('OPENAI_API_KEY', '');
  await route(voice());
  assert.match(lastSent(), /couldn’t listen/);
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => a.type === 'error' && /free right now/.test(a.summary)));
  t.store.setSecret('OPENAI_API_KEY', 'sk-test');
  // memory pressure: optional work pauses (one entry), and resumes
  res.setResourceProbe({ totalMb: 4096, availableMb: 800, cpus: 2, rssMb: 3500 });
  assert.equal(res.optionalPaused(), true);
  assert.equal(await t.memory.maybeSummarize('g1@g.us', t.agents.getAgent('panduga')), null);
  oa.models.includes('gpt-image-1') || oa.models.push('gpt-image-1');
  await refreshModels();
  await assert.rejects(() => media.mediaTools[0].run({ prompt: 'x' }, { agent: t.agents.getAgent('panduga'), chat: 'g1@g.us' }), /low on memory/);
  res.setResourceProbe({ totalMb: 4096, availableMb: 800, cpus: 2, rssMb: 300 });
  assert.equal(res.optionalPaused(), false);
  const entries = t.db.listActivity({ limit: 30 }).filter((a) => /optional work (paused|resumed)/.test(a.summary));
  assert.equal(entries.length, 2);
});

test('job limiter: one heavy call at a time on small servers, per-call timeouts', async () => {
  res.setResourceProbe({ totalMb: 1000, availableMb: 300, cpus: 1, rssMb: 100 });
  let active = 0; let peak = 0;
  const job = () => res.runJob('x', async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active--; });
  await Promise.all([job(), job(), job()]);
  assert.equal(peak, 1);
  await assert.rejects(() => res.runJob('slow', () => new Promise((r) => setTimeout(r, 200)), { timeoutMs: 20 }), { code: 'timeout' });
  const [cmd, args] = res.lowPriority('ffmpeg', ['-i', 'a'], { memMb: 512 });
  assert.equal(cmd, 'prlimit'); assert.deepEqual(args.slice(0, 5), [`--as=${512 * 1024 * 1024}`, '--', 'nice', '-n', '10']); assert.deepEqual(args.slice(5), ['ffmpeg', '-i', 'a']);
});

test('panel: capabilities, settings and admin MCP tools', async () => {
  const r = await t.api(owner, 'GET', '/api/media');
  assert.equal(r.status, 200);
  assert.ok(r.body.summary.sees); assert.ok(r.body.voices.includes('alloy'));
  const bad = await t.api(owner, 'PUT', '/api/media/settings', { voice: 'robot' });
  assert.equal(bad.status, 400);
  const ok = await t.api(owner, 'PUT', '/api/media/settings', { voice: 'coral', maxVoiceSeconds: 120 });
  assert.equal(ok.body.settings.voice, 'coral');
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  for (const n of ['get_photos_and_voice', 'set_photos_and_voice_settings', 'install_speech_engine', 'set_agent_photos_and_voice']) assert.ok(TOOLS.some((x) => x.name === n), n);
});

test('small server mode: on-server speech on a ~1 GB server only when switched on and with room right now', async () => {
  const res = await import('../src/core/resources.js');
  const { setMediaSettings } = await import('../src/core/media-ai.js');
  setMediaSettings({ local: { smallServer: false } });
  res.setResourceProbe({ totalMb: 960, availableMb: 700, cpus: 1, rssMb: 150 });
  assert.equal(res.localEngineCheck({ forEnable: true }).code, 'too_small');
  setMediaSettings({ local: { smallServer: true } });
  assert.equal(res.localEngineCheck({ forEnable: true }).ok, true);
  assert.equal(res.localEngineCheck({ needMb: 400 }).ok, true); // 700 free ≥ 400 + 150
  res.setResourceProbe({ totalMb: 960, availableMb: 520, cpus: 1, rssMb: 150 });
  assert.equal(res.localEngineCheck({ needMb: 400 }).code, 'low_memory');
  res.setResourceProbe({ totalMb: 700, availableMb: 500, cpus: 1, rssMb: 150 });
  assert.equal(res.localEngineCheck({ forEnable: true }).code, 'too_small');
  setMediaSettings({ local: { smallServer: false } });
  res.setResourceProbe(null);
});
