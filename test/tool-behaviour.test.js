// 094: how an agent uses each tool service — when, changes, share on its own, limits — a service's default overridable
// per agent, nothing known by name: risk comes from the tools' annotations, sharing from a read-only tool that returns
// media. Fake services only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setup } from './harness.js';

let t; let owner;
const queries = []; // what the fake media service was asked
const order = []; // texts and media as they reached the chat
let count = 8;
const results = () => Array.from({ length: count }, (_, i) => ({ id: `c${i}`, title: `Clip ${i}`, url: `https://media.example/${i}.gif`,
  mp4Url: `https://media.example/${i}.mp4`, previewUrl: `https://media.example/${i}-small.gif`, attribution: `"Clip ${i}" · Powered by ExampleClips` }));
const OUT = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, url: { type: 'string' }, mp4Url: { type: 'string' }, previewUrl: { type: 'string' } } } } } };
const QUERY = { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] };

/** A fake service: `tools` are MCP tool definitions; every call returns media results (structured) and is recorded. */
function fakeService(tools) {
  return http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const s = new Server({ name: 'fake', version: '1' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    s.setRequestHandler(CallToolRequestSchema, async (r) => {
      queries.push(r.params.arguments.query);
      return { content: [{ type: 'text', text: `Found ${count}` }], structuredContent: { results: results() } };
    });
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(tr);
    await tr.handleRequest(req, res, d ? JSON.parse(d) : undefined);
  }).listen(0);
}
const clips = fakeService([
  { name: 'find', description: 'Find clips', inputSchema: QUERY, outputSchema: OUT, annotations: { readOnlyHint: true } },
  { name: 'save_clip', description: 'Save a clip', inputSchema: QUERY },
  { name: 'drop_clip', description: 'Delete a clip', inputSchema: QUERY, annotations: { destructiveHint: true } },
]);
const drawer = fakeService([{ name: 'draw', description: 'Draws a picture (changes an album)', inputSchema: QUERY, outputSchema: OUT }]);
const url = (srv) => `http://127.0.0.1:${srv.address().port}/mcp`;

const CHATS = Array.from({ length: 16 }, (_, i) => `b${i + 1}@g.us`);
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  for (const c of [...CHATS, '41790000007@s.whatsapp.net']) t.chatPrefs.setChatPrefs(c, { enabled: true });
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/clips', { url: url(clips), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] } })).status, 201);
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Raju', triggers: ['raju'], model: 'anthropic:claude-sonnet-5-5', dm: 'anyone',
    services: { clips: { share: 'often', style: 'telugu movie' } }, tools: { participant: ['whatsapp:-'], organizer: [], deny: [] } } });
  for (const c of CHATS) await t.api(owner, 'POST', '/api/chats/bind', { chat: c, agent: 'raju' });
  const send = t.channel.send; const sendMedia = t.channel.sendMedia;
  t.channel.send = async (chat, text, o) => { order.push({ chat, text }); return send(chat, text, o); };
  t.channel.sendMedia = async (chat, m) => { order.push({ chat, media: m }); return sendMedia(chat, m); };
});
after(() => { clips.close(); drawer.close(); t.close(); });

const inChat = (chat) => order.filter((o) => o.chat === chat);
const media = (chat) => inChat(chat).filter((o) => o.media);
const shape = (chat) => inChat(chat).map((o) => (o.media ? o.media.kind : o.text));
const say = (chat, text, o = {}) => t.route(t.msg({ chat, text, phone: '41790000007', senderName: 'Priya', ...o }));
const share = (input, id = 's1') => ({ type: 'tool_use', id, name: 'whatsapp__share_media', input });
const use = (name, input = {}) => ({ type: 'tool_use', id: `u${Math.random().toString(36).slice(2)}`, name: `clips__${name}`, input });
const text = (s) => [{ type: 'text', text: s }];
const setRaju = (services) => t.api(owner, 'PUT', '/api/agents/raju', { services });

