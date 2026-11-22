// 094: reaction media on their own — a tool service that finds GIFs (or stickers) is used by an agent off | sometimes |
// often: moments found in code, one call (send_reaction) or a code fallback after a text-only reply, one per moment,
// no repeats, serious topics skipped, mood words only (never names) sent to the service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setup } from './harness.js';

let t; let owner;
const queries = []; // what the fake GIF service was asked
const order = []; // texts and media as they reached the chat
const results = (n = 8) => Array.from({ length: n }, (_, i) => ({ id: `klipy:g${i}`, title: `GIF ${i}`, url: `https://static.klipy.example/${i}.gif`,
  mp4Url: `https://static.klipy.example/${i}.mp4`, source: 'klipy', attribution: `"GIF ${i}" · Powered by KLIPY`, attributionRequired: true }));
let count = 8;

/** A fake reaction service: `tools` as [name, meta?]; search answers with structured results (like the KLIPY service). */
function fakeService(tools) {
  return http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const s = new Server({ name: 'fake-gifs', version: '1' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(([name, meta]) => ({ name, description: name, ...(meta ? { _meta: meta } : {}),
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } })) }));
    s.setRequestHandler(CallToolRequestSchema, async (r) => {
      queries.push(r.params.arguments.query);
      const list = results(count).map((x) => ({ ...x, webpUrl: x.url.replace('.gif', '.webp') }));
      return { content: [{ type: 'text', text: `Found ${list.length}` }], structuredContent: { query: r.params.arguments.query, results: list } };
    });
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(tr);
    await tr.handleRequest(req, res, d ? JSON.parse(d) : undefined);
  }).listen(0);
}
const gifSrv = fakeService([['search_gifs'], ['get_gif']]);
const stickerSrv = fakeService([['lookup', { 'duniya/reaction': 'sticker' }]]);
const url = (srv) => `http://127.0.0.1:${srv.address().port}/mcp`;

const CHATS = Array.from({ length: 12 }, (_, i) => `r${i + 1}@g.us`);
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  for (const c of CHATS) t.chatPrefs.setChatPrefs(c, { enabled: true });
  const r = await t.api(owner, 'PUT', '/api/tool-services/gifs', { url: url(gifSrv), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Raju', triggers: ['raju'], model: 'anthropic:claude-sonnet-5-5',
    reactions: { gifs: { mode: 'often', style: 'telugu movie' } }, tools: { participant: ['whatsapp:-'], organizer: [], deny: [] } } });
  for (const c of CHATS) await t.api(owner, 'POST', '/api/chats/bind', { chat: c, agent: 'raju' });
  const send = t.channel.send; const sendMedia = t.channel.sendMedia;
  t.channel.send = async (chat, text, o) => { order.push({ chat, text }); return send(chat, text, o); };
  t.channel.sendMedia = async (chat, m) => { order.push({ chat, media: m }); return sendMedia(chat, m); };
});
after(() => { gifSrv.close(); stickerSrv.close(); t.close(); });

const inChat = (chat) => order.filter((o) => o.chat === chat);
const media = (chat) => inChat(chat).filter((o) => o.media);
const say = (chat, text, o = {}) => t.route(t.msg({ chat, text, phone: '41790000007', senderName: 'Priya', ...o }));
const tool = (input, id = 'r1') => ({ type: 'tool_use', id, name: 'whatsapp__send_reaction', input });
const text = (s) => [{ type: 'text', text: s }];

