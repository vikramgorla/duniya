// @ts-check
// The owner's morning brief, suggested next steps and group catch-up (090).
//
// Morning brief: one message a day to the linked owners and admins (their own chat with the owner assistant), at the
// chosen time in the owner's time zone, inside the sending hours (a time outside them waits for their start). Sections:
// payments (overdue and due in 3 days), questions to the owner nobody answered, commitments due (a hook other features
// fill), birthdays, things that are stuck (failed or paused sends, model errors, an update waiting, changes waiting for a
// confirm code) and new people in chats that are on. Built in code from counts and names; nothing to report → no
// message. Rides the scheduler's 30-second tick (one check per tick, at most one brief per person per day).
//
// Suggested next steps: deterministic, from the same data ("3 people have not paid for Sankranti, due Friday — send
// reminders?"). Each is approved by the owner — in the panel (it opens the sending preview, or applies the one safe
// action it names) or in WhatsApp with the owner assistant's confirm code — and nothing is sent or changed before that.
// A dismissed suggestion never comes back for the same thing (its key).
import { db, getChatMemory, kvGet, kvSet, listPending } from './db.js';
import { clip, env, localParts, money, plural } from './config.js';
import { activity } from './events.js';
import { getSetting, updateSettings, TENANT } from './store.js';
import { getAgent, OWNER_AGENT_ID } from './agents.js';
import { moduleRows, need } from '../modules/index.js';
import { updateStatus } from './updates.js';
import { paceSettings } from './pace.js';
import { chatLabels } from './chat-names.js';
import { chatChannel } from './chat-tools.js';
import { personInfo } from './contacts.js';
import { personRow } from './people.js';

export const BRIEF_SECTIONS = ['payments', 'questions', 'commitments', 'birthdays', 'stuck', 'people'];
const DEFAULTS = { enabled: true, at: '08:00', sections: BRIEF_SECTIONS };
const DAY = 86400000;

/** Settings → Owner assistant → Morning brief: { enabled, at: 'HH:MM', sections }. */
export function briefSettings() {
  const s = getSetting('morningBrief', null) || {};
  return { enabled: s.enabled ?? DEFAULTS.enabled, at: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.at || '') ? s.at : DEFAULTS.at,
    sections: Array.isArray(s.sections) ? s.sections.filter((x) => BRIEF_SECTIONS.includes(x)) : DEFAULTS.sections };
}
export function setBriefSettings(patch = {}) {
  const cur = briefSettings();
  if (patch.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.at))) throw Object.assign(new Error('Time like 08:00'), { status: 400, field: 'at' });
  const next = { enabled: patch.enabled === undefined ? cur.enabled : !!patch.enabled, at: patch.at ?? cur.at,
    sections: patch.sections === undefined ? cur.sections : (Array.isArray(patch.sections) ? patch.sections : []).filter((x) => BRIEF_SECTIONS.includes(x)) };
  updateSettings({ morningBrief: next });
  return next;
}
const ownerTz = () => getAgent(OWNER_AGENT_ID)?.timezone || env.timezone;
const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** The time the brief goes out: its own, or the start of the sending hours when it falls outside them. */
export function briefTime(at = briefSettings().at) {
  const p = paceSettings(); const t = mins(at); const a = mins(p.hoursFrom); const b = mins(p.hoursTo);
  const inside = a < b ? t >= a && t < b : t >= a || t < b;
  return inside ? at : p.hoursFrom;
}

// ---------- hooks other features fill (PR 4: commitments) ----------
/** @type {Map<string, (now: number) => Promise<{ lines: string[], suggestions?: any[] }> | { lines: string[], suggestions?: any[] }>} */
const extra = new Map();
/** A section other code adds (e.g. 'commitments'): fn(now) → { lines, suggestions? }. */
export const registerBriefSection = (id, fn) => { extra.set(id, fn); };

// ---------- the data ----------
const day = (d) => new Date(d).toISOString().slice(0, 10);
/** A due date as people read it: "Fri 14 Nov". */
const nice = (ymd) => (/^\d{4}-\d{2}-\d{2}/.test(ymd || '') ? new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ymd);
const on = (id) => moduleRows().some((m) => m.id === id && m.on);
const ownerNames = () => {
  const names = new Set();
  for (const l of db.prepare("SELECT o.phone, u.username FROM owner_links o JOIN users u ON u.id = o.user_id WHERE o.tenant_id = ? AND o.status = 'linked'").all(TENANT)) {
    names.add(String(l.username).toLowerCase());
    const n = personInfo({ phone: l.phone }).label;
    if (n && !/^\+?\d/.test(n)) names.add(n.split(/\s+/)[0].toLowerCase());
  }
  return { names: [...names].filter((n) => n.length >= 3), phones: db.prepare("SELECT phone FROM owner_links WHERE tenant_id = ? AND status = 'linked'").all(TENANT).map((r) => r.phone) };
};

