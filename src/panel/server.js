import http from 'node:http';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { env, ROOT, DATA_DIR } from '../core/config.js';
import {
  listSecrets, setSecret, getSettings, updateSettings, interpolate, countUsers, createUser, listUsers, updateUser,
  deleteUser, authenticate, createSession, sessionUser, deleteSession,
} from '../core/store.js';
import {
  listBots, getBot, botView, createBot, updateBot, deleteBot, bindChat, loadBots, botForChat,
  listTemplates, templateConfig, exportBot, importBot, listPlugins,
} from '../core/bots.js';
import { referencedSecrets } from '../core/schema.js';
import { listActivity, listPending, dropPending, takePending, deleteNote, getNote } from '../core/db.js';
import { bus, activity } from '../core/events.js';
import { runAgent, handleConfirmCommand, applyPending } from '../core/agent.js';
import { runSchedule } from '../core/scheduler.js';
import { resetMcpPool, mcpConnection } from '../core/mcp.js';
import { memoryView, maybeSummarize, eraseChatMemory } from '../core/memory.js';
import { humanCode } from '../core/crypto.js';
import { organizerConnection } from '../core/tools.js';
import { probeServer, startSignIn, finishSignIn, listConnections, disconnect as disconnectOAuth, OAUTH_ROLES } from '../core/mcp-oauth.js';

const PUBLIC = resolve(import.meta.dirname, 'public');
const loginAttempts = new Map(); // ip -> [ts]
const startedAt = Date.now();
const ROLE_RANK = { viewer: 1, admin: 2, owner: 3 };
const SETUP_FILE = resolve(DATA_DIR, 'setup-code.txt');
let setupCode = null;

// ---------- first owner ----------
export function bootstrapAuth() {
  if (countUsers() > 0) { rmSync(SETUP_FILE, { force: true }); return; }
  if (env.adminPassword) {
    try {
      createUser({ username: 'admin', role: 'owner', password: env.adminPassword });
      activity('system', { summary: 'Owner "admin" created from ADMIN_PASSWORD' });
      return;
    } catch (e) {
      console.error(`ADMIN_PASSWORD not usable (${e.message}); falling back to a setup code`);
    }
  }
  setupCode = existsSync(SETUP_FILE) ? readFileSync(SETUP_FILE, 'utf8').trim() : humanCode(10);
  writeFileSync(SETUP_FILE, setupCode, { mode: 0o600 });
  console.log(`\n  First-run setup code: ${setupCode}\n  Open the admin panel and enter it to create the owner account.\n`);
}

// ---------- helpers ----------
// Forwarded headers are only trusted when a local proxy (Caddy, cloudflared) is configured (TRUST_PROXY=1).
const clientIp = (req) => (env.trustProxy
  ? req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
  : req.socket.remoteAddress) || '';
const isHttps = (req) => (env.trustProxy && (req.headers['x-forwarded-proto'] === 'https' || !!req.headers['cf-visitor']?.includes('https')))
  || !!req.socket.encrypted;
