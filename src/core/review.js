// @ts-check
// Review & teach (070): an agent's recent answers with the message that asked for them, rated 👍 / 👎 by admins.
// Ratings are counts and who rated, never copies of text; they go when the answer is pruned (retention, erase memory).
// Answers in chats that are private to members are left out, as everywhere outside the chat itself.
import { db } from './db.js';
import { fail } from './config.js';
import { privateChats } from './chat-prefs.js';
import { mediaView } from './message-media.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS reply_ratings (
    msg INTEGER PRIMARY KEY, agent TEXT NOT NULL, rating INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reply_ratings_agent ON reply_ratings(agent, ts);
  CREATE INDEX IF NOT EXISTS messages_agent_replies ON messages(agent, id) WHERE from_agent = 1;
  CREATE TRIGGER IF NOT EXISTS reply_ratings_gone AFTER DELETE ON messages WHEN old.from_agent = 1 BEGIN
    DELETE FROM reply_ratings WHERE msg = old.id;
  END;
`);
const WEEK = 7 * 86400000;
const ASKED_WITHIN = 30 * 60000; // the question is the last message to the agent in the 30 minutes before the answer

/** 👍 / 👎 counts of the last 7 days and how many answers it gave then. */
export function reviewCounts(agent, now = Date.now()) {
  const r = db.prepare('SELECT SUM(rating > 0) AS up, SUM(rating < 0) AS down FROM reply_ratings WHERE agent = ? AND ts >= ?').get(agent, now - WEEK);
  const answers = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE agent = ? AND from_agent = 1 AND id > 0 AND ts >= ?').get(agent, now - WEEK).n;
  return { up: r.up || 0, down: r.down || 0, answers };
}

/**
 * The agent's answers, newest first (`before`: a row id for the next page, `only`: 'down' | 'unrated').
 * Each: { id, chat, ts, text, rating, ratedBy, question: { name, sender, senderJid, text, ts } | null }.
 * @param {string} agent
 * @param {{ before?: number | string | null, limit?: number, only?: string }} [o]
 */
export function listAnswers(agent, { before = 0, limit = 20, only = '' } = {}) {
  const hidden = privateChats();
  const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 50);
  const where = ['m.agent = ?', 'm.from_agent = 1'];
  /** @type {(string|number)[]} */
  const args = [agent];
  if (Number(before)) { where.push('m.id < ?'); args.push(Math.trunc(Number(before))); }
  if (hidden.length) { where.push(`m.chat NOT IN (${hidden.map(() => '?').join(',')})`); args.push(...hidden); }
  if (only === 'down') where.push('r.rating < 0');
  if (only === 'unrated') where.push('r.rating IS NULL');
  const rows = db.prepare(`SELECT m.id, m.chat, m.ts, m.text, m.media, r.rating, r.by FROM messages m LEFT JOIN reply_ratings r ON r.msg = m.id
    WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`).all(...args, lim);
  const asked = db.prepare(`SELECT name, sender, sender_jid, text, ts FROM messages WHERE chat = ? AND id < ? AND from_agent = 0 AND ts >= ?
    ORDER BY addressed DESC, id DESC LIMIT 1`);
  return rows.map((m) => {
    const q = asked.get(m.chat, m.id, m.ts - ASKED_WITHIN);
    const media = mediaView(m.media); // 096: a GIF it shared shows with the answer
    return { id: m.id, chat: m.chat, ts: m.ts, text: m.text, ...(media ? { media } : {}), rating: m.rating || 0, ratedBy: m.by || '',
      question: q ? { name: q.name, sender: q.sender, senderJid: q.sender_jid, text: q.text, ts: q.ts } : null };
  });
}

/** 072: ratings of some answers by row id (Messages, Activity), so a rating looks the same wherever the answer is shown. */
export function ratingsOf(ids) {
  const list = [...new Set(ids.map((i) => Math.trunc(Number(i))).filter(Boolean))].slice(0, 500);
  if (!list.length) return new Map();
  return new Map(db.prepare(`SELECT msg, rating FROM reply_ratings WHERE msg IN (${list.map(() => '?').join(',')})`).all(...list).map((r) => [r.msg, r.rating]));
}

/** Rate one answer of the agent: 1, -1, or 0 to clear. */
export function rateAnswer(agent, msg, rating, by = '') {
  const m = db.prepare('SELECT id, chat FROM messages WHERE id = ? AND agent = ? AND from_agent = 1').get(Math.trunc(Number(msg)), agent);
  if (!m || privateChats().includes(m.chat)) throw fail('That answer is not in this agent’s review', 404);
  const v = Math.sign(Number(rating) || 0);
  if (!v) db.prepare('DELETE FROM reply_ratings WHERE msg = ?').run(m.id);
  else db.prepare('INSERT OR REPLACE INTO reply_ratings (msg, agent, rating, by, ts) VALUES (?, ?, ?, ?, ?)').run(m.id, agent, v, String(by).slice(0, 60), Date.now());
  return { id: m.id, rating: v };
}
