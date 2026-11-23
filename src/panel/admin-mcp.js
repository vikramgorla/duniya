// @ts-check
// Admin MCP server (017): manage this app from AI assistants (ChatGPT, Claude, …) over MCP, signed in with OAuth.
// This app is both the authorization server and the resource server (MCP authorization spec 2025-06-18):
//   /.well-known/oauth-protected-resource[/mcp]  RFC 9728   /.well-known/oauth-authorization-server  RFC 8414
//   /oauth/register (RFC 7591, public clients)  /oauth/authorize (consent page)  /oauth/token  /oauth/revoke (RFC 7009)
//   /mcp  Streamable HTTP, stateless, JSON responses. Every call acts as the panel user who approved the assistant.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { APP_VERSION, REPO } from '../core/config.js';
import { authenticate, createSession, sessionUser } from '../core/store.js';
import { passwordLoginAllowed } from '../core/google-signin.js';
import { activity } from '../core/events.js';
import { toolPhrase } from './public/app/names.js';
import { sha256 } from '../core/crypto.js';
import {
  OAuthError, SCOPE, registerClient, getClient, createCode, exchangeCode, refreshTokens, revokeToken, validateAccess, normResource,
  saveGrant, listGrants, revokeGrant, createConfirm, takeConfirm, redirectAllowed,
} from '../core/admin-oauth.js';
import { baseUrl, clientIp, cookie, isHttps, minuteLimiter } from './http-util.js';
import { PAGE_CSP, pageHead } from './http.js';

/** The token of an `Authorization: Bearer <token>` header (linear-time parsing, no regex backtracking). */
function bearerToken(header) {
  const h = String(header || '').trim();
  if (h.length > 4096 || h.slice(0, 7).toLowerCase() !== 'bearer ') return undefined;
  const t = h.slice(7).trim();
  return t && !/\s/.test(t) ? t : undefined;
}
import { TOOLS, scrub, toolHints, toolTitle } from './admin-tools.js';

const ROLE_RANK = { viewer: 1, admin: 2, owner: 3 };
const MAX_OUTPUT = 60000;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id, mcp-protocol-version',
  'access-control-max-age': '600',
};
const CORS_PATHS = new Set(['/mcp', '/oauth/token', '/oauth/register', '/oauth/revoke', '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']);
const SECRET_ARGS = new Set(['value', 'password', 'passphrase']); // no tool takes these (060); a client sending one anyway is not logged
const redact = (args) => Object.fromEntries(Object.entries(args || {}).map(([k, v]) => [k, SECRET_ARGS.has(k) ? '•••' : v]));

/** What an assistant may do, in plain words, by panel role (consent page and Settings card). */
const ROLE_ABILITIES = {
  viewer: ['See agents, chats, activity, models, pending changes and server status', 'Nothing can be changed: this account is read-only'],
  admin: ['See everything in the panel', 'Change agents, chats, models, memory, secrets and pending changes', 'Send test messages to agents and run scheduled posts'],
  owner: ['Everything an admin can do', 'Manage users, backups, updates, WhatsApp numbers and server maintenance'],
};

