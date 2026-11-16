// Shared e2e harness: fake MCP server, scripted fake Claude API, fake WhatsApp channel, real core + panel.
// Failing providers (042): `t.claudeFail` (a queue of failures for the fake Claude API) and `fakeChatProvider()` (an
// OpenAI-compatible endpoint with per-key scripts and failures). A failure is { status, message?, code?, retryAfter? }
// (e.g. 429 with Retry-After, 500, 401, 400, 404 model not found) or { network: true } (connection dropped).
// Streaming (047): both fakes answer `stream: true` requests with SSE (Anthropic-style events / Chat Completions chunks),
// one text piece per word. `t.claudeStreamFail` / `f.streamFail` queue mid-stream failures { after: n pieces, network }
// (socket dropped) or { after, error: { type, message } } (an SSE error event); `f.refuseStream` answers streamed
// requests with 400 (servers without streaming). Streamed requests are counted in t.claudeStreams / f.streams.
// Phone history (#91): `t.phone` and `t.historyAsks` fake the linked phone answering fetchHistory (see below).
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** A tiny valid PNG (1×1) for fake image results. */
export const FAKE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
/** A fake OGG voice note (only the magic bytes matter to the app). */
export const FAKE_OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40, 1)]);

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

/** Split text into word-sized pieces (spaces kept), like a model's token stream. */
export const streamPieces = (text) => String(text || '').match(/\S+\s*|\s+/g) || [];
const sse = (res, frames) => { for (const f of frames) res.write(f); };
const tick = () => new Promise((r) => setTimeout(r, 2)); // let each piece reach the client, like a real stream

/** Anthropic Messages SSE for one scripted answer; `fail` cuts it after `fail.after` text pieces. */
export async function sendAnthropicStream(req, res, content, { usage = { input_tokens: 3, output_tokens: 2 }, fail = null } = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  sse(res, [ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'f', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } } })]);
  let sent = 0;
  const cut = async () => {
    if (!fail || sent < (fail.after ?? 1)) return false;
    await tick();
    if (fail.network) req.socket.destroy();
    else { res.write(ev('error', { error: fail.error || { type: 'overloaded_error', message: 'Overloaded' } })); res.end(); }
    return true;
  };
  for (const [index, b] of content.entries()) {
    if (b.type === 'text') {
      sse(res, [ev('content_block_start', { index, content_block: { type: 'text', text: '' } })]);
      for (const piece of streamPieces(b.text)) {
        if (await cut()) return;
        res.write(ev('content_block_delta', { index, delta: { type: 'text_delta', text: piece } })); sent++;
        await tick();
      }
    } else {
      const json = JSON.stringify(b.input ?? {});
      sse(res, [ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }),
        ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(0, Math.ceil(json.length / 2)) } }),
        ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(Math.ceil(json.length / 2)) } })]);
    }
    res.write(ev('content_block_stop', { index }));
  }
  if (await cut()) return;
  sse(res, [ev('message_delta', { delta: { stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }), ev('message_stop', {})]);
  res.end();
}

/** Chat Completions SSE for one scripted `message`; `fail` cuts it after `fail.after` text pieces. */
async function sendChatStream(req, res, message, { usage, includeUsage, fail }) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (o) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', ...o })}\n\n`;
  let sent = 0;
  for (const piece of streamPieces(message.content)) {
    if (fail && sent >= (fail.after ?? 1)) {
      await tick();
      if (fail.network) req.socket.destroy();
      else { res.write(`data: ${JSON.stringify({ error: fail.error || { message: 'upstream error', type: 'server_error' } })}\n\n`); res.end(); }
      return;
    }
    res.write(chunk({ choices: [{ index: 0, delta: { ...(sent ? {} : { role: 'assistant' }), content: piece }, finish_reason: null }] })); sent++;
    await tick();
  }
  for (const [index, c] of (message.tool_calls || []).entries()) {
    const args = String(c.function?.arguments || '{}'); const half = Math.ceil(args.length / 2);
    sse(res, [chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: c.id, type: 'function', function: { name: c.function?.name, arguments: args.slice(0, half) } }] }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: args.slice(half) } }] }, finish_reason: null }] })]);
  }
  res.write(chunk({ choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
  if (includeUsage) res.write(chunk({ choices: [], usage }));
  res.end('data: [DONE]\n\n');
}

/**
 * A channel-registry factory of fake WhatsApp numbers: each session lands in `sessions[number]` with the texts it sent.
 * `extra(session)` overrides or adds channel methods.
 */
export const fakeNumbers = (sessions, extra = () => ({})) => ({ number, label }) => {
  const s = { number, label, handler: null, sent: [] };
  sessions[number] = s;
  return {
    number, label, async start(h) { s.handler = h; },
    async send(jid, text) { s.sent.push({ jid, text }); return { msgId: `o-${number}-${s.sent.length}` }; },
    async typing() {}, async chatName() { return ''; }, async listChats() { return []; }, async isMember() { return false; },
    async status() { return { status: 'open', me: '41790000099:1@s.whatsapp.net', since: 1 }; },
    ...extra(s),
  };
};

/**
 * Answer one MCP request (streamable HTTP, JSON responses) with a fresh fake server: `tools` are names,
 * `call(name)` returns the text result. For tests that host MCP next to their own OAuth endpoints.
 */
export async function serveFakeMcp(req, res, raw, { name = 'fake', tools = [], call = () => 'ok' } = {}) {
  const s = new Server({ name, version: '1' }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((n) => ({ name: n, description: n, inputSchema: { type: 'object', properties: {} } })) }));
  s.setRequestHandler(CallToolRequestSchema, async (r) => ({ content: [{ type: 'text', text: call(r.params.name) }] }));
  const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await s.connect(tr);
  return tr.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
}

