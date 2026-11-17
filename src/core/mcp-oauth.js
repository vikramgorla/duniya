// Sign in to tool services (MCP servers) with OAuth (009).
// Uses the MCP SDK's standard flow (RFC 9728 discovery, RFC 8414, dynamic registration, PKCE S256, resource
// indicator, refresh) with a provider backed by an encrypted table, one connection per agent × service × role
// (or, for a global tool service, per service × role with agent_id = GLOBAL_SCOPE).
import { fail } from './config.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { db } from './db.js';
import { TENANT } from './store.js';
import { encrypt, decrypt, newToken } from './crypto.js';
import { activity } from './events.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_oauth (
    tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, server TEXT NOT NULL, role TEXT NOT NULL,
    url TEXT NOT NULL, data_enc TEXT NOT NULL, status TEXT NOT NULL, connected_by TEXT,
    connected_at INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, agent_id, server, role)
  );
`);

export const OAUTH_ROLES = ['organizer', 'participant'];
/** agent_id of the sign-ins of global tool services (035): one per service and role, shared by all agents. */
export const GLOBAL_SCOPE = '*';
/** Activity fields: global sign-ins belong to no agent. */
const who = (agentId, server) => (agentId === GLOBAL_SCOPE ? { agent: '', name: `global tool service ${server}` } : { agent: agentId, name: server });
const PENDING_TTL = 10 * 60 * 1000;
const pending = new Map(); // state -> { agentId, server, role, url, redirectUri, by, data, codeVerifier, expires }
const listeners = new Set();
export const onOAuthChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* ignore */ } } };

function row(agentId, server, role) {
  return db.prepare('SELECT * FROM mcp_oauth WHERE tenant_id = ? AND agent_id = ? AND server = ? AND role = ?').get(TENANT, agentId, server, role);
}
function readData(r) {
  try { return JSON.parse(decrypt(r.data_enc)); } catch { return {}; }
}
function writeRow({ agentId, server, role, url, data, status, by }) {
  const now = Date.now();
  const prev = row(agentId, server, role);
  db.prepare(`INSERT OR REPLACE INTO mcp_oauth (tenant_id, agent_id, server, role, url, data_enc, status, connected_by, connected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(TENANT, agentId, server, role, url, encrypt(JSON.stringify(data)), status,
    by ?? prev?.connected_by ?? '', by ? now : (prev?.connected_at ?? now), now);
}
function setStatus(agentId, server, role, status) {
  db.prepare('UPDATE mcp_oauth SET status = ?, updated_at = ? WHERE tenant_id = ? AND agent_id = ? AND server = ? AND role = ?')
    .run(status, Date.now(), TENANT, agentId, server, role);
}

/** True when this role has a usable (or refreshable) sign-in for the service at `url`. */
export function isConnected(agentId, server, role, url) {
  const r = row(agentId, server, role);
  return !!r && r.url === url && r.status === 'connected';
}

export function listConnections(agentId) {
  return db.prepare('SELECT server, role, url, status, connected_by, connected_at FROM mcp_oauth WHERE tenant_id = ? AND agent_id = ?').all(TENANT, agentId)
    .map((r) => ({ server: r.server, role: r.role, url: r.url, status: r.status, connectedBy: r.connected_by, connectedAt: r.connected_at }));
}

export function disconnect(agentId, server, role, by = '') {
  const n = db.prepare('DELETE FROM mcp_oauth WHERE tenant_id = ? AND agent_id = ? AND server = ? AND role = ?').run(TENANT, agentId, server, role).changes;
  if (n) { activity('config', { agent: who(agentId, server).agent, summary: `Signed out of ${who(agentId, server).name} (${role})${by ? ` by ${by}` : ''}` }); changed(); }
  return n > 0;
}

/** Remove every sign-in of one service (e.g. a removed global tool service). */
export function deleteServerConnections(agentId, server) {
  db.prepare('DELETE FROM mcp_oauth WHERE tenant_id = ? AND agent_id = ? AND server = ?').run(TENANT, agentId, server);
  changed();
}

export function deleteAgentConnections(agentId) {
  db.prepare('DELETE FROM mcp_oauth WHERE tenant_id = ? AND agent_id = ?').run(TENANT, agentId);
  changed();
}

