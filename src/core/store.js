// @ts-check
// Persistent app data (005): tenants, users, sessions, agents, secrets (encrypted), settings.
import { fail } from './config.js';
import { db } from './db.js';
import { encrypt, decrypt, hashPassword, verifyPassword, sha256, newToken } from './crypto.js';

export const TENANT = 'default'; // single tenant today; every table is tenant-scoped for hosted later

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT NOT NULL, email TEXT, role TEXT NOT NULL,
    pw_salt TEXT, pw_hash TEXT, disabled INTEGER DEFAULT 0, created_at INTEGER, google_sub TEXT, UNIQUE(tenant_id, username)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER, created_at INTEGER, ip TEXT
  );
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT NOT NULL, tenant_id TEXT NOT NULL, name TEXT, enabled INTEGER, config TEXT NOT NULL,
    created_at INTEGER, updated_at INTEGER, created_by TEXT, PRIMARY KEY (tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS secrets (
    tenant_id TEXT NOT NULL, name TEXT NOT NULL, value_enc TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY (tenant_id, name)
  );
  CREATE TABLE IF NOT EXISTS settings (
    tenant_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (tenant_id, key)
  );
`);
// 019: Google sign-in. google_sub is Google's stable account id; invites let an email sign in with Google once.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users (tenant_id, google_sub) WHERE google_sub IS NOT NULL;
  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, invited_by TEXT,
    created_at INTEGER, renewed_at INTEGER, expires_at INTEGER, UNIQUE(tenant_id, email)
  );
`);
db.prepare('INSERT OR IGNORE INTO tenants (id, name, created_at) VALUES (?, ?, ?)').run(TENANT, 'Default', Date.now());

// ---------- secrets ----------
const secretCache = new Map();
const secretListeners = new Set();
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

function loadSecrets() {
  secretCache.clear();
  for (const r of db.prepare('SELECT name, value_enc FROM secrets WHERE tenant_id = ?').all(TENANT)) {
    try { secretCache.set(r.name, decrypt(r.value_enc)); } catch { secretCache.set(r.name, ''); }
  }
}
loadSecrets();

export function getSecret(name) {
  return secretCache.get(name) ?? process.env[name] ?? '';
}
export function listSecrets() {
  return [...secretCache.keys()].sort().map((name) => ({ name, set: !!secretCache.get(name) }));
}
export function setSecret(name, value) {
  if (!SECRET_NAME_RE.test(name)) throw fail('Secret names must be UPPER_SNAKE_CASE');
  if (value) {
    db.prepare('INSERT OR REPLACE INTO secrets (tenant_id, name, value_enc, updated_at) VALUES (?, ?, ?, ?)').run(TENANT, name, encrypt(value), Date.now());
    secretCache.set(name, value);
  } else {
    db.prepare('DELETE FROM secrets WHERE tenant_id = ? AND name = ?').run(TENANT, name);
    secretCache.delete(name);
  }
  for (const fn of secretListeners) fn(name);
}
export const onSecretChange = (fn) => secretListeners.add(fn);
export const reloadSecrets = loadSecrets;

/** Replace ${VAR} with secrets/env values. */
export function interpolate(value) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => getSecret(k));
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)]));
  return value;
}

// ---------- settings ----------
const SETTINGS_DEFAULTS = { paused: false, defaultDmAgent: '', historyLoadCount: 50 }; // #91: earlier messages loaded when a chat goes on
// 070: parsed once and cached; updateSettings is the only writer and drops the cache. Callers get copies, so changing
// a returned object never changes the cache.
/** @type {Record<string, any> | null} */
let cached = null;
function settingsMap() {
  if (!cached) {
    const out = { ...SETTINGS_DEFAULTS };
    for (const r of db.prepare('SELECT key, value FROM settings WHERE tenant_id = ?').all(TENANT)) {
      try { out[r.key] = JSON.parse(r.value); } catch { /* ignore */ }
    }
    cached = out;
  }
  return cached;
}
/**
 * Panel settings: the defaults above plus what owners changed. Features keep their own block (providers, backup,
 * webAccess, media, updates, …) and read it through their own module.
 * @typedef {{ paused: boolean, defaultDmAgent: string, historyLoadCount: number, smallServerMode?: boolean,
 *   whatsappNumbers?: { id: string, label: string, dmAgent?: string }[], [key: string]: any }} Settings
 * @returns {Settings}
 */
export function getSettings() {
  return structuredClone(settingsMap());
}
export function updateSettings(patch) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, ?, ?)');
  try { for (const [k, v] of Object.entries(patch)) stmt.run(TENANT, k, JSON.stringify(v)); } finally { cached = null; }
  return getSettings();
}
/** One setting (a copy), or `fallback` when it is not set. Cheaper than getSettings() on hot paths. */
export function getSetting(key, fallback) {
  const v = settingsMap()[key];
  if (v == null) return fallback;
  return typeof v === 'object' ? structuredClone(v) : v;
}