test('the panel sees each tool\'s risk from its annotations and which tool returns media', async () => {
  const list = await t.api(owner, 'GET', '/api/tool-services');
  assert.equal(list.body.find((g) => g.name === 'clips').media, 'gif');
  const mine = await t.api(owner, 'GET', '/api/agents/raju/services');
  const c = mine.body.find((x) => x.service === 'clips');
  assert.deepEqual(c.tools.map((x) => [x.name, x.risk, x.annotated, x.media || '']), [['find', 'read', true, 'gif'], ['save_clip', 'change', false, ''], ['drop_clip', 'destructive', true, '']]);
  assert.deepEqual(c.own, { share: 'often', style: 'telugu movie' });
});

test('a celebration with "often": the text, then exactly one GIF with the tool\'s credit; one call; a participant without send_media too', async () => {
  const chat = CHATS[0]; const n = t.claudeReqs.length;
  t.script.push([share({ mood: 'party dance' })], text('Congrats Chary, mission accomplished! 🎉'));
  await say(chat, 'raju Chary got promoted, congrats!! 🎉');
  const names = t.toolNames(n);
  assert.ok(names.includes('whatsapp__share_media'), 'the one-call action');
  assert.ok(!names.includes('whatsapp__send_media'), 'this participant has no send_media');
  assert.match(String(t.claudeReqs[n].system), /Sharing: you can add one fitting GIF/);
  assert.match(JSON.stringify(t.userTurn(n)), /lighthearted moment: after your text, end with share_media\(\\"celebration\\"\)/);
  assert.deepEqual(shape(chat), ['Congrats Chary, mission accomplished! 🎉', 'gif'], 'text first, then the GIF');
  const m = media(chat)[0].media;
  assert.match(m.url, /\/\d\.mp4$/, 'the MP4, not the preview');
  assert.match(m.caption, /Powered by ExampleClips/, 'the credit text the tool returned');
  assert.equal(queries.at(-1), 'party dance telugu movie', 'mood words + style words');
  const act = t.db.listActivity({ type: 'whatsapp.action' })[0];
  assert.match(act.summary, /Shared a GIF \(party dance\) from clips, chosen by the model/);
});

test('a text-only reply on a clear moment (light tier): code shares one after the text', async () => {
  const chat = CHATS[1];
  await t.api(owner, 'PUT', '/api/agents/raju', { model: 'smart' });
  t.script.push(text('Anytime, squad!'));
  await say(chat, 'thanks raju!');
  await t.api(owner, 'PUT', '/api/agents/raju', { model: 'anthropic:claude-sonnet-5-5' });
  assert.equal(t.db.listActivity({ type: 'model.usage' })[0].detail.tier, 'light');
  assert.deepEqual(shape(chat), ['Anytime, squad!', 'gif']);
  assert.equal(queries.at(-1), 'thank you telugu movie');
});

test('a [share: …] tag is never shown; serious topics get none, even when asked', async () => {
  let chat = CHATS[2];
  t.script.push(text('Ha, classic! [share: mind blown]'));
  await say(chat, 'raju that was hilarious');
  assert.deepEqual(shape(chat), ['Ha, classic!', 'gif']);
  chat = CHATS[3]; const n = t.claudeReqs.length;
  t.script.push(text('Take care, I will tell the others. [share: hug]'));
  await say(chat, 'raju sorry, accident on the highway, I will be late');
  assert.doesNotMatch(JSON.stringify(t.userTurn(n)), /lighthearted moment/);
  assert.deepEqual(shape(chat), ['Take care, I will tell the others.']);
  chat = CHATS[4];
  t.script.push([share({ mood: 'happy' })], text('Hope you feel better soon.'));
  await say(chat, 'raju I am sick today, no ride for me');
  assert.equal(media(chat).length, 0);
  assert.match(JSON.stringify(t.claudeReqs.at(-1).messages.at(-1).content), /Not for this topic/);
});

