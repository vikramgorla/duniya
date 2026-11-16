// Admin MCP (017): this app as an OAuth 2.1 authorization server for AI assistants (ChatGPT, Claude, …).
// Public clients only (dynamic registration, PKCE S256), opaque tokens stored as sha256 hashes, access 1 h,
// refresh 30 d with rotation and reuse detection (the whole family is revoked). Tokens act as the panel user who
// approved them; disabled or deleted users and revoked grants stop working on the next call.
// Mobile app (027): one built-in public client, `duniya-mobile`, with the custom-scheme redirect `duniya://oauth`
// (store/dev builds) and Expo Go's `exp://<dev-host>/--/oauth`; its tokens are bound to the resource `<base>/api`.
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { TENANT, onUserDeleted } from './store.js';
import { newToken, sha256, humanCode } from './crypto.js';
import { activity } from './events.js';
import { putTtl, getTtl, takeTtl } from './ttl-store.js';

const ACCESS_TTL = 3600 * 1000;
const REFRESH_TTL = 30 * 24 * 3600 * 1000;
const CODE_TTL = 5 * 60 * 1000;
const CONFIRM_TTL = 10 * 60 * 1000;
export const SCOPE = 'duniya';
const MAX_CLIENTS = 300;
export const MOBILE_CLIENT_ID = 'duniya-mobile';
const MOBILE_CLIENT_NAME = 'Duniya mobile app';
const MOBILE_REDIRECT = 'duniya://oauth';
// Expo Go during development: exp://192.168.1.20:8081/--/oauth, exp://u.expo.dev/<id>/--/oauth, exp://abc-anon-8081.exp.direct/--/oauth
const EXPO_GO_REDIRECT = /^exps?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*\/--\/oauth$/;

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_oauth_clients (
    client_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT, client_uri TEXT, redirect_uris TEXT NOT NULL,
    created_at INTEGER, last_used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS admin_oauth_grants (
    tenant_id TEXT NOT NULL, user_id INTEGER NOT NULL, client_id TEXT NOT NULL, created_at INTEGER, last_used_at INTEGER,
    PRIMARY KEY (tenant_id, user_id, client_id)
  );
  CREATE TABLE IF NOT EXISTS admin_oauth_tokens (
    token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL, family TEXT NOT NULL, user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS admin_oauth_tokens_family ON admin_oauth_tokens(family);
  CREATE INDEX IF NOT EXISTS admin_oauth_tokens_user ON admin_oauth_tokens(user_id, client_id);
`);
// The mobile app's client always exists (RFC 8252 native app: public client, PKCE, custom-scheme redirect).
db.prepare(`INSERT INTO admin_oauth_clients (client_id, tenant_id, name, client_uri, redirect_uris, created_at) VALUES (?, ?, ?, '', ?, ?)
  ON CONFLICT (client_id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris`)
  .run(MOBILE_CLIENT_ID, TENANT, MOBILE_CLIENT_NAME, JSON.stringify([MOBILE_REDIRECT]), Date.now());
onUserDeleted((id) => {
  db.prepare('DELETE FROM admin_oauth_grants WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM admin_oauth_tokens WHERE user_id = ?').run(id);
});
const prune = () => db.prepare('DELETE FROM admin_oauth_tokens WHERE expires_at < ?').run(Date.now());
prune();

export class OAuthError extends Error {
  constructor(code, description, status = 400) { super(description); this.code = code; this.status = status; }
  toJSON() { return { error: this.code, error_description: this.message }; }
}

// ---------- clients (RFC 7591) ----------
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** https anywhere, or http on loopback (desktop apps). No fragments. */
function validRedirectUri(u) {
  let url; try { url = new URL(String(u)); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
}
// eslint-disable-next-line no-control-regex -- strip control characters on purpose
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const clientRow = (id) => db.prepare('SELECT * FROM admin_oauth_clients WHERE client_id = ? AND tenant_id = ?').get(String(id || ''), TENANT);
export function getClient(id) {
  const r = clientRow(id);
  return r && { clientId: r.client_id, name: r.name || 'AI assistant', clientUri: r.client_uri || '', redirectUris: JSON.parse(r.redirect_uris), mobile: r.client_id === MOBILE_CLIENT_ID };
}
/** Exact match with a registered redirect URI; the mobile app may also return to Expo Go (exp://…/--/oauth). */
export function redirectAllowed(client, uri) {
  if (!client || !uri) return false;
  if (client.redirectUris.includes(String(uri))) return true;
  return client.clientId === MOBILE_CLIENT_ID && EXPO_GO_REDIRECT.test(String(uri));
}

export function registerClient(meta = {}) {
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10) throw new OAuthError('invalid_redirect_uri', 'redirect_uris must list 1 to 10 URLs');
  for (const u of uris) if (!validRedirectUri(u)) throw new OAuthError('invalid_redirect_uri', `Redirect URI must be https, or http on localhost: ${clean(u, 200)}`);
  const grants = meta.grant_types || ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || !grants.includes('authorization_code')) throw new OAuthError('invalid_client_metadata', 'grant_types must include authorization_code');
  if (meta.response_types && !(Array.isArray(meta.response_types) && meta.response_types.includes('code'))) throw new OAuthError('invalid_client_metadata', 'response_types must include code');
  // Too many unused registrations (registration is unauthenticated): forget the oldest ones without a grant.
  const n = db.prepare('SELECT COUNT(*) AS n FROM admin_oauth_clients WHERE tenant_id = ?').get(TENANT).n;
  if (n >= MAX_CLIENTS) {
    db.prepare(`DELETE FROM admin_oauth_clients WHERE client_id IN (SELECT c.client_id FROM admin_oauth_clients c
      WHERE c.tenant_id = ? AND c.client_id != '${MOBILE_CLIENT_ID}' AND NOT EXISTS (SELECT 1 FROM admin_oauth_grants g WHERE g.client_id = c.client_id)
      ORDER BY c.created_at LIMIT ?)`).run(TENANT, n - MAX_CLIENTS + 1);
  }
  const clientId = `duniya-${newToken(12)}`;
  const now = Date.now();
  const name = clean(meta.client_name, 80) || 'AI assistant';
  const clientUri = /^https:\/\//.test(String(meta.client_uri || '')) ? clean(meta.client_uri, 200) : '';
  db.prepare('INSERT INTO admin_oauth_clients (client_id, tenant_id, name, client_uri, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(clientId, TENANT, name, clientUri, JSON.stringify(uris.map(String)), now);
  // We only support public clients: whatever auth method was asked for, the answer is "none" (RFC 7591 §3.2.1).
  return {
    client_id: clientId, client_id_issued_at: Math.floor(now / 1000), client_name: name, ...(clientUri ? { client_uri: clientUri } : {}),
    redirect_uris: uris.map(String), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none', scope: SCOPE,
  };
}

// ---------- authorization codes (in memory, single-use) ----------
const codes = new Map();
const sweepCodes = () => { for (const [k, v] of codes) if (v.expires < Date.now()) codes.delete(k); };
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkceChallenge = (verifier) => b64url(createHash('sha256').update(String(verifier)).digest());

export function createCode({ clientId, userId, redirectUri, codeChallenge, resource, scope = SCOPE }) {
  sweepCodes();
  const code = newToken(24);
  codes.set(sha256(code), { clientId, userId, redirectUri, codeChallenge, resource, scope, expires: Date.now() + CODE_TTL });
  return code;
}

export function exchangeCode({ code, clientId, redirectUri, codeVerifier, resource }) {
  sweepCodes();
  const key = sha256(code || '');
  const c = codes.get(key);
  codes.delete(key); // single-use, whatever happens next
  if (!c) throw new OAuthError('invalid_grant', 'The authorization code is invalid, expired or was already used');
  if (c.clientId !== clientId) throw new OAuthError('invalid_grant', 'The code was issued to another client');
  if (c.redirectUri !== redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(String(codeVerifier || '')) || pkceChallenge(codeVerifier) !== c.codeChallenge) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed');
  }
  if (resource && normResource(resource) !== c.resource) throw new OAuthError('invalid_target', 'resource does not match the authorization request');
  if (!grantRow(c.userId, c.clientId) || !activeUser(c.userId)) throw new OAuthError('invalid_grant', 'Access was revoked');
  return issueTokens({ userId: c.userId, clientId: c.clientId, resource: c.resource, scope: c.scope });
}

export const normResource = (r) => String(r || '').replace(/\/+$/, '');

// ---------- tokens ----------
const insToken = db.prepare(`INSERT INTO admin_oauth_tokens (token_hash, tenant_id, kind, family, user_id, client_id, resource, scope, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
function issueTokens({ userId, clientId, resource, scope, family = newToken(12) }) {
  const now = Date.now();
  const access = newToken(32); const refresh = newToken(32);
  insToken.run(sha256(access), TENANT, 'access', family, userId, clientId, resource, scope, now + ACCESS_TTL, now);
  insToken.run(sha256(refresh), TENANT, 'refresh', family, userId, clientId, resource, scope, now + REFRESH_TTL, now);
  db.prepare('UPDATE admin_oauth_clients SET last_used_at = ? WHERE client_id = ?').run(now, clientId);
  if (Math.random() < 0.05) prune();
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope };
}
const tokenRow = (token, kind) => db.prepare('SELECT * FROM admin_oauth_tokens WHERE token_hash = ? AND kind = ? AND tenant_id = ?').get(sha256(token || ''), kind, TENANT);
const revokeFamily = (family) => db.prepare('DELETE FROM admin_oauth_tokens WHERE family = ?').run(family);
const activeUser = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ? AND disabled = 0').get(Number(id), TENANT);
const grantRow = (userId, clientId) => db.prepare('SELECT * FROM admin_oauth_grants WHERE tenant_id = ? AND user_id = ? AND client_id = ?').get(TENANT, Number(userId), clientId);

export function refreshTokens({ refreshToken, clientId, resource }) {
  const r = tokenRow(refreshToken, 'refresh');
  if (!r || r.client_id !== clientId) throw new OAuthError('invalid_grant', 'The refresh token is invalid');
  if (r.used_at) {
    // A rotated token came back: someone else may hold a copy. Revoke everything issued from this sign-in.
    revokeFamily(r.family);
    const c = getClient(r.client_id);
    activity('config', { summary: `AI assistant "${c?.name || r.client_id}": an old refresh token was reused, so its access was revoked (sign in again)` });
    throw new OAuthError('invalid_grant', 'The refresh token was already used; access was revoked');
  }
  if (r.expires_at < Date.now()) throw new OAuthError('invalid_grant', 'The refresh token expired');
  if (resource && normResource(resource) !== r.resource) throw new OAuthError('invalid_target', 'resource does not match');
  if (!activeUser(r.user_id) || !grantRow(r.user_id, r.client_id)) { revokeFamily(r.family); throw new OAuthError('invalid_grant', 'Access was revoked'); }
  db.prepare('UPDATE admin_oauth_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), r.token_hash);
  return issueTokens({ userId: r.user_id, clientId: r.client_id, resource: r.resource, scope: r.scope, family: r.family });
}

/** RFC 7009: always succeeds; a refresh token takes its whole family with it. */
export function revokeToken({ token, clientId }) {
  for (const kind of ['refresh', 'access']) {
    const r = tokenRow(token, kind);
    if (!r || (clientId && r.client_id !== clientId)) continue;
    if (kind === 'refresh') revokeFamily(r.family); else db.prepare('DELETE FROM admin_oauth_tokens WHERE token_hash = ?').run(r.token_hash);
  }
}

/** Check a bearer token for `resource`. Returns { user, client, tokenHash } or null. */
export function validateAccess(token, resource) {
  if (!token) return null;
  const r = tokenRow(token, 'access');
  if (!r || r.expires_at < Date.now() || r.resource !== normResource(resource)) return null;
  const u = activeUser(r.user_id);
  const g = u && grantRow(r.user_id, r.client_id);
  if (!g) return null;
  if (!g.last_used_at || Date.now() - g.last_used_at > 60000) {
    db.prepare('UPDATE admin_oauth_grants SET last_used_at = ? WHERE tenant_id = ? AND user_id = ? AND client_id = ?').run(Date.now(), TENANT, r.user_id, r.client_id);
  }
  return {
    user: { id: u.id, username: u.username, email: u.email || '', role: u.role, disabled: false },
    client: getClient(r.client_id) || { clientId: r.client_id, name: 'AI assistant' },
    tokenHash: r.token_hash,
  };
}

// ---------- grants (what the panel lists) ----------
export function saveGrant(userId, clientId) {
  const now = Date.now();
  db.prepare(`INSERT INTO admin_oauth_grants (tenant_id, user_id, client_id, created_at, last_used_at) VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT (tenant_id, user_id, client_id) DO UPDATE SET created_at = excluded.created_at`).run(TENANT, Number(userId), clientId, now);
}
export function listGrants({ userId = null } = {}) {
  const rows = db.prepare(`SELECT g.user_id, g.client_id, g.created_at, g.last_used_at, u.username, u.role, c.name, c.redirect_uris
    FROM admin_oauth_grants g JOIN users u ON u.id = g.user_id LEFT JOIN admin_oauth_clients c ON c.client_id = g.client_id
    WHERE g.tenant_id = ? AND (? IS NULL OR g.user_id = ?) ORDER BY g.created_at DESC`).all(TENANT, userId, userId);
  return rows.map((r) => {
    let host = '';
    try { const u = new URL(JSON.parse(r.redirect_uris || '[]')[0]); host = /^https?:$/.test(u.protocol) ? u.host : ''; } catch { /* none */ }
    const mobile = r.client_id === MOBILE_CLIENT_ID;
    return { userId: r.user_id, username: r.username, role: r.role, clientId: r.client_id, clientName: r.name || 'AI assistant', kind: mobile ? 'app' : 'assistant', redirectHost: mobile ? 'phone app' : host, connectedAt: r.created_at, lastUsedAt: r.last_used_at };
  });
}
export function revokeGrant(userId, clientId) {
  const had = db.prepare('DELETE FROM admin_oauth_grants WHERE tenant_id = ? AND user_id = ? AND client_id = ?').run(TENANT, Number(userId), clientId).changes > 0;
  db.prepare('DELETE FROM admin_oauth_tokens WHERE tenant_id = ? AND user_id = ? AND client_id = ?').run(TENANT, Number(userId), clientId);
  return had;
}

// ---------- confirm codes for risky tools (SQLite, survive a restart (#64); single-use, 10 min) ----------
const CONFIRM_KIND = 'admin-mcp-confirm';
const argsHash = (args) => sha256(JSON.stringify(args ?? {}));
export function createConfirm({ userId, clientId, tool, args, preview }) {
  const code = humanCode(8);
  putTtl(CONFIRM_KIND, code, { userId, clientId, tool, args, hash: argsHash(args), preview }, Date.now() + CONFIRM_TTL);
  return code;
}
/** Takes (and removes) a confirm code for this user and assistant. Throws with a plain-language reason. */
export function takeConfirm(code, { userId, clientId }) {
  const key = String(code || '').trim().toUpperCase();
  const c = getTtl(CONFIRM_KIND, key);
  if (!c) { throw Object.assign(new Error('This confirm code is unknown, expired (10 minutes) or was already used. Start the action again.'), { status: 404 }); }
  if (c.userId !== userId || c.clientId !== clientId) throw Object.assign(new Error('This confirm code belongs to another user or assistant.'), { status: 403 });
  if (!takeTtl(CONFIRM_KIND, key)) throw Object.assign(new Error('This confirm code was already used. Start the action again.'), { status: 404 });
  if (argsHash(c.args) !== c.hash) throw Object.assign(new Error('The action changed after it was previewed.'), { status: 409 });
  return c;
}