test('a celebration with "often": the text, then exactly one GIF with the KLIPY credit; one call; participants without send_media too', async () => {
  const chat = CHATS[0]; const n = t.claudeReqs.length;
  t.script.push([tool({ mood: 'party dance' })], text('Congrats Chary, mission accomplished! 🎉'));
  await say(chat, 'raju Chary got promoted, congrats!! 🎉');
  const req = t.claudeReqs[n];
  const names = req.tools.map((x) => x.name);
  assert.ok(names.includes('whatsapp__send_reaction'), 'the one-call action is offered to a participant');
  assert.ok(!names.includes('whatsapp__send_media'), 'this participant has no send_media');
  assert.match(String(req.system), /Reactions: you can add one fitting GIF/);
  assert.match(JSON.stringify(req.messages[0].content), /lighthearted moment: after your text, end with send_reaction\(\\"celebration\\"\)/);
  const out = inChat(chat);
  assert.equal(out.length, 2); assert.ok(out[0].text && out[1].media, 'text first, then the GIF');
  assert.equal(out[1].media.kind, 'gif'); assert.match(out[1].media.url, /\.mp4$/, 'the MP4 (what chat apps send)');
  assert.equal(out[1].media.caption, 'Powered by KLIPY');
  assert.equal(queries.at(-1), 'party dance telugu movie', 'mood words + the style keywords');
  const act = t.db.db.prepare("SELECT summary FROM activity WHERE type = 'whatsapp.action' ORDER BY id DESC LIMIT 1").get();
  assert.match(act.summary, /Sent a GIF \(party dance\) from gifs, chosen by the model/);
});

test('a text-only reply on a clear moment (the light model forgot): code sends one GIF after the text', async () => {
  const chat = CHATS[1];
  await t.api(owner, 'PUT', '/api/agents/raju', { model: 'smart' });
  t.script.push(text('Anytime, squad!'));
  await say(chat, 'thanks raju!');
  await t.api(owner, 'PUT', '/api/agents/raju', { model: 'anthropic:claude-sonnet-5-5' });
  const tier = t.db.db.prepare("SELECT detail FROM activity WHERE type = 'model.usage' ORDER BY id DESC LIMIT 1").get();
  assert.match(tier.detail, /"tier":"light"/, 'a light-tier turn');
  assert.deepEqual(inChat(chat).map((o) => (o.media ? 'gif' : o.text)), ['Anytime, squad!', 'gif']);
  assert.equal(queries.at(-1), 'thank you telugu movie');
});

test('the model can ask with a [reaction: …] tag (never shown); serious topics get none, even when asked', async () => {
  let chat = CHATS[2];
  t.script.push(text('Ha, classic! [reaction: mind blown]'));
  await say(chat, 'raju that was hilarious');
  assert.deepEqual(inChat(chat).map((o) => (o.media ? 'gif' : o.text)), ['Ha, classic!', 'gif']);
  assert.equal(queries.at(-1), 'mind blown telugu movie');
  chat = CHATS[3]; const n = t.claudeReqs.length;
  t.script.push(text('Take care, I will tell the others. [reaction: hug]'));
  await say(chat, 'raju sorry, accident on the highway, I will be late');
  assert.doesNotMatch(JSON.stringify(t.claudeReqs[n].messages[0].content), /lighthearted moment/);
  assert.deepEqual(inChat(chat).map((o) => o.text || 'media'), ['Take care, I will tell the others.'], 'no GIF, tag removed');
  chat = CHATS[4];
  t.script.push([tool({ mood: 'happy' })], text('Hope you feel better soon.'));
  await say(chat, 'raju I am sick today, no ride for me');
  assert.equal(media(chat).length, 0);
  assert.match(JSON.stringify(t.claudeReqs.at(-1).messages.at(-1).content), /Not for this topic/);
});

test('two quick celebratory messages → one GIF (one per moment)', async () => {
  const chat = CHATS[5];
  t.script.push(text('Woohoo! 🎉'), [tool({ mood: 'party' })], text('Party time!'));
  await say(chat, 'raju we did it, yay!');
  await say(chat, 'raju congrats everyone 🎉🎉');
  assert.equal(media(chat).length, 1);
  assert.match(JSON.stringify(t.claudeReqs.at(-1).messages.at(-1).content), /a few minutes ago/);
});

test('repeat avoidance: the next GIFs in a chat are ones not sent there lately', async () => {
  const chat = CHATS[6]; const real = Date.now; let shift = 0;
  Date.now = () => real() + shift;
  count = 3;
  try {
    for (let i = 0; i < 3; i++) {
      t.script.push(text(`Nice ${i}!`));
      await say(chat, `raju congrats ${i}! 🎉`);
      shift += 5 * 60000; // past the few minutes between two
    }
  } finally { Date.now = real; count = 8; }
  const urls = media(chat).map((m) => m.media.url);
  assert.equal(urls.length, 3); assert.equal(new Set(urls).size, 3, 'three different GIFs');
});

