import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { env, ROOT, readJson, writeJson, listSecrets, setSecret, getSettings, updateSettings } from '../core/config.js';
import { listBots, getBot, botView, updateBot, bindChat, loadBots } from '../core/bots.js';
import { listActivity, listPending, dropPending, takePending } from '../core/db.js';
import { bus, activity } from '../core/events.js';
import { runAgent, handleConfirmCommand, applyPending } from '../core/agent.js';
import { runSchedule } from '../core/scheduler.js';
import { resetMcpPool } from '../core/mcp.js';
import { memoryView, maybeSummarize, eraseChatMemory } from '../core/memory.js';
import { deleteNote, getNote } from '../core/db.js';
import { botForChat } from '../core/bots.js';

const PUBLIC = resolve(import.meta.dirname, 'public');
const SESSION_MS = 7 * 24 * 3600 * 1000;
const sessions = new Map(); // token -> expires
const loginAttempts = new Map(); // ip -> [ts]
const startedAt = Date.now();

// ---------- password ----------
function hashPw(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(pw, salt, 32).toString('hex') };
}
function checkPassword(pw) {
  const stored = readJson('admin.json', null);
  if (stored?.hash) {
    const { hash } = hashPw(pw, stored.salt);
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
  }
  if (!env.adminPassword) return false;
  const a = Buffer.from(scryptSync(pw, 'x', 32));
  const b = Buffer.from(scryptSync(env.adminPassword, 'x', 32));
  return timingSafeEqual(a, b);
}
const passwordConfigured = () => !!(readJson('admin.json', null)?.hash || env.adminPassword);

// ---------- helpers ----------
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.headers['cf-visitor']?.includes('https');