// ---------- users ----------
export const ROLES = ['owner', 'admin', 'viewer'];
const userView = (u) => u && ({
  id: u.id, username: u.username, email: u.email || '', role: u.role, disabled: !!u.disabled, createdAt: u.created_at,
  google: !!u.google_sub, hasPassword: !!u.pw_hash,
});

export const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(TENANT).n;
export const listUsers = () => db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY id').all(TENANT).map(userView);
export const getUser = (id) => userView(db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(Number(id), TENANT));
const ownersCount = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role = 'owner' AND disabled = 0").get(TENANT).n;

function checkPasswordStrength(pw) {
  if (String(pw || '').length < 12) throw fail('Password must be at least 12 characters');
}
/** noPassword (060): the person sets their own password with a one-time sign-up link. */
export function createUser({ username, email = '', role = 'admin', password, noPassword = false }) {
  const name = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(name)) throw fail('Username: 2–40 letters, digits, . _ -');
  if (!ROLES.includes(role)) throw fail('Role must be owner, admin or viewer');
  if (!noPassword) checkPasswordStrength(password);
  if (db.prepare('SELECT 1 FROM users WHERE tenant_id = ? AND username = ?').get(TENANT, name)) {
    throw fail('Username already exists', 409);
  }
  const { salt, hash } = noPassword ? { salt: null, hash: null } : hashPassword(password);
  const r = db.prepare('INSERT INTO users (tenant_id, username, email, role, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, name, String(email || ''), role, salt, hash, Date.now());
  return getUser(Number(r.lastInsertRowid));
}
const normEmail = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const err = (status, message, field) => fail(message, status, { field });

