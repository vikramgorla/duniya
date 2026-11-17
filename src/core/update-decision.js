// Breaking releases need the owner's decision (045, issue #57).
//
// - Automatic updates install only `safeTarget` (never across a breaking release).
// - A breaking release is announced once per version: Activity, the panel (Overview banner + Updates card), WhatsApp to
//   the owner alert number and, for every owner who linked the owner assistant, a message with a confirm code.
// - Confirm on the panel (dialog) or with "confirm ABCD" on WhatsApp: backup (when configured) → update → restart. A
//   WhatsApp confirmation is answered again after the restart (a pending report is kept in kv).
// - The owner can snooze the notice (reminded again after 7 days) or dismiss it (until a newer breaking release).
import { randomInt } from 'node:crypto';
import { env, fail, restartSoon } from './config.js';
import { phoneChat } from '../channels/index.js';
import { kvGet, kvSet } from './db.js';
import { getUser } from './store.js';
import { activity } from './events.js';
import { updateStatus, checkForUpdate, applyUpdate, getUpdateSettings, installKind, runningVersion, backupConfigured, installedReleases } from './updates.js';
import { releaseRange } from './releases.js';
import { sendOwnerAlert, ownerNumber } from './owner-alerts.js';
import { listLinks, registerConfirmHandler } from './owner-assistant.js';
import { chatChannel } from './chat-tools.js';

const DAY = 86400000;
const SNOOZE_DAYS = 7;
const CODE_TTL = 3 * DAY;
const REPORT_TTL = 2 * DAY;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const readKv = (k, d) => { try { return JSON.parse(kvGet(k) || 'null') ?? d; } catch { return d; } };
const v = (x) => (String(x || '').startsWith('v') ? x : `v${x}`);

let restartFn = () => restartSoon(1000);
/** How the process restarts after an update (the panel passes its own; tests count restarts). */
export function setUpdateRestart(fn) { restartFn = fn; }

// ---------------------------------------------------------------- the decision
/** The breaking release waiting for the owner, or null. { version, target, current, steps, safeTarget, notifiedAt, snoozedUntil, dismissed, show } */
export function pendingDecision(now = Date.now()) {
  const st = updateStatus();
  if (!st?.available || !st.breaking || !st.decisionVersion) return null;
  const rec = readKv('updates:notice', null);
  const mine = rec && rec.version === st.decisionVersion ? rec : null;
  const snoozedUntil = mine?.snoozeUntil && mine.snoozeUntil > now ? mine.snoozeUntil : null;
  return {
    version: v(st.decisionVersion), target: st.target, current: st.current, steps: st.steps, safeTarget: st.safeTarget,
    notifiedAt: mine?.notifiedAt || null, snoozedUntil, dismissed: !!mine?.dismissed, show: !mine?.dismissed && !snoozedUntil,
    backup: backupConfigured(), docker: installKind() === 'docker',
  };
}

/** "remind me in 7 days" or "dismiss" (until a newer breaking release). */
export function snoozeDecision({ action = 'snooze', by = '', now = Date.now() } = {}) {
  const d = pendingDecision(now);
  if (!d) throw fail('No update is waiting for a decision', 404);
  const rec = readKv('updates:notice', null);
  const base = rec && v(rec.version) === d.version ? rec : { version: d.version.slice(1), notifiedAt: now };
  const next = action === 'dismiss' ? { ...base, dismissed: true, snoozeUntil: null } : { ...base, dismissed: false, snoozeUntil: now + SNOOZE_DAYS * DAY };
  kvSet('updates:notice', JSON.stringify(next));
  activity('system', { summary: action === 'dismiss' ? `Update ${d.version} dismissed by ${by || 'owner'} (no more reminders for it)` : `Update ${d.version}: ${by || 'owner'} will be reminded in ${SNOOZE_DAYS} days` });
  return pendingDecision(now);
}

// ---------------------------------------------------------------- notifications
function noticeText(st) {
  const lines = [`*Duniya ${v(st.decisionVersion)} needs your decision*`, `You are running ${st.current}. Automatic updates stop before this release.`];
  for (const s of st.steps) {
    lines.push('', `*${v(s.version)}: ${s.title}*`);
    if (s.summary) lines.push(s.summary);
    if (s.actions.length) lines.push('What you need to do:', ...s.actions.map((a) => `- ${a}`));
  }
  // 065: the key changes of the whole jump, briefly (new first); the full list is in the panel
  const all = (st.notes || []).flatMap((n) => n.changes || []);
  const key = [...all.filter((c) => c.type === 'new'), ...all.filter((c) => c.type !== 'new')].slice(0, 5);
  if (key.length) lines.push('', `*Also in this update* (${st.notes.length} release${st.notes.length > 1 ? 's' : ''}):`, ...key.map((c) => `- ${c.text}`), ...(all.length > key.length ? [`…and ${all.length - key.length} more in the panel.`] : []));
  if (st.safeTarget) lines.push('', `${st.safeTarget} can still be installed without this decision.`);
  lines.push('', 'Review it in the panel: Overview → Server → Updates.');
  return lines.join('\n');
}