test('two quick celebratory messages → one GIF; repeats avoided; names never searched', async () => {
  let chat = CHATS[5];
  t.script.push(text('Woohoo! 🎉'), [share({ mood: 'party' })], text('Party time!'));
  await say(chat, 'raju we did it, yay!');
  await say(chat, 'raju congrats everyone 🎉🎉');
  assert.equal(media(chat).length, 1);
  assert.match(JSON.stringify(t.claudeReqs.at(-1).messages.at(-1).content), /a few minutes ago/);
  chat = CHATS[6]; const real = Date.now; let shift = 0; count = 3;
  Date.now = () => real() + shift;
  try {
    for (let i = 0; i < 3; i++) { t.script.push(text(`Nice ${i}!`)); await say(chat, `raju congrats ${i}! 🎉`); shift += 5 * 60000; }
  } finally { Date.now = real; count = 8; }
  assert.equal(new Set(media(chat).map((m) => m.media.url)).size, 3, 'three different GIFs');
  chat = CHATS[7];
  t.db.logMessage({ chat, sender: '41790000003', name: 'Chary Rao', text: 'hello' });
  t.script.push([share({ mood: 'party for Priya and Chary at 41790000003 priya@x.ch' })], text('Party!'));
  await say(chat, 'raju happy birthday Chary! 🎂');
  assert.equal(queries.at(-1), 'party telugu movie');
});

test('"sometimes" only on strong moments; "off" never; not offered for a tool that is not read-only', async () => {
  await setRaju({ clips: { share: 'sometimes', style: 'telugu movie' } });
  let chat = CHATS[8];
  t.script.push(text('Haha!'));
  await say(chat, 'raju lol that joke');
  assert.equal(media(chat).length, 0);
  t.script.push(text('Party!'));
  await say(chat, 'raju happy birthday everyone!');
  assert.equal(media(chat).length, 1);
  await setRaju({ clips: { share: 'off' } });
  chat = CHATS[9]; let n = t.claudeReqs.length;
  t.script.push(text('Congrats! [share: party]'));
  await say(chat, 'raju congrats on the promotion!! 🎉');
  assert.ok(!t.toolNames(n).includes('whatsapp__share_media'));
  assert.doesNotMatch(String(t.claudeReqs[n].system), /Sharing:/);
  assert.deepEqual(shape(chat), ['Congrats!']);
  // a service whose media tool changes something (no readOnlyHint): never shared on its own
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/drawer', { url: url(drawer), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] }, behaviour: { share: 'often' } })).status, 201);
  chat = CHATS[10]; n = t.claudeReqs.length;
  t.script.push(text('Congrats!'));
  await say(chat, 'raju congrats!! 🎉');
  assert.ok(!t.toolNames(n).includes('whatsapp__share_media'));
  assert.equal(media(chat).length, 0);
  assert.equal((await t.api(owner, 'GET', '/api/tool-services')).body.find((g) => g.name === 'drawer').media, '');
  await t.api(owner, 'DELETE', '/api/tool-services/drawer');
});

test('when to use it and changes that differ: one compact line per service in the instructions', async () => {
  await t.api(owner, 'PUT', '/api/tool-services/clips', { url: url(clips), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] }, behaviour: { when: 'asked', note: 'Only for the group, never in direct chats about work.' } });
  await setRaju({ clips: { changes: 'ask' } });
  const n = t.claudeReqs.length;
  t.script.push(text('Hi!'));
  await say(CHATS[11], 'raju hi');
  const sys = String(t.claudeReqs[n].system);
  assert.match(sys, /How to use your tool services:\n- clips: only when someone asks for that kind of thing; changes: show each change and wait for a yes; Only for the group, never in direct chats about work\./);
  const r = await t.api(owner, 'PUT', '/api/agents/raju', { services: { clips: { when: 'sometimes' } } });
  assert.equal(r.status, 400);
});

test('risk from annotations: read, change (also when nothing is declared), destructive, a delete-like input, the owner\'s override (validated)', async () => {
  // how it plays out in a conversation (a change applied on a clear request, a destructive one waiting) is in autonomy.test.js
  const { riskOf } = await import('../src/core/autonomy.js');
  assert.equal(riskOf({ readOnlyHint: true }), 'read');
  assert.equal(riskOf({}), 'change', 'no annotations: a change');
  assert.equal(riskOf({ destructiveHint: true }), 'destructive');
  assert.equal(riskOf({ readOnlyHint: false }, { op: 'delete' }), 'destructive', 'an input that asks for a delete');
  assert.equal(riskOf({ destructiveHint: true }, {}, 'change'), 'change', 'the owner\'s override wins');
  await setRaju({ clips: { tools: { drop_clip: 'change' } } });
  const c = (await t.api(owner, 'GET', '/api/agents/raju/services')).body.find((x) => x.service === 'clips');
  assert.deepEqual(c.own, { tools: { drop_clip: 'change' } });
  assert.equal((await t.api(owner, 'PUT', '/api/agents/raju', { services: { clips: { tools: { drop_clip: 'risky' } } } })).status, 400);
});