function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function send(res, status, body, headers = {}) {
  const isObj = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 2e6) throw new Error('Body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
const gitVersion = () => new Promise((r) => execFile('git', ['log', '-1', '--format=%h %cs %s'], { cwd: ROOT }, (e, out) => r(e ? 'unknown' : out.trim())));
function rateLimitLogin(ip) {
  const recent = (loginAttempts.get(ip) || []).filter((t) => Date.now() - t < 60000);
  recent.push(Date.now()); loginAttempts.set(ip, recent);
  return recent.length > 5;
}
function setSessionCookie(req, res, userId) {
  const { token, maxAge } = createSession(userId, clientIp(req));
  res.setHeader('set-cookie', `duniya_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function startPanel({ channel, extend = [] }) {
  bootstrapAuth();
  const routes = [];
  /** opts.role: minimum role (default: viewer for GET, admin otherwise). opts.public: no auth. */
  const route = (method, pattern, handler, opts = {}) => routes.push({
    method, handler, public: !!opts.public,
    role: opts.role || (method === 'GET' ? 'viewer' : 'admin'),
    re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  });

  // ---------- session / setup ----------
  route('GET', '/api/session', async (req) => {
    const user = sessionUser(cookie(req, 'duniya_session'));
    return { authed: !!user, user, needsSetup: countUsers() === 0 };
  }, { public: true });
  route('POST', '/api/setup', async (req, res, body) => {
    if (countUsers() > 0) return [409, { error: 'Already set up' }];
    if (rateLimitLogin(clientIp(req))) return [429, { error: 'Too many attempts, wait a minute' }];
    if (!setupCode || String(body.code || '').trim().toUpperCase() !== setupCode) return [403, { error: 'Wrong setup code (see the server log or installer output)' }];
    const user = createUser({ username: body.username || 'admin', email: body.email, role: 'owner', password: body.password });
    rmSync(SETUP_FILE, { force: true }); setupCode = null;
    activity('system', { summary: `Owner "${user.username}" created via setup` });
    setSessionCookie(req, res, user.id);
    return { ok: true, user };
  }, { public: true });
  route('POST', '/api/login', async (req, res, body) => {
    const ip = clientIp(req);
    if (rateLimitLogin(ip)) return [429, { error: 'Too many attempts, wait a minute' }];
    const user = authenticate(body.username || 'admin', String(body.password || ''));
    if (!user) { activity('system', { summary: `Panel login failed for "${body.username || 'admin'}" from ${ip}` }); return [401, { error: 'Wrong username or password' }]; }
    setSessionCookie(req, res, user.id);
    activity('system', { summary: `Panel login: ${user.username} from ${ip}` });
    return { ok: true, user };
  }, { public: true });
  route('POST', '/api/logout', async (req, res) => {
    deleteSession(cookie(req, 'duniya_session'));
    res.setHeader('set-cookie', 'duniya_session=; Path=/; Max-Age=0');
    return { ok: true };
  }, { role: 'viewer' });
  route('POST', '/api/password', async (req, res, body, q, p, user) => {
    if (!authenticate(user.username, String(body.current || ''))) return [400, { error: 'Current password is wrong' }];
    updateUser(user.id, { password: String(body.next || '') });
    activity('system', { summary: `Password changed: ${user.username}` });
    return { ok: true };
  }, { role: 'viewer' });

  // ---------- users (owner) ----------
  route('GET', '/api/users', async () => listUsers(), { role: 'owner' });
  route('POST', '/api/users', async (req, res, body, q, p, user) => {
    const u = createUser(body); activity('system', { summary: `User ${u.username} (${u.role}) added by ${user.username}` }); return u;
  }, { role: 'owner' });
  route('PUT', '/api/users/:id', async (req, res, body, q, p, user) => {
    const u = updateUser(p.id, body); activity('system', { summary: `User ${u.username} updated by ${user.username}` }); return u;
  }, { role: 'owner' });
  route('DELETE', '/api/users/:id', async (req, res, body, q, p, user) => {
    deleteUser(p.id); activity('system', { summary: `User #${p.id} removed by ${user.username}` }); return { ok: true };
  }, { role: 'owner' });

  // ---------- overview ----------
  route('GET', '/api/status', async (req, res, body, q, p, user) => ({
    user,
    channel: await channel.status(),
    settings: getSettings(),
    version: await gitVersion(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
    bots: listBots().map((b) => ({ id: b.id, name: b.name, enabled: b.enabled, chats: b.chats.length })),
    pending: listPending().length,
  }));
  route('POST', '/api/settings', async (req, res, body, q, p, user) => {
    const patch = {};
    if ('paused' in body) patch.paused = !!body.paused;
    if ('defaultDmBot' in body) patch.defaultDmBot = String(body.defaultDmBot || '');
    activity('system', { summary: `Settings by ${user.username}: ${JSON.stringify(patch)}` });
    return updateSettings(patch);
  });

  // ---------- activity ----------
  route('GET', '/api/activity', async (req, res, body, q) => listActivity({ limit: q.get('limit'), bot: q.get('bot') || '', before: Number(q.get('before') || 0) }));
  route('GET', '/api/events', async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    const onAct = (a) => res.write(`data: ${JSON.stringify(a)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    bus.on('activity', onAct);
    req.on('close', () => { bus.off('activity', onAct); clearInterval(ping); });
    return null;
  });

  // ---------- bots ----------
  route('GET', '/api/templates', async () => listTemplates());
  route('GET', '/api/plugins', async () => listPlugins());
  route('GET', '/api/bots', async () => listBots().map(botView));
  route('POST', '/api/bots', async (req, res, body, q, p, user) => {
    const base = body.template ? templateConfig(body.template) : {};
    const { bot, warnings } = await createBot({ id: body.id, config: { ...base, ...(body.config || {}) }, by: user.username });
    return [201, { ...botView(bot), warnings }];
  });
  route('POST', '/api/bots/import', async (req, res, body, q, p, user) => {
    const { bot, warnings } = await importBot(body, user.username);
    return [201, { ...botView(bot), warnings }];
  });
  route('POST', '/api/bots/reload', async () => { await loadBots(); await resetMcpPool(); activity('system', { summary: 'Bots reloaded' }); return listBots().map(botView); });
  route('GET', '/api/bots/:id', async (req, res, body, q, p) => { const b = getBot(p.id); return b ? botView(b) : [404, { error: 'Not found' }]; });
  route('PUT', '/api/bots/:id', async (req, res, body, q, p, user) => {
    const { bot, warnings } = await updateBot(p.id, body, user.username);
    return { ...botView(bot), warnings };
  });
  route('DELETE', '/api/bots/:id', async (req, res, body, q, p, user) => { deleteBot(p.id, user.username); return { ok: true }; });
  route('POST', '/api/bots/:id/duplicate', async (req, res, body, q, p, user) => {
    const src = getBot(p.id);
    if (!src) return [404, { error: 'Not found' }];
    const { hooks, id, updatedAt, ...config } = src;
    const { bot } = await createBot({ id: body.id, config: { ...config, name: `${config.name} (copy)`, chats: [] }, by: user.username });
    return [201, botView(bot)];
  });
  route('GET', '/api/bots/:id/export', async (req, res, body, q, p) => {
    const doc = exportBot(p.id);
    send(res, 200, JSON.stringify(doc, null, 2), { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${p.id}.bot.json"` });
    return null;
  });
  // ---------- tool service sign-in (009) ----------
  route('POST', '/api/bots/:id/probe', async (req, res, body) => {
    const url = interpolate(String(body.url || '')).trim();
    if (!url) return [400, { error: 'Enter the tool service URL first' }];
    return probeServer(url);
  });
  route('GET', '/api/bots/:id/connections', async (req, res, body, q, p) => listConnections(p.id));
  route('POST', '/api/bots/:id/connections/:server/:role', async (req, res, body, q, p, user) => {
    const bot = getBot(p.id);
    const srv = bot?.mcpServers?.[p.server];
    if (!srv) return [404, { error: 'Save the bot with this tool service first' }];
    if (srv.auth !== 'oauth') return [400, { error: 'This tool service is not set to Sign in' }];
    if (!OAUTH_ROLES.includes(p.role)) return [400, { error: 'Unknown role' }];
    const url = interpolate(srv.url);
    if (!url) return [400, { error: 'The tool service URL is empty' }];
    const redirectUri = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}/oauth/mcp/callback`;
    return startSignIn({ botId: bot.id, server: p.server, role: p.role, url, redirectUri, by: user.username });
  });
  route('DELETE', '/api/bots/:id/connections/:server/:role', async (req, res, body, q, p, user) => {
    disconnectOAuth(p.id, p.server, p.role, user.username);
    return { ok: true };
  });
  // The browser comes back here from the service. SameSite=Strict means no session cookie on this cross-site
  // navigation: the single-use state proves the sign-in was started by an admin; the page then returns to the panel.
  route('GET', '/oauth/mcp/callback', async (req, res, body, q) => {
    let ok = true; let msg; let botId = '';
    try {
      const r = await finishSignIn({ state: q.get('state'), code: q.get('code'), error: q.get('error'), errorDescription: q.get('error_description') });
      botId = r.botId; msg = `Connected ${r.server} for ${r.role}s.`;
    } catch (e) { ok = false; msg = e.message; botId = e.botId || ''; }
    const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const back = botId ? `/#bots/${encodeURIComponent(botId)}` : '/';
    const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${ok ? 'Connected' : 'Sign-in failed'}</title>
<body style="font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f4f6f5;color:#14201b">
<div style="background:#fff;border:1px solid #e3e8e5;border-radius:16px;padding:28px;max-width:440px;text-align:center">
<div style="font-size:40px">${ok ? '✅' : '⚠️'}</div><h2 style="margin:8px 0">${ok ? 'Connected' : 'Sign-in did not complete'}</h2>
<p style="color:#5b6a63">${esc(msg)}</p><p><a href="${esc(back)}" id=b style="color:#128c7e;font-weight:600">Back to the panel</a></p></div>
${ok ? `<script>setTimeout(function(){location.replace(${JSON.stringify(back)})},1200)</script>` : ''}`;
    send(res, ok ? 200 : 400, html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP });
    return null;
  }, { public: true });

  route('POST', '/api/bots/:id/discover', async (req, res, body, q, p) => {
    let url; let token;
    if (body.auth === 'oauth') {
      const bot = getBot(p.id);
      if (!bot?.mcpServers?.[body.server] || bot.mcpServers[body.server].auth !== 'oauth') return [400, { error: 'Save the bot and connect the tool service first' }];
      const tools = await organizerConnection(bot, body.server).listTools();
      return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 300) }));
    }
    if (body.url) { url = interpolate(String(body.url)); token = interpolate(String(body.token || '')); } else {
      const bot = getBot(p.id);
      const srv = bot?.mcpServers?.[body.server];
      if (!srv) return [404, { error: 'Unknown tool service' }];
      url = interpolate(srv.url); token = interpolate(srv.tokens?.organizer || '');
    }
    if (!url) return [400, { error: 'URL is empty (is its secret set?)' }];
    const tools = await mcpConnection(url, token).listTools();
    return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 300) }));
  });
  route('POST', '/api/bots/:id/test', async (req, res, body, q, p) => {
    const bot = getBot(p.id);
    if (!bot) return [404, { error: 'Not found' }];
    const role = body.role === 'organizer' ? 'organizer' : 'participant';
    const chat = `panel:${p.id}`;
    const text = String(body.text || '').slice(0, 4000);
    const confirm = await handleConfirmCommand({ bot, text, role, chat });
    if (confirm !== undefined) return { reply: confirm };
    activity('message.in', { bot: bot.id, chat, summary: `Panel test (${role}): ${text}` });
    const ctx = { bot, role, chat, senderName: 'Panel admin', requester: 'panel', text, isGroup: false, source: 'panel' };
    const reply = await runAgent(ctx);
    activity('message.out', { bot: bot.id, chat, summary: reply || '(no reply)' });
    return { reply, usage: ctx.usage, model: ctx.model };
  });
  route('POST', '/api/bots/:id/schedules/:sid/run', async (req, res, body, q, p) => {
    const bot = getBot(p.id);
    const s = bot?.schedules.find((x) => x.id === decodeURIComponent(p.sid));
    if (!s) return [404, { error: 'Not found' }];
    return runSchedule(bot, s, channel, { force: true });
  });

  // ---------- chats + memory ----------
  route('GET', '/api/chats', async () => {
    const chats = await channel.listChats();
    const owner = new Map(listBots().flatMap((b) => b.chats.map((c) => [c, b.id])));
    const known = new Set(chats.map((c) => c.id));
    const missing = [...owner.keys()].filter((c) => !known.has(c)).map((id) => ({ id, name: '(not a member / offline)', size: 0 }));
    return [...chats, ...missing].map((c) => ({ ...c, bot: owner.get(c.id) || '' }));
  });
  route('POST', '/api/chats/bind', async (req, res, body, q, p, user) => { await bindChat(String(body.chat), body.bot || null, user.username); return { ok: true }; });
  route('GET', '/api/chats/:chat/memory', async (req, res, body, q, p) => memoryView(decodeURIComponent(p.chat)));
  route('POST', '/api/chats/:chat/memory/summarize', async (req, res, body, q, p) => {
    const chat = decodeURIComponent(p.chat);
    const summary = await maybeSummarize(chat, botForChat(chat), { force: true });
    return { summary: summary ?? memoryView(chat).summary };
  });
  route('DELETE', '/api/chats/:chat/memory', async (req, res, body, q, p, user) => { eraseChatMemory(decodeURIComponent(p.chat), user.username); return { ok: true }; });
  route('DELETE', '/api/notes/:id', async (req, res, body, q, p, user) => {
    const note = getNote(p.id);
    if (!note) return [404, { error: 'Not found' }];
    deleteNote(p.id);
    activity('memory.note.removed', { chat: note.chat, summary: `#${p.id} (panel, ${user.username})` });
    return { ok: true };
  });

  // ---------- pending ----------
  route('GET', '/api/pending', async () => listPending());
  route('DELETE', '/api/pending/:code', async (req, res, body, q, p, user) => {
    dropPending(p.code); activity('confirm.cancelled', { summary: `${p.code} (panel, ${user.username})` }); return { ok: true };
  });
  route('POST', '/api/pending/:code/apply', async (req, res, body, q, p) => {
    const row = takePending(p.code);
    if (!row) return [404, { error: 'Expired or not found' }];
    return { result: await applyPending(getBot(row.bot), row) };
  });

  // ---------- secrets ----------
  route('GET', '/api/secrets', async () => {
    const stored = new Map(listSecrets().map((s) => [s.name, s.set]));
    const wanted = new Set(['ANTHROPIC_API_KEY']);
    for (const b of listBots()) for (const s of referencedSecrets(b)) wanted.add(s);
    return [...new Set([...stored.keys(), ...wanted])].sort().map((name) => ({
      name, set: !!stored.get(name) || !!process.env[name], usedByBots: wanted.has(name),
    }));
  });
  route('PUT', '/api/secrets', async (req, res, body, q, p, user) => {
    setSecret(String(body.name || ''), String(body.value || ''));
    activity('system', { summary: `Secret ${body.value ? 'set' : 'removed'}: ${body.name} (by ${user.username})` });
    return { ok: true };
  });

  // ---------- channel control ----------
  route('POST', '/api/whatsapp/pair', async (req, res, body) => ({ code: await channel.pair(body.phone) }));
  route('POST', '/api/whatsapp/logout', async () => { await channel.logout(); return { ok: true }; });
  route('POST', '/api/whatsapp/restart', async () => { await channel.restart(); return { ok: true }; });

  // ---------- system ----------
  route('POST', '/api/system/restart', async () => { setTimeout(() => process.exit(0), 300); return { ok: true }; }, { role: 'owner' });

  // Other features (providers, backups, updates) add their routes with the same role gates.
  for (const fn of [].concat(extend)) fn(route, { channel });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, readFileSync(resolve(PUBLIC, 'index.html')), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'x-frame-options': 'DENY' });
      }
      if (url.pathname === '/healthz') return send(res, 200, 'ok');
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Not found' });
      let user = null;
      if (!r.public) {
        user = sessionUser(cookie(req, 'duniya_session'));
        if (!user) return send(res, 401, { error: 'Login required' });
        if (ROLE_RANK[user.role] < ROLE_RANK[r.role]) {
          return send(res, 403, { error: user.role === 'viewer' ? 'Read-only account' : `Requires ${r.role} role` });
        }
      }
      if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 415, { error: 'JSON required' }); // CSRF guard (with SameSite=Strict)
      }
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await r.handler(req, res, body, url.searchParams, url.pathname.match(r.re).groups || {}, user);
      if (out === null) return;
      if (Array.isArray(out) && typeof out[0] === 'number' && out.length === 2) return send(res, out[0], out[1]);
      return send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 400, { error: e.message, field: e.field });
    }
  });
  server.listen(env.panelPort, env.panelHost, () => {
    console.log(`Admin panel on http://${env.panelHost}:${env.panelPort}`);
  });
  return server;
}

