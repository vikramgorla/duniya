// @ts-check
// Updates (008, 045): check the git remote for new releases (tags) or main, apply via deploy/update.sh, optional auto
// mode. 045: releases.json (read from the target with git) marks breaking releases; the status says what lies between
// the installed and the available version and which release can be reached safely. Before every update a local backup
// is made when a backup passphrase is set (the last N pre-update backups are kept).
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';
import { getSetting, updateSettings, getSecret } from './store.js';
import { kvGet, kvSet } from './db.js';
import { activity } from './events.js';
import { parseVersion, compareVersions, analyzeJump, readReleasesAt } from './releases.js';
import { runBackup } from './backup/index.js';

export { parseVersion, compareVersions };

const git = (args, cwd) => new Promise((res, rej) => execFile('git', args, { cwd, timeout: 60000 }, (e, out, err) => (e ? rej(new Error((err || e.message).trim())) : res(out.trim()))));

// The checkout this process updates. Tests point it at a temporary git repository (with the version "running" there).
let appRoot = ROOT;
let runningOverride = null;
export function _setAppRoot(root, { running = null } = {}) { appRoot = root || ROOT; runningOverride = running; }
export const updateRoot = () => appRoot;

export function installKind() {
  if (process.env.DUNIYA_INSTALL) return process.env.DUNIYA_INSTALL;
  return existsSync(resolve(ROOT, '.git')) ? 'dev' : 'unknown';
}

export const newestTag = (tags) => tags.filter((t) => parseVersion(t)).sort(compareVersions).at(-1) || null;

const DEFAULTS = { mode: process.env.UPDATE_MODE || 'notify', channel: 'stable', at: '04:00', keepPreUpdate: 3 };
export function getUpdateSettings() {
  const s = getSetting('updates', {}) || {};
  return { ...DEFAULTS, mode: process.env.UPDATE_MODE || 'notify', ...s };
}
export function setUpdateSettings(patch) {
  const next = { ...getUpdateSettings(), ...patch };
  if (!['off', 'notify', 'auto'].includes(next.mode)) throw Object.assign(new Error('mode: off, notify or auto'), { status: 400, field: 'mode' });
  if (!['stable', 'main'].includes(next.channel)) throw Object.assign(new Error('channel: stable or main'), { status: 400, field: 'channel' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.at)) throw Object.assign(new Error('at: HH:MM'), { status: 400, field: 'at' });
  next.keepPreUpdate = Number(next.keepPreUpdate);
  if (!Number.isInteger(next.keepPreUpdate) || next.keepPreUpdate < 1 || next.keepPreUpdate > 20) throw Object.assign(new Error('keepPreUpdate: 1–20'), { status: 400, field: 'keepPreUpdate' });
  updateSettings({ updates: next });
  return next;
}
const savedStatus = () => { try { return JSON.parse(kvGet('updates:status') || 'null'); } catch { return null; } };
// The version this process is running (read once at start; an update restarts the process).
const STARTED_VERSION = (() => { try { return `v${JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version}`; } catch { return 'unknown'; } })();
export const RUNNING_VERSION = STARTED_VERSION;
export const runningVersion = () => runningOverride || STARTED_VERSION;

/** What lies between `current` and the saved check (pure on the saved data, so it stays right after a restart). */
function withAnalysis(st, current) {
  const target = st.channel === 'main' ? st.targetVersion : st.latest;
  const a = analyzeJump({ current, target, versions: st.channel === 'main' ? (st.targetVersion ? [st.targetVersion] : []) : st.tags || [], releases: st.releases || {} });
  const safeTarget = st.channel === 'main' ? (a.breaking ? null : st.available ? 'main' : null) : a.safeTarget;
  return { ...st, breaking: a.breaking, steps: a.steps, safeTarget, decisionVersion: a.decisionVersion };
}

/** Last check, corrected for what is running now (a check saved before an update + restart is otherwise stale). */
export const updateStatus = () => {
  const st = savedStatus();
  if (!st) return null;
  if (st.channel === 'stable' && parseVersion(runningVersion())) {
    const current = runningVersion();
    return withAnalysis({ ...st, current, available: !!(st.latest && parseVersion(st.latest) && compareVersions(current, st.latest) < 0) }, current);
  }
  return withAnalysis(st, parseVersion(runningVersion()) ? runningVersion() : st.currentVersion);
};

