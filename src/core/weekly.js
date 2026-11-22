// Weekly summary (041, issue #38): the text of the owner assistant's "weekly-summary" schedule (059: day, time and
// on/off are that schedule in the agent editor; owner-assistant.js sends it). Counts and costs only — never message
// contents.
import { plural } from './config.js';
import { ownerTz } from './owner-clock.js';
import { db, listPending } from './db.js';
import { listAgents } from './agents.js';
import { statsBetween, dayOf } from './stats.js';
import { updateStatus } from './updates.js';
import { lastBackup } from './backup/index.js';
import { listCaps, capStatus, monthOf } from './budget.js';
import { rebootStatus } from './system.js';

const fmtUsd = (c) => (c === 0 ? '$0' : c < 0.01 ? '<$0.01' : `$${c < 10 ? c.toFixed(2) : Math.round(c)}`);
const usageBetween = (from, to) => Object.fromEntries(db.prepare(`SELECT agent, SUM(cost) AS cost, SUM(input + output) AS tokens, COUNT(*) AS calls,
  SUM(CASE WHEN priced IS NULL THEN 1 ELSE 0 END) AS unpriced FROM usage WHERE ts >= ? AND ts < ? GROUP BY agent`).all(from, to).map((r) => [r.agent, r]));
const costText = (u) => (!u?.calls ? '$0' : u.unpriced === u.calls ? 'price not set' : `${fmtUsd(u.cost || 0)}${u.unpriced ? '+' : ''}`);

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
  const rb = rebootStatus(); // #96: an OS update waiting for a restart for more than 7 days gets one line
  return {
    from, to: Math.min(to, now), agents,
    ignored: { messages: ignoredRows.reduce((a, r) => a + r.n, 0), chats: new Set(ignoredRows.map((r) => r.chat)).size },
    heldByBudget: sum('budget'),
    capsReached: listCaps().map((c) => capStatus(c, month)).filter((s) => s.used >= 1).length,
    pending: listPending().length,
    update: up?.available ? { latest: up.latest, current: up.current, decision: up.breaking && up.decisionVersion ? `v${up.decisionVersion}` : null } : null,
    backups: { failures: backupFailures, lastFailed: !!lb && Object.values(lb.results || {}).some((v) => String(v).startsWith('error')) },
    restart: rb.required && rb.since && now - rb.since > 7 * 86400000 ? { days: Math.floor((now - rb.since) / 86400000), kernel: rb.kernel } : null,
  };
}

/** Short WhatsApp text from weeklyData. */
export function weeklyText(d = weeklyData()) {
  const day = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: ownerTz() });
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
  if (d.update) todo.push(d.update.decision ? `update ${d.update.decision} needs your decision (breaking release; running ${d.update.current})` : `update available: ${d.update.latest} (running ${d.update.current})`);
  if (d.backups.failures || d.backups.lastFailed) todo.push(d.backups.failures ? `${plural(d.backups.failures, 'backup')} failed` : 'the last backup failed');
  if (d.restart) todo.push(`the server has waited ${d.restart.days} days for a restart to finish OS updates${d.restart.kernel ? ' (new kernel)' : ''} (Server → Restart server)`);
  lines.push(todo.length ? `Needs you: ${todo.join('; ')}. Open the panel to sort it out.` : 'Nothing needs you right now.');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
