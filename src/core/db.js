import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(resolve(DATA_DIR, 'duniya.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, channel TEXT, chat TEXT, bot TEXT, sender TEXT, name TEXT,
    text TEXT, from_bot INTEGER DEFAULT 0, ts INTEGER
  );
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat, id);
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY, ts INTEGER, type TEXT, bot TEXT, chat TEXT, summary TEXT, detail TEXT
  );
  CREATE INDEX IF NOT EXISTS activity_bot ON activity(bot, id);
  CREATE TABLE IF NOT EXISTS pending (
    code TEXT PRIMARY KEY, bot TEXT, server TEXT, confirm_tool TEXT, confirm_id TEXT,
    tool TEXT, chat TEXT, requester TEXT, summary TEXT, expires INTEGER
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`);

// ---- chat history ----
const insMsg = db.prepare('INSERT INTO messages (channel, chat, bot, sender, name, text, from_bot, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const recent = db.prepare('SELECT * FROM (SELECT * FROM messages WHERE chat = ? ORDER BY id DESC LIMIT ?) ORDER BY id');
const prune = db.prepare('DELETE FROM messages WHERE chat = ? AND id <= (SELECT id FROM messages WHERE chat = ? ORDER BY id DESC LIMIT 1 OFFSET 300)');

export function logMessage({ channel = 'whatsapp', chat, bot = '', sender = '', name = '', text, fromBot = false }) {
  insMsg.run(channel, chat, bot, sender, name, text, fromBot ? 1 : 0, Date.now());
  if (Math.random() < 0.05) prune.run(chat, chat);
}
export const history = (chat, n = 20) => recent.all(chat, n);

// ---- activity log (what the panel shows) ----
const insAct = db.prepare('INSERT INTO activity (ts, type, bot, chat, summary, detail) VALUES (?, ?, ?, ?, ?, ?)');
const pruneAct = db.prepare('DELETE FROM activity WHERE id <= (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET 5000)');
export function insertActivity(a) {
  const r = insAct.run(a.ts, a.type, a.bot || '', a.chat || '', a.summary || '', a.detail ? JSON.stringify(a.detail) : '');
  if (Math.random() < 0.02) pruneAct.run();
  return Number(r.lastInsertRowid);
}
export function listActivity({ limit = 200, bot = '', before = 0 } = {}) {
  const lim = Math.min(Number(limit) || 200, 1000);
  const rows = bot
    ? db.prepare('SELECT * FROM activity WHERE bot = ? AND (? = 0 OR id < ?) ORDER BY id DESC LIMIT ?').all(bot, before, before, lim)
    : db.prepare('SELECT * FROM activity WHERE (? = 0 OR id < ?) ORDER BY id DESC LIMIT ?').all(before, before, lim);
  return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}

// ---- pending confirmations ----
const expire = db.prepare('DELETE FROM pending WHERE expires < ?');
const insPending = db.prepare(`INSERT OR REPLACE INTO pending
  (code, bot, server, confirm_tool, confirm_id, tool, chat, requester, summary, expires)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const getPendingStmt = db.prepare('SELECT * FROM pending WHERE code = ?');
const delPendingStmt = db.prepare('DELETE FROM pending WHERE code = ?');

export function addPending(p) {
  expire.run(Date.now());
  insPending.run(p.code, p.bot, p.server, p.confirmTool, p.confirmId, p.tool, p.chat, p.requester, p.summary || '', p.expires);
}
export function peekPending(code) { expire.run(Date.now()); return getPendingStmt.get(code); }
export function takePending(code) {
  const row = peekPending(code);
  if (row) delPendingStmt.run(code);
  return row;
}
export const dropPending = (code) => delPendingStmt.run(code);
export function listPending() {
  expire.run(Date.now());
  return db.prepare('SELECT code, bot, tool, chat, requester, summary, expires FROM pending ORDER BY expires').all();
}

// ---- key/value ----
const getKv = db.prepare('SELECT v FROM kv WHERE k = ?');
const setKvStmt = db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)');
export const kvGet = (k) => getKv.get(k)?.v;
export const kvSet = (k, v) => setKvStmt.run(k, String(v));