function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function authed(req) {
  const t = cookie(req, 'duniya_session');
  const exp = t && sessions.get(t);
  if (!exp || exp < Date.now()) { if (t) sessions.delete(t); return false; }
  return true;
}
function send(res, status, body, headers = {}) {
  const isObj = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1e6) throw new Error('Body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
function gitVersion() {
  return new Promise((r) => execFile('git', ['log', '-1', '--format=%h %cs %s'], { cwd: ROOT }, (e, out) => r(e ? 'unknown' : out.trim())));
}

const INDEX_HTML = () => readFileSync(resolve(PUBLIC, 'index.html'));
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function startPanel({ channel }) {
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

  // ---------- auth ----------
  route('GET', '/api/session', async (req) => ({ authed: authed(req), passwordConfigured: passwordConfigured() }));
  route('POST', '/api/login', async (req, res, body) => {
    const ip = clientIp(req);
    const recent = (loginAttempts.get(ip) || []).filter((t) => Date.now() - t < 60000);
    if (recent.length >= 5) return [429, { error: 'Too many attempts, wait a minute' }];
    recent.push(Date.now()); loginAttempts.set(ip, recent);
    if (!checkPassword(String(body.password || ''))) {
      activity('system', { summary: `Panel login failed from ${ip}` });
      return [401, { error: 'Wrong password' }];
    }
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    activity('system', { summary: `Panel login from ${ip}` });
    res.setHeader('set-cookie', `duniya_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}`);
    return { ok: true };
  }, { public: true });
  route('POST', '/api/logout', async (req, res) => {
    sessions.delete(cookie(req, 'duniya_session'));
    res.setHeader('set-cookie', 'duniya_session=; Path=/; Max-Age=0');
    return { ok: true };
  });
  route('POST', '/api/password', async (req, res, body) => {
    if (!checkPassword(String(body.current || ''))) return [400, { error: 'Current password is wrong' }];
    if (String(body.next || '').length < 12) return [400, { error: 'Use at least 12 characters' }];
    writeJson('admin.json', hashPw(String(body.next)));
    sessions.clear();
    activity('system', { summary: 'Panel password changed' });
    return { ok: true };
  });

  // ---------- overview ----------
  route('GET', '/api/status', async () => ({
    channel: await channel.status(),
    settings: getSettings(),
    version: await gitVersion(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
    bots: listBots().map((b) => ({ id: b.id, name: b.name, enabled: b.enabled, chats: b.chats.length })),
    pending: listPending().length,
  }));
  route('POST', '/api/settings', async (req, res, body) => {
    const patch = {};
    if ('paused' in body) patch.paused = !!body.paused;
    if ('defaultDmBot' in body) patch.defaultDmBot = String(body.defaultDmBot || '');
    activity('system', { summary: `Settings: ${JSON.stringify(patch)}` });
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
  route('GET', '/api/bots', async () => listBots().map(botView));
  route('GET', '/api/bots/:id', async (req, res, body, q, p) => {
    const b = getBot(p.id); return b ? botView(b) : [404, { error: 'Not found' }];
  });
  route('PUT', '/api/bots/:id', async (req, res, body, q, p) => botView(updateBot(p.id, body)));
  route('POST', '/api/bots/reload', async () => { await loadBots(); await resetMcpPool(); activity('system', { summary: 'Bots reloaded' }); return listBots().map(botView); });
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
    return { reply, usage: ctx.usage };
  });
  route('POST', '/api/bots/:id/schedules/:sid/run', async (req, res, body, q, p) => {
    const bot = getBot(p.id);
    const s = bot?.schedules.find((x) => x.id === p.sid);
    if (!s) return [404, { error: 'Not found' }];
    return runSchedule(bot, s, channel, { force: true });
  });

  // ---------- chats ----------
  route('GET', '/api/chats', async () => {
    const chats = await channel.listChats();
    const owner = new Map(listBots().flatMap((b) => b.chats.map((c) => [c, b.id])));
    const known = new Set(chats.map((c) => c.id));
    const missing = [...owner.keys()].filter((c) => !known.has(c)).map((id) => ({ id, name: '(not a member / offline)', size: 0 }));
    return [...chats, ...missing].map((c) => ({ ...c, bot: owner.get(c.id) || '' }));
  });
  route('POST', '/api/chats/bind', async (req, res, body) => { bindChat(String(body.chat), body.bot || null); return { ok: true }; });

  // ---------- memory (004) ----------
  route('GET', '/api/chats/:chat/memory', async (req, res, body, q, p) => memoryView(decodeURIComponent(p.chat)));
  route('POST', '/api/chats/:chat/memory/summarize', async (req, res, body, q, p) => {
    const chat = decodeURIComponent(p.chat);
    const summary = await maybeSummarize(chat, botForChat(chat), { force: true });
    return { summary: summary ?? memoryView(chat).summary };
  });
  route('DELETE', '/api/chats/:chat/memory', async (req, res, body, q, p) => { eraseChatMemory(decodeURIComponent(p.chat)); return { ok: true }; });
  route('DELETE', '/api/notes/:id', async (req, res, body, q, p) => {
    const note = getNote(p.id);
    if (!note) return [404, { error: 'Not found' }];
    deleteNote(p.id);
    activity('memory.note.removed', { chat: note.chat, summary: `#${p.id} (panel)` });
    return { ok: true };
  });

  // ---------- pending ----------
  route('GET', '/api/pending', async () => listPending());
  route('DELETE', '/api/pending/:code', async (req, res, body, q, p) => {
    dropPending(p.code); activity('confirm.cancelled', { summary: `${p.code} (panel)` }); return { ok: true };
  });
  route('POST', '/api/pending/:code/apply', async (req, res, body, q, p) => {
    const row = takePending(p.code);
    if (!row) return [404, { error: 'Expired or not found' }];
    return { result: await applyPending(getBot(row.bot), row) };
  });

  // ---------- secrets ----------
  route('GET', '/api/secrets', async () => {
    const names = new Set(listSecrets().map((s) => s.name));
    const wanted = new Set(['ANTHROPIC_API_KEY']);
    for (const b of listBots()) JSON.stringify(b.mcpServers).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => wanted.add(k));
    return [...new Set([...names, ...wanted])].sort().map((name) => ({
      name, set: listSecrets().some((s) => s.name === name && s.set) || !!process.env[name], usedByBots: wanted.has(name),
    }));
  });
  route('PUT', '/api/secrets', async (req, res, body) => {
    setSecret(String(body.name || ''), String(body.value || ''));
    activity('system', { summary: `Secret ${body.value ? 'set' : 'removed'}: ${body.name}` });
    return { ok: true };
  });

  // ---------- channel control ----------
  route('POST', '/api/whatsapp/pair', async (req, res, body) => ({ code: await channel.pair(body.phone) }));
  route('POST', '/api/whatsapp/logout', async () => { await channel.logout(); return { ok: true }; });
  route('POST', '/api/whatsapp/restart', async () => { await channel.restart(); return { ok: true }; });

  // ---------- system ----------
  route('POST', '/api/system/update', async () => {
    activity('system', { summary: 'Update requested from panel' });
    const out = await new Promise((r) => {
      const p = spawn('bash', [resolve(ROOT, 'deploy/update.sh')], { cwd: ROOT });
      let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
      p.on('close', (code) => r({ code, log: log.slice(-6000) }));
    });
    if (out.code === 0) {
      activity('system', { summary: 'Updated; restarting' });
      setTimeout(() => process.exit(0), 500); // systemd restarts us
    } else {
      activity('error', { summary: 'Update failed', detail: out.log });
    }
    return out;
  });
  route('POST', '/api/system/restart', async () => { setTimeout(() => process.exit(0), 300); return { ok: true }; });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, INDEX_HTML(), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'x-frame-options': 'DENY' });
      }
      if (url.pathname === '/healthz') return send(res, 200, 'ok');
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Not found' });
      const isPublic = url.pathname === '/api/login' || url.pathname === '/api/session';
      if (!isPublic && !authed(req)) return send(res, 401, { error: 'Login required' });
      if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 415, { error: 'JSON required' }); // CSRF guard (with SameSite=Strict)
      }
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await r.handler(req, res, body, url.searchParams, url.pathname.match(r.re).groups || {});
      if (out === null) return; // streaming
      if (Array.isArray(out) && typeof out[0] === 'number' && out.length === 2) return send(res, out[0], out[1]);
      return send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (!res.headersSent) send(res, 400, { error: e.message });
    }
  });
  server.listen(env.panelPort, env.panelHost, () => {
    console.log(`Admin panel on http://${env.panelHost}:${env.panelPort}${passwordConfigured() ? '' : ' (WARNING: no ADMIN_PASSWORD set — login disabled)'}`);
  });
  return server;
}
