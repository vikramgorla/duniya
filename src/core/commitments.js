// @ts-check
// Commitments (091): agents with "Track promises" on notice when someone in one of their chats that are on promises
// something ("I'll bring the speakers", "I'll pay on Friday"): who, what, when it is due and the message. They are kept
// on the person's page and the agent's Promises list; when one falls due the agent follows up gently — in the chat where
// it was promised, or in the person's direct chat, per agent — once, inside the sending hours, never in a chat that is
// off. When the chat later shows it done ("brought them", "paid ✅"), the background model marks it done; the owner
// can correct any of it. Due promises go into the morning brief.
//
// Cheap first: a message is only looked at by the model when it reads like a promise (or like something done while the
// person has open promises), at most MAX_PER_DAY model calls per agent per day; follow-ups ride the upkeep tick, a few
// per tick. No message text is kept except the promise's own short wording.
//
// 092: People → Promises lists them across agents (open, overdue, done; by person, agent or chat); the owner and admins
// mark done, reopen, re-date or delete them there (and through the admin MCP / owner assistant); an agent's organizers
// do the same for the promises of its chats from the chat (PROMISE_TOOLS), participants see their own.
import { db, kvGet, kvSet, logMessage } from './db.js';
import { clip, env, localParts } from './config.js';
import { usageTag } from './usage.js';
import { activity } from './events.js';
import { chat as modelChat } from './providers/index.js';
import { isChatEnabled } from './chat-prefs.js';
import { sendingHoursNow } from './pace.js';
import { getAgent } from './agents.js';
import { personRow } from './people.js';
import { chatsOfPerson } from './people-access.js';
import { channelOf, isGroup } from '../channels/index.js';
import { chatChannel } from './chat-tools.js';
import { registerBriefSection } from './brief.js';
import { TENANT } from './store.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY, agent TEXT NOT NULL, chat TEXT NOT NULL, person TEXT NOT NULL DEFAULT '', who TEXT NOT NULL DEFAULT '',
    what TEXT NOT NULL, due TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', msg INTEGER, by TEXT NOT NULL DEFAULT '',
    followed_up_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS commitments_open ON commitments(status, due);
  CREATE INDEX IF NOT EXISTS commitments_person ON commitments(person, status);
  CREATE INDEX IF NOT EXISTS commitments_chat ON commitments(chat, status);
  CREATE INDEX IF NOT EXISTS commitments_agent ON commitments(agent, status);
