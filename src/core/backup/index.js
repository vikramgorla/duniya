// @ts-check
// Backups (007): settings, run, retention per destination, schedule, list, restore staging.
import { readdirSync, rmSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, env, fail } from '../config.js';
import { getSecret, setSecret, getSetting, updateSettings } from '../store.js';
import { kvGet, kvSet } from '../db.js';
import { activity } from '../events.js';
import { assertDiskRoom } from '../retention.js';
import { writeBackup, checkBackup, stageRestore } from './bundle.js';
import * as gh from './github.js';
import { s3Client } from './s3.js';

export const LOCAL_DIR = resolve(process.env.BACKUP_DIR || resolve(DATA_DIR, 'backups'));
// 069: milliseconds in the name (two backups in one second never overwrite each other); older names stay valid
const FILE_RE = /^duniya-\d{8}-\d{6}(?:-\d{3})?\.dbk$/;

const DEFAULTS = {
  enabled: false, schedule: 'daily', at: '03:30', weekday: 'sun', keep: 14, includeWhatsApp: true,
  github: { enabled: false, repo: '', branch: '', path: 'backups' },
  s3: { enabled: false, endpoint: '', region: 'auto', bucket: '', prefix: 'duniya/' },
  githubClientId: '',
  githubApp: null, // 019: { id, slug, name, owner, htmlUrl, clientId, createdAt, installationId?, account? }
};

export function getBackupSettings() {
  const s = getSetting('backup', {}) || {};
  return { ...DEFAULTS, ...s, github: { ...DEFAULTS.github, ...(s.github || {}) }, s3: { ...DEFAULTS.s3, ...(s.s3 || {}) } };
}

const bad = (field, msg) => fail(`${field}: ${msg}`, 400, { field });
export function updateBackupSettings(patch) {
  const cur = getBackupSettings();
  const next = { ...cur, ...patch, github: { ...cur.github, ...(patch.github || {}) }, s3: { ...cur.s3, ...(patch.s3 || {}) } };
  if (!['hourly', '6h', 'daily', 'weekly'].includes(next.schedule)) throw bad('schedule', 'hourly, 6h, daily or weekly');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.at)) throw bad('at', 'HH:MM');
  if (!['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(next.weekday)) throw bad('weekday', 'mon…sun');
  next.keep = Number(next.keep);
  if (!Number.isInteger(next.keep) || next.keep < 1 || next.keep > 365) throw bad('keep', '1–365');
  next.enabled = !!next.enabled; next.includeWhatsApp = !!next.includeWhatsApp;
  if (next.enabled && !getSecret('BACKUP_PASSPHRASE')) throw bad('enabled', 'set a backup passphrase first');
  next.github.enabled = !!next.github.enabled;
  if (next.github.enabled && !/^[\w.-]+\/[\w.-]+$/.test(next.github.repo || '')) throw bad('github.repo', 'owner/name');
  next.s3.enabled = !!next.s3.enabled;
  if (next.s3.enabled) {
    try { new URL(next.s3.endpoint); } catch { throw bad('s3.endpoint', 'must be a URL'); }
    if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(next.s3.bucket || '')) throw bad('s3.bucket', 'invalid bucket name');
  }
  next.s3.prefix = String(next.s3.prefix || '').replace(/^\/+/, '');
  updateSettings({ backup: next });
  return next;
}

export function setPassphrase(p) {
  if (String(p || '').length < 12) throw bad('passphrase', 'at least 12 characters');
  setSecret('BACKUP_PASSPHRASE', String(p));
  activity('backup.settings', { summary: 'Backup passphrase changed (older backups still need the old passphrase)' });
}

export const githubClientId = () => getBackupSettings().githubClientId || process.env.GITHUB_OAUTH_CLIENT_ID || '';
export const APP_KEY_SECRET = 'GITHUB_APP_PRIVATE_KEY';
let instToken = null; // { installationId, token, expiresAt }
/** An installation token for the backup GitHub App, refreshed 5 minutes before it expires. */
async function appInstallationToken() {
  const app = getBackupSettings().githubApp;
  const pem = getSecret(APP_KEY_SECRET);
  if (!app?.installationId || !pem) throw fail('The GitHub app is not installed yet');
  if (instToken && instToken.installationId === app.installationId && instToken.expiresAt - Date.now() > 300000) return instToken.token;
  const t = await gh.installationToken(gh.appJwt(app.id, pem), app.installationId);
  instToken = { installationId: app.installationId, ...t };
  return t.token;
}
export const resetAppToken = () => { instToken = null; };
/** How backups reach GitHub: the installed GitHub App when there is one, else the saved token (or null). */
function githubAuth() {
  if (getBackupSettings().githubApp?.installationId && getSecret(APP_KEY_SECRET)) return appInstallationToken;
  return getSecret('GITHUB_BACKUP_TOKEN') || null;
}
const ghToken = githubAuth;
const s3For = (s) => s3Client({ ...s.s3, accessKeyId: getSecret('S3_ACCESS_KEY_ID'), secretAccessKey: getSecret('S3_SECRET_ACCESS_KEY') });

