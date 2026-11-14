import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { DATA_DIR, env } from './config.js';

export const db = new DatabaseSync(resolve(DATA_DIR, 'duniya.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, channel TEXT, chat TEXT, bot TEXT, sender TEXT, name TEXT,
    text TEXT, from_bot INTEGER DEFAULT 0, ts INTEGER
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY, ts INTEGER, type TEXT, bot TEXT, chat TEXT, summary TEXT, detail TEXT
  );
  CREATE INDEX IF NOT EXISTS activity_bot ON activity(bot, id);
  CREATE TABLE IF NOT EXISTS pending (
    code TEXT PRIMARY KEY, bot TEXT, server TEXT, confirm_tool TEXT, confirm_id TEXT,
    tool TEXT, chat TEXT, requester TEXT, summary TEXT, expires INTEGER
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS chat_memory (
    chat TEXT PRIMARY KEY, summary TEXT, upto_id INTEGER DEFAULT 0, updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY, chat TEXT, bot TEXT, text TEXT, author TEXT, role TEXT, ts INTEGER
  );
  CREATE INDEX IF NOT EXISTS notes_chat ON notes(chat, id);
`);

// ---- migrations (004-group-memory) ----
const cols = new Set(db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name));
for (const [col, type] of [['msg_id', 'TEXT'], ['quoted', 'TEXT'], ['addressed', 'INTEGER DEFAULT 0']]) {
  if (!cols.has(col)) db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${type}`);
}
db.exec(`
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat, id);
  CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_msgid ON messages(chat, msg_id) WHERE msg_id IS NOT NULL;
`);

// ---- chat history ----
const insMsg = db.prepare(`INSERT OR IGNORE INTO messages
  (channel, chat, bot, msg_id, sender, name, text, quoted, addressed, from_bot, ts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const recent = db.prepare('SELECT * FROM (SELECT * FROM messages WHERE chat = ? ORDER BY id DESC LIMIT ?) ORDER BY id');
const pruneCap = db.prepare('DELETE FROM messages WHERE chat = ? AND id <= (SELECT id FROM messages WHERE chat = ? ORDER BY id DESC LIMIT 1 OFFSET ?)');
const pruneAge = db.prepare('DELETE FROM messages WHERE ts < ?');

/** Store a message once (dedup by chat + msgId). Returns the row id, or 0 if it was a duplicate. */
export function logMessage({ channel = 'whatsapp', chat, bot = '', msgId = null, sender = '', name = '', text, quoted = '', addressed = false, fromBot = false, ts = Date.now() }) {
  const r = insMsg.run(channel, chat, bot, msgId, sender, name, String(text ?? ''), String(quoted || '').slice(0, 500),
    addressed ? 1 : 0, fromBot ? 1 : 0, ts);
  if (Math.random() < 0.02) pruneMessages(chat);
  return r.changes ? Number(r.lastInsertRowid) : 0;
}
export function pruneMessages(chat) {
  if (chat) pruneCap.run(chat, chat, env.memory.maxMessagesPerChat);
  pruneAge.run(Date.now() - env.memory.retentionDays * 86400000);
}
export const history = (chat, n = 30) => recent.all(chat, n);
export const messageCount = (chat) => db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat = ?').get(chat).n;
export const messagesAfter = (chat, afterId, beforeId) =>
  db.prepare('SELECT * FROM messages WHERE chat = ? AND id > ? AND id < ? ORDER BY id').all(chat, afterId, beforeId);
export function searchMessages(chat, query, limit = 15) {
  const like = `%${String(query).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return db.prepare(`SELECT * FROM (SELECT * FROM messages WHERE chat = ? AND (text LIKE ? ESCAPE '\\' OR quoted LIKE ? ESCAPE '\\')
    ORDER BY id DESC LIMIT ?) ORDER BY id`).all(chat, like, like, Math.min(Math.max(Number(limit) || 15, 1), 30));
}

// ---- chat memory (rolling summary) ----
export const getChatMemory = (chat) => db.prepare('SELECT * FROM chat_memory WHERE chat = ?').get(chat) || null;
export function setChatMemory(chat, summary, uptoId) {
  db.prepare('INSERT OR REPLACE INTO chat_memory (chat, summary, upto_id, updated_at) VALUES (?, ?, ?, ?)').run(chat, summary, uptoId, Date.now());
}

// ---- notes ----
export function addNote({ chat, bot, text, author, role }) {
  const r = db.prepare('INSERT INTO notes (chat, bot, text, author, role, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(chat, bot, String(text).slice(0, 500), author || '', role || '', Date.now());
  db.prepare('DELETE FROM notes WHERE chat = ? AND id <= (SELECT id FROM notes WHERE chat = ? ORDER BY id DESC LIMIT 1 OFFSET ?)')
    .run(chat, chat, env.memory.maxNotesPerChat);
  return Number(r.lastInsertRowid);
}
export const listNotes = (chat, limit = 200) =>
  db.prepare('SELECT * FROM (SELECT * FROM notes WHERE chat = ? ORDER BY id DESC LIMIT ?) ORDER BY id').all(chat, limit);
export const getNote = (id) => db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(id));
export const deleteNote = (id, chat) => (chat
  ? db.prepare('DELETE FROM notes WHERE id = ? AND chat = ?').run(Number(id), chat)
  : db.prepare('DELETE FROM notes WHERE id = ?').run(Number(id))).changes > 0;

export function eraseChat(chat) {
  db.prepare('DELETE FROM messages WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM chat_memory WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM notes WHERE chat = ?').run(chat);
}

// ---- activity log (what the panel shows) ----
const insAct = db.prepare('INSERT INTO activity (ts, type, bot, chat, summary, detail) VALUES (?, ?, ?, ?, ?, ?)');
export function insertActivity(a) {
  const r = insAct.run(a.ts, a.type, a.bot || '', a.chat || '', a.summary || '', a.detail ? JSON.stringify(a.detail) : '');
  return Number(r.lastInsertRowid);
}
/** Keep at most `max` entries and nothing older than `days`. */
export function pruneActivity({ days = 30, max = 5000 } = {}) {
  db.prepare('DELETE FROM activity WHERE id <= (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET ?)').run(Math.max(100, max));
  db.prepare('DELETE FROM activity WHERE ts < ?').run(Date.now() - Math.max(1, days) * 86400000);
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
