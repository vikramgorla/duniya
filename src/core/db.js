// @ts-check
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { DATA_DIR, env } from './config.js';

export const DB_FILE = resolve(DATA_DIR, 'duniya.sqlite');
/**
 * Rows are plain objects whose columns the SQL decides, so statements hand them out untyped (063, type checking).
 * @typedef {{ run: (...params: any[]) => import('node:sqlite').StatementResultingChanges, get: (...params: any[]) => any,
 *   all: (...params: any[]) => any[], iterate: (...params: any[]) => IterableIterator<any> }} Statement
 * @type {Omit<DatabaseSync, 'prepare'> & { prepare: (sql: string) => Statement }}
 */
export const db = new DatabaseSync(DB_FILE);
// 069: pragmas for a small server. WAL with synchronous = NORMAL is crash-safe (a power cut can lose only the last
// moments, never corrupt the file) and avoids an fsync per write; the WAL file is trimmed after checkpoints; temp
// tables stay in memory; the page cache is 8 MB. auto_vacuum = INCREMENTAL only takes effect on a new database (or
// after the next VACUUM, which retention.js runs when it is cheap): freed pages then go back in small steps.
db.exec(`
  PRAGMA auto_vacuum = INCREMENTAL;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -8000;
  PRAGMA journal_size_limit = 33554432;
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, channel TEXT, chat TEXT, agent TEXT, msg_id TEXT, sender TEXT, sender_jid TEXT, name TEXT,
    text TEXT, quoted TEXT, addressed INTEGER DEFAULT 0, from_agent INTEGER DEFAULT 0, ts INTEGER
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY, ts INTEGER, type TEXT, agent TEXT, chat TEXT, summary TEXT, detail TEXT
  );
  CREATE INDEX IF NOT EXISTS activity_agent ON activity(agent, id);
  CREATE INDEX IF NOT EXISTS activity_chat ON activity(chat, id);
  CREATE INDEX IF NOT EXISTS activity_ts ON activity(ts);
  CREATE TABLE IF NOT EXISTS pending (
    code TEXT PRIMARY KEY, agent TEXT, server TEXT, confirm_tool TEXT, confirm_id TEXT,
    tool TEXT, chat TEXT, requester TEXT, summary TEXT, expires INTEGER
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS member_tags (
    chat TEXT NOT NULL, member TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat, member)
  );
  CREATE TABLE IF NOT EXISTS chat_memory (
    chat TEXT PRIMARY KEY, summary TEXT, upto_id INTEGER DEFAULT 0, updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY, chat TEXT, agent TEXT, text TEXT, author TEXT, role TEXT, ts INTEGER
  );
  CREATE INDEX IF NOT EXISTS notes_chat ON notes(chat, id);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat, id);
  CREATE INDEX IF NOT EXISTS messages_chat_ts ON messages(chat, ts);
  CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_msgid ON messages(chat, msg_id) WHERE msg_id IS NOT NULL;
  -- 026: reactions and polls (WhatsApp features)
  CREATE TABLE IF NOT EXISTS wa_reactions (
    chat TEXT, msg_id TEXT, sender TEXT, name TEXT, emoji TEXT, ts INTEGER, PRIMARY KEY (chat, msg_id, sender)
  );
  CREATE INDEX IF NOT EXISTS wa_reactions_chat ON wa_reactions(chat, ts);
  CREATE TABLE IF NOT EXISTS wa_polls (
    chat TEXT, msg_id TEXT, name TEXT, options TEXT, selectable INTEGER, creator TEXT, message TEXT, votes TEXT, ts INTEGER,
    PRIMARY KEY (chat, msg_id)
  );
  CREATE INDEX IF NOT EXISTS wa_polls_chat ON wa_polls(chat, ts);
`);

