// @ts-check
// The panel's HTTP server (src/panel): the router with its role gates and CSRF guard, the admin MCP's in-process
// calls, and the static panel files. Routes live in routes/<area>.js, registered here in one place.
import http from 'node:http';
import { env, fail } from '../core/config.js';
import { setChatChannel } from '../core/chat-tools.js';
import { domainCheckResponse } from '../core/webaccess.js';
import { setOwnerToolRunner } from '../core/owner-assistant.js';
import { send, uploadAllowed, requestUser } from './http.js';
import { createAdminMcp } from './admin-mcp.js';
import { TOOLS as ADMIN_TOOLS } from './admin-tools.js';
import { panelAssets } from './assets.js';
import { authRoutes, bootstrapAuth } from './routes/auth.js';
import { googleRoutes } from './routes/google.js';
import { webRoutes } from './routes/web.js';
import { linkRoutes } from './routes/links.js';
import { statusRoutes } from './routes/status.js';
import { agentRoutes } from './routes/agents.js';
import { chatRoutes } from './routes/chats.js';
import { contactRoutes } from './routes/contacts.js';
import { systemRoutes } from './routes/system.js';
import { toolServiceRoutes } from './routes/tool-services.js';
import { insightRoutes } from './routes/insights.js';
import { ownerAssistantRoutes } from './routes/owner-assistant.js';
import { ownerAlertRoutes } from './routes/owner-alerts.js';
import { directChatRoutes } from './routes/direct-chats.js';
import { mediaRoutes } from './routes/media.js';

const ROLE_RANK = { viewer: 1, admin: 2, owner: 3 };

// ---------- helpers ----------
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 2e6) throw new Error('Body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function startPanel({ channel, extend = [] }) {
  bootstrapAuth();
  setChatChannel(channel);
  const routes = [];
  /** opts.role: minimum role (default: viewer for GET, admin otherwise). opts.public: no auth. */
  /** opts.raw: the handler reads the (binary) request body itself; see uploadAllowed() for the CSRF guard. */
  const route = (method, pattern, handler, opts = {}) => routes.push({
    method, handler, public: !!opts.public, raw: !!opts.raw,
    role: opts.role || (method === 'GET' ? 'viewer' : 'admin'),
    re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  });


  authRoutes(route, { channel }); // session, setup, sign-in, own password, users
  googleRoutes(route); // Sign in with Google, invites (019)
  webRoutes(route); // web address & access (031)
  linkRoutes(route, { invoke }); // POST /api/users (with a password or a sign-up link), one-time links (060)
  statusRoutes(route, { channel }); // status, live stream, settings, activity and logging
  agentRoutes(route, { channel });
  chatRoutes(route, { channel });
  contactRoutes(route, { channel });
  systemRoutes(route, { channel }); // pending, secrets, usage, server metrics & maintenance, WhatsApp numbers, restart

  // ---------- global tool services (035): Settings → Tool services ----------
  toolServiceRoutes(route);
  insightRoutes(route, { channel }); // silences (#34), first-run checklist (#36), test tools (#37)
  ownerAssistantRoutes(route, { channel }); // owner assistant, Ask box, privacy notice (044)

  // ---------- spending caps (040) and owner alerts / weekly summary (041) ----------
  ownerAlertRoutes(route, { channel });
  directChatRoutes(route, { channel }); // prepared direct chats + intro (049)
  mediaRoutes(route); // photos & voice (043)

  // Other features (providers, backups, updates) add their routes with the same role gates.
  for (const fn of [].concat(extend)) fn(route, { channel });

  // ---------- admin MCP for AI assistants (017) ----------
  // Tools run these same route handlers in-process as the approving user, with the same role gates.
  const findRoute = (method, pathname) => routes.find((x) => x.method === method && x.re.test(pathname));
  const routeRole = (method, path) => {
    const r = findRoute(method, new URL(path, 'http://x').pathname);
    return r ? (r.public ? 'viewer' : r.role) : null; // null: that feature's routes are not mounted
  };
  async function invoke(user, method, path, body = {}, { host = '' } = {}) {
    const url = new URL(path, 'http://x');
    const r = findRoute(method, url.pathname);
    if (!r) throw fail('Not found', 404);
    if (!r.public && ROLE_RANK[user.role] < ROLE_RANK[r.role]) {
      throw fail(user.role === 'viewer' ? 'Read-only account' : `Requires ${r.role} role`, 403);
    }
    const req = { method, url: path, headers: { host, 'content-type': 'application/json' }, socket: { remoteAddress: 'mcp' }, on() {} };
    const chunks = [];
    const res = {
      statusCode: 200, headersSent: false, setHeader() {}, on() {},
      writeHead(status) { this.statusCode = status; this.headersSent = true; return this; },
      write(c) { chunks.push(Buffer.from(c)); return true; },
      end(c) { if (c) chunks.push(Buffer.from(c)); },
    };
    let out = await r.handler(req, res, body ?? {}, url.searchParams, url.pathname.match(r.re).groups || {}, user);
    let status = 200;
    if (out === null) {
      status = res.statusCode;
      const text = Buffer.concat(chunks).toString('utf8');
      try { out = JSON.parse(text); } catch { out = text; }
    } else if (Array.isArray(out) && typeof out[0] === 'number' && out.length === 2) [status, out] = out;
    if (status >= 400) throw fail(out?.error || `Failed (${status})`, status);
    return out ?? { ok: true };
  }
  const adminMcp = createAdminMcp({ invoke, routeRole });
  setOwnerToolRunner({ invoke, routeRole, tools: ADMIN_TOOLS }); // the owner assistant runs the same tools in-process (044)
  adminMcp.panelRoutes(route);

  // The panel shell, its modules and icons: from memory, compressed, ETag/304 (058, 063: assets.js).
  const { shell, assets } = panelAssets();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return shell(req, res);
      }
      if (url.pathname === '/healthz') return send(res, 200, 'ok');
      // 036: domain reachability proof + Caddy's on-demand TLS "ask" (public, answers only one-time tokens).
      if (req.method === 'GET' && url.pathname.startsWith('/.well-known/duniya-check')) {
        const r = domainCheckResponse(url, req);
        return send(res, r.status, r.body, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      }
      if (req.method === 'GET' && Object.hasOwn(assets, url.pathname)) return assets[url.pathname](req, res, url);
      if (await adminMcp.handle(req, res, url)) return;
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Not found' });
      let user = null;
      if (!r.public) {
        user = requestUser(req);
        if (!user) return send(res, 401, { error: 'Login required' });
        if (ROLE_RANK[user.role] < ROLE_RANK[r.role]) {
          return send(res, 403, { error: user.role === 'viewer' ? 'Read-only account' : `Requires ${r.role} role` });
        }
      }
      if (req.method !== 'GET' && r.raw) {
        if (!uploadAllowed(req)) return send(res, 415, { error: 'Uploads must come from the panel' });
      } else if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 415, { error: 'JSON required' }); // CSRF guard (with SameSite=Strict)
      }
      const body = req.method === 'GET' || r.raw ? {} : await readBody(req);
      const out = await r.handler(req, res, body, url.searchParams, url.pathname.match(r.re).groups || {}, user);
      if (out === null) return;
      if (Array.isArray(out) && typeof out[0] === 'number' && out.length === 2) return send(res, out[0], out[1]);
      return send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 400, { error: e.message, code: e.code, field: e.field, needsConfirm: e.needsConfirm, warnings: e.warnings, check: e.check });
    }
  });
  server.listen(env.panelPort, env.panelHost, () => {
    console.log(`Admin panel on http://${env.panelHost}:${env.panelPort}`);
  });
  return server;
}