const codes = () => readKv('updates:codes', []).filter((c) => c.expires > Date.now());
function newCode(entry) {
  const list = codes();
  let code;
  do code = Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  while (list.some((c) => c.code === code));
  kvSet('updates:codes', JSON.stringify([...list.filter((c) => c.userId !== entry.userId), { ...entry, code, expires: Date.now() + CODE_TTL }]));
  return code;
}

/** Owners who linked the owner assistant: [{ userId, username, phone }]. */
const linkedOwners = () => listLinks().filter((l) => getUser(l.userId)?.role === 'owner' && !getUser(l.userId)?.disabled);

/** Announce the breaking release once per version (and again when a snooze ends). Returns true when it announced. */
export async function announceBreaking(st = updateStatus(), now = Date.now()) {
  if (!st?.available || !st.breaking || !st.decisionVersion) return false;
  const rec = readKv('updates:notice', null);
  const same = rec && rec.version === st.decisionVersion;
  const due = !same || (!rec.dismissed && rec.snoozeUntil && rec.snoozeUntil <= now);
  if (!due) return false;
  kvSet('updates:notice', JSON.stringify({ version: st.decisionVersion, target: st.target, notifiedAt: now, snoozeUntil: null, dismissed: false }));
  const text = noticeText(st);
  activity('system', { summary: `Update ${v(st.decisionVersion)} needs your decision (breaking release; automatic updates stop before it)`, detail: { steps: st.steps.map((s) => s.version) } });
  const owners = linkedOwners();
  const ch = chatChannel();
  const backupLine = backupConfigured() ? 'a backup is made first' : 'no backup passphrase is set, so no backup is made';
  for (const o of owners) {
    const code = newCode({ userId: o.userId, version: st.decisionVersion, target: st.target });
    const msg = `${text}\n\nReply *confirm ${code}* to update to ${st.target} — ${backupLine}. Reply *cancel ${code}* to be reminded in ${SNOOZE_DAYS} days.`;
    try {
      if (!ch) throw new Error('WhatsApp is not available');
      await ch.send(phoneChat(o.phone), msg);
      activity('system', { summary: `Update decision ${v(st.decisionVersion)} sent to ${o.username} on WhatsApp (owner assistant)` });
    } catch (e) { activity('error', { summary: `Update decision message to ${o.username} failed: ${e.message}` }); }
  }
  if (!owners.some((o) => o.phone === ownerNumber())) await sendOwnerAlert(text, { kind: 'update decision' });
  return true;
}

// ---------------------------------------------------------------- confirming
/**
 * Install the newest release even across breaking ones (owners only): backup (unless backup === false) → update →
 * restart. reportTo: a WhatsApp chat that gets the result (after the restart when it worked).
 */
export async function runConfirmedUpdate({ by = '', backup = true, reportTo = '' } = {}) {
  if (installKind() === 'docker') throw fail('Docker install: pull the new image (docker compose pull && docker compose up -d)');
  const st = await checkForUpdate();
  if (!st.available) throw fail('Already up to date');
  const from = runningVersion();
  activity('system', { summary: `Update to ${st.target} confirmed by ${by || 'owner'}${st.breaking ? ` (breaking: ${st.steps.map((s) => v(s.version)).join(', ')})` : ''}${backup ? '' : ', without a backup'}` });
  const r = await applyUpdate({ target: st.target, backup, by });
  if (r.code === 0) {
    kvSet('updates:notice', 'null');
    if (reportTo) kvSet('updates:report', JSON.stringify({ chat: reportTo, target: st.target, from, backup: r.backup, at: Date.now() }));
    restartFn();
  } else if (reportTo) {
    await chatChannel()?.send(reportTo, `The update to ${st.target} was not installed; still running ${from}. ${r.code === 2 ? r.log : 'Details: Overview → Server → Updates.'}`).catch(() => {});
  }
  return { ...r, target: st.target, from };
}