/**
 * A fake OpenAI-compatible provider. Every request is recorded with its key; `fail[key]` holds failures for that key
 * (or `fail['*']` for any key), shifted one per chat request; `script` holds assistant replies (Chat Completions
 * `message` objects), shifted per successful chat request; otherwise it answers "<name> (<key>) says hi".
 */
export function fakeChatProvider({ name = 'fake', models = ['fake-large', 'fake-mini'] } = {}) {
  const f = { name, reqs: [], fail: {}, script: [], models, media: [], mediaFail: [], transcript: 'see you at the station at nine', imageModels: [], mediaCost: null,
    streams: 0, streamFail: [], refuseStream: false };
  f.server = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url.endsWith('/models') && !req.url.endsWith('/images/models')) return json(200, { data: f.models.map((id) => ({ id })) });
    // Photos & voice (043): the documented media endpoints, recorded in f.media as { path, key, body }.
    const media = (path, body) => { f.media.push({ path, key, body }); const failure = f.mediaFail.shift(); if (failure) { sendFailure(req, res, failure); return true; } return false; };
    const route = req.url.replace(/^.*\/v1|^.*\/api\/v1/, '');
    if (route === '/audio/transcriptions') {
      const isJson = String(req.headers['content-type'] || '').includes('json');
      if (media(route, isJson ? JSON.parse(d) : { multipart: true, model: (d.match(/name="model"\r\n\r\n([^\r]+)/) || [])[1] })) return;
      return json(200, { text: f.transcript, usage: { input_tokens: 10, output_tokens: 5, ...(f.mediaCost != null ? { cost: f.mediaCost } : {}) } });
    }
    if (route === '/audio/speech') {
      if (media(route, JSON.parse(d))) return;
      res.writeHead(200, { 'content-type': 'audio/ogg' }); return res.end(Buffer.from('OggS\0fake-opus-voice-note'));
    }
    if (route === '/images/models') return json(200, { data: f.imageModels.map((id) => ({ id, name: id, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } })) });
    if (route === '/images/generations' || route === '/images/edits' || route === '/images') {
      const isJson = String(req.headers['content-type'] || '').includes('json');
      if (media(route, isJson ? JSON.parse(d) : { multipart: true, hasImage: d.includes('name="image[]"') })) return;
      return json(200, { data: [{ b64_json: FAKE_PNG.toString('base64') }], usage: { input_tokens: 20, output_tokens: 100, ...(f.mediaCost != null ? { cost: f.mediaCost } : {}) } });
    }
    if (req.url.endsWith('/chat/completions')) {
      const body = JSON.parse(d); f.reqs.push({ key, body });
      const failure = f.fail[key]?.shift() || f.fail['*']?.shift();
      if (failure) return sendFailure(req, res, failure);
      if (body.stream && f.refuseStream) return json(400, { error: { message: 'stream is not supported', type: 'invalid_request_error' } });
      const message = f.script.shift() || { content: `${name} (${key}) says hi` };
      const usage = { prompt_tokens: 4, completion_tokens: 3 };
      if (body.stream) { f.streams++; return sendChatStream(req, res, message, { usage, includeUsage: !!body.stream_options?.include_usage, fail: f.streamFail.shift() }); }
      return json(200, { choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 3 } });
    }
    json(404, { error: { message: 'not found' } });
  }).listen(0);
  f.url = () => `http://127.0.0.1:${f.server.address().port}/v1`;
  f.close = () => f.server.close();
  return f;
}

