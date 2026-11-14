// Sign in to tool services (MCP servers) with OAuth (009).
// Uses the MCP SDK's standard flow (RFC 9728 discovery, RFC 8414, dynamic registration, PKCE S256, resource
// indicator, refresh) with a provider backed by an encrypted table, one connection per bot × service × role.
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { db } from './db.js';
import { TENANT } from './store.js';
import { encrypt, decrypt, newToken } from './crypto.js';
import { activity } from './events.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_oauth (
    tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, server TEXT NOT NULL, role TEXT NOT NULL,
    url TEXT NOT NULL, data_enc TEXT NOT NULL, status TEXT NOT NULL, connected_by TEXT,
    connected_at INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, bot_id, server, role)
  );
`);

export const OAUTH_ROLES = ['organizer', 'participant'];
const PENDING_TTL = 10 * 60 * 1000;
const pending = new Map(); // state -> { botId, server, role, url, redirectUri, by, data, codeVerifier, expires }
const listeners = new Set();
export const onOAuthChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* ignore */ } } };

function row(botId, server, role) {
  return db.prepare('SELECT * FROM mcp_oauth WHERE tenant_id = ? AND bot_id = ? AND server = ? AND role = ?').get(TENANT, botId, server, role);
}
function readData(r) {
  try { return JSON.parse(decrypt(r.data_enc)); } catch { return {}; }
}
function writeRow({ botId, server, role, url, data, status, by }) {
  const now = Date.now();
  const prev = row(botId, server, role);
  db.prepare(`INSERT OR REPLACE INTO mcp_oauth (tenant_id, bot_id, server, role, url, data_enc, status, connected_by, connected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(TENANT, botId, server, role, url, encrypt(JSON.stringify(data)), status,
    by ?? prev?.connected_by ?? '', by ? now : (prev?.connected_at ?? now), now);
}
function setStatus(botId, server, role, status) {
  db.prepare('UPDATE mcp_oauth SET status = ?, updated_at = ? WHERE tenant_id = ? AND bot_id = ? AND server = ? AND role = ?')
    .run(status, Date.now(), TENANT, botId, server, role);
}

/** True when this role has a usable (or refreshable) sign-in for the service at `url`. */
export function isConnected(botId, server, role, url) {
  const r = row(botId, server, role);
  return !!r && r.url === url && r.status === 'connected';
}

export function listConnections(botId) {
  return db.prepare('SELECT server, role, url, status, connected_by, connected_at FROM mcp_oauth WHERE tenant_id = ? AND bot_id = ?').all(TENANT, botId)
    .map((r) => ({ server: r.server, role: r.role, url: r.url, status: r.status, connectedBy: r.connected_by, connectedAt: r.connected_at }));
}

export function disconnect(botId, server, role, by = '') {
  const n = db.prepare('DELETE FROM mcp_oauth WHERE tenant_id = ? AND bot_id = ? AND server = ? AND role = ?').run(TENANT, botId, server, role).changes;
  if (n) { activity('config', { bot: botId, summary: `Signed out of ${server} (${role})${by ? ` by ${by}` : ''}` }); changed(); }
  return n > 0;
}

export function deleteBotConnections(botId) {
  db.prepare('DELETE FROM mcp_oauth WHERE tenant_id = ? AND bot_id = ?').run(TENANT, botId);
  changed();
}

/**
 * OAuthClientProvider. Interactive providers keep everything in the pending sign-in until it completes;
 * runtime providers read/write the stored row (token refresh) and mark the row when a new sign-in is needed.
 */
class Provider {
  constructor({ botId, server, role, url, redirectUri, pendingState = null, client = null }) {
    Object.assign(this, { botId, server, role, url, pendingState });
    this.fixedClient = client?.id ? { client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}) } : null;
    this.interactive = !!pendingState;
    if (this.interactive) {
      this.data = pendingState.data;
      this._redirect = redirectUri;
    } else {
      const r = row(botId, server, role);
      this.data = r ? readData(r) : {};
      this._redirect = this.data.redirectUri || redirectUri || 'http://localhost/oauth/mcp/callback';
    }
    this.authorizeUrl = null;
  }

  get redirectUrl() { return this._redirect; }
  get clientMetadata() {
    return {
      client_name: 'whatsapp-agent-duniya', client_uri: 'https://github.com/vikramgorla/whatsapp-agent-duniya',
      redirect_uris: [this._redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: this.fixedClient?.client_secret ? 'client_secret_basic' : 'none',
    };
  }
  state() { return this.pendingState?.state; }
  clientInformation() { return this.fixedClient || this.data.client; }
  get saveClientInformation() {
    if (this.fixedClient) return undefined; // a pre-registered app is never re-registered
    return (info) => { this.data.client = info; this.data.redirectUri = this._redirect; this.persist(); };
  }
  tokens() { return this.data.tokens; }
  saveTokens(tokens) {
    this.data.tokens = tokens; this.data.tokensAt = Date.now(); this.data.redirectUri = this._redirect;
    this.persist('connected');
  }
  saveCodeVerifier(v) { if (this.pendingState) this.pendingState.codeVerifier = v; }
  codeVerifier() {
    if (!this.pendingState?.codeVerifier) throw new Error('Sign-in was not started from this panel');
    return this.pendingState.codeVerifier;
  }
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') delete this.data.client;
    if (scope === 'all' || scope === 'tokens') delete this.data.tokens;
    this.persist();
  }
  redirectToAuthorization(url) {
    if (this.interactive) { this.authorizeUrl = url.toString(); return; }
    // At runtime a new sign-in means the refresh failed: stop and ask an admin to reconnect.
    if (row(this.botId, this.server, this.role)?.status !== 'reconnect') {
      setStatus(this.botId, this.server, this.role, 'reconnect');
      activity('error', { bot: this.botId, summary: `Sign-in to ${this.server} (${this.role}) expired: reconnect it in the panel` });
      changed();
    }
    throw Object.assign(new Error(`Sign-in to "${this.server}" expired. An admin needs to reconnect it in the panel.`), { reconnect: true });
  }
  persist(status) {
    if (this.interactive) return; // stored only when the sign-in completes
    if (!row(this.botId, this.server, this.role)) return;
    writeRow({ botId: this.botId, server: this.server, role: this.role, url: this.url, data: this.data,
      status: status || row(this.botId, this.server, this.role).status });
  }
}

