// @ts-check
// Retention and health (069). Keeps the database small on a small server with no chores for the owner:
//  - on the shared upkeep tick (upkeep.js), at most once an hour, old rows go in bounded batches (2 000 rows per kind per
//    tick; a large first clean-up continues on the next ticks): stored messages (days and per-chat cap), activity
//    (Settings → Activity log: days and entries), usage detail (days), why-quiet rows (90 days), daily counters
//    (60 days), finished schedule markers (14 days), expired sessions, confirm codes and short-lived state;
//    summaries, notes, contacts and settings are never pruned;
//  - after a clean-up: PRAGMA optimize and freed pages handed back in small steps (incremental vacuum); a full VACUUM
//    only when it is cheap (a third of the file free, under 512 MB, enough free disk, memory not tight, weekly at most);
//  - free disk space is checked every tick: low → the owner is told (once a day); almost full → stored messages and
//    optional activity pause (errors and changes are still recorded), backups refuse, and everything resumes by
//    itself when space is back;
//  - the clock: when wall time and monotonic time disagree by more than 10 minutes, or the clock is behind the newest
//    activity entry, nothing is pruned (a wrong clock must never delete history) and Health says so.
import { statfsSync, statSync, existsSync } from 'node:fs';
import { DATA_DIR, env, fail } from './config.js';
import { db, DB_FILE, kvGet, kvSet, setWritesPaused, writesPaused } from './db.js';
import { activity, loggingSettings } from './events.js';
import { getSetting, updateSettings } from './store.js';
import { optionalPaused } from './resources.js';
import { queueStats } from './media-queue.js';
import { sendOwnerAlert } from './owner-alerts.js';

const DAY = 86400000;
const HOUR = 3600000;
const BATCH = 2000;
const MB = 1048576;
const LABELS = { messagesDays: 'Stored messages: days', messagesPerChat: 'Stored messages per chat', usageDays: 'Usage detail: days' };
const RETENTION_LIMITS = Object.freeze({ messagesDays: [7, 3650], messagesPerChat: [200, 50000], usageDays: [30, 3650] });
// Disk levels: low below 500 MB or 5 % free; full below 100 MB (writes pause).
const DISK_LOW = 500 * MB; const DISK_FULL = 100 * MB;

/** What is kept: stored messages and usage detail (here) and the activity log (Settings → Activity log). */
function retentionSettings() {
  const s = getSetting('retention', null) || {};
  return { messagesDays: s.messagesDays ?? env.memory.retentionDays, messagesPerChat: s.messagesPerChat ?? env.memory.maxMessagesPerChat, usageDays: s.usageDays ?? 400 };
}
/** Change some of the retention settings; numbers are checked against RETENTION_LIMITS. */
export function setRetention(patch = {}) {
  const next = retentionSettings();
  for (const [k, [lo, hi]] of Object.entries(RETENTION_LIMITS)) {
    if (patch[k] === undefined) continue;
    const v = Math.round(Number(patch[k]));
    if (!(v >= lo && v <= hi)) throw fail(`${LABELS[k]}: ${lo}–${hi}`, 400, { field: k });
    next[k] = v;
  }
  updateSettings({ retention: next });
  nextRun = 0; // apply soon (the next tick)
  return next;
}

// ---------- clock ----------
let lastWall = 0; let lastMono = 0;
let clock = { ok: true, skewMs: 0, at: 0 };
function checkClock(now) {
  const mono = performance.now();
  const drift = lastWall ? (now - lastWall) - (mono - lastMono) : 0;
  lastWall = now; lastMono = mono;
  const newest = db.prepare('SELECT MAX(ts) AS ts FROM activity').get().ts || 0;
  const behind = newest - now > 10 * 60000 ? newest - now : 0;
  const skew = Math.abs(drift) > 10 * 60000 ? drift : -behind;
  if (skew) {
    if (clock.ok) activity('system', { summary: `The server clock jumped by ${Math.round(skew / 60000)} minutes; old data is not pruned until it is steady` });
    clock = { ok: false, skewMs: Math.round(skew), at: now };
  } else if (!clock.ok && now - clock.at > HOUR) clock = { ok: true, skewMs: 0, at: now };
  return clock.ok;
}