/**
 * OAuthClientProvider. Interactive providers keep everything in the pending sign-in until it completes;
 * runtime providers read/write the stored row (token refresh) and mark the row when a new sign-in is needed.
 */
class Provider {
  constructor({ agentId, server, role, url, redirectUri, pendingState = null, client = null }) {
    Object.assign(this, { agentId, server, role, url, pendingState });
    this.fixedClient = client?.id ? { client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}) } : null;
    this.interactive = !!pendingState;
    if (this.interactive) {
      this.data = pendingState.data;
      this._redirect = redirectUri;
    } else {
      const r = row(agentId, server, role);
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
    if (row(this.agentId, this.server, this.role)?.status !== 'reconnect') {
      setStatus(this.agentId, this.server, this.role, 'reconnect');
      activity('error', { agent: who(this.agentId, this.server).agent, summary: `Sign-in to ${who(this.agentId, this.server).name} (${this.role}) expired: reconnect it in the panel` });
      changed();
    }
    throw Object.assign(new Error(`Sign-in to "${this.server}" expired. An admin needs to reconnect it in the panel.`), { reconnect: true });
  }
  persist(status) {
    if (this.interactive) return; // stored only when the sign-in completes
    if (!row(this.agentId, this.server, this.role)) return;
    writeRow({ agentId: this.agentId, server: this.server, role: this.role, url: this.url, data: this.data,
      status: status || row(this.agentId, this.server, this.role).status });
  }
}

/** Provider used by MCP connections at runtime (adds the bearer token, refreshes it on 401). */
export const runtimeProvider = (agentId, server, role, url, client = null) => new Provider({ agentId, server, role, url, client });

function sweep() {
  for (const [k, p] of pending) if (p.expires < Date.now()) pending.delete(k);
}

/** Start a sign-in; returns the service's authorization URL to open in the browser. */
export async function startSignIn({ agentId, server, role, url, redirectUri, by = '', client = null }) {
  if (!OAUTH_ROLES.includes(role)) throw fail('Unknown role');
  sweep();
  const state = newToken(24);
  const p = { state, agentId, server, role, url, redirectUri, by, client, data: {}, expires: Date.now() + PENDING_TTL };
  pending.set(state, p);
  const prov = new Provider({ agentId, server, role, url, redirectUri, pendingState: p, client });
  try {
    const result = await auth(prov, { serverUrl: url });
    if (result === 'AUTHORIZED') throw new Error('The service did not ask for a sign-in');
    if (!prov.authorizeUrl) throw new Error('The service did not return a sign-in page');
    return { authorizeUrl: prov.authorizeUrl };
  } catch (e) {
    pending.delete(state);
    throw fail(`Could not start sign-in to ${server}: ${e.message}`);
  }
}

/** Finish a sign-in from the callback (?code&state or ?error). Returns { agentId, server, role }. */
export async function finishSignIn({ state, code, error, errorDescription }) {
  sweep();
  const p = state && pending.get(state);
  if (!p) throw new Error('This sign-in link has expired or was already used. Start again from the panel.');
  pending.delete(state);
  if (error) throw Object.assign(new Error(`The service did not approve the sign-in (${errorDescription || error}).`), { agentId: p.agentId });
  if (!code) throw Object.assign(new Error('The service returned no authorization code.'), { agentId: p.agentId });
  const prov = new Provider({ ...p, pendingState: p, client: p.client });
  try {
    const result = await auth(prov, { serverUrl: p.url, authorizationCode: code });
    if (result !== 'AUTHORIZED' || !p.data.tokens) throw new Error('no tokens received');
  } catch (e) {
    throw Object.assign(new Error(`Sign-in to ${p.server} failed: ${e.message}`), { agentId: p.agentId });
  }
  writeRow({ agentId: p.agentId, server: p.server, role: p.role, url: p.url, data: { ...p.data, redirectUri: p.redirectUri }, status: 'connected', by: p.by || 'admin' });
  activity('config', { agent: who(p.agentId, p.server).agent, summary: `Signed in to ${who(p.agentId, p.server).name} for ${p.role}s${p.by ? ` by ${p.by}` : ''}` });
  changed();
  return { agentId: p.agentId, server: p.server, role: p.role };
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
  if (res.status !== 401 && res.status !== 403) throw fail(`The server answered ${res.status}`);
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
