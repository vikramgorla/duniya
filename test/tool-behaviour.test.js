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

const CHATS = Array.from({ length: 21 }, (_, i) => `b${i + 1}@g.us`);
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  for (const c of [...CHATS, '41790000007@s.whatsapp.net']) t.chatPrefs.setChatPrefs(c, { enabled: true });
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/clips', { url: url(clips), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] } })).status, 201);
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Raju', triggers: ['raju'], model: 'anthropic:claude-sonnet-5-5', dm: 'anyone',
    services: { clips: { when: 'often', style: 'telugu movie' } }, tools: { participant: ['whatsapp:-'], organizer: [], deny: [] } } });
  for (const c of CHATS) await t.api(owner, 'POST', '/api/chats/bind', { chat: c, agent: 'raju' });
  const send = t.channel.send; const sendMedia = t.channel.sendMedia;
  t.channel.send = async (chat, text, o) => { order.push({ chat, text }); return send(chat, text, o); };
  t.channel.sendMedia = async (chat, m) => { order.push({ chat, media: m }); return sendMedia(chat, m); };
});
after(() => { clips.close(); drawer.close(); t.close(); });

const inChat = (chat) => order.filter((o) => o.chat === chat);
const media = (chat) => inChat(chat).filter((o) => o.media);
// a short answer goes as the GIF's caption (one message, nothing else in it): "text + gif"
const withText = (m) => (m.caption ? `${m.caption} + ${m.kind}` : m.kind);
const shape = (chat) => inChat(chat).map((o) => (o.media ? withText(o.media) : o.text));
const say = (chat, text, o = {}) => t.route(t.msg({ chat, text, phone: '41790000007', senderName: 'Priya', ...o }));
const use = (name, input = {}) => ({ type: 'tool_use', id: `u${Math.random().toString(36).slice(2)}`, name: `clips__${name}`, input });
const text = (s) => [{ type: 'text', text: s }];
const setRaju = (services) => t.api(owner, 'PUT', '/api/agents/raju', { services });

test('the panel sees each tool\'s risk from its annotations and which tool returns media', async () => {
  assert.equal((await t.api(owner, 'GET', '/api/tool-services/media')).body.clips, 'gif');
  const mine = await t.api(owner, 'GET', '/api/agents/raju/services');
  const c = mine.body.find((x) => x.service === 'clips');
  assert.deepEqual(c.tools.map((x) => [x.name, x.risk, x.annotated, x.media || '']), [['find', 'read', true, 'gif'], ['save_clip', 'change', false, ''], ['drop_clip', 'destructive', true, '']]);
  assert.deepEqual(c.own, { when: 'often', style: 'telugu movie' });
});

test('the AI picks the mood with a tag it must give every turn: one message, the GIF with the answer and the credit; no tool needed', async () => {
  const chat = CHATS[0]; const n = t.claudeReqs.length;
  t.script.push(text('Congrats Chary, mission accomplished! 🎉\n[share: party dance]'));
  await say(chat, 'raju Chary got promoted, congrats!! 🎉');
  const names = t.toolNames(n);
  assert.ok(!names.some((x) => /share_media|send_media/.test(x)), 'no tool: the tag is the choice');
  assert.match(String(t.claudeReqs[n].system), /end every answer with one tag on its own line — \[share: /);
  assert.match(JSON.stringify(t.userTurn(n)), /End with \[share: mood\] or \[share: none\]/);
  assert.deepEqual(shape(chat), ['Congrats Chary, mission accomplished! 🎉 + gif'], 'one message: the GIF, the answer as its caption');
  const m = media(chat)[0].media;
  assert.match(m.url, /\/\d\.mp4$/, 'the MP4, not the preview');
  assert.doesNotMatch(m.caption, /Powered by|Clip \d|https?:/, 'no credit, title or link in the message');
  assert.deepEqual((await t.api(owner, 'GET', '/api/credits')).body, [{ service: 'clips', credit: 'Powered by ExampleClips' }], 'the credit all results share, for the panel');
  assert.equal((await t.api(owner, 'GET', '/api/tool-services')).body.find((g) => g.name === 'clips').credit, 'Powered by ExampleClips');
  assert.equal(queries.at(-1), 'party dance telugu movie', 'mood words + style words');
  const act = t.db.listActivity({ type: 'whatsapp.action' })[0];
  assert.match(act.summary, /Shared a GIF \(party dance\) from clips, chosen by the model/);
});

test('sharing on its own works for participants who have no tools of the service (a Registry add)', async () => {
  await t.api(owner, 'PUT', '/api/tool-services/clips', { url: url(clips), auth: 'none', defaults: { organizer: ['*'], participant: [] } });
  const chat = CHATS[15]; const n = t.claudeReqs.length;
  t.script.push(text('Yay! [share: cheer]'));
  await say(chat, 'raju we won the match!! 🎉');
  const names = t.toolNames(n);
  assert.match(String(t.claudeReqs[n].system), /\[share: /, 'the owner chose sharing: every sender');
  assert.ok(!names.some((x) => x.startsWith('clips__')), 'none of the service\'s own tools for this role');
  assert.deepEqual(shape(chat), ['Yay! + gif']);
  await t.api(owner, 'PUT', '/api/tool-services/clips', { url: url(clips), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] } });
});