export function createAdminMcp({ invoke, routeRole }) {
  const limitToken = minuteLimiter(60);
  const limitRegister = minuteLimiter(20);
  const limitLogin = minuteLimiter(5);
  // Minimum role per tool = the highest role of the panel routes it uses (null when a route is not mounted: hidden).
  const toolRole = new Map(TOOLS.map((t) => {
    const roles = t.calls.map(([m, p]) => routeRole(m, p));
    return [t.name, roles.includes(null) ? null : roles.reduce((a, b) => (ROLE_RANK[b] > ROLE_RANK[a] ? b : a), 'viewer')];
  }));
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  const allowed = (user, name) => !!toolRole.get(name) && ROLE_RANK[user.role] >= ROLE_RANK[toolRole.get(name)];
  const resourceOf = (req) => `${baseUrl(req)}/mcp`;

  // ---------- small HTTP helpers ----------
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  };
  async function rawBody(req, max = 1e6) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > max) throw new OAuthError('invalid_request', 'Body too large', 413); chunks.push(c); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function formBody(req) {
    const raw = await rawBody(req);
    if (String(req.headers['content-type'] || '').includes('application/json')) {
      try { return JSON.parse(raw || '{}'); } catch { throw new OAuthError('invalid_request', 'Invalid JSON'); }
    }
    return Object.fromEntries(new URLSearchParams(raw));
  }

  // ---------- metadata ----------
  const SERVER_INFO = { name: 'duniya-admin', title: 'Duniya admin', version: APP_VERSION.replace(/^v/, ''), websiteUrl: REPO.pages,
    description: 'Manage a self-hosted Duniya server (AI agents for WhatsApp and Telegram): agents, chats, people, events, models, backups and updates. Risky changes need a confirmation.' };
  const resourceMetadata = (req) => ({
    resource: resourceOf(req), authorization_servers: [baseUrl(req)], scopes_supported: [SCOPE], bearer_methods_supported: ['header'],
    resource_name: 'Duniya admin',
  });
  const serverMetadata = (req) => {
    const b = baseUrl(req);
    return {
      issuer: b, authorization_endpoint: `${b}/oauth/authorize`, token_endpoint: `${b}/oauth/token`, registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`, response_types_supported: ['code'], response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    };
  };

  // ---------- consent page ----------
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const PARAMS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];
  const hidden = (p) => PARAMS.filter((k) => p[k] != null && p[k] !== '').map((k) => `<input type=hidden name="${k}" value="${esc(p[k])}">`).join('');
  // The Duniya mark (DESIGN.md, Mark), the panel's own file
  const LOGO = '<img src="/icons/logo-small.svg" width="40" height="40" alt="">';
  // 070: the shared page look (/page.css, /page.js) under PAGE_CSP: no inline style or script.
  function page(res, status, { title, body, formTo = '', bounce = false }) {
    const csp = PAGE_CSP.replace("form-action 'self'", `form-action 'self'${formTo ? ` ${formTo}` : ''}`);
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': csp });
    res.end(`${pageHead(`${title} · Duniya`)}<body${bounce ? ' data-bounce' : ''}><main class=consent>${LOGO}${body}</main><script src="/page.js"></script></body></html>`);
  }
  const errorPage = (res, msg) => page(res, 400, { title: 'Cannot connect', body: `<h1>This connection link does not work</h1><div class="note bad">${esc(msg)}</div><p class="small muted">Go back to your AI assistant and add the connector again.</p>` });

  /** Validates an authorization request. Errors before the redirect URI is known are shown here, never redirected. */
  function checkRequest(req, p) {
    const client = getClient(p.client_id);
    if (!client) return { fatal: 'Unknown app (client_id). It may have been registered on another server.' };
    const redirectUri = p.redirect_uri || (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
    if (!redirectAllowed(client, redirectUri)) return { fatal: 'The return address (redirect_uri) is not the one this app registered.' };
    const back = (error, description) => ({ client, redirectUri, error, description });
    if (p.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported');
    if (!p.code_challenge || p.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    const base = baseUrl(req);
    const wanted = p.resource ? normResource(p.resource) : `${base}/mcp`;
    if (wanted !== `${base}/mcp` && wanted !== base) return back('invalid_target', `Unknown resource; use ${base}/mcp`);
    return { client, redirectUri, resource: `${base}/mcp` };
  }
  const redirectTo = (uri, params) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
    return u.toString();
  };
  const csrfFor = (token) => sha256(`consent:${token}`).slice(0, 32);

  // Where the browser goes after the form (CSP form-action also covers the redirect that follows the POST).
  const formTarget = (uri) => new URL(uri).origin;
  function consentPage({ req, res, p, chk, user, sessionToken }) {
    const abilities = ROLE_ABILITIES[user.role] || ROLE_ABILITIES.viewer;
    const host = new URL(chk.redirectUri).host;
    page(res, 200, { title: `Connect ${chk.client.name}`, formTo: formTarget(chk.redirectUri), body: `
<h1>Connect ${esc(chk.client.name)}?</h1>
<p class=muted><b>${esc(chk.client.name)}</b> <span class=small>(returns to <code>${esc(host)}</code>)</span> wants to manage this Duniya app for you.</p>
<p>It acts as <b>${esc(user.username)}</b> <span class=pill>${esc(user.role)}</span> and can:</p>
<ul>${abilities.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
${user.role === 'viewer' ? '' : '<div class=note>Risky actions (deleting an agent, erasing memory, removing secrets or users, removing a WhatsApp number, restoring a backup, updates and restarts) always need a second confirmation step.</div>'}
<p class="small muted">Only approve if you just added this connector yourself. You can disconnect it any time in Settings → Connected AI assistants.</p>
<form method=post action="/oauth/authorize" class=actions>${hidden(p)}<input type=hidden name=csrf value="${csrfFor(sessionToken)}">
<button class="btn primary" name=action value=approve>Approve</button><button class="btn danger" name=action value=deny>Deny</button></form>` });
  }
  function loginPage(res, p, chk, { error = '', bounce = false } = {}) {
    // The session cookie is SameSite=Strict, so it is not sent when ChatGPT/Claude send the browser here. Reloading the
    // page from itself (same-site) brings the cookie along; if there is still no session, the user signs in here.
    page(res, error ? 401 : 200, { title: 'Sign in', body: `
<h1>Sign in to connect ${esc(chk.client.name)}</h1>
<p class="muted small">Use your Duniya panel account. Next you will see what ${esc(chk.client.name)} will be allowed to do.</p>
${error ? `<div class="note bad">${esc(error)}</div>` : ''}
${passwordLoginAllowed() ? '' : `<div class=note>Password sign-in is switched off on this panel. Sign in with Google in a new tab, then come back and press Continue.</div>
<div class=actions><a class="btn primary" href="/auth/google/start" target=_blank rel=noopener>Sign in with Google</a><a class=btn href="">Continue</a></div>`}
<form method=post action="/oauth/authorize"${passwordLoginAllowed() ? '' : ' hidden'}>${hidden(p)}
<label for=u>Username</label><input type=text id=u name=username autocomplete=username autocapitalize=none required value="admin">
<label for=pw>Password</label><input type=password id=pw name=password autocomplete=current-password required autofocus>
<div class=actions><button class="btn primary" name=action value=login>Sign in</button><button class="btn" name=action value=deny formnovalidate>Cancel</button></div></form>`,
    bounce });
  }

  async function authorize(req, res, url) {
    const p = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await formBody(req);
    const chk = checkRequest(req, p);
    if (chk.fatal) return errorPage(res, chk.fatal);
    if (chk.error) { res.writeHead(302, { location: redirectTo(chk.redirectUri, { error: chk.error, error_description: chk.description, state: p.state, iss: baseUrl(req) }) }); return res.end(); }
    let token = cookie(req, 'duniya_session');
    let user = sessionUser(token);
    if (req.method === 'GET') return user ? consentPage({ req, res, p, chk, user, sessionToken: token }) : loginPage(res, p, chk, { bounce: p._s !== '1' });

    if (p.action === 'deny') {
      res.writeHead(302, { location: redirectTo(chk.redirectUri, { error: 'access_denied', error_description: 'The user denied access', state: p.state, iss: baseUrl(req) }) });
      return res.end();
    }
    if (p.action === 'login') {
      const ip = clientIp(req);
      if (limitLogin(`login:${ip}`)) return loginPage(res, p, chk, { error: 'Too many attempts, wait a minute.' });
      if (!passwordLoginAllowed()) return loginPage(res, p, chk, { error: 'Password sign-in is switched off. Use Sign in with Google.' });
      user = authenticate(p.username || 'admin', String(p.password || ''));
      if (!user) { activity('system', { summary: `Panel login failed for "${p.username || 'admin'}" from ${ip} (AI assistant sign-in)` }); return loginPage(res, p, chk, { error: 'Wrong username or password.' }); }
      const s = createSession(user.id, ip);
      token = s.token;
      res.setHeader('set-cookie', `duniya_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${s.maxAge}${isHttps(req) ? '; Secure' : ''}`);
      activity('system', { summary: `Panel login: ${user.username} from ${ip} (AI assistant sign-in)` });
      return consentPage({ req, res, p, chk, user, sessionToken: token });
    }
    if (p.action === 'approve') {
      if (!user) return loginPage(res, p, chk, { error: 'Your session ended. Sign in again.' });
      if (p.csrf !== csrfFor(token)) return errorPage(res, 'This approval form is out of date. Start again from your AI assistant.');
      saveGrant(user.id, chk.client.clientId);
      activity('config', { summary: `AI assistant "${chk.client.name}" connected by ${user.username} (${user.role}), returns to ${new URL(chk.redirectUri).host}` });
      const code = createCode({ clientId: chk.client.clientId, userId: user.id, redirectUri: chk.redirectUri, codeChallenge: p.code_challenge, resource: chk.resource });
      res.writeHead(302, { location: redirectTo(chk.redirectUri, { code, state: p.state, iss: baseUrl(req) }) });
      return res.end();
    }
    return user ? consentPage({ req, res, p, chk, user, sessionToken: token }) : loginPage(res, p, chk);
  }

  async function token(req, res) {
    const f = await formBody(req);
    const client = getClient(f.client_id);
    if (!client) throw new OAuthError('invalid_client', 'Unknown client_id', 401);
    if (f.grant_type === 'authorization_code') {
      return json(res, 200, exchangeCode({ code: f.code, clientId: client.clientId, redirectUri: f.redirect_uri, codeVerifier: f.code_verifier, resource: f.resource }));
    }
    if (f.grant_type === 'refresh_token') return json(res, 200, refreshTokens({ refreshToken: f.refresh_token, clientId: client.clientId, resource: f.resource }));
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }

  // ---------- MCP ----------
  async function callTool(name, args, ctx) {
    const started = Date.now();
    const { user, client } = ctx;
    const log = (ok, extra = '') => activity('mcp.call', {
      summary: `${toolPhrase(name)} · ${user.username} via ${client.name}${ok ? '' : ` — ${extra}`}`.slice(0, 300), // #136: plain words; the tool name is in detail
      detail: { tool: name, args: redact(args), ok, ms: Date.now() - started, client: client.name, user: user.username },
    });
    const fail = (msg) => { log(false, msg); return { isError: true, content: [{ type: 'text', text: msg }] }; };
    const tool = byName.get(name);
    if (name === 'confirm_action') return confirmAction(args, ctx, log, fail);
    if (!tool || !toolRole.get(name)) return fail(`Unknown tool: ${name}`);
    if (!allowed(user, name)) return fail(user.role === 'viewer' ? 'Read-only account: this assistant was approved by a viewer and cannot change anything.' : `Requires the ${toolRole.get(name)} role in the panel.`);
    const missing = (tool.required || []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
    if (missing.length) return fail(`Missing: ${missing.join(', ')}`);
    try {
      if (typeof tool.risky === 'function' ? tool.risky(args) : tool.risky) { // 049: some tools are risky only with some arguments
        const preview = await tool.preview(args, ctx.x);
        const code = createConfirm({ userId: user.id, clientId: client.clientId, tool: name, args, preview });
        activity('confirm.created', { summary: `${preview} — asked by ${user.username} via ${client.name}, waiting for confirm_action (${code})`.slice(0, 480) });
        log(true);
        return { content: [{ type: 'text', text: `Not done yet. ${preview}\n\nAsk the user to confirm. If they agree, call confirm_action with {"confirm_code": "${code}"} (valid 10 minutes, once).` }],
          structuredContent: { status: 'needs_confirmation', preview, confirm_code: code, expires_in_seconds: 600 } };
      }
      const out = await tool.run(args, ctx.x);
      log(true);
      return result(out);
    } catch (e) { return fail(e.message || String(e)); }
  }
  async function confirmAction(args, ctx, log, fail) {
    const { user, client } = ctx;
    let c;
    try { c = takeConfirm(args.confirm_code, { userId: user.id, clientId: client.clientId }); } catch (e) { return fail(e.message); }
    if (!allowed(user, c.tool)) return fail(`Your role no longer allows ${c.tool}.`);
    try {
      const out = await byName.get(c.tool).run(c.args, ctx.x);
      activity('confirm.applied', { summary: `${c.preview} — confirmed by ${user.username} via ${client.name}`.slice(0, 480) });
      log(true);
      return result({ done: true, action: c.tool, result: out });
    } catch (e) { return fail(`${c.tool} failed: ${e.message}`); }
  }
  function result(out) {
    let text = JSON.stringify(scrub(out ?? { ok: true }));
    if (text.length > MAX_OUTPUT) text = `${text.slice(0, MAX_OUTPUT)}… (truncated; ask for less, e.g. a smaller limit)`;
    return { content: [{ type: 'text', text }] };
  }
  // 084: confirm_action carries out any risky tool: destructive, idempotent (a code works once; repeating it changes
  // nothing), open-world when some risky tool is.
  const CONFIRM = {
    name: 'confirm_action',
    description: 'Carry out a risky action that a tool previewed (it returned a confirm_code). Only call this after the user has read the preview and said yes.',
    input: { confirm_code: { type: 'string', description: 'The confirm_code from the preview' } }, required: ['confirm_code'],
    destructive: true, idempotent: true, openWorld: TOOLS.some((t) => t.risky && t.openWorld),
  };
  const toolDef = (t) => ({
    name: t.name, title: toolTitle(t.name), description: t.description,
    inputSchema: { type: 'object', properties: t.input, ...(t.required ? { required: t.required } : {}) },
    annotations: { title: toolTitle(t.name), ...toolHints(t) },
  });
  const toolDefs = (user) => [...TOOLS.filter((t) => allowed(user, t.name)), ...(ROLE_RANK[user.role] >= ROLE_RANK.admin ? [CONFIRM] : [])].map(toolDef);

  async function mcp(req, res) {
    const bearer = bearerToken(req.headers.authorization);
    const auth = validateAccess(bearer, resourceOf(req));
    if (!auth) {
      const meta = `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
      return json(res, 401, { error: bearer ? 'invalid_token' : 'unauthorized', error_description: 'Sign in with OAuth to use this MCP server' }, {
        'www-authenticate': `Bearer resource_metadata="${meta}"${bearer ? ', error="invalid_token"' : ''}`,
      });
    }
    if (req.method !== 'POST') return json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST' }, id: null }, { allow: 'POST' });
    if (limitToken(auth.tokenHash)) return json(res, 429, { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests (60 per minute). Wait a moment.' }, id: null }, { 'retry-after': '30' });
    let body;
    try { body = JSON.parse((await rawBody(req, 2e6)) || 'null'); } catch { return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }); }
    const ctx = { user: auth.user, client: auth.client };
    ctx.x = { call: (method, path, b) => invoke(auth.user, method, path, b, { host: req.headers.host }) };
    const server = new Server({ ...SERVER_INFO, icons: [{ src: `${baseUrl(req)}/icons/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] }] }, {
      capabilities: { tools: {} },
      instructions: `You manage a self-hosted AI agent platform for WhatsApp and Telegram ("Duniya") as panel user ${auth.user.username} (${auth.user.role}). `
        + 'Use the list/get tools to look before changing anything. Risky tools return a preview and a confirm_code: show the preview to the user and call confirm_action only after they agree. '
        + 'Never ask the user for keys, passwords or passphrases: set_secret and add_user return one-time links where people enter them in the panel.',
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs(auth.user) }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => callTool(r.params.name, r.params.arguments || {}, ctx));
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { tr.close().catch(() => {}); server.close().catch(() => {}); }); // the client is gone: nothing left to tell
    await server.connect(tr);
    await tr.handleRequest(req, res, body);
  }

  /** Handles the admin MCP and OAuth paths. Returns true when the request was one of them. */
  async function handle(req, res, url) {
    const path = url.pathname;
    const isOurs = CORS_PATHS.has(path) || path === '/oauth/authorize';
    if (!isOurs) return false;
    if (CORS_PATHS.has(path)) {
      for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
    }
    try {
      if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
        if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }), true;
        json(res, 200, resourceMetadata(req), { 'cache-control': 'max-age=300' });
      } else if (path === '/.well-known/oauth-authorization-server') {
        if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }), true;
        json(res, 200, serverMetadata(req), { 'cache-control': 'max-age=300' });
      } else if (path === '/oauth/register') {
        if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }), true;
        if (limitRegister(`reg:${clientIp(req)}`)) throw new OAuthError('slow_down', 'Too many registrations, wait a minute', 429);
        const meta = await formBody(req);
        const out = registerClient(meta);
        activity('mcp.register', { summary: `AI assistant registered: "${out.client_name}" (${new URL(out.redirect_uris[0]).host})` });
        json(res, 201, out);
      } else if (path === '/oauth/authorize') {
        if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' }), true;
        await authorize(req, res, url);
      } else if (path === '/oauth/token') {
        if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }), true;
        await token(req, res);
      } else if (path === '/oauth/revoke') {
        if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }), true;
        const f = await formBody(req);
        revokeToken({ token: f.token, clientId: f.client_id || '' });
        json(res, 200, {});
      } else if (path === '/mcp') {
        await mcp(req, res);
      }
    } catch (e) {
      if (res.headersSent) return true;
      if (e instanceof OAuthError) json(res, e.status, e.toJSON());
      else { activity('error', { summary: `Admin MCP ${path}: ${e.message}` }); json(res, 500, { error: 'server_error', error_description: 'Something went wrong' }); }
    }
    return true;
  }

  // ---------- panel: Settings → Connected AI assistants ----------
  function panelRoutes(route) {
    route('GET', '/api/assistants', async ({ req, user }) => {
      const base = baseUrl(req);
      return {
        mcpUrl: `${base}/mcp`, https: base.startsWith('https://'), publicUrlSet: !!process.env.PUBLIC_URL,
        abilities: ROLE_ABILITIES[user.role], grants: listGrants(user.role === 'owner' ? {} : { userId: user.id }), you: user.id,
      };
    }, { role: 'viewer' });
    // Anyone can disconnect their own assistants; owners can disconnect anyone's.
    route('DELETE', '/api/assistants/:userId/:clientId', async ({ params, user }) => {
      const uid = Number(params.userId);
      if (uid !== user.id && user.role !== 'owner') return [403, { error: 'Only owners can disconnect other people\'s assistants' }];
      const g = listGrants({ userId: uid }).find((x) => x.clientId === params.clientId);
      if (!revokeGrant(uid, params.clientId)) return [404, { error: 'Not connected' }];
      activity('config', { summary: `AI assistant "${g?.clientName || params.clientId}" of ${g?.username || `user #${uid}`} disconnected by ${user.username}` });
      return { ok: true };
    }, { role: 'viewer' });
  }

  return { handle, panelRoutes, tools: TOOLS, toolRole };
}
