// Persistent app data (005): tenants, users, sessions, bots, secrets (encrypted), settings.
import { db } from './db.js';
import { encrypt, decrypt, hashPassword, verifyPassword, sha256, newToken } from './crypto.js';

export const TENANT = 'default'; // single tenant today; every table is tenant-scoped for hosted later

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT NOT NULL, email TEXT, role TEXT NOT NULL,
    pw_salt TEXT, pw_hash TEXT, disabled INTEGER DEFAULT 0, created_at INTEGER, UNIQUE(tenant_id, username)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER, created_at INTEGER, ip TEXT
  );
  CREATE TABLE IF NOT EXISTS bots (
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
  if (!SECRET_NAME_RE.test(name)) throw Object.assign(new Error('Secret names must be UPPER_SNAKE_CASE'), { status: 400 });
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
const SETTINGS_DEFAULTS = { paused: false, defaultDmBot: '' };
export function getSettings() {
  const out = { ...SETTINGS_DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings WHERE tenant_id = ?').all(TENANT)) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore */ }
  }
  return out;
}
export function updateSettings(patch) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (tenant_id, key, value) VALUES (?, ?, ?)');
  for (const [k, v] of Object.entries(patch)) stmt.run(TENANT, k, JSON.stringify(v));
  return getSettings();
}
export const getSetting = (key, fallback) => getSettings()[key] ?? fallback;

// ---------- users ----------
export const ROLES = ['owner', 'admin', 'viewer'];
const userView = (u) => u && ({ id: u.id, username: u.username, email: u.email || '', role: u.role, disabled: !!u.disabled, createdAt: u.created_at });

export const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(TENANT).n;
export const listUsers = () => db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY id').all(TENANT).map(userView);
export const getUser = (id) => userView(db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(Number(id), TENANT));
const ownersCount = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role = 'owner' AND disabled = 0").get(TENANT).n;

function checkPasswordStrength(pw) {
  if (String(pw || '').length < 12) throw Object.assign(new Error('Password must be at least 12 characters'), { status: 400 });
}
export function createUser({ username, email = '', role = 'admin', password }) {
  const name = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(name)) throw Object.assign(new Error('Username: 2–40 letters, digits, . _ -'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('Role must be owner, admin or viewer'), { status: 400 });
  checkPasswordStrength(password);
  if (db.prepare('SELECT 1 FROM users WHERE tenant_id = ? AND username = ?').get(TENANT, name)) {
    throw Object.assign(new Error('Username already exists'), { status: 409 });
  }
  const { salt, hash } = hashPassword(password);
  const r = db.prepare('INSERT INTO users (tenant_id, username, email, role, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, name, String(email || ''), role, salt, hash, Date.now());
  return getUser(Number(r.lastInsertRowid));
}
export function updateUser(id, { role, password, disabled, email }) {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(Number(id), TENANT);
  if (!u) throw Object.assign(new Error('User not found'), { status: 404 });
  const losingOwner = u.role === 'owner' && ((role && role !== 'owner') || disabled === true);
  if (losingOwner && ownersCount() <= 1) throw Object.assign(new Error('At least one owner must remain'), { status: 400 });
  if (role !== undefined) {
    if (!ROLES.includes(role)) throw Object.assign(new Error('Invalid role'), { status: 400 });
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
  if (!u) throw Object.assign(new Error('User not found'), { status: 404 });
  if (u.role === 'owner' && ownersCount() <= 1) throw Object.assign(new Error('At least one owner must remain'), { status: 400 });
  deleteSessionsFor(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
}
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

// ---------- bots ----------
const parseBot = (r) => r && ({ id: r.id, config: JSON.parse(r.config), createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by });
export const listBotRows = () => db.prepare('SELECT * FROM bots WHERE tenant_id = ? ORDER BY name').all(TENANT).map(parseBot);
export const getBotRow = (id) => parseBot(db.prepare('SELECT * FROM bots WHERE tenant_id = ? AND id = ?').get(TENANT, id));
export const countBots = () => db.prepare('SELECT COUNT(*) AS n FROM bots WHERE tenant_id = ?').get(TENANT).n;
export function saveBotRow(id, config, by = '') {
  const now = Date.now();
  const exists = db.prepare('SELECT 1 FROM bots WHERE tenant_id = ? AND id = ?').get(TENANT, id);
  if (exists) {
    db.prepare('UPDATE bots SET name = ?, enabled = ?, config = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
      .run(config.name, config.enabled ? 1 : 0, JSON.stringify(config), now, TENANT, id);
  } else {
    db.prepare('INSERT INTO bots (id, tenant_id, name, enabled, config, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, TENANT, config.name, config.enabled ? 1 : 0, JSON.stringify(config), now, now, by);
  }
}
export const deleteBotRow = (id) => db.prepare('DELETE FROM bots WHERE tenant_id = ? AND id = ?').run(TENANT, id).changes > 0;
