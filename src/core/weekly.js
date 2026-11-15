// Weekly summary to the owner on WhatsApp (041, issue #38). Counts and costs only — never message contents. Runs from
// the scheduler at the owner's day and time (server timezone); on by default once an alert number is known.
import { env } from './config.js';
import { db, kvGet, kvSet, listPending } from './db.js';
import { getSetting, updateSettings } from './store.js';
import { listAgents } from './agents.js';
import { statsBetween, dayOf } from './stats.js';
import { ownerNumber, sendOwnerAlert } from './owner-alerts.js';
import { updateStatus } from './updates.js';
import { lastBackup } from './backup/index.js';
import { listCaps, capStatus, monthOf } from './budget.js';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULTS = { enabled: null, day: 'mon', at: '09:00' };
const bad = (message, field) => Object.assign(new Error(message), { status: 400, field });

/** { enabled (null = default), day, at, active } — active: it will actually be sent. */
export function getWeeklySettings() {
  const s = { ...DEFAULTS, ...(getSetting('weekly', {}) || {}) };
  const on = s.enabled === null ? true : !!s.enabled;
  return { ...s, active: on && !!ownerNumber(), last: Number(kvGet('weekly:last') || 0) || null };
}
export function setWeeklySettings(patch = {}) {
  const cur = { ...DEFAULTS, ...(getSetting('weekly', {}) || {}) };
  const next = { ...cur };
  if ('enabled' in patch) next.enabled = patch.enabled === null ? null : !!patch.enabled;
  if ('day' in patch) { if (!WEEKDAYS.includes(patch.day)) throw bad('Day must be mon … sun', 'day'); next.day = patch.day; }
  if ('at' in patch) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.at))) throw bad('Time must be HH:MM', 'at'); next.at = patch.at; }
  updateSettings({ weekly: next });
  return getWeeklySettings();
}

const fmtUsd = (c) => (c === 0 ? '$0' : c < 0.01 ? '<$0.01' : `$${c < 10 ? c.toFixed(2) : Math.round(c)}`);
const usageBetween = (from, to) => Object.fromEntries(db.prepare(`SELECT agent, SUM(cost) AS cost, SUM(input + output) AS tokens, COUNT(*) AS calls,
  SUM(CASE WHEN priced IS NULL THEN 1 ELSE 0 END) AS unpriced FROM usage WHERE ts >= ? AND ts < ? GROUP BY agent`).all(from, to).map((r) => [r.agent, r]));
const costText = (u) => (!u?.calls ? '$0' : u.unpriced === u.calls ? 'price not set' : `${fmtUsd(u.cost || 0)}${u.unpriced ? '+' : ''}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The numbers behind the summary (also returned by the API for the preview). */
export function weeklyData(now = Date.now()) {
  const today = dayOf(now);
  const thisWeek = [today - 6, today + 1]; const lastWeek = [today - 13, today - 6];
  const ms = ([a, b]) => [a * 86400000, b * 86400000];
  const cur = statsBetween(...thisWeek);
  const usage = usageBetween(...ms(thisWeek)); const prev = usageBetween(...ms(lastWeek));
  const sum = (kind, agent) => cur.filter((r) => r.kind === kind && (agent === undefined || r.agent === agent)).reduce((a, r) => a + r.n, 0);
  const agents = listAgents().map((a) => ({
    id: a.id, name: a.name, enabled: a.enabled, handled: sum('handled', a.id), replies: sum('reply', a.id),
    cost: usage[a.id] || null, lastCost: prev[a.id] || null,
  }));
  const ignoredRows = cur.filter((r) => r.kind === 'ignored');
  const [from, to] = ms(thisWeek);
  const backupFailures = db.prepare("SELECT COUNT(*) AS n FROM activity WHERE type = 'error' AND ts >= ? AND ts < ? AND (summary LIKE 'Backup %' OR summary LIKE 'Scheduled backup failed%')").get(from, to).n;
  const lb = lastBackup();
  const up = updateStatus();
  const month = monthOf(now);
  return {
    from, to: Math.min(to, now), agents,
    ignored: { messages: ignoredRows.reduce((a, r) => a + r.n, 0), chats: new Set(ignoredRows.map((r) => r.chat)).size },
    heldByBudget: sum('budget'),
    capsReached: listCaps().map((c) => capStatus(c, month)).filter((s) => s.used >= 1).length,
    pending: listPending().length,
    update: up?.available ? { latest: up.latest, current: up.current } : null,
    backups: { failures: backupFailures, lastFailed: !!lb && Object.values(lb.results || {}).some((v) => String(v).startsWith('error')) },
  };
}

/** Short WhatsApp text from weeklyData. */
export function weeklyText(d = weeklyData()) {
  const day = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: env.timezone });
  const lines = [`*Duniya — your week* (${day(d.from)} – ${day(d.to)})`, ''];
  const active = d.agents.filter((a) => a.handled || a.replies || a.cost?.calls);
  for (const a of active) {
    const vs = a.lastCost?.calls ? ` (last week ${costText(a.lastCost)})` : ' (last week $0)';
    lines.push(`- ${a.name}: ${plural(a.handled, 'message')} handled, ${plural(a.replies, 'reply', 'replies')}, ${costText(a.cost)}${vs}`);
  }
  const quiet = d.agents.filter((a) => !active.includes(a));
  if (quiet.length) lines.push(`- Quiet this week: ${quiet.map((a) => `${a.name}${a.enabled ? '' : ' (off)'}`).join(', ')}`);
  if (!d.agents.length) lines.push('- No agents yet.');
  lines.push('');
  if (d.ignored.messages) lines.push(`Ignored: ${plural(d.ignored.messages, 'message')} in ${plural(d.ignored.chats, 'chat')} that are switched off.`);
  if (d.heldByBudget || d.capsReached) lines.push(`Spending caps: ${plural(d.capsReached, 'cap')} reached${d.heldByBudget ? `, ${plural(d.heldByBudget, 'reply', 'replies')} held back` : ''}.`);
  const todo = [];
  if (d.pending) todo.push(`${plural(d.pending, 'change')} waiting for confirmation`);
  if (d.update) todo.push(`update available: ${d.update.latest} (running ${d.update.current})`);
  if (d.backups.failures || d.backups.lastFailed) todo.push(d.backups.failures ? `${plural(d.backups.failures, 'backup')} failed` : 'the last backup failed');
  lines.push(todo.length ? `Needs you: ${todo.join('; ')}. Open the panel to sort it out.` : 'Nothing needs you right now.');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Send the summary now (Settings → "Send now", or the scheduler). */
export async function sendWeekly({ reason = 'manual' } = {}) {
  const text = weeklyText();
  const r = await sendOwnerAlert(text, { kind: reason === 'schedule' ? 'weekly summary' : 'weekly summary (sent now)' });
  if (r.sent) kvSet('weekly:last', String(Date.now()));
  return { ...r, text };
}

function nowParts(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, day: p.weekday.slice(0, 3).toLowerCase() };
}

/** Called by the scheduler every 30 s: sends once on the chosen day, at or after the chosen time. */
export async function weeklyTick() {
  const s = getWeeklySettings();
  if (!s.active) return false;
  const { date, hhmm, day } = nowParts(env.timezone);
  if (day !== s.day || hhmm < s.at) return false;
  const key = `weekly:slot:${date}`;
  if (kvGet(key)) return false;
  kvSet(key, '1');
  await sendWeekly({ reason: 'schedule' });
  return true;
}
