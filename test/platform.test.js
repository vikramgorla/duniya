// End-to-end: fake MCP server + scripted fake Claude API + fake WhatsApp channel + real panel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mcpCalls = [];
const claudeReqs = [];
let script = [];
let mcpHttp, claudeHttp, panel;
let core = {};

function fakeMcp() {
  const s = new Server({ name: 'fake', version: '1' }, { capabilities: { tools: {} } });
  const t = (name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ['whoami', 'agenda_list', 'registrations_list', 'room_assign_preview', 'confirm'].map(t) }));
  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    mcpCalls.push(req.params);
    const n = req.params.name;
    const text = n === 'agenda_list' ? '[{"title":"Puja 10:00"}]'
      : n === 'room_assign_preview' ? JSON.stringify({ preview: 'Rao -> Room 4', confirm_id: 'cf_SECRET123' })
        : n === 'confirm' ? 'Applied' : 'ok';
    return { content: [{ type: 'text', text }] };
  });
  return s;
}

// Fake WhatsApp channel
const sent = [];
const channel = {
  id: 'whatsapp',
  send: async (chat, text) => { sent.push({ chat, text }); },
  typing: async () => {},
  listChats: async () => [{ id: 'g1@g.us', name: 'Panduga families', size: 12 }, { id: 'g2@g.us', name: 'Carpool', size: 6 }],
  isMember: async (chat, phone) => chat === 'g1@g.us' && phone === '41790000002',
  status: async () => ({ status: 'open', me: '41790000099:1@s.whatsapp.net', since: Date.now() }),
};
const msg = (o) => ({ channel: 'whatsapp', raw: {}, isGroup: true, chat: 'g1@g.us', phone: '41790000002', senderJid: 'x', senderName: 'Anu', mentioned: false, replyToBot: false, ...o });
const toolNames = (i) => claudeReqs[i].tools.map((t) => t.name).sort();