// ---------- disk ----------
let disk = { level: 'ok', free: null, total: null };
function diskInfo() {
  try { const s = statfsSync(DATA_DIR); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return null; }
}
/** Check free space; switch writes off below the full mark and on again above it. Returns the level. */
export function checkDisk(now = Date.now(), info = diskInfo()) {
  if (!info) return disk.level;
  const level = info.free < DISK_FULL ? 'full' : info.free < DISK_LOW || info.free < info.total * 0.05 ? 'low' : 'ok';
  const was = disk.level;
  disk = { level, ...info };
  if (level === 'full' && !writesPaused()) setWritesPaused(true);
  if (level !== 'full' && writesPaused()) setWritesPaused(false);
  if (level !== was) {
    const free = `${Math.round(info.free / MB)} MB free`;
    if (level === 'ok') activity('system', { summary: `Disk space is back (${free}); everything is stored again` });
    else {
      const text = level === 'full'
        ? `The server disk is almost full (${free}). Stored messages and optional activity are paused and backups wait until space is freed. Agents keep answering.`
        : `The server disk is getting full (${free}). Old data is pruned automatically; consider fewer local backups or a bigger disk.`;
      activity('error', { summary: text });
      const last = Number(kvGet('health:diskAlertAt')) || 0;
      if (now - last > DAY || level === 'full') { kvSet('health:diskAlertAt', now); sendOwnerAlert(`Duniya: ${text}`, { kind: 'disk' }).catch(() => {}); }
    }
  }
  return level;
}
/** For backups: refuse while the disk is almost full (a half-written backup would make it worse). */
export function assertDiskRoom() {
  if (disk.level === 'full') throw fail(`The disk is almost full (${Math.round((disk.free || 0) / MB)} MB free); backups wait until space is freed`, 507);
}

// ---------- pruning ----------
let nextRun = 0;
let more = false;
const del = (sql, ...args) => Number(db.prepare(sql).run(...args).changes);
/** One bounded clean-up. Returns { removed } (rows per kind) and whether more is left. */
function prune(now) {
  const r = retentionSettings(); const log = loggingSettings();
  const removed = { messages: 0, activity: 0, usage: 0, other: 0 };
  let left = false;
  // stored messages: per chat, older than the days or beyond the cap
  let budget = BATCH;
  for (const { chat } of db.prepare('SELECT DISTINCT chat FROM messages').all()) {
    if (budget <= 0) { left = true; break; }
    let n = del('DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE chat = ? AND ts < ? LIMIT ?)', chat, now - r.messagesDays * DAY, budget);
    budget -= n;
    const edge = db.prepare('SELECT id FROM messages WHERE chat = ? ORDER BY id DESC LIMIT 1 OFFSET ?').get(chat, r.messagesPerChat);
    if (edge && budget > 0) { const c = del('DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE chat = ? AND id <= ? ORDER BY id LIMIT ?)', chat, edge.id, budget); n += c; budget -= c; }
    removed.messages += n;
  }
  // activity: days, then the entry cap
  removed.activity += del('DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE ts < ? LIMIT ?)', now - Math.max(1, log.retentionDays) * DAY, BATCH);
  const edge = db.prepare('SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET ?').get(Math.max(100, log.maxEntries));
  if (edge) removed.activity += del('DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE id <= ? ORDER BY id LIMIT ?)', edge.id, BATCH);
  removed.usage += del('DELETE FROM usage WHERE id IN (SELECT id FROM usage WHERE ts < ? LIMIT ?)', now - r.usageDays * DAY, BATCH);
  left ||= removed.activity >= BATCH || removed.usage >= BATCH;
  // small bookkeeping tables
  removed.other += del('DELETE FROM silences WHERE last_ts < ?', now - 90 * DAY);
  removed.other += del('DELETE FROM daily_stats WHERE day < ?', Math.floor(now / DAY) - 60);
  removed.other += del("DELETE FROM kv WHERE k LIKE 'sched:%' AND substr(k, -10) < ?", new Date(now - 14 * DAY).toISOString().slice(0, 10));
  removed.other += del('DELETE FROM sessions WHERE expires_at < ?', now);
  removed.other += del('DELETE FROM pending WHERE expires < ?', now);
  removed.other += del('DELETE FROM ttl_state WHERE expires < ?', now - HOUR);
  return { removed, left };
}