test('limits: per reply, per day and direct messages only, enforced in code with an Activity line', async () => {
  await t.api(owner, 'PUT', '/api/tool-services/clips', { url: url(clips), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] } });
  await setRaju({ clips: { perReply: 1 } });
  const calls = queries.length;
  t.script.push([use('find', { query: 'a' }), use('find', { query: 'b' })], text('Here.'));
  await say(CHATS[12], 'raju find two clips');
  assert.equal(queries.length - calls, 1, 'the second use in the reply was stopped');
  assert.match(JSON.stringify(t.claudeReqs.at(-1).messages.at(-1).content), /Not used: clips has a limit \(at most 1 per reply\)/);
  assert.match(t.db.listActivity({ type: 'limit' })[0].summary, /Limit: clips was not used \(at most 1 per reply\)/);
  await setRaju({ clips: { perDay: 1 } });
  t.script.push([use('find', { query: 'c' })], text('One.'), [use('find', { query: 'd' })], text('Two.'));
  await say(CHATS[12], 'raju one clip');
  await say(CHATS[12], 'raju another clip');
  assert.match(t.db.listActivity({ type: 'limit' })[0].summary, /at most 1 per day/);
  await setRaju({ clips: { where: 'dm' } });
  t.script.push([use('find', { query: 'e' })], text('Only in direct messages.'));
  await say(CHATS[13], 'raju a clip please');
  assert.match(t.db.listActivity({ type: 'limit' })[0].summary, /only be posted in direct messages/);
  const before = queries.length;
  t.script.push([use('find', { query: 'f' })], text('Here you go.'));
  await say('41790000007@s.whatsapp.net', 'a clip please', { isGroup: false });
  assert.equal(queries.length, before + 1, 'allowed in a direct message');
  await setRaju({ clips: { share: 'often', style: 'telugu movie' } });
});

test('admin MCP: get and set how a service is used, per agent and as the default', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const x = { call: async (m, p, b) => { const r = await t.api(owner, m, p, b); if (r.status >= 400) throw new Error(JSON.stringify(r.body)); return r.body; } };
  const set = TOOLS.find((y) => y.name === 'set_tool_behaviour'); const get = TOOLS.find((y) => y.name === 'get_tool_behaviour');
  assert.deepEqual((await set.run({ agent_id: 'raju', service: 'clips', when: 'proactive', per_reply: 2 }, x)).settings, { share: 'often', style: 'telugu movie', when: 'proactive', perReply: 2 });
  assert.deepEqual((await set.run({ agent_id: 'raju', service: 'clips', when: 'inherit' }, x)).settings, { share: 'often', style: 'telugu movie', perReply: 2 });
  assert.deepEqual((await set.run({ service: 'clips', share: 'sometimes', style: 'cats' }, x)).default, { share: 'sometimes', style: 'cats' });
  const all = await get.run({}, x);
  assert.deepEqual(all.find((s) => s.service === 'clips').default, { share: 'sometimes', style: 'cats' });
  assert.equal((await get.run({ agent_id: 'raju' }, x)).find((s) => s.service === 'clips').media, 'gif');
});

test('one-time: an agent whose instructions ask for GIFs and that can use a media service shares on its own', async () => {
  const { saveAgentRow, getAgentRow } = t.store;
  const { services, ...old } = getAgentRow('raju').config; void services;
  saveAgentRow('silk', { ...old, name: 'Silk', chats: [], prompt: 'Use Telugu or Tamil cinema reactions as GIFs often when people celebrate.' }, 'test');
  saveAgentRow('plain', { ...old, name: 'Plain', chats: [], prompt: 'No moving pictures.' }, 'test');
  await t.agents.loadAgents();
  assert.deepEqual(t.agents.getAgent('silk').services, { clips: { when: 'proactive', share: 'often', style: 'Telugu or Tamil cinema reactions' } });
  assert.equal(t.agents.getAgent('plain').services, undefined);
});