// ---- chat history ----
const insMsg = db.prepare(`INSERT OR IGNORE INTO messages
  (channel, chat, agent, msg_id, sender, name, text, quoted, addressed, from_agent, ts, sender_jid)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const recent = db.prepare('SELECT * FROM (SELECT * FROM messages WHERE chat = ? ORDER BY id DESC LIMIT ?) ORDER BY id');

// 069: disk almost full (retention.js) or SQLite said so: stored messages and optional activity pause, never crash.
let paused = false;
export const writesPaused = () => paused;
export const setWritesPaused = (on) => { paused = !!on; };
/** A write failed because the disk is full: pause optional writes (retention.js resumes them when space is back). */
export const diskFullError = (e) => { const full = /SQLITE_FULL|disk is full|ENOSPC/i.test(String(e?.message || e)); if (full) paused = true; return full; };

/** Store a message once (dedup by chat + msgId). Returns the row id, or 0 if it was a duplicate or writes are paused. */
export function logMessage({ channel = 'whatsapp', chat, agent = '', msgId = null, sender = '', name = '', text, quoted = '', addressed = false, fromAgent = false, ts = Date.now(), senderJid = '' }) {
  if (paused) return 0;
  let r;
  try {
    r = insMsg.run(channel, chat, agent, msgId, sender, name, String(text ?? ''), String(quoted || '').slice(0, 500),
      addressed ? 1 : 0, fromAgent ? 1 : 0, ts, senderJid || '');
  } catch (e) { if (diskFullError(e)) return 0; throw e; }
  return r.changes ? Number(r.lastInsertRowid) : 0;
}
/**
 * #91: store messages that are OLDER than everything stored for the chat (history the phone sent on demand). They get
 * row ids below every existing row (ids may go negative), so "recent" (by id) and summary boundaries stay right.
 * `rows`: logMessage-style objects. Returns the stored rows ({ id, ts }), oldest first; duplicates are skipped.
 */
const insMsgWithId = db.prepare(`INSERT OR IGNORE INTO messages
  (id, channel, chat, agent, msg_id, sender, name, text, quoted, addressed, from_agent, ts, sender_jid)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
export function insertEarlierMessages(chat, rows) {
  const fresh = rows.filter((m) => !m.msgId || !messageByMsgId(chat, m.msgId)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!fresh.length) return [];
  const out = [];
  db.exec('BEGIN');
  try {
    const min = db.prepare('SELECT MIN(id) AS m FROM messages').get().m;
    let id = Math.min(Number(min ?? 0), 0) - fresh.length - 1; // never 0 (0 means "no row" elsewhere)
    for (const m of fresh) {
      id++;
      const r = insMsgWithId.run(id, m.channel || 'whatsapp', chat, m.agent || '', m.msgId || null, m.sender || '', m.name || '', String(m.text ?? ''),
        String(m.quoted || '').slice(0, 500), m.addressed ? 1 : 0, m.fromAgent ? 1 : 0, m.ts || Date.now(), m.senderJid || '');
      if (r.changes) out.push({ id, ts: m.ts });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return out;
}
/** #91: the oldest stored message of a chat that has a WhatsApp id (anchor for loading earlier messages). */
export const oldestStoredMessage = (chat) => db.prepare('SELECT * FROM messages WHERE chat = ? AND msg_id IS NOT NULL ORDER BY id LIMIT 1').get(chat) || null;
/** #91: how much of a chat is stored: { count, since } (since = time of the oldest stored message). */
export const storedSpan = (chat) => { const r = db.prepare('SELECT COUNT(*) AS n, MIN(ts) AS since FROM messages WHERE chat = ?').get(chat); return { count: r.n, since: r.since || null }; };
export const history = (chat, n = 30) => recent.all(chat, n);
export const messageCount = (chat) => db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat = ?').get(chat).n;
/** 069: how many messages lie between two row ids (cheap check before loading them). */
export const countBetween = (chat, afterId, beforeId) => db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat = ? AND id > ? AND id < ?').get(chat, afterId, beforeId).n;
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
export function addNote({ chat, agent, text, author, role }) {
  const r = db.prepare('INSERT INTO notes (chat, agent, text, author, role, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(chat, agent, String(text).slice(0, 500), author || '', role || '', Date.now());
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

export function updateNote(id, chat, text) {
  return db.prepare('UPDATE notes SET text = ?, ts = ? WHERE id = ? AND chat = ?').run(String(text).slice(0, 500), Date.now(), Number(id), chat).changes > 0;
}
/** Notes of several scopes (chat ids or `agent:<id>`) whose text contains the query, newest first. */
export function searchNotes(chats, query, limit = 20) {
  if (!chats.length) return [];
  const q = `%${String(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.prepare(`SELECT * FROM notes WHERE chat IN (${chats.map(() => '?').join(',')}) AND text LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`)
    .all(...chats, q, Math.min(Number(limit) || 20, 50));
}
export const deleteAgentNotes = (agent) => db.prepare('DELETE FROM notes WHERE chat = ?').run(`agent:${agent}`).changes;

export function eraseChat(chat) {
  db.prepare('DELETE FROM messages WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM wa_reactions WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM wa_polls WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM chat_memory WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM notes WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM member_tags WHERE chat = ?').run(chat);
}

// ---- activity log (what the panel shows) ----
const insAct = db.prepare('INSERT INTO activity (ts, type, agent, chat, summary, detail) VALUES (?, ?, ?, ?, ?, ?)');
export function insertActivity(a) {
  const r = insAct.run(a.ts, a.type, a.agent || '', a.chat || '', a.summary || '', a.detail ? JSON.stringify(a.detail) : '');
  return Number(r.lastInsertRowid);
}
/** @param {{ limit?: number|string, agent?: string, chat?: string, before?: number }} [o]  limit: as sent (a query string is fine) */
export function listActivity({ limit = 200, agent = '', chat = '', before = 0 } = {}) {
  const lim = Math.min(Number(limit) || 200, 1000);
  const where = ['(? = 0 OR id < ?)'];
  /** @type {(string|number)[]} */
  const args = [before, before];
  if (agent) { where.push('agent = ?'); args.push(agent); }
  if (chat) { where.push('chat = ?'); args.push(chat); }
  const rows = db.prepare(`SELECT * FROM activity WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, lim);
  return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}

// ---- pending confirmations ----
const expire = db.prepare('DELETE FROM pending WHERE expires < ?');
const insPending = db.prepare(`INSERT OR REPLACE INTO pending
  (code, agent, server, confirm_tool, confirm_id, tool, chat, requester, summary, expires)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const getPendingStmt = db.prepare('SELECT * FROM pending WHERE code = ?');
const delPendingStmt = db.prepare('DELETE FROM pending WHERE code = ?');

export function addPending(p) {
  expire.run(Date.now());
  insPending.run(p.code, p.agent, p.server, p.confirmTool, p.confirmId, p.tool, p.chat, p.requester, p.summary || '', p.expires);
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
  return db.prepare('SELECT code, agent, tool, chat, requester, summary, expires FROM pending ORDER BY expires').all();
}

// ---- key/value ----
const getKv = db.prepare('SELECT v FROM kv WHERE k = ?');
const setKvStmt = db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)');
export const kvGet = (k) => getKv.get(k)?.v;
export const kvSet = (k, v) => setKvStmt.run(k, String(v));

/** Latest display name per sender phone seen in a chat (for member lists). */
export function namesInChat(chat) {
  const rows = db.prepare("SELECT sender, name FROM messages WHERE chat = ? AND sender != '' AND sender != 'agent' ORDER BY id DESC LIMIT 2000").all(chat);
  const out = {};
  for (const r of rows) if (!out[r.sender] && r.name) out[r.sender] = r.name;
  return out;
}

/** Stored messages of a chat, newest first (for admins in the panel). */
/** @param {string} chat  @param {{ before?: number|string, limit?: number|string, q?: string }} [o]  numbers as sent */
export function listMessages(chat, { before = 0, limit = 50, q = '' } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  /** @type {(string|number)[]} */
  const args = [chat];
  let where = 'chat = ?';
  if (Number(before)) { where += ' AND id < ?'; args.push(Number(before)); }
  if (q) { where += ' AND text LIKE ?'; args.push(`%${String(q).slice(0, 100)}%`); }
  return db.prepare(`SELECT id, sender, sender_jid AS senderJid, name, text, quoted, from_agent AS fromAgent, addressed, ts FROM messages WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...args, lim)
    .map((m) => ({ ...m, fromAgent: !!m.fromAgent, addressed: !!m.addressed }));
}

// ---- WhatsApp reactions and polls (026) ----
export const messageByMsgId = (chat, msgId) => db.prepare('SELECT * FROM messages WHERE chat = ? AND msg_id = ?').get(chat, String(msgId)) || null;
/** Latest stored message of a chat sent by the agent (for "edit/delete my last message"). */
export const lastAgentMessage = (chat) => db.prepare('SELECT * FROM messages WHERE chat = ? AND from_agent = 1 AND msg_id IS NOT NULL ORDER BY id DESC LIMIT 1').get(chat) || null;
export function setMessageText(chat, msgId, text) {
  db.prepare('UPDATE messages SET text = ? WHERE chat = ? AND msg_id = ?').run(String(text), chat, String(msgId));
}
/** Store a reaction; an empty emoji removes the sender's reaction. */
export function saveReaction({ chat, msgId, sender, name = '', emoji = '', ts = Date.now() }) {
  if (!emoji) { db.prepare('DELETE FROM wa_reactions WHERE chat = ? AND msg_id = ? AND sender = ?').run(chat, String(msgId), sender); return; }
  db.prepare('INSERT OR REPLACE INTO wa_reactions (chat, msg_id, sender, name, emoji, ts) VALUES (?, ?, ?, ?, ?, ?)').run(chat, String(msgId), sender, name, emoji, ts);
  db.prepare('DELETE FROM wa_reactions WHERE chat = ? AND ts < (SELECT ts FROM wa_reactions WHERE chat = ? ORDER BY ts DESC LIMIT 1 OFFSET 500)').run(chat, chat);
}
export const recentReactions = (chat, limit = 15) => db.prepare(`SELECT r.*, m.text AS target_text, m.from_agent AS target_from_agent FROM wa_reactions r
  LEFT JOIN messages m ON m.chat = r.chat AND m.msg_id = r.msg_id WHERE r.chat = ? ORDER BY r.ts DESC LIMIT ?`).all(chat, limit).reverse();

const pollRow = (r) => (r ? { ...r, options: JSON.parse(r.options || '[]'), votes: JSON.parse(r.votes || '{}') } : null);
/** Keep a poll's creation message (BufferJSON text) so votes can be decrypted later. */
export function savePoll({ chat, msgId, name, options, selectable = 1, creator = '', message = '', ts = Date.now() }) {
  db.prepare(`INSERT INTO wa_polls (chat, msg_id, name, options, selectable, creator, message, votes, ts) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
    ON CONFLICT(chat, msg_id) DO UPDATE SET name = excluded.name, options = excluded.options, selectable = excluded.selectable, creator = excluded.creator, message = excluded.message`)
    .run(chat, String(msgId), String(name || ''), JSON.stringify(options || []), Number(selectable) || 0, creator, message, ts);
}
export const getPoll = (chat, msgId) => pollRow(db.prepare('SELECT * FROM wa_polls WHERE chat = ? AND msg_id = ?').get(chat, String(msgId)));
export const latestPoll = (chat) => pollRow(db.prepare('SELECT * FROM wa_polls WHERE chat = ? ORDER BY ts DESC LIMIT 1').get(chat));
export const recentPolls = (chat, limit = 3) => db.prepare('SELECT * FROM wa_polls WHERE chat = ? ORDER BY ts DESC LIMIT ?').all(chat, limit).map(pollRow).reverse();
/** A voter's latest choice replaces their earlier one (empty list = vote withdrawn). */
export function savePollVote({ chat, msgId, voter, name = '', selected = [], ts = Date.now() }) {
  const p = getPoll(chat, msgId);
  if (!p) return null;
  const votes = p.votes;
  if (selected.length) votes[voter] = { name, options: selected, ts }; else delete votes[voter];
  db.prepare('UPDATE wa_polls SET votes = ? WHERE chat = ? AND msg_id = ?').run(JSON.stringify(votes), chat, String(msgId));
  return { ...p, votes };
}
/** Option counts of a poll: [{ name, votes, voters: [names] }]. */
export function pollTally(p) {
  const counts = p.options.map((o) => ({ name: o, votes: 0, voters: [] }));
  for (const v of Object.values(p.votes || {})) {
    for (const o of v.options || []) {
      let c = counts.find((x) => x.name === o);
      if (!c) { c = { name: o, votes: 0, voters: [] }; counts.push(c); }
      c.votes++; c.voters.push(v.name || 'someone');
    }
  }
  return counts;
}
