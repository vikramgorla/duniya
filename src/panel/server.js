// @ts-check
// The panel's HTTP server (src/panel): the router with its role gates and CSRF guard, the admin MCP's in-process
// calls, and the static panel files. Routes live in routes/<area>.js, registered here in one place.
import http from 'node:http';
import { env, fail } from '../core/config.js';
import { activity } from '../core/events.js';
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
import { peopleRoutes } from './routes/people.js';
import { systemRoutes } from './routes/system.js';
import { toolServiceRoutes } from './routes/tool-services.js';
import { insightRoutes } from './routes/insights.js';
import { ownerAssistantRoutes } from './routes/owner-assistant.js';
import { ownerAlertRoutes } from './routes/owner-alerts.js';
import { directChatRoutes } from './routes/direct-chats.js';
import { mediaRoutes } from './routes/media.js';
import { paceRoutes } from './routes/pace.js';
import { moduleRoutes } from './routes/modules.js';
import { lessonRoutes } from './routes/lessons.js';
import { promiseRoutes } from './routes/promises.js';

/** Why a service, provider or address could not be reached, for an owner ('' when the error is something else). */
function unreachable(e) {
  if (!e?.cause && e?.code === undefined) return ''; // our own messages are already plain; only wrapped system errors
  let text = '';
  for (let x = e; x && text.length < 2000; x = x.cause) text += ` ${x.code || ''} ${x.message || ''}`;
  if (/ECONNREFUSED/.test(text)) return 'The service refused the connection: is it running at that address?';
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return 'That address could not be found: check its spelling.';
  if (/CERT|self[- ]signed|UNABLE_TO_VERIFY|SSL|TLS/i.test(text)) return 'The service\'s HTTPS certificate is not valid, so it was not used.';
  if (/-32001|timed? ?out|ETIMEDOUT|did not answer in time/i.test(text)) return 'The service did not answer in time. Try again in a minute.';
  if (/\b401\b|Unauthorized/i.test(text)) return 'The service refused the key or sign-in (401).';
  if (/fetch failed|ECONNRESET|socket hang up|EHOSTUNREACH|ENETUNREACH/i.test(text)) return 'Could not reach the service. Check its address and that it is online.';
  return '';
}
const ROLE_RANK = { viewer: 1, admin: 2, owner: 3 };
const BODY_MAX = 2e6; // bytes of a JSON or form body
// A programming error (not a refused request): answered as 500 without its internals, and kept where the owner and a
// developer find it. Before, it reached the panel as a 400 with the raw message and left no trace.
const isBug = (e) => e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError;
function reportBug(method, path, e) {
  console.error(`panel ${method} ${path}:`, e);
  try { activity('error', { summary: `The panel hit an error on ${method} ${path}: ${e.message}` }); } catch { /* the database may be the problem */ }
}

// ---------- helpers ----------
async function readBody(req, form = false) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > BODY_MAX) throw fail('That is too large to send', 413); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (form) return new URLSearchParams(raw);
  try { return raw ? JSON.parse(raw) : {}; } catch { throw fail('The request was not valid JSON', 400); }
}
/** 083: a plain HTML form of a public page (survey links): urlencoded, and the browser says it comes from this site. */
function formAllowed(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) return false;
  try { return new URL(String(req.headers.origin || '')).host === req.headers.host; } catch { return false; }
}

const mayNot = (user, r) => fail(user.role === 'viewer' ? 'Read-only account' : `Requires ${r.role} role`, 403);
/** Who asks, when they may use this route (public routes: nobody needs to sign in); throws 401 / 403 otherwise. */
function userFor(r, req) {
  if (r.public) return null;
  const user = requestUser(req);
  if (!user) throw fail('Login required', 401);
  if (ROLE_RANK[user.role] < ROLE_RANK[r.role]) throw mayNot(user, r);
  return user;
}
/**
 * The guard against requests another site makes for a signed-in user (with SameSite=Strict): what changes something
 * comes as JSON, as the panel's own upload, or as a form sent from its own page. Throws otherwise.
 */
function guardBody(r, req) {
  if (req.method === 'GET') return;
  if (r.raw) { if (!uploadAllowed(req)) throw fail('Uploads must come from the panel', 415); return; }
  if (r.form) { if (!formAllowed(req)) throw fail('Send the form from its page', 403); return; }
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail('JSON required', 415);
}
/** What a handler returned, on the wire: null (it answered by itself), [status, answer], or the answer. */
function answer(res, out) {
  if (out === null) return;
  if (Array.isArray(out) && typeof out[0] === 'number' && out.length === 2) return send(res, out[0], out[1]);
  return send(res, 200, out ?? { ok: true });
}
/** A request that threw: its own status and words; a service that could not be reached in plain words (2.56); a bug is recorded and answered as a 500. */
function answerError(req, res, url, e) {
  const plain = e.status ? '' : unreachable(e);
  if (plain) console.warn(`panel ${req.method} ${url.pathname}: ${e.message}`);
  const bug = !e.status && !plain && isBug(e);
  if (bug) reportBug(req.method, url.pathname, e);
  if (res.headersSent) return;
  send(res, e.status || (plain ? 502 : bug ? 500 : 400), { error: plain || (bug ? 'Something went wrong on the server. It is in Activity; please try again.' : e.message),
    code: e.code, field: e.field, needsConfirm: e.needsConfirm, warnings: e.warnings, check: e.check });
}