`);

const MAX_PER_DAY = 50;
const PER_TICK = 3;
const PROMISE = /\b(i'?ll|i will|i can|i'?m going to|i am going to|i shall|let me|je vais|je peux|ich werde|ich bringe|voy a|lo hago|i'?ll do|on it)\b/i;
const DONE = /\b(done|did it|brought|paid|sent|finished|ready|delivered|sorted|handled|got (it|them)|fait|erledigt|bezahlt|hecho)\b|✅|✔️/i;
const today = (tz = env.timezone, now = Date.now()) => localParts(tz, now).date;
const view = (r, day = today()) => ({ id: r.id, agent: r.agent, chat: r.chat, person: r.person, who: r.who || r.person_name || '', what: r.what, due: r.due, status: r.status,
  overdue: r.status === 'open' && !!r.due && r.due < day, msg: r.msg || null, by: r.by, followedUpAt: r.followed_up_at || null, createdAt: r.created_at, updatedAt: r.updated_at });
const STATUSES = ['open', 'overdue', 'done', 'dropped', 'all'];
const notFound = () => Object.assign(new Error('No such promise'), { status: 404 });
const one = (id) => db.prepare('SELECT * FROM commitments WHERE id = ?').get(Math.trunc(Number(id)) || 0);

/**
 * Commitments by agent, person, chat (or chats: an agent's), status 'open' (default; overdue first, then by due date,
 * undated last), 'overdue', 'done', 'dropped' (newest change first) or 'all' (newest first). ≤ limit (200).
 * @param {{ agent?: string, person?: string, chat?: string, chats?: string[] | null, status?: string, limit?: number }} [f]
 */
export function listCommitments({ agent = '', person = '', chat = '', chats = null, status = 'open', limit = 200 } = {}) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error(`status: ${STATUSES.join(', ')}`), { status: 400, field: 'status' });
  const day = today();
  const where = []; /** @type {(string|number)[]} */ const args = [TENANT];
  if (status === 'overdue') { where.push("c.status = 'open' AND c.due <> '' AND c.due < ?"); args.push(day); } else if (status !== 'all') { where.push('c.status = ?'); args.push(status); }
  if (agent) { where.push('c.agent = ?'); args.push(agent); }
  if (person) { where.push('c.person = ?'); args.push(person); }
  if (chat) { where.push('c.chat = ?'); args.push(chat); }
  if (chats) { if (!chats.length) return []; where.push(`c.chat IN (${chats.map(() => '?').join(',')})`); args.push(...chats); }
  const order = status === 'open' || status === 'overdue' ? "c.due = '', c.due, c.id DESC" : status === 'all' ? 'c.id DESC' : 'c.updated_at DESC';
  return db.prepare(`SELECT c.*, p.name AS person_name FROM commitments c LEFT JOIN people p ON p.tenant_id = ? AND p.id = c.person
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`).all(...args, Math.min(Math.max(Number(limit) || 200, 1), 200)).map((r) => view(r, day));
}
/** One commitment (or null). */
export const getCommitment = (id) => { const r = one(id); return r ? view(r) : null; };
/**
 * Correct one: status (open | done | dropped), what, due. Reopening, or a new due date, lets the gentle follow-up go
 * out again when it falls due.
 * @param {number|string} id @param {{ status?: string, what?: string, due?: string }} [patch] @param {string} [by]
 */
export function updateCommitment(id, { status, what, due } = {}, by = '') {
  const r = one(id);
  if (!r) throw notFound();
  if (status !== undefined && !['open', 'done', 'dropped'].includes(status)) throw Object.assign(new Error('status: open, done or dropped'), { status: 400, field: 'status' });
  if (due !== undefined && due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(due))) throw Object.assign(new Error('Due date like 2026-12-01'), { status: 400, field: 'due' });
  if (what !== undefined && String(what).trim().length < 2) throw Object.assign(new Error('Say what was promised'), { status: 400, field: 'what' });
  const again = (status === 'open' && r.status !== 'open') || (due !== undefined && due !== r.due);
  db.prepare('UPDATE commitments SET status = ?, what = ?, due = ?, by = ?, followed_up_at = ?, updated_at = ? WHERE id = ?')
    .run(status ?? r.status, what !== undefined ? clip(String(what).trim(), 200) : r.what, due ?? r.due, String(by).slice(0, 60), again ? null : r.followed_up_at, Date.now(), r.id);
  activity('config', { agent: r.agent, chat: r.chat, summary: `Promise ${status && status !== r.status ? (status === 'open' ? 'reopened' : `marked ${status}`) : 'changed'} (${by || 'owner'})` });
  return view(one(r.id));
}
/** Delete one (a mistake, or something nobody should see again). */
export function deleteCommitment(id, by = '') {
  const r = one(id);
  if (!r) throw notFound();
  db.prepare('DELETE FROM commitments WHERE id = ?').run(r.id);
  activity('config', { agent: r.agent, chat: r.chat, summary: `Promise deleted (${by || 'owner'})` });
  return { ok: true };
}
// ---------- agent tools (092): promises__list_promises, promises__update_promise, for agents with Track promises ----------
const inScope = (c, ctx) => !!c && (ctx.agent.chats || []).includes(c.chat) && (ctx.role === 'organizer' || (!!ctx.personId && c.person === ctx.personId));
const toolView = (c, ctx) => ({ id: c.id, who: c.who || 'someone', what: c.what, due: c.due || null, status: c.overdue ? 'overdue' : c.status, inThisChat: c.chat === ctx.chat });
/** Organizers: the promises of the agent's chats, and they mark done, reopen, re-date or drop them; participants: their own, and mark them done. */
export const promiseTools = [
  { name: 'list_promises', roles: ['organizer', 'participant'],
    description: 'Promises people made in this agent\'s chats (who, what, due date, open / overdue / done). Organizers see all of them; anyone else sees their own. status: open (default), overdue or done.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'overdue', 'done'] } } },
    run: (a, ctx) => {
      if (ctx.role !== 'organizer' && !ctx.personId) return 'I do not know who you are on this app yet, so I cannot show your promises.';
      const list = listCommitments({ chats: ctx.agent.chats || [], person: ctx.role === 'organizer' ? '' : ctx.personId, status: a.status || 'open', limit: 30 });
      return list.length ? list.map((c) => toolView(c, ctx)) : 'No promises.';
    } },
  { name: 'update_promise', roles: ['organizer', 'participant'],
    description: 'Change a promise (its id from list_promises). Organizers: status done, open (reopen) or dropped, and the due date (YYYY-MM-DD, empty for none). Anyone else: only mark their own promise done.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' }, status: { type: 'string', enum: ['done', 'open', 'dropped'] }, due: { type: 'string', description: 'YYYY-MM-DD or empty' } }, required: ['id'] },
    run: (a, ctx) => {
      const c = getCommitment(a.id);
      if (!inScope(c, ctx)) return 'No such promise here.';
      if (ctx.role !== 'organizer' && (a.status !== 'done' || a.due !== undefined)) return 'Only organizers can reopen, drop or re-date a promise; you can mark your own done.';
      return toolView(updateCommitment(c.id, { ...(a.status ? { status: a.status } : {}), ...(a.due !== undefined ? { due: a.due } : {}) }, `${ctx.agent.name || ctx.agent.id} (${ctx.role})`), ctx);
    } },
];

/** A person is erased: their commitments go. A chat's memory is erased: its commitments go. */
export const forgetCommitments = ({ person = '', chat = '' }) => db.prepare(person ? 'DELETE FROM commitments WHERE person = ?' : 'DELETE FROM commitments WHERE chat = ?').run(person || chat);

const callsToday = (agent) => Number(kvGet(`commitments:${agent}:${today()}`) || 0);
const countCall = (agent) => kvSet(`commitments:${agent}:${today()}`, String(callsToday(agent) + 1));

const FIND = 'You read one chat message and find promises its writer makes about something they will do (bring, pay, send, organise, call…). Answer in JSON only: {"promises": [{"what": "short, in the writer\'s words, third person, e.g. bring the speakers", "due": "YYYY-MM-DD or empty"}]} — an empty list when it is not a real promise (a question, a joke, a maybe). Resolve "Friday", "tomorrow", "next week" against the date given.';
const JUDGE = 'You check whether a chat message shows that open promises are done. Answer in JSON only: {"done": [ids]} — ids of the promises the message clearly shows done (the writer says it is done, or someone confirms it). Empty when unsure.';
const parse = (res, key) => { const t = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' '); try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))[key] || []; } catch { return []; } };

/**
 * Router (a stored message in a chat that is on, from a person, for an agent with promises on): find promises in it,
 * and mark open ones of this chat done when it shows them done. Event-driven, never throws, bounded per agent per day.
 */
export async function noteMessage(agent, msg, rowId) {
  if (!agent?.promises?.track || !msg.text || msg.fromMe || !isChatEnabled(msg.chat)) return;
  const tz = agent.timezone || env.timezone;
  try {
    const open = db.prepare("SELECT id, who, what FROM commitments WHERE chat = ? AND status = 'open' ORDER BY id DESC LIMIT 20").all(msg.chat);
    if (open.length && DONE.test(msg.text) && callsToday(agent.id) < MAX_PER_DAY) {
      countCall(agent.id);
      const res = await modelChat({ model: 'auto', purpose: 'background', maxTokens: 60, fallback: undefined, usage: usageTag('commitments', { agent: agent.id, chat: msg.chat }), system: JUDGE,
        messages: [{ role: 'user', content: JSON.stringify({ message: { from: msg.senderName || 'someone', text: clip(msg.text, 500) }, open }) }] });
      for (const id of parse(res, 'done').map(Number).filter((i) => open.some((o) => o.id === i))) {
        db.prepare("UPDATE commitments SET status = 'done', by = 'chat', updated_at = ? WHERE id = ? AND status = 'open'").run(Date.now(), id);
        activity('config', { agent: agent.id, chat: msg.chat, summary: 'A commitment was marked done from the chat' });
      }
    }
    if (!PROMISE.test(msg.text) || callsToday(agent.id) >= MAX_PER_DAY) return;
    countCall(agent.id);
    const res = await modelChat({ model: 'auto', purpose: 'background', maxTokens: 150, fallback: undefined, usage: usageTag('commitments', { agent: agent.id, chat: msg.chat }), system: FIND,
      messages: [{ role: 'user', content: `Today is ${today(tz)} (${new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: tz })}).\nMessage from ${msg.senderName || 'someone'}: ${clip(msg.text, 500)}` }] });
    const now = Date.now();
    for (const p of parse(res, 'promises').slice(0, 3)) {
      const what = clip(String(p.what || '').trim(), 200);
      if (what.length < 3) continue;
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(p.due || '')) ? p.due : '';
      db.prepare('INSERT INTO commitments (agent, chat, person, who, what, due, msg, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(agent.id, msg.chat, msg.personId || '', clip(msg.senderName || '', 80), what, due, rowId || null, now, now);
      activity('config', { agent: agent.id, chat: msg.chat, summary: `Commitment noted${due ? `, due ${due}` : ''}` });
    }
  } catch (e) { activity('error', { agent: agent.id, chat: msg.chat, summary: `Commitments: ${e.message}` }); }
}

/** The gentle follow-up, written in code (no model): one line, the promise in their words. */
const followText = (c, inGroup) => `${inGroup ? `${c.who || 'Hi'}, a` : `Hi${c.who ? ` ${c.who.split(/\s+/)[0]}` : ''}, a`} friendly reminder: you said you'd ${c.what}${c.due ? ` (by ${c.due})` : ''}. All set? Just reply here.`;