/**
 * Everything the brief could say, by section: { payments, questions, birthdays, stuck, people, extra: { id: { lines } } }.
 * `chats`: the chats the owner assistant may read (on, not private to members).
 */
export async function briefData(now = Date.now(), chats = []) {
  const out = { payments: null, questions: [], birthdays: [], stuck: [], people: [], extra: {} };
  if (on('orders')) {
    const ord = await need('orders');
    const soon = day(now + 3 * DAY); const today = day(now);
    const open = ord.listOrders({ status: 'open' }).filter((o) => o.due && o.due <= soon);
    if (open.length) {
      const byEvent = new Map();
      for (const o of open) { const k = o.event || ''; if (!byEvent.has(k)) byEvent.set(k, { event: o.event || '', name: o.eventName || '', currency: o.currency, list: [] }); byEvent.get(k).list.push(o); }
      out.payments = [...byEvent.values()].map((g) => ({ ...g, overdue: g.list.filter((o) => o.due < today).length, left: g.list.reduce((a, o) => a + o.left, 0),
        due: g.list.map((o) => o.due).sort()[0], who: g.list.slice(0, 5).map((o) => o.who) }));
    }
  }
  // questions to the owner nobody answered: last 24 h in chats the assistant may read, naming the owner, with a "?", and
  // no message from the owner in that chat after it
  const me = ownerNames();
  if (me.names.length) {
    const re = new RegExp(`(^|[^\\p{L}])(${me.names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})($|[^\\p{L}])`, 'iu');
    const names = await chatLabels(chats.slice(0, 50), chatChannel());
    for (const chat of chats.slice(0, 50)) {
      const rows = db.prepare("SELECT id, sender, sender_jid, name, text, ts FROM messages WHERE chat = ? AND ts >= ? AND from_agent = 0 AND text LIKE '%?%' ORDER BY id DESC LIMIT 100").all(chat, now - DAY);
      const ownerLast = me.phones.length ? db.prepare(`SELECT MAX(ts) AS ts FROM messages WHERE chat = ? AND ts >= ? AND sender IN (${me.phones.map(() => '?').join(',')})`).get(chat, now - DAY, ...me.phones).ts || 0 : 0;
      for (const m of rows) {
        if (m.ts <= ownerLast || me.phones.includes(m.sender) || !re.test(m.text)) continue;
        out.questions.push({ chat, chatName: names.get(chat) || 'a chat', id: m.id, from: personInfo({ phone: m.sender, jid: m.sender_jid, fallbackName: m.name }).label, text: clip(m.text, 160) });
      }
    }
    out.questions = out.questions.slice(0, 8);
  }
  const keys = [day(now).slice(5), day(now + DAY).slice(5)];
  out.birthdays = db.prepare("SELECT id, name, birthday FROM people WHERE tenant_id = ? AND birthday <> '' AND substr(birthday, -5) IN (?, ?) AND hidden = 0 LIMIT 20").all(TENANT, ...keys)
    .map((p) => ({ id: p.id, name: personRow(p.id)?.name || p.name, when: p.birthday.slice(-5) === keys[0] ? 'today' : 'tomorrow' }));
  // stuck things
  const errors = db.prepare("SELECT COUNT(*) AS n FROM activity WHERE ts >= ? AND type = 'error' AND summary LIKE 'Model error%'").get(now - DAY).n;
  if (errors) out.stuck.push({ kind: 'model', text: `${plural(errors, 'answer')} failed on a model error`, href: '#models' });
  const pend = listPending().length;
  if (pend) out.stuck.push({ kind: 'pending', text: `${plural(pend, 'change')} waiting for a confirm code`, href: '#pending' });
  const up = updateStatus();
  if (up?.available) out.stuck.push({ kind: 'update', version: up.latest, text: up.breaking ? `update ${up.latest} needs your decision` : `update ${up.latest} is ready`, href: '#settings/updates' });
  if (on('sending')) {
    for (const r of db.prepare("SELECT id, title, status, reason FROM snd_runs WHERE tenant_id = ? AND status = 'paused' ORDER BY rowid DESC LIMIT 5").all(TENANT)) {
      out.stuck.push({ kind: 'paused', run: r.id, text: `“${clip(r.title, 60)}” is paused${r.reason ? ` (${clip(r.reason, 80)})` : ''}`, href: `#people/sending/${r.id}` });
    }
  }
  // new people in chats that are on (they wrote, or joined a group)
  out.people = db.prepare("SELECT id FROM people WHERE tenant_id = ? AND created_at >= ? AND source <> 'phone' AND hidden = 0 ORDER BY created_at DESC LIMIT 20").all(TENANT, now - DAY)
    .map((p) => ({ id: p.id, name: personRow(p.id)?.name || 'someone' }));
  for (const [id, fn] of extra) { try { out.extra[id] = await fn(now); } catch (e) { activity('error', { summary: `Morning brief: ${id} failed: ${e.message}` }); } }
  return out;
}