function stampName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `duniya-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${String(d.getUTCMilliseconds()).padStart(3, '0')}.dbk`;
}

export function listLocal() {
  if (!existsSync(LOCAL_DIR)) return [];
  const pre = new Set(preUpdateFiles());
  return readdirSync(LOCAL_DIR).filter((f) => FILE_RE.test(f)).sort().reverse()
    .map((f) => ({ file: f, size: statSync(resolve(LOCAL_DIR, f)).size, ...(pre.has(f) ? { preUpdate: true } : {}) }));
}

// Pre-update backups (045): local only, kept apart from the normal retention (the last `keepPreUpdate` are kept).
const preUpdateFiles = () => { try { return JSON.parse(kvGet('backup:preUpdate') || '[]').filter((f) => FILE_RE.test(f)); } catch { return []; } };
export const listPreUpdate = () => preUpdateFiles().filter((f) => existsSync(resolve(LOCAL_DIR, f)));

let running = null;
/**
 * Make a backup now. Returns { file, size, results: { local, github?, s3? } }.
 * preUpdate: a local-only backup before an update; the last `keepPreUpdate` of these are kept.
 */
export function runBackup({ reason = 'manual', appVersion = '', preUpdate = false, keepPreUpdate = 3 } = {}) {
  if (running) return running;
  running = (async () => {
    await null; // always async, so the guard below is set before the work starts
    {
      const s = getBackupSettings();
      const pass = getSecret('BACKUP_PASSPHRASE');
      if (!pass) throw bad('passphrase', 'set a backup passphrase first');
      assertDiskRoom(); // 069: never fill the last of the disk with a backup
      let file = stampName();
      // the same millisecond (a clock that went back): wait for the next stamp
      while (existsSync(resolve(LOCAL_DIR, file))) { await new Promise((r) => setTimeout(r, 5)); file = stampName(); }
      const results = {};
      // 070: streamed from disk into the file; GitHub / S3 get the same encrypted bytes (compressed size)
      const keep = (s.github.enabled || s.s3.enabled) && !preUpdate;
      const { size, bytes: remote } = await writeBackup(resolve(LOCAL_DIR, file), pass, { includeWhatsApp: s.includeWhatsApp, appVersion, keep });
      let pre = preUpdateFiles();
      if (preUpdate) {
        pre = [...pre, file];
        const keepN = Math.max(1, Number(keepPreUpdate) || 3);
        for (const old of pre.slice(0, Math.max(0, pre.length - keepN))) rmSync(resolve(LOCAL_DIR, old), { force: true });
        pre = pre.slice(-keepN);
        kvSet('backup:preUpdate', JSON.stringify(pre));
      } else {
        for (const old of listLocal().filter((b) => !pre.includes(b.file)).slice(s.keep)) rmSync(resolve(LOCAL_DIR, old.file), { force: true });
      }
      results.local = 'ok';
      if (s.github.enabled && !preUpdate) {
        try {
          if (!ghToken()) throw new Error('GitHub is not connected');
          const r = await gh.upload(ghToken(), s.github, file, remote, s.keep);
          results.github = r.pruned.length ? `ok (pruned ${r.pruned.length})` : 'ok';
        } catch (e) { results.github = `error: ${e.message}`; }
      }
      if (s.s3.enabled && !preUpdate) {
        try {
          const c = s3For(s);
          await c.put(`${s.s3.prefix}${file}`, remote);
          const objs = (await c.list(s.s3.prefix)).filter((o) => FILE_RE.test(o.key.slice(s.s3.prefix.length))).sort((a, z) => z.key.localeCompare(a.key));
          for (const o of objs.slice(s.keep)) await c.del(o.key);
          results.s3 = 'ok';
        } catch (e) { results.s3 = `error: ${e.message}`; }
      }
      const last = { at: Date.now(), file, size, results, reason };
      kvSet('backup:last', JSON.stringify(last));
      const failed = Object.entries(results).filter(([, v]) => v.startsWith('error'));
      activity(failed.length ? 'error' : 'backup.done', {
        summary: `${preUpdate ? 'Pre-update backup' : 'Backup'} ${file} (${Math.round(size / 1024)} KB): ${Object.entries(results).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      });
      return last;
    }
  })().finally(() => { running = null; });
  return running;
}

export const lastBackup = () => { try { return JSON.parse(kvGet('backup:last') || 'null'); } catch { return null; } };

export async function listBackups(source) {
  const s = getBackupSettings();
  if (source === 'local') return listLocal();
  if (source === 'github') return (await gh.list(ghToken(), s.github)).map(({ file, size }) => ({ file, size }));
  if (source === 's3') {
    return (await s3For(s).list(s.s3.prefix)).map((o) => ({ file: o.key.slice(s.s3.prefix.length), size: o.size }))
      .filter((o) => FILE_RE.test(o.file)).sort((a, z) => z.file.localeCompare(a.file));
  }
  throw bad('source', 'local, github or s3');
}

/** A backup as a local path (read in place) or, from GitHub or S3, the downloaded file in memory. */
export async function fetchBackup(source, file) {
  if (!FILE_RE.test(file || '')) throw bad('file', 'invalid backup file name');
  const s = getBackupSettings();
  if (source === 'local') {
    const p = resolve(LOCAL_DIR, file);
    if (!existsSync(p)) throw fail('Backup not found', 404);
    return p;
  }
  if (source === 'github') return gh.download(ghToken(), s.github, file);
  if (source === 's3') return s3For(s).get(`${s.s3.prefix}${file}`);
  throw bad('source', 'local, github or s3');
}

/** Fetch and decrypt a backup without restoring it (060: the restore preview checks that it opens). */
export async function openBackup({ source, file, passphrase }) {
  const r = await checkBackup(await fetchBackup(source, file), passphrase);
  return { files: r.files.length, createdAt: r.createdAt };
}
/**
 * Decrypt and stage a backup (local, github, s3, or `path`: an uploaded file on disk); the caller restarts.
 */
export async function restoreBackup({ source, file, passphrase, path = '' }) {
  const r = await stageRestore(path || await fetchBackup(source, file), passphrase, `${source}:${file}`);
  activity('backup.restore', { summary: `Restore of ${file} from ${source} staged (${r.files.length} files); restarting` });
  return { files: r.files.length, createdAt: r.createdAt };
}

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour === '24' ? 0 : p.hour), hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, weekday: p.weekday.slice(0, 3).toLowerCase() };
}

/** The schedule slot `date` falls in, or null if no backup is due in it yet (pure; tested). */
export function slotFor(s, date = new Date(), tz = env.timezone) {
  const p = parts(date, tz);
  if (s.schedule === 'hourly') return `${p.date}T${String(p.hour).padStart(2, '0')}`;
  if (s.schedule === '6h') return `${p.date}/${Math.floor(p.hour / 6)}`;
  if (p.hhmm < s.at) return null;
  if (s.schedule === 'daily') return p.date;
  if (s.schedule === 'weekly') return p.weekday === s.weekday ? `${p.date}W` : null;
  return null;
}

// 2.31.0 only (remove in the next release): backups from 2.30 and earlier (DUNIYA1) cannot be restored any more, so
// when the newest local backup is in the old format and a passphrase is set, make a fresh one once at startup.
const newestIsOldFormat = () => {
  const [f] = listLocal(); if (!f) return false;
  const fd = openSync(resolve(LOCAL_DIR, f.file), 'r'); const b = Buffer.alloc(8);
  try { readSync(fd, b, 0, 8, 0); } finally { closeSync(fd); }
  return b.toString() === 'DUNIYA1\n';
};
export function startBackupScheduler({ appVersion = '' } = {}) {
  setTimeout(() => {
    try { if (getSecret('BACKUP_PASSPHRASE') && newestIsOldFormat()) Promise.resolve().then(() => runBackup({ reason: 'new backup format', appVersion })).catch((e) => activity('error', { summary: `Backup in the new format failed: ${e.message}` })); } catch { /* best effort */ }
  }, 30 * 1000).unref();
  const tick = async () => {
    const s = getBackupSettings();
    if (!s.enabled) return;
    const slot = slotFor(s);
    if (!slot || kvGet('backup:slot') === slot) return;
    kvSet('backup:slot', slot);
    try { await runBackup({ reason: 'schedule', appVersion }); } catch (e) { activity('error', { summary: `Scheduled backup failed: ${e.message}` }); }
  };
  setInterval(tick, 60 * 1000).unref();
}

export { gh as github };