/**
 * Upkeep tick: commitments due today or earlier, not followed up yet, of agents whose follow-ups are on → one gentle
 * message each (at most PER_TICK), inside the sending hours, only in chats that are on. Returns how many went out.
 */
export async function commitmentsTick(now = Date.now()) {
  if (!sendingHoursNow(now)) return 0;
  const ch = chatChannel();
  if (!ch?.send) return 0;
  let n = 0;
  for (const c of db.prepare("SELECT * FROM commitments WHERE status = 'open' AND due <> '' AND due <= ? AND followed_up_at IS NULL ORDER BY due LIMIT 20").all(today(env.timezone, now))) {
    if (n >= PER_TICK) break;
    const agent = getAgent(c.agent);
    const mode = agent?.promises?.followUp || 'chat';
    db.prepare('UPDATE commitments SET followed_up_at = ? WHERE id = ?').run(now, c.id); // once, whatever happens below
    if (!agent?.enabled || !agent.promises?.track || mode === 'off') continue;
    const target = mode === 'dm' ? chatsOfPerson(c.person).find((x) => !isGroup(x.chat) && channelOf(x.chat) && isChatEnabled(x.chat))?.chat : c.chat;
    if (!target || !isChatEnabled(target)) continue;
    const text = followText(c, isGroup(target));
    try {
      const sent = await ch.send(target, text);
      logMessage({ chat: target, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text, fromAgent: true });
      activity('message.out', { agent: agent.id, chat: target, summary: `${text} (follow-up on a commitment)` });
      n++;
    } catch (e) { activity('error', { agent: agent.id, chat: target, summary: `Commitment follow-up failed: ${e.message}` }); }
  }
  return n;
}

// the morning brief (090): commitments due today or overdue
registerBriefSection('commitments', (now) => {
  const rows = db.prepare("SELECT * FROM commitments WHERE status = 'open' AND due <> '' AND due <= ? ORDER BY due LIMIT 10").all(today(env.timezone, now));
  return { lines: rows.map((c) => `${c.who || personRow(c.person)?.name || 'Someone'}: ${c.what} (${c.due < today(env.timezone, now) ? `overdue since ${c.due}` : 'due today'})`) };
});