before(async () => {
  mcpHttp = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await fakeMcp().connect(tr);
    await tr.handleRequest(req, res, d ? JSON.parse(d) : undefined);
  }).listen(0);
  claudeHttp = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    claudeReqs.push(JSON.parse(d));
    const content = script.shift() || [{ type: 'text', text: '(script empty)' }];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'f', usage: { input_tokens: 3, output_tokens: 2 },
      stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', content }));
  }).listen(0);

  const tmp = mkdtempSync(join(tmpdir(), 'duniya-'));
  const bots = join(tmp, 'bots');
  cpSync(resolve(import.meta.dirname, '../bots/panduga'), join(bots, 'panduga'), { recursive: true });
  mkdirSync(join(bots, 'helper'));
  writeFileSync(join(bots, 'helper', 'bot.json'), JSON.stringify({ name: 'Helper', triggers: ['!help'], dm: 'organizers' }));
  cpSync(resolve(import.meta.dirname, '../bots/_template/index.js'), join(bots, 'helper', 'index.js'));
  mkdirSync(join(tmp, 'data', 'bots'), { recursive: true });
  writeFileSync(join(tmp, 'data', 'bots', 'panduga.json'), JSON.stringify({ chats: ['g1@g.us'], organizers: ['+41 79 000 00 01'] }));
  writeFileSync(join(tmp, 'data', 'bots', 'helper.json'), JSON.stringify({ chats: ['g2@g.us'], organizers: ['41790000001'] }));
  writeFileSync(join(tmp, 'data', 'secrets.json'), JSON.stringify({
    ANTHROPIC_API_KEY: 'test', PANDUGA_MCP_URL: `http://127.0.0.1:${mcpHttp.address().port}/mcp`, PANDUGA_TOKEN_ORGANIZER: 'org',
  }));

  Object.assign(process.env, {
    DATA_DIR: join(tmp, 'data'), BOTS_DIR: bots, ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudeHttp.address().port}`,
    ADMIN_PASSWORD: 'correct horse battery', PANEL_PORT: '0',
  });
  core.bots = await import('../src/core/bots.js');
  core.router = await import('../src/core/router.js');
  core.agent = await import('../src/core/agent.js');
  core.config = await import('../src/core/config.js');
  await core.bots.loadBots();
  core.route = core.router.createRouter(channel);
  panel = (await import('../src/panel/server.js')).startPanel({ channel });
  await new Promise((r) => panel.listening ? r() : panel.once('listening', r));
});

after(() => { mcpHttp.close(); claudeHttp.close(); panel.close(); setTimeout(() => process.exit(0), 50); });

test('loads bots from folders, ignores _template', () => {
  assert.deepEqual(core.bots.listBots().map((b) => b.id).sort(), ['helper', 'panduga']);
});

test('group message without trigger is logged but not answered', async () => {
  sent.length = 0; claudeReqs.length = 0;
  await core.route(msg({ text: 'see you all tomorrow' }));
  assert.equal(sent.length, 0);
  assert.equal(claudeReqs.length, 0);
});

test('participant asks via trigger: read-only tools, reply posted to the group', async () => {
  sent.length = 0; claudeReqs.length = 0;
  script = [[{ type: 'tool_use', id: 't1', name: 'panduga__agenda_list', input: {} }], [{ type: 'text', text: 'Puja is at 10:00.' }]];
  await core.route(msg({ text: '!panduga when is puja?' }));
  assert.deepEqual(sent, [{ chat: 'g1@g.us', text: 'Puja is at 10:00.' }]);
  assert.ok(toolNames(0).includes('panduga__agenda_list'));
  assert.ok(!toolNames(0).some((n) => /preview|confirm|registrations/.test(n)), 'no write/private tools for participants');
  assert.match(claudeReqs[0].messages[0].content, /when is puja\?$/);
});

test('participant cannot run a write tool even if the model asks', async () => {
  mcpCalls.length = 0;
  script = [[{ type: 'tool_use', id: 't2', name: 'panduga__room_assign_preview', input: {} }], [{ type: 'text', text: 'Ask an organizer.' }]];
  await core.route(msg({ text: '!panduga move me to room 4' }));
  assert.equal(mcpCalls.filter((c) => c.name === 'room_assign_preview').length, 0);
});

test('organizer change is held until "confirm CODE"; participants cannot confirm', async () => {
  sent.length = 0; mcpCalls.length = 0; claudeReqs.length = 0;
  script = [[{ type: 'tool_use', id: 't3', name: 'panduga__room_assign_preview', input: { family: 'Rao' } }], [{ type: 'text', text: 'Preview: Rao -> Room 4.' }]];
  await core.route(msg({ phone: '41790000001', senderName: 'Vik', mentioned: true, text: '@41790000099 put Rao in room 4' }));
  assert.ok(!toolNames(0).includes('panduga__confirm'), 'confirm tool hidden from model');
  assert.ok(!JSON.stringify(claudeReqs[1].messages.at(-1)).includes('cf_SECRET123'), 'confirm id hidden from model');
  const code = sent[0].text.match(/confirm ([A-Z0-9]{4})/)[1];

  await core.route(msg({ text: `confirm ${code}` }));
  assert.equal(sent.at(-1).text, 'Only organizers can confirm or cancel changes.');
  assert.equal(mcpCalls.filter((c) => c.name === 'confirm').length, 0);

  await core.route(msg({ phone: '41790000001', text: `confirm ${code}` }));
  const confirms = mcpCalls.filter((c) => c.name === 'confirm');
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].arguments.confirm_id, 'cf_SECRET123');
  assert.match(sent.at(-1).text, /^Done/);
});

test('"no idea" style replies are not treated as commands', async () => {
  sent.length = 0;
  await core.route(msg({ text: 'cancel ABCD' }));
  await core.route(msg({ text: 'no idea' }));
  assert.equal(sent.length, 0);
});

test('hook-based bot: local tool + onMessage shortcut', async () => {
  sent.length = 0; claudeReqs.length = 0;
  await core.route(msg({ chat: 'g2@g.us', phone: '41790000001', text: '!ping', mentioned: true }));
  assert.equal(sent.at(-1).text, 'pong');
  assert.equal(claudeReqs.length, 0);
  script = [[{ type: 'tool_use', id: 't4', name: 'local__roll_dice', input: { sides: 6 } }], [{ type: 'text', text: 'You rolled it.' }]];
  await core.route(msg({ chat: 'g2@g.us', phone: '41790000003', text: '!help roll a die' }));
  assert.ok(toolNames(0).includes('local__roll_dice'));
  const toolResult = JSON.stringify(claudeReqs[1].messages.at(-1));
  assert.match(toolResult, /result/);
});

test('DM routing: group member reaches panduga; strangers get nothing', async () => {
  sent.length = 0;
  script = [[{ type: 'text', text: 'Hi Anu!' }]];
  await core.route(msg({ isGroup: false, chat: '41790000002@s.whatsapp.net', text: 'hello' }));
  assert.equal(sent.at(-1).text, 'Hi Anu!');
  const before = sent.length;
  await core.route(msg({ isGroup: false, chat: '41799999999@s.whatsapp.net', phone: '41799999999', text: 'hello' }));
  assert.equal(sent.length, before);
});

test('paused stops everything', async () => {
  sent.length = 0;
  core.config.updateSettings({ paused: true });
  await core.route(msg({ text: '!panduga hi' }));
  assert.equal(sent.length, 0);
  core.config.updateSettings({ paused: false });
});

test('panel: auth required, login works, bot settings editable, secrets never returned', async () => {
  const base = `http://127.0.0.1:${panel.address().port}`;
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  assert.equal((await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"nope"}' })).status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse battery' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const get = (p) => fetch(base + p, { headers: { cookie } }).then((r) => r.json());
  const status = await get('/api/status');
  assert.equal(status.channel.status, 'open');
  // CSRF guard: non-JSON POST rejected
  assert.equal((await fetch(`${base}/api/settings`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'paused=1' })).status, 415);
  const put = await fetch(`${base}/api/bots/panduga`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ triggers: ['!pd'], organizers: ['+41 79 000 00 01', '+91 98450 00000'] }) });
  const updated = await put.json();
  assert.deepEqual(updated.triggers, ['!pd']);
  assert.deepEqual(updated.organizers, ['41790000001', '919845000000']);
  const bad = await fetch(`${base}/api/bots/panduga`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ mcpServers: {} }) });
  assert.equal(bad.status, 400, 'MCP config is not editable from the panel');
  const secrets = await get('/api/secrets');
  assert.ok(secrets.find((s) => s.name === 'PANDUGA_TOKEN_MEMBER' && s.usedByBots && !s.set));
  assert.ok(!JSON.stringify(secrets).includes('org'), 'secret values are never returned');
  const chats = await get('/api/chats');
  assert.equal(chats.find((c) => c.id === 'g1@g.us').bot, 'panduga');
  const acts = await get('/api/activity?limit=500');
  assert.ok(acts.some((a) => a.type === 'confirm.applied'));
  assert.ok(acts.some((a) => a.type === 'tool.call' && a.summary.startsWith('panduga:agenda_list')));
  const html = await fetch(base + '/').then((r) => r.text());
  assert.match(html, /Duniya/);
});