/** WhatsApp "confirm ABCD" / "cancel ABCD" for an update code. Returns reply text, or undefined when not ours. */
async function resolveUpdateConfirm({ user, code, cancel = false, surface = '' }) {
  const key = String(code || '').trim().toUpperCase();
  const c = codes().find((x) => x.code === key);
  if (!c) return undefined;
  if (c.userId !== user.id) return 'This code belongs to another person.';
  if (!String(surface).startsWith('whatsapp:')) return 'Confirm this update in WhatsApp, where the code was sent, or use the panel.';
  if (user.role !== 'owner') return 'Only owners can confirm updates.';
  kvSet('updates:codes', JSON.stringify(codes().filter((x) => x.version !== c.version)));
  if (cancel) {
    try { snoozeDecision({ action: 'snooze', by: user.username }); } catch { /* nothing waiting any more */ }
    return `OK, staying on ${runningVersion()}. I will remind you in ${SNOOZE_DAYS} days.`;
  }
  if (installKind() === 'docker') return 'This server runs in Docker: update the image on the host (docker compose pull && docker compose up -d).';
  const chat = String(surface).slice('whatsapp:'.length);
  runConfirmedUpdate({ by: `${user.username} (WhatsApp)`, backup: true, reportTo: chat })
    .catch((e) => chatChannel()?.send(chat, `The update did not start: ${e.message}`).catch(() => {}));
  return `Starting: ${backupConfigured() ? 'backup, then ' : ''}update to ${c.target}. The agents pause for 1–2 minutes; I will message you here when it is back.`;
}
registerConfirmHandler(resolveUpdateConfirm);

/** After a restart: tell the owner on WhatsApp how the confirmed update went. Kept until it could be sent (2 days). */
export async function deliverUpdateReport(now = Date.now()) {
  const rec = readKv('updates:report', null);
  if (!rec?.chat) return false;
  if (now - rec.at > REPORT_TTL) { kvSet('updates:report', 'null'); return false; }
  const ch = chatChannel();
  if (!ch) return false;
  const running = runningVersion();
  const ok = running !== rec.from;
  const news = ok ? releaseRange(installedReleases(), rec.from, running).slice(0, 3).map((n) => `- v${n.version}: ${n.title}`) : []; // 065
  const text = ok ? `✓ Updated to ${running} (from ${rec.from}). Everything restarted.${rec.backup ? ` Backup made first: ${rec.backup}.` : ''}${news.length ? `\n\nWhat's new:\n${news.join('\n')}\nAll changes: panel → Settings → Release notes.` : ''}`
    : `The update to ${rec.target} did not finish: still running ${running}. Check Overview → Server → Updates.`;
  try { await ch.send(rec.chat, text); } catch { return false; }
  kvSet('updates:report', 'null');
  activity('system', { summary: `Update result sent on WhatsApp: ${ok ? `running ${running}` : 'not finished'}` });
  return true;
}

// ---------------------------------------------------------------- scheduler
const hhmm = (d) => d.toLocaleTimeString('en-GB', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit', hour12: false });
const today = (d) => d.toLocaleDateString('en-CA', { timeZone: env.timezone });

/** One scheduler round (exported for tests). */
export async function updateTick({ now = new Date() } = {}) {
  await deliverUpdateReport(now.getTime()).catch(() => {});
  const s = getUpdateSettings();
  if (s.mode === 'off') return { action: 'off' };
  const st0 = updateStatus();
  const st = !st0 || now.getTime() - st0.checkedAt > 6 * 3600 * 1000 ? await checkForUpdate({ channel: s.channel }) : st0;
  if (st.breaking) await announceBreaking(st, now.getTime());
  if (s.mode !== 'auto' || !st.available) return { action: 'none', breaking: !!st.breaking };
  const target = st.breaking ? st.safeTarget : st.target;
  if (!target) return { action: 'waiting', breaking: true };
  if (hhmm(now) < s.at || kvGet('updates:autoDay') === today(now)) return { action: 'later', target };
  kvSet('updates:autoDay', today(now));
  const r = await applyUpdate({ target, by: 'automatic update' });
  if (r.code === 0) restartFn();
  return { action: r.code === 0 ? 'updated' : 'failed', target, code: r.code };
}

export function startUpdateScheduler({ restart } = {}) {
  if (restart) restartFn = restart;
  if (installKind() !== 'systemd') return; // docker/dev: notify only through the panel
  const tick = () => updateTick().catch((e) => activity('error', { summary: `Update check failed: ${e.message}` }));
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 10 * 60 * 1000).unref();
}