/** Check the remote. Returns the status { current, latest, available, target, breaking, steps, safeTarget, … }. */
export async function checkForUpdate({ root = appRoot, channel = getUpdateSettings().channel } = {}) {
  await git(['fetch', '-q', 'origin', '--tags', '--prune'], root);
  const head = await git(['rev-parse', 'HEAD'], root);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  let current = await git(['describe', '--tags', '--always'], root).catch(() => head.slice(0, 7));
  let latest; let target; let available; let tags = []; let releases = {}; let targetVersion = null;
  if (channel === 'stable') {
    const all = (await git(['tag', '-l', 'v*'], root)).split('\n').filter((t) => parseVersion(t));
    const tag = newestTag(all);
    const exact = await git(['describe', '--tags', '--exact-match', 'HEAD'], root).catch(() => '');
    current = exact || `v${pkg}`;
    latest = tag; target = tag;
    available = !!tag && compareVersions(current, tag) < 0;
    tags = all.filter((t) => compareVersions(t, current) > 0).sort(compareVersions);
    if (available) releases = await readReleasesAt(root, `refs/tags/${tag}`);
  } else {
    const remote = await git(['rev-parse', 'origin/main'], root);
    latest = remote.slice(0, 7); target = 'main';
    available = remote !== head && (await git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], root).then(() => true, () => false));
    if (available) {
      try { targetVersion = `v${JSON.parse(await git(['show', 'origin/main:package.json'], root)).version}`; } catch { targetVersion = null; }
      releases = await readReleasesAt(root, 'origin/main');
    }
  }
  // Keep only what lies ahead (the status is small and stays meaningful after a restart).
  releases = Object.fromEntries(Object.entries(releases).filter(([v]) => compareVersions(v, `v${pkg}`) > 0));
  const status = { current, currentVersion: `v${pkg}`, latest, available, target, targetVersion, tags, releases, channel, checkedAt: Date.now(), lastResult: savedStatus()?.lastResult || null };
  if (root === appRoot) kvSet('updates:status', JSON.stringify(status));
  return withAnalysis(status, channel === 'stable' ? current : `v${pkg}`);
}

// ---------------------------------------------------------------- pre-update backups
/** Backups are "configured" when a backup passphrase is set (backups are always encrypted). */
export const backupConfigured = () => !!getSecret('BACKUP_PASSPHRASE');

/** Make the local pre-update backup. Returns { file } or null when backups are not configured. Throws on failure. */
export async function preUpdateBackup({ target }) {
  if (!backupConfigured()) return null;
  const r = await runBackup({ reason: `before update to ${target || 'latest'}`, appVersion: runningVersion(), preUpdate: true, keepPreUpdate: getUpdateSettings().keepPreUpdate });
  return { file: r.file };
}

// One update at a time. The running state is kept server-side so the panel can show it after a reload.
let inflight = null;
export const updateRunning = () => (inflight ? { target: inflight.target, startedAt: inflight.startedAt, phase: inflight.phase } : null);

/**
 * Backup (when configured and `backup` is not false) → deploy/update.sh <target>. Returns { code, log, backup }.
 * A second call while one runs gets the same result. A failed backup stops the update (code 2).
 */
/** @param {{ root?: string, target?: string, backup?: boolean, by?: string }} [o] */
export function applyUpdate({ root = appRoot, target, backup = true, by = '' } = {}) {
  const own = root === appRoot;
  if (inflight && own) return inflight.promise;
  const state = { target, startedAt: Date.now(), phase: backup ? 'backup' : 'install' };
  const promise = (async () => {
    let made = null;
    if (backup && own) {
      try { made = await preUpdateBackup({ target }); } catch (e) {
        const log = `Backup before the update failed: ${e.message}. The update was not installed.`;
        saveResult({ ok: false, target, log, backup: null });
        activity('error', { summary: `Update to ${target || 'latest'} not installed: the backup before it failed (${e.message})` });
        return { code: 2, log, backup: null };
      }
    }
    state.phase = 'install';
    const r = await runUpdate({ root, target });
    if (own) {
      saveResult({ ok: r.code === 0, target, log: r.log, backup: made?.file || null });
      activity(r.code === 0 ? 'system' : 'error', { summary: r.code === 0 ? `Updated to ${target || 'latest'}${made ? ` (backup ${made.file} first)` : ''}${by ? ` by ${by}` : ''}` : 'Update failed (previous version kept)', detail: r.log.slice(-2000) });
    }
    return { ...r, backup: made?.file || null };
  })().finally(() => { if (own) inflight = null; });
  if (own) inflight = Object.assign(state, { promise });
  return promise;
}

function saveResult({ ok, target, log, backup }) {
  const st = savedStatus() || {};
  kvSet('updates:status', JSON.stringify({ ...st, lastResult: { at: Date.now(), ok, target: target || 'latest', from: runningVersion(), backup, log: String(log).slice(-1000) } }));
}

function runUpdate({ root, target }) {
  return new Promise((r) => {
    const p = spawn('bash', [resolve(root, 'deploy/update.sh'), ...(target ? [target] : [])], { cwd: root });
    let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
    p.on('close', (code) => r({ code, log: log.slice(-6000) }));
  });
}