/** The brief as a WhatsApp text, '' when there is nothing to say. `codes`: confirm codes per suggestion key. */
export function briefText(d, sections = briefSettings().sections, codes = new Map(), suggestions = []) {
  const parts = [];
  const add = (title, lines) => { if (lines.length) parts.push(`*${title}*\n${lines.map((l) => `- ${l}`).join('\n')}`); };
  if (sections.includes('payments') && d.payments) add('Payments', d.payments.map((g) => `${g.name || 'Other orders'}: ${plural(g.list.length, 'order')} open, ${money(g.left, g.currency)} left${g.overdue ? ` (${g.overdue} overdue)` : ''}, due ${nice(g.due)} — ${g.who.join(', ')}${g.list.length > 5 ? '…' : ''}`));
  if (sections.includes('questions')) add('Questions for you', d.questions.map((q) => `${q.from} in ${q.chatName}: “${q.text}”`));
  if (sections.includes('commitments') && d.extra.commitments) add('Commitments due', d.extra.commitments.lines || []);
  if (sections.includes('birthdays')) add('Birthdays', d.birthdays.map((b) => `${b.name} (${b.when})`));
  if (sections.includes('stuck')) add('Needs a look', d.stuck.map((s) => s.text));
  if (sections.includes('people') && d.people.length) add('New people', [`${d.people.slice(0, 6).map((p) => p.name).join(', ')}${d.people.length > 6 ? ` and ${d.people.length - 6} more` : ''}`]);
  if (!parts.length) return '';
  const next = suggestions.filter((s) => codes.has(s.key)).map((s) => `${s.title} — reply *confirm ${codes.get(s.key)}*`);
  return [`*Good morning — your brief*`, ...parts, ...(next.length ? [`*Suggested*\n${next.map((l) => `- ${l}`).join('\n')}`] : [])].join('\n\n');
}

// ---------- suggested next steps ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS suggestions (
    key TEXT PRIMARY KEY, title TEXT NOT NULL, action TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS suggestions_status ON suggestions(status, created_at);
