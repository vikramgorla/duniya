// Shared e2e harness: fake MCP server, scripted fake Claude API, fake WhatsApp channel, real core + panel.
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function setup({ bindings = {}, env = {} } = {}) {
  const t = {
    mcpCalls: [], claudeReqs: [], summaryReqs: [], script: [], sent: [],
    summaryText: 'Decisions: take the 9:10 train. Rao family arrives Saturday.', summaryFail: false,
  };

  const fakeMcp = () => {
    const s = new Server({ name: 'fake', version: '1' }, { capabilities: { tools: {} } });
    const tool = (name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ['whoami', 'agenda_list', 'registrations_list', 'room_assign_preview', 'confirm'].map(tool) }));
    s.setRequestHandler(CallToolRequestSchema, async (req) => {
      t.mcpCalls.push(req.params);
      const n = req.params.name;
      const text = n === 'agenda_list' ? '[{"title":"Puja 10:00"}]'
        : n === 'room_assign_preview' ? JSON.stringify({ preview: 'Rao -> Room 4', confirm_id: 'cf_SECRET123' })
          : n === 'confirm' ? 'Applied' : 'ok';
      return { content: [{ type: 'text', text }] };
    });
    return s;
  };

  t.mcpHttp = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await fakeMcp().connect(tr);
    await tr.handleRequest(req, res, d ? JSON.parse(d) : undefined);
  }).listen(0);

  t.claudeHttp = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const body = JSON.parse(d);
    const isSummary = String(body.system || '').startsWith('You maintain the running memory');
    if (isSummary) {
      t.summaryReqs.push(body);
      if (t.summaryFail) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"type":"error","error":{"type":"api_error","message":"boom"}}'); return; }
    } else {
      t.claudeReqs.push(body);
    }
    const content = isSummary ? [{ type: 'text', text: t.summaryText }] : (t.script.shift() || [{ type: 'text', text: '(script empty)' }]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'f', usage: { input_tokens: 3, output_tokens: 2 },
      stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', content }));
  }).listen(0);

  let seq = 0;
  t.channel = {
    id: 'whatsapp',
    send: async (chat, text) => { t.sent.push({ chat, text }); return { msgId: `out-${++seq}` }; },
    typing: async () => {},
    chatName: async (chat) => (chat === 'g1@g.us' ? 'Panduga families' : ''),
    listChats: async () => [{ id: 'g1@g.us', name: 'Panduga families', size: 12 }, { id: 'g2@g.us', name: 'Carpool', size: 6 }],
    isMember: async (chat, phone) => chat === 'g1@g.us' && phone === '41790000002',
    status: async () => ({ status: 'open', me: '41790000099:1@s.whatsapp.net', since: Date.now() }),
  };
  t.msg = (o) => ({
    channel: 'whatsapp', raw: {}, isGroup: true, chat: 'g1@g.us', phone: '41790000002', senderJid: 'x', senderName: 'Anu',
    mentioned: false, replyToBot: false, quoted: '', msgId: `in-${++seq}`, ts: Date.now(), ...o,
  });

  const tmp = mkdtempSync(join(tmpdir(), 'duniya-'));
  const bots = join(tmp, 'bots');
  cpSync(resolve(import.meta.dirname, '../bots/panduga'), join(bots, 'panduga'), { recursive: true });
  mkdirSync(join(bots, 'helper'));
  writeFileSync(join(bots, 'helper', 'bot.json'), JSON.stringify({ name: 'Helper', triggers: ['!help'], dm: 'organizers' }));
  cpSync(resolve(import.meta.dirname, '../bots/_template/index.js'), join(bots, 'helper', 'index.js'));
  mkdirSync(join(tmp, 'data', 'bots'), { recursive: true });
  writeFileSync(join(tmp, 'data', 'bots', 'panduga.json'), JSON.stringify({ chats: ['g1@g.us'], organizers: ['+41 79 000 00 01'], ...(bindings.panduga || {}) }));
  writeFileSync(join(tmp, 'data', 'bots', 'helper.json'), JSON.stringify({ chats: ['g2@g.us'], organizers: ['41790000001'], ...(bindings.helper || {}) }));
  writeFileSync(join(tmp, 'data', 'secrets.json'), JSON.stringify({
    ANTHROPIC_API_KEY: 'test', PANDUGA_MCP_URL: `http://127.0.0.1:${t.mcpHttp.address().port}/mcp`, PANDUGA_TOKEN_ORGANIZER: 'org',
  }));

  Object.assign(process.env, {
    DATA_DIR: join(tmp, 'data'), BOTS_DIR: bots, ANTHROPIC_BASE_URL: `http://127.0.0.1:${t.claudeHttp.address().port}`,
    ADMIN_PASSWORD: 'correct horse battery', PANEL_PORT: '0', ...env,
  });
  t.bots = await import('../src/core/bots.js');
  t.router = await import('../src/core/router.js');
  t.agent = await import('../src/core/agent.js');
  t.config = await import('../src/core/config.js');
  t.memory = await import('../src/core/memory.js');
  t.db = await import('../src/core/db.js');
  await t.bots.loadBots();
  t.route = t.router.createRouter(t.channel);
  t.onHistory = t.router.createHistoryHandler();
  t.panel = (await import('../src/panel/server.js')).startPanel({ channel: t.channel });
  await new Promise((r) => (t.panel.listening ? r() : t.panel.once('listening', r)));
  t.base = `http://127.0.0.1:${t.panel.address().port}`;
  t.toolNames = (i) => t.claudeReqs[i].tools.map((x) => x.name).sort();
  t.userTurn = (i) => t.claudeReqs[i].messages[0].content;
  t.login = async () => {
    const r = await fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse battery' }) });
    return r.headers.get('set-cookie').split(';')[0];
  };
  t.waitFor = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error('waitFor timed out');
  };
  t.close = () => { t.mcpHttp.close(); t.claudeHttp.close(); t.panel.close(); setTimeout(() => process.exit(0), 50); };
  return t;
}
