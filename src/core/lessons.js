// @ts-check
// Lessons (089): short rules an agent learns from the owner's corrections, saved only after the owner approves them
// (or at once when the agent's "approve lessons by itself" switch is on).
//   - answer lessons ("Chary drives on Saturdays, not Rao"): from a 👎 on an answer (Review, Messages, Activity) and
//     from the owner correcting the agent in a chat ("no, it's Chary who…", "don't answer that here"). The most relevant
//     few (full-text search over the lessons, no new dependency) go into the agent's turn, within a small budget.
//   - join-in lessons ("Don't answer logistics chatter between Anu and Ravi"): from feedback on the messages the agent
//     judged by itself in groups (follow-ups or "whenever needed"): "it didn't need to answer" on an answer, "it should
//     have answered" on a Why quiet row, and 👍 / 👎 on judged answers. They go into the note of judged turns.
// The model only proposes a lesson's wording (background model, bounded per agent per day); saving, scope and use are
// decided here. Lessons are per agent, optionally per chat; a chat's memory erase removes its lessons.
import { db } from './db.js';
import { clip, fail } from './config.js';
import { usageTag } from './usage.js';
import { activity, bus } from './events.js';
import { chat as modelChat } from './providers/index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY, agent TEXT NOT NULL, chat TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'answer',
    text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', source TEXT NOT NULL DEFAULT 'owner', msg INTEGER,
    by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lessons_agent ON lessons(agent, status, kind);
  CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts USING fts5(text, content = 'lessons', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2');
  CREATE TRIGGER IF NOT EXISTS lessons_fts_ins AFTER INSERT ON lessons BEGIN INSERT INTO lessons_fts (rowid, text) VALUES (new.id, new.text); END;
  CREATE TRIGGER IF NOT EXISTS lessons_fts_del AFTER DELETE ON lessons BEGIN INSERT INTO lessons_fts (lessons_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
  CREATE TRIGGER IF NOT EXISTS lessons_fts_upd AFTER UPDATE OF text ON lessons BEGIN
    INSERT INTO lessons_fts (lessons_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO lessons_fts (rowid, text) VALUES (new.id, new.text);
  END;
  -- answers the agent gave to messages it judged by itself (no wake word): feedback on them teaches when to join in
  CREATE TABLE IF NOT EXISTS judged_answers (msg INTEGER PRIMARY KEY, agent TEXT NOT NULL, chat TEXT NOT NULL, ts INTEGER NOT NULL);
  CREATE TRIGGER IF NOT EXISTS judged_answers_gone AFTER DELETE ON messages WHEN old.from_agent = 1 BEGIN DELETE FROM judged_answers WHERE msg = old.id; END;
  -- feedback on judged turns, counts per agent + chat: good | needless (answered, should not have) | missed (stayed out, should have answered)
  CREATE TABLE IF NOT EXISTS join_feedback (agent TEXT NOT NULL, chat TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, last_ts INTEGER,
    PRIMARY KEY (agent, chat, kind));
`);

const KINDS = ['answer', 'join'];
const MAX_PROPOSALS_PER_DAY = 20;
const CONTEXT_CHARS = 800; // about 200 tokens of lessons in a turn
const JOIN_LESSONS = 5;

const view = (r) => ({ id: r.id, agent: r.agent, chat: r.chat, kind: r.kind, text: r.text, status: r.status, source: r.source, msg: r.msg || null, by: r.by, createdAt: r.created_at, updatedAt: r.updated_at });
const row = (id) => db.prepare('SELECT * FROM lessons WHERE id = ?').get(Math.trunc(Number(id)) || 0);
const cleanText = (t) => clip(String(t || '').replace(/\s+/g, ' ').trim(), 240);

/** An agent's lessons: { proposed, active } (newest first), and the join-in feedback per chat. */
export function listLessons(agent) {
  const all = db.prepare('SELECT * FROM lessons WHERE agent = ? ORDER BY id DESC LIMIT 400').all(agent).map(view);
  const feedback = db.prepare('SELECT chat, kind, count, last_ts FROM join_feedback WHERE agent = ? ORDER BY last_ts DESC LIMIT 200').all(agent);
  return { proposed: all.filter((l) => l.status === 'proposed'), active: all.filter((l) => l.status === 'active'), feedback };
}
/** How many lessons wait for the owner's OK (the agent page's row says so). */
export const proposedCount = (agent) => db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE agent = ? AND status = 'proposed'").get(agent).n;

/** Add a lesson by hand (the owner): active at once. */
export function addLesson(agent, { text, chat = '', kind = 'answer' }, by = '') {
  const t = cleanText(text);
  if (t.length < 3) throw fail('Write the lesson (a short sentence)', 400, { field: 'text' });
  if (!KINDS.includes(kind)) throw fail('kind: answer or join', 400, { field: 'kind' });
  return save({ agent, chat, kind, text: t, status: 'active', source: 'owner', by });
}
function save({ agent, chat, kind, text, status, source, msg = null, by = '' }) {
  const now = Date.now();
  const id = Number(db.prepare('INSERT INTO lessons (agent, chat, kind, text, status, source, msg, by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(agent, chat || '', kind, text, status, source, msg, String(by).slice(0, 60), now, now).lastInsertRowid);
  activity('config', { agent, chat: chat || '', summary: `Lesson ${status === 'proposed' ? 'proposed' : 'saved'} (${SOURCE[source] || source}${kind === 'join' ? ', when to join in' : ''})` });
  bus.emit('status');
  return view(row(id));
}
const SOURCE = { thumbs: 'from a 👎 on an answer', correction: 'from your correction in the chat', needless: 'it did not need to answer', missed: 'it should have answered', owner: 'added by hand' };

/**
 * Change a lesson: text, scope (chat: '' = all its chats), status ('active' approves).
 * @param {string} agent @param {number|string} id @param {{ text?: string, chat?: string, status?: string }} [patch] @param {string} [by]
 */
export function updateLesson(agent, id, { text, chat, status } = {}, by = '') {
  const r = row(id);
  if (!r || r.agent !== agent) throw fail('No such lesson', 404);
  const next = { text: text === undefined ? r.text : cleanText(text), chat: chat === undefined ? r.chat : String(chat || ''), status: status === undefined ? r.status : status };
  if (next.text.length < 3) throw fail('Write the lesson (a short sentence)', 400, { field: 'text' });
  if (!['proposed', 'active'].includes(next.status)) throw fail('status: proposed or active', 400, { field: 'status' });
  db.prepare('UPDATE lessons SET text = ?, chat = ?, status = ?, by = ?, updated_at = ? WHERE id = ?').run(next.text, next.chat, next.status, String(by).slice(0, 60), Date.now(), r.id);
  if (next.status !== r.status) activity('config', { agent, chat: next.chat, summary: `Lesson approved (${by || 'owner'})` });
  bus.emit('status');
  return view(row(r.id));
}
export function deleteLesson(agent, id) {
  const r = row(id);
  if (!r || r.agent !== agent) throw fail('No such lesson', 404);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(r.id);
  bus.emit('status');
  return { ok: true };
}
/** A chat's memory was erased: its own lessons and join-in feedback go too. */
export function forgetChatLessons(chat) {
  db.prepare('DELETE FROM lessons WHERE chat = ?').run(chat);
  db.prepare('DELETE FROM join_feedback WHERE chat = ?').run(chat);
}

// ---------- in the agent's turn ----------
const ftsWords = (text) => (String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).slice(0, 12).map((w) => `"${w}"*`).join(' OR ');
/** The lessons for this turn: the ones matching the message first, then the newest; chat lessons before agent-wide ones. */
export function lessonsContext(agent, chat, text) {
  const q = ftsWords(text);
  const hits = q ? db.prepare(`SELECT l.* FROM lessons_fts f JOIN lessons l ON l.id = f.rowid WHERE lessons_fts MATCH ? AND l.agent = ? AND l.status = 'active' AND l.kind = 'answer'
    AND l.chat IN ('', ?) ORDER BY (l.chat = '') , rank LIMIT 8`).all(q, agent.id, chat) : [];
  const recent = db.prepare(`SELECT * FROM lessons WHERE agent = ? AND status = 'active' AND kind = 'answer' AND chat IN ('', ?) ORDER BY (chat = ''), id DESC LIMIT 8`).all(agent.id, chat);
  const picked = []; let size = 0;
  for (const l of [...hits, ...recent]) {
    if (picked.some((p) => p.id === l.id) || size + l.text.length > CONTEXT_CHARS) continue;
    picked.push(l); size += l.text.length;
  }
  if (!picked.length) return '';
  return `<lessons note="corrections the owner approved; follow them">\n${picked.map((l) => `- ${l.text}`).join('\n')}\n</lessons>`;
}
/** Join-in lessons for a judged turn in this chat (and agent-wide ones). */
export function joinLessonsNote(agent, chat) {
  const list = db.prepare(`SELECT text FROM lessons WHERE agent = ? AND status = 'active' AND kind = 'join' AND chat IN ('', ?) ORDER BY (chat = ''), id DESC LIMIT ?`).all(agent.id, chat, JOIN_LESSONS);
  return list.length ? `What the owner taught you about joining in here:\n${list.map((l) => `- ${l.text}`).join('\n')}` : '';
}

// ---------- proposals ----------
const PROPOSE = 'You write one short lesson (one sentence, at most 25 words) that an assistant in a group chat should follow next time, from a correction by its owner. Write a rule, not a story; use names only when the correction is about them. If there is nothing to learn, answer exactly NONE. Answer in JSON: {"lesson": "…", "scope": "chat" | "agent"} — scope "chat" when it only applies to this chat (e.g. "don\'t answer that here").';
const JOIN = 'You write one short rule (one sentence, at most 25 words) for an assistant that reads a group chat and decides by itself when to join in. From the owner\'s feedback on one message, say when to answer or stay out (e.g. "Don\'t answer logistics chatter between Anu and Ravi"). If there is nothing general to learn, answer exactly NONE. Answer in JSON: {"lesson": "…"}.';
const proposalsToday = (agent) => db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE agent = ? AND source <> 'owner' AND created_at >= ?").get(agent, Date.now() - 86400000).n;

/**
 * Ask the background model for a lesson and keep it as proposed (or active with auto-approve). Never throws; at most
 * MAX_PROPOSALS_PER_DAY per agent. `input`: what happened, in plain lines. Returns the lesson or null.
 */
async function propose({ agent, chat, kind, source, msg = null, input, by = '' }) {
  if (agent.lessons?.enabled === false || proposalsToday(agent.id) >= MAX_PROPOSALS_PER_DAY) return null;
  try {
    const res = await modelChat({ model: 'auto', purpose: 'background', maxTokens: 120, fallback: undefined, usage: usageTag('lessons', { agent: agent.id, chat }),
      system: kind === 'join' ? JOIN : PROPOSE, messages: [{ role: 'user', content: clip(input, 3000) }] });
    const out = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    if (!out || /^NONE\b/i.test(out)) return null;
    let lesson = ''; let scope = kind === 'join' ? 'chat' : 'agent';
    try { const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); lesson = String(j.lesson || ''); if (j.scope === 'chat' || j.scope === 'agent') scope = j.scope; } catch { lesson = out; }
    lesson = cleanText(lesson.replace(/^["“]|["”]$/g, ''));
    if (lesson.length < 3 || /^NONE\b/i.test(lesson)) return null;
    return save({ agent: agent.id, chat: scope === 'chat' || kind === 'join' ? chat : '', kind, text: lesson, status: agent.lessons?.autoApprove ? 'active' : 'proposed', source, msg, by });
  } catch (e) {
    activity('error', { agent: agent.id, summary: `A lesson could not be proposed: ${e.message}` });
    return null;
  }
}

/** A 👎 on an answer: propose a lesson from the question and the answer. */
export function lessonFromThumbsDown(agent, { msg, chat, question, answer, by }) {
  return propose({ agent, chat, kind: 'answer', source: 'thumbs', msg, by, input: `The owner marked this answer as wrong or unhelpful.\nQuestion: ${question || '(not found)'}\nAnswer: ${answer}` });
}
const CORRECTION = /^(no\b|nope|wrong|not\b|actually|incorrect|that'?s not|it'?s not|don'?t|do not|never|stop|please don'?t|you should(n'?t)?|nein|non\b|pas\b)/i;
/** The owner corrected the agent in a chat right after its answer: propose a lesson. `answer`: its last answer there. */
export function lessonFromCorrection(agent, { chat, text, answer, msg }) {
  if (!CORRECTION.test(String(text || '').trim())) return null;
  return propose({ agent, chat, kind: 'answer', source: 'correction', msg, by: 'owner', input: `The assistant said: ${answer}\nIts owner replied: ${text}` });
}

// ---------- learning when to join in ----------
/** An answer to a message the agent judged by itself (no wake word). */
export function noteJudgedAnswer(msg, agent, chat) {
  if (msg) db.prepare('INSERT OR REPLACE INTO judged_answers (msg, agent, chat, ts) VALUES (?, ?, ?, ?)').run(msg, agent, chat, Date.now());
}
/** Of these answer row ids, the ones that answered judged messages. */
export function judgedOf(ids) {
  const list = [...new Set(ids.map((i) => Math.trunc(Number(i))).filter(Boolean))].slice(0, 500);
  if (!list.length) return new Set();
  return new Set(db.prepare(`SELECT msg FROM judged_answers WHERE msg IN (${list.map(() => '?').join(',')})`).all(...list).map((r) => r.msg));
}
const countFeedback = (agent, chat, kind) => db.prepare(`INSERT INTO join_feedback (agent, chat, kind, count, last_ts) VALUES (?, ?, ?, 1, ?)
  ON CONFLICT (agent, chat, kind) DO UPDATE SET count = count + 1, last_ts = excluded.last_ts`).run(agent, chat, kind, Date.now());

/**
 * Feedback on joining in: kind 'good' | 'needless' (on a judged answer: `msg`) or 'missed' (it stayed out: the last
 * message it left alone in `chat`). Counts always; needless and missed also propose a join-in lesson.
 * `texts`: { message (what was said), answer? } — read by the caller from stored messages.
 */
export function joinFeedback(agent, { chat, kind, msg = null, message = '', answer = '', by = '' }) {
  if (!['good', 'needless', 'missed'].includes(kind)) throw fail('kind: good, needless or missed', 400, { field: 'kind' });
  countFeedback(agent.id, chat, kind);
  activity('config', { agent: agent.id, chat, summary: `Join-in feedback: ${kind === 'good' ? 'answered well' : kind === 'needless' ? 'did not need to answer' : 'should have answered'} (${by || 'owner'})` });
  if (kind === 'good' || !message) return null;
  return propose({ agent, chat, kind: 'join', source: kind, msg, by,
    input: kind === 'needless' ? `The assistant answered this group message by itself, but the owner says it did not need to.\nMessage: ${message}\nIts answer: ${answer}`
      : `The assistant read this group message and stayed out, but the owner says it should have answered.\nMessage: ${message}` });
}