test('a long answer goes first, the GIF right after it with no caption; stored as two messages', async () => {
  const chat = CHATS[12];
  const long = `Congratulations! ${'What a day for everyone here, '.repeat(20)}`.trim();
  t.script.push(text(`${long} [share: party]`));
  await say(chat, 'raju we launched!! 🎉');
  assert.deepEqual(shape(chat), [long, 'gif']);
  assert.equal(media(chat)[0].media.caption, '');
});

test('no tag from the model (a light one): the fallback rules share on a clear moment', async () => {
  const chat = CHATS[1];
  await t.api(owner, 'PUT', '/api/agents/raju', { model: 'smart' });
  t.script.push(text('Anytime, squad!'));
  await say(chat, 'thanks raju!');
  await t.api(owner, 'PUT', '/api/agents/raju', { model: 'anthropic:claude-sonnet-5-5' });
  assert.equal(t.db.listActivity({ type: 'model.usage' })[0].detail.tier, 'light');
  assert.deepEqual(shape(chat), ['Anytime, squad! + gif']);
  assert.equal(queries.at(-1), 'thank you telugu movie');
});

test('a [share: …] tag is never shown; serious topics get none, even when asked', async () => {
  let chat = CHATS[2];
  t.script.push(text('Ha, classic! [share: mind blown]'));
  await say(chat, 'raju that was hilarious');
  assert.deepEqual(shape(chat), ['Ha, classic! + gif']);
  chat = CHATS[3]; const n = t.claudeReqs.length;
  t.script.push(text('Take care, I will tell the others. [share: hug]'));
  await say(chat, 'raju sorry, accident on the highway, I will be late');
  assert.doesNotMatch(JSON.stringify(t.userTurn(n)), /End with \[share/, 'no reminder on a serious topic');
  assert.deepEqual(shape(chat), ['Take care, I will tell the others.'], 'code vetoes the model on a serious topic');
  chat = CHATS[4];
  t.script.push(text('Hope you feel better soon. [share: happy]'));
  await say(chat, 'raju I am sick today, no ride for me');
  assert.equal(media(chat).length, 0);
});

test('two quick celebratory messages → one GIF; repeats avoided; names never searched', async () => {
  let chat = CHATS[5];
  t.script.push(text('Woohoo! 🎉 [share: celebration]'), text('Party time! [share: party]'));
  await say(chat, 'raju we did it, yay!');
  await say(chat, 'raju congrats everyone 🎉🎉');
  assert.equal(media(chat).length, 1, 'none shortly after another, whatever the model asks');
  chat = CHATS[6]; const real = Date.now; let shift = 0; count = 3;
  Date.now = () => real() + shift;
  try {
    for (let i = 0; i < 3; i++) { t.script.push(text(`Nice ${i}!`)); await say(chat, `raju congrats ${i}! 🎉`); shift += 5 * 60000; }
  } finally { Date.now = real; count = 8; }
  assert.equal(new Set(media(chat).map((m) => m.media.url)).size, 3, 'three different GIFs');
  chat = CHATS[7];
  t.db.logMessage({ chat, sender: '41790000003', name: 'Chary Rao', text: 'hello' });
  t.script.push(text('Party! [share: party for Priya and Chary at 41790000003 priya@x.ch]'));
  await say(chat, 'raju happy birthday Chary! 🎂');
  assert.equal(queries.at(-1), 'party telugu movie');
});

test('Proactively shares only on strong moments; When useful never; not offered for a tool that is not read-only', async () => {
  await setRaju({ clips: { when: 'proactive', style: 'telugu movie' } });
  let chat = CHATS[8];
  t.script.push(text('Haha!'));
  await say(chat, 'raju lol that joke');
  assert.equal(media(chat).length, 0);
  t.script.push(text('Party!'));
  await say(chat, 'raju happy birthday everyone!');
  assert.equal(media(chat).length, 1);
  await setRaju({ clips: { when: 'useful' } });
  chat = CHATS[9]; let n = t.claudeReqs.length;
  t.script.push(text('Congrats! [share: party]'));
  await say(chat, 'raju congrats on the promotion!! 🎉');
  assert.doesNotMatch(String(t.claudeReqs[n].system), /Sharing:/);
  assert.deepEqual(shape(chat), ['Congrats!']);
  // a service whose media tool changes something (no readOnlyHint): never shared on its own
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/drawer', { url: url(drawer), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] }, behaviour: { when: 'often' } })).status, 201);
  chat = CHATS[10]; n = t.claudeReqs.length;
  t.script.push(text('Congrats!'));
  await say(chat, 'raju congrats!! 🎉');
  assert.doesNotMatch(String(t.claudeReqs[n].system), /Sharing:/);
  assert.equal(media(chat).length, 0);
  assert.equal((await t.api(owner, 'GET', '/api/tool-services/media')).body.drawer, '');
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
  await setRaju({ clips: { when: 'often', style: 'telugu movie' } });
});

test('admin MCP: get and set how a service is used, per agent and as the default', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const x = { call: async (m, p, b) => { const r = await t.api(owner, m, p, b); if (r.status >= 400) throw new Error(JSON.stringify(r.body)); return r.body; } };
  const set = TOOLS.find((y) => y.name === 'set_tool_behaviour'); const get = TOOLS.find((y) => y.name === 'get_tool_behaviour');
  assert.deepEqual((await set.run({ agent_id: 'raju', service: 'clips', when: 'proactive', per_reply: 2 }, x)).settings, { when: 'proactive', style: 'telugu movie', perReply: 2 });
  assert.deepEqual((await set.run({ agent_id: 'raju', service: 'clips', when: 'inherit' }, x)).settings, { style: 'telugu movie', perReply: 2 });
  assert.deepEqual((await set.run({ service: 'clips', when: 'often', style: 'cats' }, x)).default, { when: 'often', style: 'cats' });
  const all = await get.run({}, x);
  assert.deepEqual(all.find((s) => s.service === 'clips').default, { when: 'often', style: 'cats' });
  assert.equal((await get.run({ agent_id: 'raju' }, x)).find((s) => s.service === 'clips').media, 'gif');
});