export function findUserByGoogleSub(sub) {
  return userView(db.prepare('SELECT * FROM users WHERE tenant_id = ? AND google_sub = ?').get(TENANT, String(sub)));
}
/** Users whose email matches (case-insensitive). */
export function findUsersByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE tenant_id = ? AND lower(trim(email)) = ?').all(TENANT, normEmail(email)).map(userView);
}
export function linkGoogle(userId, sub) {
  const other = findUserByGoogleSub(sub);
  if (other && other.id !== Number(userId)) throw err(409, `This Google account is already linked to ${other.username}`);
  db.prepare('UPDATE users SET google_sub = ? WHERE id = ? AND tenant_id = ?').run(String(sub), Number(userId), TENANT);
  return getUser(userId);
}
export function unlinkGoogle(userId) {
  const u = getUser(userId);
  if (!u) throw err(404, 'User not found');
  if (!u.hasPassword) throw err(400, 'Set a password first, otherwise this account could not sign in any more');
  db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(u.id);
  return getUser(u.id);
}
/** A username from an email address: anu.rao@gmail.com → anu.rao (then anu.rao-2, …). */
export function usernameFromEmail(email) {
  let base = normEmail(email).split('@')[0].replace(/\+.*$/, '').replace(/[^a-z0-9._-]+/g, '.').replace(/^[._-]+|[._-]+$/g, '').slice(0, 34);
  if (base.length < 2) base = `user${base}`;
  const taken = (n) => !!db.prepare('SELECT 1 FROM users WHERE tenant_id = ? AND username = ?').get(TENANT, n);
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}
/** Account created by an accepted invite: signs in with Google only (no password until they set one). */
export function createGoogleUser({ email, role, sub }) {
  if (!ROLES.includes(role)) throw err(400, 'Invalid role');
  const name = usernameFromEmail(email);
  const r = db.prepare('INSERT INTO users (tenant_id, username, email, role, google_sub, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(TENANT, name, normEmail(email), role, String(sub), Date.now());
  return getUser(Number(r.lastInsertRowid));
}

// ---------- invites (019) ----------
const INVITE_MS = 14 * 24 * 3600 * 1000;
const inviteView = (i) => i && ({ id: i.id, email: i.email, role: i.role, invitedBy: i.invited_by || '', createdAt: i.created_at, renewedAt: i.renewed_at, expiresAt: i.expires_at, expired: i.expires_at < Date.now() });
export const listInvites = () => db.prepare('SELECT * FROM invites WHERE tenant_id = ? ORDER BY id').all(TENANT).map(inviteView);
export function createInvite({ email, role = 'admin', by = '' }) {
  const e = normEmail(email);
  if (!EMAIL_RE.test(e)) throw err(400, 'Enter a valid email address', 'email');
  if (!ROLES.includes(role)) throw err(400, 'Role must be owner, admin or viewer', 'role');
  if (findUsersByEmail(e).length) throw err(409, `${e} already has an account — they can sign in with Google directly`, 'email');
  const now = Date.now();
  db.prepare(`INSERT INTO invites (tenant_id, email, role, invited_by, created_at, renewed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, renewed_at = excluded.renewed_at, expires_at = excluded.expires_at`)
    .run(TENANT, e, role, by, now, now, now + INVITE_MS);
  return inviteView(db.prepare('SELECT * FROM invites WHERE tenant_id = ? AND email = ?').get(TENANT, e));
}
export function renewInvite(id) {
  const now = Date.now();
  const n = db.prepare('UPDATE invites SET renewed_at = ?, expires_at = ? WHERE id = ? AND tenant_id = ?').run(now, now + INVITE_MS, Number(id), TENANT).changes;
  if (!n) throw err(404, 'Invite not found');
  return inviteView(db.prepare('SELECT * FROM invites WHERE id = ?').get(Number(id)));
}
export function revokeInvite(id) {
  const i = db.prepare('SELECT * FROM invites WHERE id = ? AND tenant_id = ?').get(Number(id), TENANT);
  if (!i) throw err(404, 'Invite not found');
  db.prepare('DELETE FROM invites WHERE id = ?').run(i.id);
  return inviteView(i);
}
/** The open (unexpired) invite for this email, if any. */
export const openInvite = (email) => inviteView(db.prepare('SELECT * FROM invites WHERE tenant_id = ? AND email = ? AND expires_at > ?').get(TENANT, normEmail(email), Date.now()));
/** Accept: create the account and delete the invite, atomically. */
export function acceptInvite(email, sub) {
  const inv = openInvite(email);
  if (!inv) return null;
  db.exec('BEGIN');
  try {
    const u = createGoogleUser({ email, role: inv.role, sub });
    db.prepare('DELETE FROM invites WHERE id = ?').run(inv.id);
    db.exec('COMMIT');
    return { user: u, invite: inv };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** @param {number|string} id  @param {{ role?: string, password?: string, disabled?: boolean, email?: string }} change */
export function updateUser(id, { role, password, disabled, email }) {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(Number(id), TENANT);
  if (!u) throw fail('User not found', 404);
  const losingOwner = u.role === 'owner' && ((role && role !== 'owner') || disabled === true);
  if (losingOwner && ownersCount() <= 1) throw fail('At least one owner must remain');
  if (role !== undefined) {
    if (!ROLES.includes(role)) throw fail('Invalid role');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
  }
  if (email !== undefined) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(String(email), u.id);
  if (disabled !== undefined) {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, u.id);
    if (disabled) deleteSessionsFor(u.id);
  }
  if (password !== undefined) {
    checkPasswordStrength(password);
    const { salt, hash } = hashPassword(password);
    db.prepare('UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?').run(salt, hash, u.id);
    deleteSessionsFor(u.id);
  }
  return getUser(u.id);
}
export function deleteUser(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(Number(id), TENANT);
  if (!u) throw fail('User not found', 404);
  if (u.role === 'owner' && ownersCount() <= 1) throw fail('At least one owner must remain');
  deleteSessionsFor(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  for (const fn of userDeletedListeners) fn(u.id); // e.g. AI assistant grants (017): ids can be reused by SQLite
}
const userDeletedListeners = new Set();
export const onUserDeleted = (fn) => userDeletedListeners.add(fn);
export function authenticate(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ? AND disabled = 0')
    .get(TENANT, String(username || 'admin').trim().toLowerCase());
  return u && verifyPassword(password, u.pw_salt, u.pw_hash) ? userView(u) : null;
}

// ---------- sessions ----------
const SESSION_MS = 7 * 24 * 3600 * 1000;
export function createSession(userId, ip = '') {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at, ip) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_MS, Date.now(), ip);
  return { token, maxAge: SESSION_MS / 1000 };
}
export function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.disabled = 0`).get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return userView(row);
}
export const deleteSession = (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
export const deleteSessionsFor = (userId, exceptToken) => (exceptToken
  ? db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(exceptToken))
  : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId));
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

// ---------- agents ----------
const parseAgent = (r) => r && ({ id: r.id, config: JSON.parse(r.config), createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by });
export const listAgentRows = () => db.prepare('SELECT * FROM agents WHERE tenant_id = ? ORDER BY name').all(TENANT).map(parseAgent);
export const getAgentRow = (id) => parseAgent(db.prepare('SELECT * FROM agents WHERE tenant_id = ? AND id = ?').get(TENANT, id));
export const countAgents = () => db.prepare('SELECT COUNT(*) AS n FROM agents WHERE tenant_id = ?').get(TENANT).n;
export function saveAgentRow(id, config, by = '') {
  const now = Date.now();
  const exists = db.prepare('SELECT 1 FROM agents WHERE tenant_id = ? AND id = ?').get(TENANT, id);
  if (exists) {
    db.prepare('UPDATE agents SET name = ?, enabled = ?, config = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
      .run(config.name, config.enabled ? 1 : 0, JSON.stringify(config), now, TENANT, id);
  } else {
    db.prepare('INSERT INTO agents (id, tenant_id, name, enabled, config, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, TENANT, config.name, config.enabled ? 1 : 0, JSON.stringify(config), now, now, by);
  }
}
export const deleteAgentRow = (id) => db.prepare('DELETE FROM agents WHERE tenant_id = ? AND id = ?').run(TENANT, id).changes > 0;
