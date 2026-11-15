// Shared e2e harness: fake MCP server, scripted fake Claude API, fake WhatsApp channel, real core + panel.
// Failing providers (042): `t.claudeFail` (a queue of failures for the fake Claude API) and `fakeChatProvider()` (an
// OpenAI-compatible endpoint with per-key scripts and failures). A failure is { status, message?, code?, retryAfter? }
// (e.g. 429 with Retry-After, 500, 401, 400, 404 model not found) or { network: true } (connection dropped).
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** Answer a request with a scripted failure (see the header). */
export function sendFailure(req, res, f, style = 'openai') {
  if (f.network) { req.socket.destroy(); return; }
  const headers = { 'content-type': 'application/json', ...(f.retryAfter != null ? { 'retry-after': String(f.retryAfter) } : {}) };
  res.writeHead(f.status || 500, headers);
  const message = f.message || `fake failure ${f.status || 500}`;
  res.end(JSON.stringify(style === 'anthropic'
    ? { type: 'error', error: { type: f.code || (f.status === 429 ? 'rate_limit_error' : f.status === 401 ? 'authentication_error' : f.status === 404 ? 'not_found_error' : f.status >= 500 ? 'api_error' : 'invalid_request_error'), message } }
    : { error: { message, code: f.code || null, type: f.type || 'error' } }));
}

/**
 * A fake OpenAI-compatible provider. Every request is recorded with its key; `fail[key]` holds failures for that key
 * (or `fail['*']` for any key), shifted one per chat request; `script` holds assistant replies (Chat Completions
 * `message` objects), shifted per successful chat request; otherwise it answers "<name> (<key>) says hi".
 */
export function fakeChatProvider({ name = 'fake', models = ['fake-large', 'fake-mini'] } = {}) {
  const f = { name, reqs: [], fail: {}, script: [], models };
  f.server = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url.endsWith('/models')) return json(200, { data: f.models.map((id) => ({ id })) });
    if (req.url.endsWith('/chat/completions')) {
      const body = JSON.parse(d); f.reqs.push({ key, body });
      const failure = f.fail[key]?.shift() || f.fail['*']?.shift();
      if (failure) return sendFailure(req, res, failure);
      const message = f.script.shift() || { content: `${name} (${key}) says hi` };
      return json(200, { choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 3 } });
    }
    json(404, { error: { message: 'not found' } });
  }).listen(0);
  f.url = () => `http://127.0.0.1:${f.server.address().port}/v1`;
  f.close = () => f.server.close();
  return f;
}