test('names never reach the GIF search: only mood words', async () => {
  const chat = CHATS[7];
  t.db.logMessage({ chat, sender: '41790000003', name: 'Chary Rao', text: 'hello' });
  t.script.push([tool({ mood: 'party for Priya and Chary at 41790000003 priya@x.ch' })], text('Party!'));
  await say(chat, 'raju happy birthday Chary! 🎂');
  const q = queries.at(-1);
  for (const w of ['priya', 'chary', 'rao', 'raju', '4179']) assert.ok(!q.toLowerCase().includes(w), `${w} not in "${q}"`);
  assert.equal(q, 'party telugu movie');
});

test('"sometimes" only on strong moments; "off" never (no tool, no note, tags ignored)', async () => {
  await t.api(owner, 'PUT', '/api/agents/raju', { reactions: { gifs: { mode: 'sometimes', style: 'telugu movie' } } });
  let chat = CHATS[8];
  t.script.push(text('Haha!'));
  await say(chat, 'raju lol that joke'); // light moment: no GIF
  assert.equal(media(chat).length, 0);
  t.script.push(text('Party!'));
  await say(chat, 'raju happy birthday everyone!'); // strong: one
  assert.equal(media(chat).length, 1);
  await t.api(owner, 'PUT', '/api/agents/raju', { reactions: { gifs: { mode: 'off' } } });
  chat = CHATS[9]; const n = t.claudeReqs.length;
  t.script.push(text('Congrats! [reaction: party]'));
  await say(chat, 'raju congrats on the promotion!! 🎉');
  assert.ok(!t.toolNames(n).includes('whatsapp__send_reaction'));
  assert.doesNotMatch(String(t.claudeReqs[n].system), /Reactions:/);
  assert.deepEqual(inChat(chat).map((o) => o.text || 'media'), ['Congrats!']);
});

test('any service works the same way: a sticker service marked by its tool metadata, default set in Settings', async () => {
  const r = await t.api(owner, 'PUT', '/api/tool-services/stickies', { url: url(stickerSrv), auth: 'none', defaults: { organizer: [], participant: [] }, reactions: { mode: 'often', style: 'cute cat' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = await t.api(owner, 'GET', '/api/tool-services');
  assert.deepEqual(list.body.find((g) => g.name === 'stickies').reaction, { tool: 'lookup', kind: 'sticker', query: 'query', limit: 'limit' });
  assert.equal(list.body.find((g) => g.name === 'gifs').reaction.kind, 'gif');
  await t.api(owner, 'PUT', '/api/agents/raju', { reactions: { gifs: { mode: 'off' } } }); // the sticker service's default applies
  const mine = await t.api(owner, 'GET', '/api/agents/raju/reactions');
  assert.deepEqual(mine.body.map((x) => [x.service, x.kind, x.own.mode, x.default.mode]), [['gifs', 'gif', 'off', 'off'], ['stickies', 'sticker', 'inherit', 'often']]);
  const chat = CHATS[10];
  t.script.push(text('Welcome aboard!'));
  await say(chat, 'raju welcome Anu to the group');
  const m = media(chat);
  assert.equal(m.length, 1); assert.equal(m[0].media.kind, 'sticker'); assert.match(m[0].media.url, /\.webp$/);
  assert.equal(queries.at(-1), 'welcome cute cat');
});

test('one-time: an agent whose instructions ask for GIFs and that uses the gifs service gets "often"', async () => {
  const { saveAgentRow, getAgentRow } = t.store;
  const base = getAgentRow('raju').config;
  const { reactions, ...old } = base; void reactions;
  saveAgentRow('silk', { ...old, name: 'Silk', chats: [], prompt: 'Use GIFs often for celebrations.' }, 'test');
  saveAgentRow('plain', { ...old, name: 'Plain', chats: [], prompt: 'No moving pictures.' }, 'test');
  await t.agents.loadAgents();
  assert.deepEqual(t.agents.getAgent('silk').reactions, { gifs: { mode: 'often', style: '' } });
  assert.equal(t.agents.getAgent('plain').reactions, undefined);
});