`);
/**
 * What the data suggests, deterministically: [{ key, title, action: { tool, args } | { href } }]. The key names the
 * thing (an event's due date, a version, a run), so a dismissed suggestion stays dismissed.
 */
function candidates(d) {
  const out = [];
  if (on('sending')) {
    for (const g of d.payments || []) {
      out.push({ key: `remind:${g.event || 'none'}:${g.due}`, title: `${plural(g.list.length, 'person', 'people')} ${g.list.length === 1 ? 'has' : 'have'} not paid${g.name ? ` for ${g.name}` : ''} (due ${nice(g.due)}) — send reminders?`,
        action: { tool: 'send_to_people', args: { title: `Payment reminder${g.name ? `: ${g.name}` : ''}`, audience: { kind: 'orders', ...(g.event ? { event: g.event } : {}) }, purpose: 'updates',
          template: g.event ? 'Hi {first_name}, a friendly reminder: {amount} is still open for {event}, due {due}. You can pay by {ways_to_pay}. Thank you!' : 'Hi {first_name}, a friendly reminder: {amount} is still open, due {due}. You can pay by {ways_to_pay}. Thank you!' } } });
    }
  }
  for (const s of d.stuck) {
    if (s.kind === 'update') out.push({ key: `update:${s.version}`, title: `${s.text} — install it?`, action: { href: s.href } });
    if (s.kind === 'paused') out.push({ key: `resume:${s.run}`, title: `${s.text} — resume it?`, action: { tool: 'control_send', args: { run: s.run, action: 'resume' } } });
  }
  for (const x of Object.values(d.extra)) out.push(...(x?.suggestions || []));
  return out;
}
const view = (r) => ({ key: r.key, title: r.title, action: JSON.parse(r.action || '{}'), status: r.status, createdAt: r.created_at });
/** Bring the suggestions up to date: new ones open, open ones whose reason is gone are closed. Returns the open ones. */
export async function refreshSuggestions(now = Date.now(), d = null, chats = []) {
  const list = candidates(d || await briefData(now, chats));
  const keys = new Set(list.map((c) => c.key));
  const ins = db.prepare('INSERT OR IGNORE INTO suggestions (key, title, action, status, created_at, updated_at) VALUES (?, ?, ?, \'open\', ?, ?)');
  for (const c of list) ins.run(c.key, c.title, JSON.stringify(c.action), now, now);
  for (const r of db.prepare("SELECT key FROM suggestions WHERE status = 'open'").all()) {
    if (!keys.has(r.key)) db.prepare("UPDATE suggestions SET status = 'gone', updated_at = ? WHERE key = ?").run(now, r.key);
  }
  db.prepare("DELETE FROM suggestions WHERE status <> 'open' AND updated_at < ?").run(now - 180 * DAY); // dismissed keys are remembered half a year
  kvSet('suggestions:at', String(now));
  return openSuggestions();
}
export const openSuggestions = () => db.prepare("SELECT * FROM suggestions WHERE status = 'open' ORDER BY created_at DESC LIMIT 20").all().map(view);
/** Open suggestions, refreshed when the last refresh is older than 5 minutes (Overview opens it; no timer). */
export async function currentSuggestions(chats, now = Date.now()) {
  return now - Number(kvGet('suggestions:at') || 0) > 5 * 60000 ? refreshSuggestions(now, null, chats) : openSuggestions();
}
export function setSuggestionStatus(key, status, by = '') {
  const r = db.prepare('SELECT * FROM suggestions WHERE key = ?').get(String(key));
  if (!r) throw Object.assign(new Error('No such suggestion'), { status: 404 });
  db.prepare('UPDATE suggestions SET status = ?, updated_at = ? WHERE key = ?').run(status, Date.now(), r.key);
  activity('config', { summary: `Suggestion ${status === 'dismissed' ? 'dismissed' : 'approved'}: ${clip(r.title, 120)} (${by || 'owner'})` });
  return view({ ...r, status });
}

/** Is the brief due now (its time today, not sent yet)? Marks today's brief as sent. */
export function briefDue(now = Date.now()) {
  const s = briefSettings();
  if (!s.enabled) return null;
  const { hhmm, date } = localParts(ownerTz(), now);
  if (hhmm !== briefTime(s.at) || kvGet(`brief:${date}`)) return null;
  kvSet(`brief:${date}`, '1');
  return { date, sections: s.sections };
}

// ---------- group catch-up ----------
/**
 * Material for "what did I miss in <group>": the messages since the owner last wrote there (else 24 h; at most 120,
 * 300 characters each) and the chat's running summary. Messages carry their id so answers can link to them.
 */
export function catchUpMaterial(chat, phones = [], now = Date.now()) {
  const last = phones.length ? db.prepare(`SELECT MAX(ts) AS ts FROM messages WHERE chat = ? AND sender IN (${phones.map(() => '?').join(',')})`).get(chat, ...phones).ts || 0 : 0;
  const since = Math.max(last, now - 7 * DAY) || now - DAY;
  const rows = db.prepare('SELECT * FROM (SELECT * FROM messages WHERE chat = ? AND ts > ? ORDER BY id DESC LIMIT 120) ORDER BY id').all(chat, last ? since : now - DAY);
  return { since: last ? since : now - DAY, sinceYourLastMessage: !!last, runningSummary: clip(getChatMemory(chat)?.summary || '', 2000),
    messages: rows.map((m) => ({ id: m.id, at: new Date(m.ts).toISOString().slice(0, 16), from: m.from_agent ? 'Assistant' : personInfo({ phone: m.sender, jid: m.sender_jid, fallbackName: m.name }).label, text: clip(m.text, 300) })) };
}