export async function setup({ bindings = {}, env = {}, seed = true, extend = null, beforeImport = null, chatsOn = true } = {}) {
  const t = {
    mcpCalls: [], claudeReqs: [], summaryReqs: [], script: [], sent: [], claudeFail: [],
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
    if (req.method === 'GET') { // models list
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', type: 'model', created_at: '2026-01-01T00:00:00Z' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'a', last_id: 'b' }));
      return;
    }
    let d = ''; for await (const c of req) d += c;
    const body = JSON.parse(d);
    const isSummary = String(body.system || '').startsWith('You maintain the running memory');
    if (isSummary) {
      t.summaryReqs.push(body);
      if (t.summaryFail) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"type":"error","error":{"type":"api_error","message":"boom"}}'); return; }
    } else {
      t.claudeReqs.push(body);
      const f = t.claudeFail.shift();
      if (f) return sendFailure(req, res, f, 'anthropic');
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
    groupMembers: async (chat) => (chat === 'g1@g.us' ? [{ phone: '41790000001', jid: 'a', admin: true }, { phone: '41790000002', jid: 'b', admin: false }, { phone: '41790000003', jid: 'c', admin: true }, { phone: '', jid: 'x@lid', admin: false }] : []),
    status: async () => ({ status: 'open', me: '41790000099:1@s.whatsapp.net', since: Date.now() }),
  };
  // WhatsApp actions (026): every call recorded as { fn, chat, args }; results look like the real channel's.
  t.waCalls = [];
  const wa = (fn, result) => async (chat, ...args) => { t.waCalls.push({ fn, chat, args }); return typeof result === 'function' ? result(chat, ...args) : result; };
  Object.assign(t.channel, {
    sendMedia: wa('sendMedia', () => ({ msgId: `out-${++seq}`, mimetype: 'image/png', bytes: 10 })),
    sendLocation: wa('sendLocation', () => ({ msgId: `out-${++seq}` })),
    sendContact: wa('sendContact', () => ({ msgId: `out-${++seq}` })),
    react: wa('react', { ok: true }), editMessage: wa('editMessage', () => ({ msgId: `out-${++seq}` })), deleteMessage: wa('deleteMessage', { ok: true }),
    markRead: wa('markRead', { ok: true }), presence: wa('presence', { ok: true }),
    sendPoll: wa('sendPoll', (chat, p) => { const msgId = `poll-${++seq}`; t.db?.savePoll({ chat, msgId, name: p.name, options: p.options, selectable: p.multi ? 0 : 1 }); return { msgId }; }),
    groupInfo: wa('groupInfo', (chat) => ({ id: chat, subject: chat === 'g1@g.us' ? 'Panduga families' : 'Group', description: 'Event group', owner: '', size: 3,
      announcement: false, locked: true, joinApproval: false, participants: [{ phone: '41790000001', jid: 'a', admin: 'superadmin' }, { phone: '41790000002', jid: 'b', admin: null }, { phone: '41790000003', jid: 'c', admin: 'admin' }] })),
    groupInviteLink: wa('groupInviteLink', { link: 'https://chat.whatsapp.com/AbC123' }), groupRevokeInvite: wa('groupRevokeInvite', { link: 'https://chat.whatsapp.com/NeW456' }),
    groupParticipants: wa('groupParticipants', (chat, people) => people.map((p) => ({ who: `${String(p).replace(/\D/g, '')}@s.whatsapp.net`, status: '200', ok: true }))),
    groupSubject: wa('groupSubject', { ok: true }), groupDescription: wa('groupDescription', { ok: true }), groupPicture: wa('groupPicture', { ok: true }),
    groupSettings: wa('groupSettings', { ok: true }), groupLeave: wa('groupLeave', { ok: true }),
    profile: wa('profile', (chat, who) => ({ jid: `${String(who).replace(/\D/g, '')}@s.whatsapp.net`, phone: String(who).replace(/\D/g, ''), about: 'Hey there', pictureUrl: 'https://pps.whatsapp.net/x.jpg' })),
    block: wa('block', { jid: 'x' }), unblock: wa('unblock', { jid: 'x' }),
  });
  t.msg = (o) => ({
    channel: 'whatsapp', raw: {}, isGroup: true, chat: 'g1@g.us', phone: '41790000002', senderJid: 'x', senderName: 'Anu',
    mentioned: false, replyToAgent: false, quoted: '', msgId: `in-${++seq}`, ts: Date.now(), ...o,
  });

  const tmp = mkdtempSync(join(tmpdir(), 'duniya-'));
  t.tmp = tmp;
  Object.assign(process.env, {
    DATA_DIR: join(tmp, 'data'), ANTHROPIC_BASE_URL: `http://127.0.0.1:${t.claudeHttp.address().port}`,
    ADMIN_PASSWORD: 'correct horse battery', PANEL_PORT: '0', ...env,
  });
  if (beforeImport) await beforeImport(t);
  t.store = await import('../src/core/store.js');
  t.agents = await import('../src/core/agents.js');
  t.router = await import('../src/core/router.js');
  t.runner = await import('../src/core/runner.js');
  t.config = await import('../src/core/config.js');
  t.memory = await import('../src/core/memory.js');
  t.db = await import('../src/core/db.js');
  t.events = await import('../src/core/events.js');
  await t.agents.loadAgents();
  if (seed) {
    t.store.setSecret('ANTHROPIC_API_KEY', 'test');
    t.store.setSecret('PANDUGA_MCP_URL', `http://127.0.0.1:${t.mcpHttp.address().port}/mcp`);
    t.store.setSecret('PANDUGA_TOKEN_ORGANIZER', 'org');
    await t.agents.createAgent({ id: 'panduga', config: {
      ...JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/panduga-agent.json'), 'utf8')), name: 'Panduga', model: 'claude-sonnet-5-5',
      // token-based service (OAuth sign-in has its own test, mcp-oauth.test.js)
      mcpServers: { panduga: { url: '${PANDUGA_MCP_URL}', tokens: { organizer: '${PANDUGA_TOKEN_ORGANIZER}', participant: '${PANDUGA_TOKEN_MEMBER}' } } },
      chats: ['g1@g.us'], organizers: ['+41 79 000 00 01'], ...(bindings.panduga || {}),
    } });
    await t.agents.createAgent({ id: 'helper', config: {
      name: 'Helper', prompt: 'You help.', model: 'claude-sonnet-5-5', triggers: ['!help'], dm: 'organizers',
      chats: ['g2@g.us'], organizers: ['41790000001'], plugins: ['example-dice'], ...(bindings.helper || {}),
    } });
  }
  // #10: chats are off by default. Tests written before that switch on the chats they use; tests about the
  // allow-list switch chats off explicitly (or pass { chatsOn: false }).
  t.chatPrefs = await import('../src/core/chat-prefs.js');
  if (chatsOn !== false) {
    for (const c of [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `g${n}@g.us`), 'shop#g-shop@g.us', 'shop#41790000555@s.whatsapp.net',
      ...[1, 2, 3, 4, 5, 9].map((n) => `4179000000${n}@s.whatsapp.net`)]) t.chatPrefs.setChatPrefs(c, { enabled: true });
  }
  t.route = t.router.createRouter(t.channel);
  t.onHistory = t.router.createHistoryHandler();
  const { providerRoutes } = await import('../src/panel/routes/providers.js');
  const { backupRoutes } = await import('../src/panel/routes/backups.js');
  const { updateRoutes } = await import('../src/panel/routes/updates.js');
  t.restarts = 0;
  t.panel = (await import('../src/panel/server.js')).startPanel({ channel: t.channel, extend: [providerRoutes, (route) => backupRoutes(route, { restart: () => { t.restarts++; } }), (route) => updateRoutes(route, { restart: () => { t.restarts++; } }), ...(extend || [])] });
  await new Promise((r) => (t.panel.listening ? r() : t.panel.once('listening', r)));
  t.base = `http://127.0.0.1:${t.panel.address().port}`;
  t.toolNames = (i) => t.claudeReqs[i].tools.map((x) => x.name).sort();
  t.userTurn = (i) => t.claudeReqs[i].messages[0].content;
  t.login = async (username = 'admin', password = 'correct horse battery') => {
    const r = await fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (r.status !== 200) throw new Error(`login ${username}: ${r.status}`);
    return r.headers.get('set-cookie').split(';')[0];
  };
  t.api = async (cookie, method, path, body) => {
    const r = await fetch(t.base + path, { method, headers: { cookie, ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) }, body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  };
  t.waitFor = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error('waitFor timed out');
  };
  t.close = () => { t.mcpHttp.close(); t.claudeHttp.close(); t.panel.close(); setTimeout(() => process.exit(0), 50); };
  return t;
}