export async function setup({ bindings = {}, env = {}, seed = true, extend = null, beforeImport = null, chatsOn = true, privacyNotice = false } = {}) {
  const t = {
    mcpCalls: [], claudeReqs: [], summaryReqs: [], script: [], sent: [], claudeFail: [], claudeStreamFail: [], claudeStreams: 0,
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
    if (body.stream) { t.claudeStreams++; return sendAnthropicStream(req, res, content, { fail: t.claudeStreamFail.shift() }); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'f', usage: { input_tokens: 3, output_tokens: 2 },
      stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', content }));
  }).listen(0);

  let seq = 0;
  t.channel = {
    id: 'whatsapp',
    send: async (chat, text, opts) => { t.sent.push({ chat, text, ...(opts?.mentions ? { mentions: opts.mentions } : {}) }); return { msgId: `out-${++seq}` }; },
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
  // #91: the linked phone's history. t.phone.chats[chat] = messages the phone has (t.msg()-like, any order);
  // fetchHistory(chat, count, anchor) is recorded in t.historyAsks and, when t.phone.online, answers a little later
  // with up to `count` messages older than the anchor as an on-demand history batch (like 'messaging-history.set'
  // with syncType ON_DEMAND). Offline: no answer (the app times out).
  t.phone = { online: true, chats: {}, delay: 20 };
  t.historyAsks = [];
  t.channel.fetchHistory = async (chat, count, anchor) => {
    t.historyAsks.push({ chat, count, anchor });
    if (!t.phone.online) return 'req-id';
    const all = [...(t.phone.chats[chat] || [])].sort((a, b) => a.ts - b.ts);
    const i = all.findIndex((m) => m.msgId === anchor.msgId);
    const older = (i >= 0 ? all.slice(0, i) : all.filter((m) => m.ts < anchor.ts)).slice(-count);
    setTimeout(() => t.onHistory(older, { onDemand: true, chats: [chat] }), t.phone.delay);
    return 'req-id';
  };
  // Photos & voice (043): inbound media messages. t.mediaMsg({ type: 'image'|'audio'|'sticker'|'document', buffer, ... })
  // builds a message like the WhatsApp channel's (mediaInfo, mediaRef, fetchMedia); downloads are counted in t.downloads.
  t.mediaStore = new Map(); t.downloads = [];
  t.channel.downloadMedia = async (chat, ref) => { t.downloads.push(ref); if (!t.mediaStore.has(ref)) throw new Error('media expired'); return t.mediaStore.get(ref); };
  t.mediaMsg = ({ type = 'image', buffer = FAKE_PNG, mimetype, size, seconds = 4, caption = '', fileName = '', ...o } = {}) => {
    const ref = `media-${++seq}`;
    t.mediaStore.set(ref, buffer);
    const mt = mimetype || { image: 'image/png', sticker: 'image/webp', audio: 'audio/ogg', document: 'application/pdf' }[type];
    const text = type === 'audio' ? '[voice note]' : type === 'sticker' ? '[sticker]' : type === 'document' ? `[document: ${fileName || 'file.pdf'}]` : `[image${caption ? `: ${caption}` : ''}]`;
    return t.msg({ text, caption, media: true, mediaInfo: { type, mimetype: mt, size: size ?? buffer.length, ...(type === 'audio' ? { seconds, ptt: true } : {}), ...(fileName ? { fileName } : {}) },
      mediaRef: ref, fetchMedia: async () => t.channel.downloadMedia('', ref), ...o });
  };
  t.msg = (o) => ({
    channel: 'whatsapp', raw: {}, isGroup: true, chat: 'g1@g.us', phone: '41790000002', senderJid: 'x', senderName: 'Anu',
    mentioned: false, replyToAgent: false, quoted: '', msgId: `in-${++seq}`, ts: Date.now(), ...o,
  });

  const tmp = mkdtempSync(join(tmpdir(), 'duniya-'));
  t.tmp = tmp;
  Object.assign(process.env, {
    DATA_DIR: join(tmp, 'data'), ANTHROPIC_BASE_URL: `http://127.0.0.1:${t.claudeHttp.address().port}`,
    ADMIN_PASSWORD: 'correct horse battery', PANEL_PORT: '0', WELCOME_DELAY_MS: '20', WELCOME_GAP_MS: '0', ...env,
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
  // 044: the privacy notice is on by default; tests written before it switch it off (pass { privacyNotice: true }).
  if (!privacyNotice) t.store.updateSettings({ privacyNotice: { enabled: false } });
  if (seed) {
    t.store.setSecret('ANTHROPIC_API_KEY', 'test');
    t.store.setSecret('PANDUGA_MCP_URL', `http://127.0.0.1:${t.mcpHttp.address().port}/mcp`);
    t.store.setSecret('PANDUGA_TOKEN_ORGANIZER', 'org');
    await t.agents.createAgent({ id: 'panduga', config: {
      ...JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/panduga-agent.json'), 'utf8')), name: 'Panduga', model: 'anthropic:claude-sonnet-5-5',
      // token-based service (OAuth sign-in has its own test, mcp-oauth.test.js)
      mcpServers: { panduga: { url: '${PANDUGA_MCP_URL}', tokens: { organizer: '${PANDUGA_TOKEN_ORGANIZER}', participant: '${PANDUGA_TOKEN_MEMBER}' } } },
      chats: ['g1@g.us'], organizers: ['+41 79 000 00 01'], ...(bindings.panduga || {}),
    } });
    await t.agents.createAgent({ id: 'helper', config: {
      name: 'Helper', prompt: 'You help.', model: 'anthropic:claude-sonnet-5-5', triggers: ['!help'], dm: 'organizers',
      chats: ['g2@g.us'], organizers: ['41790000001'], ...(bindings.helper || {}),
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
  t.onJoin = t.router.createJoinHandler(t.channel); // 054: people joined a group ({ chat, participants: [{ jid, phone }] })
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