test('a tool service that never answers holds up a reply at most a few seconds, once (services are asked at once; a failure is remembered)', async () => {
  const stuck = () => http.createServer(() => {}).listen(0); // accepts, never answers
  const a = stuck(); const b = stuck();
  for (const [k, srv] of [['stuck1', a], ['stuck2', b]]) await t.api(owner, 'PUT', `/api/tool-services/${k}`, { url: url(srv), auth: 'none', defaults: { organizer: ['*'], participant: ['*'] } });
  const chat = CHATS[14];
  t.script.push(text('Here.'));
  const t0 = Date.now();
  await say(chat, 'raju are you there?');
  const took = Date.now() - t0;
  assert.ok(took < 12000, `two silent services in parallel, each within its wait (took ${took} ms)`);
  assert.deepEqual(shape(chat).slice(-1), ['Here.']);
  for (const k of ['stuck1', 'stuck2']) await t.api(owner, 'DELETE', `/api/tool-services/${k}`);
  a.closeAllConnections(); b.closeAllConnections(); a.close(); b.close();
});

test('a service that cannot be reached is explained in plain words (502), not as "fetch failed"', async () => {
  const r = await t.api(owner, 'POST', '/api/tool-services/discover', { server: 'nobody', url: 'http://127.0.0.1:9/mcp' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /refused the connection|Could not reach/);
  assert.doesNotMatch(r.body.error, /fetch failed|MCP http/);
});

test('one setting: Proactively shares sometimes, Often often, When useful never (no separate share switch)', async () => {
  const chat = CHATS[13];
  await setRaju({ clips: { when: 'proactive' } });
  let n = t.claudeReqs.length;
  t.script.push(text('Congrats!'));
  await say(chat, 'raju we got the keys!! 🎉');
  assert.match(String(t.claudeReqs[n].system), /Share when one clearly adds warmth/, 'proactive → sometimes');
  await setRaju({ clips: { when: 'useful' } });
  n = t.claudeReqs.length;
  t.script.push(text('Congrats!'));
  await say(chat, 'raju and the car too!! 🎉');
  assert.doesNotMatch(String(t.claudeReqs[n].system), /Sharing:/, 'when useful: nothing shared on its own');
  await setRaju({ clips: { when: 'often', style: 'telugu movie' } });
});

test('one-time: a saved "share" setting becomes When to use it (sometimes → proactive, often → often)', async () => {
  const { saveAgentRow, getAgentRow } = t.store;
  const cfg = getAgentRow('raju').config;
  saveAgentRow('raju', { ...cfg, services: { clips: { share: 'sometimes', style: 'x' } } }, 'test');
  t.agents.loadAgents();
  assert.deepEqual(t.agents.getAgent('raju').services, { clips: { style: 'x', when: 'proactive' } });
  saveAgentRow('raju', { ...cfg, services: { clips: { share: 'often', style: 'telugu movie' } } }, 'test');
  t.agents.loadAgents();
  assert.deepEqual(t.agents.getAgent('raju').services, { clips: { style: 'telugu movie', when: 'often' } });
});

test('festival greetings are celebrations ("happy Diwali", "happy Pongal"); "happy to help" is not', async () => {
  await setRaju({ clips: { when: 'proactive', style: 'telugu movie' } });
  for (const [i, greet] of [['happy Diwali'], ['happy pongal everyone']].entries()) {
    const chat = CHATS[16 + i];
    t.script.push(text('Same to you!'));
    await say(chat, `raju ${greet}`);
    assert.equal(media(chat).length, 1, greet);
  }
  const chat = CHATS[18]; const before = media(chat).length;
  t.script.push(text('Glad to hear.'));
  await say(chat, 'raju happy to help anytime');
  assert.equal(media(chat).length, before, 'not a celebration');
  await setRaju({ clips: { when: 'often', style: 'telugu movie' } });
});

test('the AI decides beyond any word list (good news in any words), and its [share: none] wins over the rules', async () => {
  await setRaju({ clips: { when: 'proactive', style: 'telugu movie' } });
  let chat = CHATS[19]; const before = media(chat).length;
  t.script.push(text('That is wonderful news! [share: proud happy]'));
  await say(chat, 'raju my daughter got into the university she wanted');
  assert.equal(media(chat).length, before + 1, 'no rule word, the AI chose');
  assert.equal(queries.at(-1), 'proud happy telugu movie');
  chat = CHATS[20];
  t.script.push(text('Congrats! [share: none]'));
  await say(chat, 'raju congrats on the new job 🎉');
  assert.equal(media(chat).length, 0, 'the AI said none: no fallback');
  const agent = (await t.api(owner, 'GET', '/api/agents/raju/services')).body.find((x) => x.service === 'clips');
  assert.ok(agent.shared.ai >= 1 && agent.shared.rule >= 1, 'the card counts who picked them');
  await setRaju({ clips: { when: 'often', style: 'telugu movie' } });
});

test('media links and service credits never reach the chat: in the answer, or in a caption the AI writes', async () => {
  const chat = CHATS[11];
  t.script.push([use('find', { query: 'dance' })], text('Here: https://media.example/3.mp4 — Powered by ExampleClips'));
  await say(chat, 'raju find me a dance clip');
  assert.equal(inChat(chat).filter((o) => o.text).at(-1).text, 'Here:', 'the link and the credit are gone');
  const send = { type: 'tool_use', id: 'sm1', name: 'whatsapp__send_media', input: { kind: 'gif', url: 'https://media.example/4.mp4', caption: 'Woo!\n\nPowered by ExampleClips https://media.example/4.mp4' } };
  await t.api(owner, 'PUT', '/api/agents/raju', { tools: { participant: ['whatsapp:send_media'], organizer: [], deny: [] } });
  t.script.push([send], text('Sent.'));
  await say(chat, 'raju send that one');
  assert.equal(media(chat).at(-1).media.caption, 'Woo!');
  await t.api(owner, 'PUT', '/api/agents/raju', { tools: { participant: ['whatsapp:-'], organizer: [], deny: [] } });
});