function compact(now) {
  db.exec('PRAGMA optimize');
  const pages = db.prepare('PRAGMA page_count').get().page_count;
  const free = db.prepare('PRAGMA freelist_count').get().freelist_count;
  const pageSize = db.prepare('PRAGMA page_size').get().page_size;
  if (db.prepare('PRAGMA auto_vacuum').get().auto_vacuum === 2) { if (free) db.exec('PRAGMA incremental_vacuum(2048)'); return null; }
  // Not yet incremental (created before 069): one VACUUM switches it, when that is cheap.
  const size = pages * pageSize;
  const lastVacuum = Number(kvGet('health:vacuumAt')) || 0;
  if (free < pages / 3 || size > 512 * MB || now - lastVacuum < 7 * DAY || optionalPaused() || (disk.free != null && disk.free < size * 2 + DISK_LOW)) return null;
  const t0 = performance.now();
  db.exec('VACUUM');
  kvSet('health:vacuumAt', now);
  return Math.round(performance.now() - t0);
}

let running = false;
let healthCache = null;
/** Upkeep tick (every 30 s): the disk check always; a clean-up at most hourly, or on the next tick while more is left. */
export function retentionTick(now = Date.now()) {
  checkDisk(now);
  if (running || (!more && now < nextRun)) return null;
  if (!checkClock(now)) { nextRun = now + HOUR; return { skipped: 'clock' }; }
  running = true;
  try {
    const t0 = performance.now();
    const { removed, left } = prune(now);
    more = left;
    nextRun = now + HOUR;
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    const vacuumMs = total || !more ? compact(now) : null;
    const last = { at: now, removed, ms: Math.round(performance.now() - t0), ...(vacuumMs != null ? { vacuumMs } : {}) };
    kvSet('health:lastPrune', JSON.stringify(last));
    healthCache = null;
    if (removed.messages + removed.activity + removed.usage >= 100) {
      activity('system', { summary: `Old data pruned: ${removed.messages} stored messages, ${removed.activity} activity entries, ${removed.usage} usage rows${vacuumMs != null ? '; database compacted' : ''}` });
    }
    return last;
  } finally { running = false; }
}

// ---------- health (Server → Health, admin MCP) ----------
const fileSize = (f) => (existsSync(f) ? statSync(f).size : 0);
/** Database size, oldest kept data, retention, last clean-up, disk, queue and clock. Counts are cached for a minute. */
export function healthView(now = Date.now()) {
  if (!healthCache || now - healthCache.at > 60000) {
    const one = (sql) => db.prepare(sql).get() || {};
    healthCache = { at: now,
      rows: { messages: one('SELECT COUNT(*) AS n FROM messages').n, activity: one('SELECT COUNT(*) AS n FROM activity').n, usage: one('SELECT COUNT(*) AS n FROM usage').n },
      oldest: { messages: one('SELECT MIN(ts) AS ts FROM messages').ts || null, activity: one('SELECT MIN(ts) AS ts FROM activity').ts || null, usage: one('SELECT MIN(ts) AS ts FROM usage').ts || null } };
  }
  const pageSize = db.prepare('PRAGMA page_size').get().page_size;
  const last = (() => { try { return JSON.parse(kvGet('health:lastPrune') || 'null'); } catch { return null; } })();
  const log = loggingSettings();
  return {
    database: { bytes: fileSize(DB_FILE) + fileSize(`${DB_FILE}-wal`), freeBytes: db.prepare('PRAGMA freelist_count').get().freelist_count * pageSize, rows: healthCache.rows },
    oldest: healthCache.oldest,
    retention: { ...retentionSettings(), activityDays: log.retentionDays, activityEntries: log.maxEntries, limits: RETENTION_LIMITS },
    lastPrune: last, nextPruneAt: more ? now : nextRun || null, vacuumAt: Number(kvGet('health:vacuumAt')) || null,
    disk: { ...disk, writesPaused: writesPaused() },
    queue: queueStats(),
    clock,
  };
}