export function startPanel({ channel, extend = [] }) {
  bootstrapAuth();
  setChatChannel(channel);
  const routes = [];
  /**
   * Register a route. The handler gets one object and names what it needs: `req`, `res` (to answer by itself: return
   * null), `body` (parsed JSON; a URLSearchParams for opts.form), `query` (the URL's search parameters), `params` (the
   * `:name` parts of the pattern) and `user` (the signed-in user; undefined on public routes). It returns the answer
   * (JSON, 200), `[status, answer]`, or throws `fail(message, status)`.
   * opts.role: minimum role (default: viewer for GET, admin otherwise). opts.public: no auth.
   * opts.raw: the handler reads the (binary) request body itself; see uploadAllowed() for the CSRF guard.
   * opts.form (083, public pages): the body is a same-origin HTML form; see formAllowed().
   */
  const route = (method, pattern, handler, opts = {}) => routes.push({
    method, handler, public: !!opts.public, raw: !!opts.raw, form: !!opts.form,
    role: opts.role || (method === 'GET' ? 'viewer' : 'admin'),
    re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  });


  authRoutes(route, { channel }); // session, setup, sign-in, own password, users
  googleRoutes(route); // Sign in with Google, invites (019)
  webRoutes(route); // web address & access (031)
  linkRoutes(route, { invoke }); // POST /api/users (with a password or a sign-up link), one-time links (060)
  statusRoutes(route, { channel }); // status, live stream, settings, activity and logging
  agentRoutes(route, { channel });
  lessonRoutes(route, { channel }); // 089: lessons and join-in feedback
  promiseRoutes(route, { channel }); // 091: commitments, people's preferences, suggested ties
  chatRoutes(route, { channel });
  peopleRoutes(route, { channel }); // People (078): people, households, lists
  systemRoutes(route, { channel }); // pending, secrets, usage, server metrics & maintenance, WhatsApp numbers, restart

  // ---------- global tool services (035): Settings → Tool services ----------
  toolServiceRoutes(route);
  insightRoutes(route, { channel }); // silences (#34), first-run checklist (#36), test tools (#37)
  ownerAssistantRoutes(route, { channel }); // owner assistant, Ask box, privacy notice (044)

  // ---------- spending caps (040) and owner alerts / weekly summary (041) ----------
  ownerAlertRoutes(route, { channel });
  directChatRoutes(route, { channel }); // prepared direct chats + intro (049)
  mediaRoutes(route); // photos & voice (043)
  paceRoutes(route); // sending pace (080)
  moduleRoutes(route); // modules, events, orders (081)

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
    if (!r.public && ROLE_RANK[user.role] < ROLE_RANK[r.role]) throw mayNot(user, r);
    const req = { method, url: path, headers: { host, 'content-type': 'application/json' }, socket: { remoteAddress: 'mcp' }, on() {} };
    const chunks = [];
    const res = {
      statusCode: 200, headersSent: false, setHeader() {}, on() {},
      writeHead(status) { this.statusCode = status; this.headersSent = true; return this; },
      write(c) { chunks.push(Buffer.from(c)); return true; },
      end(c) { if (c) chunks.push(Buffer.from(c)); },
    };
    let out = await r.handler({ req, res, body: body ?? {}, query: url.searchParams, params: url.pathname.match(r.re).groups || {}, user });
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
  /** What needs no route: the shell, the health probe, the domain check, the panel's files and the admin MCP. True when answered. */
  async function serveBuiltIn(req, res, url) {
    const get = req.method === 'GET';
    if (get && (url.pathname === '/' || url.pathname === '/index.html')) { await shell(req, res); return true; }
    if (url.pathname === '/healthz') { send(res, 200, 'ok'); return true; }
    // 036: domain reachability proof + Caddy's on-demand TLS "ask" (public, answers only one-time tokens).
    if (get && url.pathname.startsWith('/.well-known/duniya-check')) {
      const r = domainCheckResponse(url, req);
      send(res, r.status, r.body, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return true;
    }
    if (get && Object.hasOwn(assets, url.pathname)) { await assets[url.pathname](req, res, url); return true; }
    return adminMcp.handle(req, res, url);
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (await serveBuiltIn(req, res, url)) return;
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw fail('Not found', 404);
      const user = userFor(r, req);
      guardBody(r, req);
      const body = req.method === 'GET' || r.raw ? {} : await readBody(req, r.form);
      answer(res, await r.handler({ req, res, body, query: url.searchParams, params: url.pathname.match(r.re).groups || {}, user }));
    } catch (e) { answerError(req, res, url, e); }
  });
  server.listen(env.panelPort, env.panelHost, () => {
    console.log(`Admin panel on http://${env.panelHost}:${env.panelPort}`);
  });
  return server;
}