/** Provider used by MCP connections at runtime (adds the bearer token, refreshes it on 401). */
export const runtimeProvider = (botId, server, role, url, client = null) => new Provider({ botId, server, role, url, client });

function sweep() {
  for (const [k, p] of pending) if (p.expires < Date.now()) pending.delete(k);
}

/** Start a sign-in; returns the service's authorization URL to open in the browser. */
export async function startSignIn({ botId, server, role, url, redirectUri, by = '', client = null }) {
  if (!OAUTH_ROLES.includes(role)) throw Object.assign(new Error('Unknown role'), { status: 400 });
  sweep();
  const state = newToken(24);
  const p = { state, botId, server, role, url, redirectUri, by, client, data: {}, expires: Date.now() + PENDING_TTL };
  pending.set(state, p);
  const prov = new Provider({ botId, server, role, url, redirectUri, pendingState: p, client });
  try {
    const result = await auth(prov, { serverUrl: url });
    if (result === 'AUTHORIZED') throw new Error('The service did not ask for a sign-in');
    if (!prov.authorizeUrl) throw new Error('The service did not return a sign-in page');
    return { authorizeUrl: prov.authorizeUrl };
  } catch (e) {
    pending.delete(state);
    throw Object.assign(new Error(`Could not start sign-in to ${server}: ${e.message}`), { status: 400 });
  }
}

/** Finish a sign-in from the callback (?code&state or ?error). Returns { botId, server, role }. */
export async function finishSignIn({ state, code, error, errorDescription }) {
  sweep();
  const p = state && pending.get(state);
  if (!p) throw new Error('This sign-in link has expired or was already used. Start again from the panel.');
  pending.delete(state);
  if (error) throw Object.assign(new Error(`The service did not approve the sign-in (${errorDescription || error}).`), { botId: p.botId });
  if (!code) throw Object.assign(new Error('The service returned no authorization code.'), { botId: p.botId });
  const prov = new Provider({ ...p, pendingState: p, client: p.client });
  try {
    const result = await auth(prov, { serverUrl: p.url, authorizationCode: code });
    if (result !== 'AUTHORIZED' || !p.data.tokens) throw new Error('no tokens received');
  } catch (e) {
    throw Object.assign(new Error(`Sign-in to ${p.server} failed: ${e.message}`), { botId: p.botId });
  }
  writeRow({ botId: p.botId, server: p.server, role: p.role, url: p.url, data: { ...p.data, redirectUri: p.redirectUri }, status: 'connected', by: p.by || 'admin' });
  activity('config', { bot: p.botId, summary: `Signed in to ${p.server} for ${p.role}s${p.by ? ` by ${p.by}` : ''}` });
  changed();
  return { botId: p.botId, server: p.server, role: p.role };
}

/**
 * Check a tool service URL: follows permanent redirects and reports whether it needs OAuth.
 * Returns { url, auth: 'oauth' | 'token' | 'none', name? }.
 */
export async function probeServer(rawUrl, { fetchFn = fetch } = {}) {
  let url = new URL(rawUrl).toString();
  const init = {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'whatsapp-agent-duniya', version: '1' } } }),
  };
  let res;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetchFn(url, init);
    if ([301, 302, 307, 308].includes(res.status) && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).toString(); continue; }
    break;
  }
  if (res.ok) return { url, auth: 'none' };
  if (res.status !== 401 && res.status !== 403) throw Object.assign(new Error(`The server answered ${res.status}`), { status: 400 });
  const header = res.headers.get('www-authenticate') || '';
  const m = header.match(/resource_metadata="([^"]+)"/);
  const candidates = [m?.[1], new URL(`/.well-known/oauth-protected-resource${new URL(url).pathname}`, url).toString(), new URL('/.well-known/oauth-protected-resource', url).toString()].filter(Boolean);
  for (const c of candidates) {
    try {
      const r = await fetchFn(c, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const meta = await r.json();
      if (Array.isArray(meta.authorization_servers) && meta.authorization_servers.length) return { url, auth: 'oauth', name: meta.resource_name || '' };
    } catch { /* try next */ }
  }
  return { url, auth: 'token' };
}
