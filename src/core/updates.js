// @ts-check
// Updates (008, 045): check the git remote for new releases (tags) or main, apply via deploy/update.sh, optional auto
// mode. 045: releases.json (read from the target with git) marks breaking releases; the status says what lies between
// the installed and the available version and which release can be reached safely. Before every update a local backup
// is made when a backup passphrase is set (the last N pre-update backups are kept). 095: an installed update leaves a
// note for the start guard (update-guard.js); a release that did not start and was rolled back is told here.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION, DATA_DIR, REPO, ROOT, bad, fail } from './config.js';
import { parseRepo, repoLinks, sameRepo } from './repo.js';
import { getSetting, updateSettings, getSecret } from './store.js';
import { kvGet, kvSet } from './db.js';
import { activity, recordFailure } from './events.js';
import { GUARDED_INSTALL, depsKey, noteUpdate, takeRollbackResult } from './update-guard.js';
import { parseVersion, compareVersions, analyzeJump, readReleasesAt, normalizeReleases, releaseRange } from './releases.js';
import { runBackup } from './backup/index.js';

export { parseVersion, compareVersions };

// GIT_TERMINAL_PROMPT=0: a repository that needs a password fails at once instead of waiting for one.
const git = (args, cwd) => new Promise((res, rej) => execFile('git', args, { cwd, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (e, out, err) => (e ? rej(new Error((err || e.message).trim())) : res(out.trim()))));

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
  if (!['off', 'notify', 'auto'].includes(next.mode)) throw fail('mode: off, notify or auto', 400, { field: 'mode' });
  if (!['stable', 'main'].includes(next.channel)) throw fail('channel: stable or main', 400, { field: 'channel' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.at)) throw fail('at: HH:MM', 400, { field: 'at' });
  next.keepPreUpdate = Number(next.keepPreUpdate);
  if (!Number.isInteger(next.keepPreUpdate) || next.keepPreUpdate < 1 || next.keepPreUpdate > 20) throw fail('keepPreUpdate: 1–20', 400, { field: 'keepPreUpdate' });
  updateSettings({ updates: next });
  return next;
}
const savedStatus = () => { try { return JSON.parse(kvGet('updates:status') || 'null'); } catch { return null; } };
// The version this process is running (read once at start; an update restarts the process).
export const RUNNING_VERSION = APP_VERSION;
export const runningVersion = () => runningOverride || APP_VERSION;
// 065: the release notes of the installed version (its own releases.json; read once, an update restarts the process).
let installedOnce = null;
export const installedReleases = () => (installedOnce ||= (() => { try { return normalizeReleases(JSON.parse(readFileSync(resolve(ROOT, 'releases.json'), 'utf8'))); } catch { return {}; } })());

/** What lies between `current` and the saved check (pure on the saved data, so it stays right after a restart). */
function withAnalysis(st, current) {
  const target = st.channel === 'main' ? st.targetVersion : st.latest;
  const a = analyzeJump({ current, target, versions: st.channel === 'main' ? (st.targetVersion ? [st.targetVersion] : []) : st.tags || [], releases: st.releases || {} });
  const safeTarget = st.channel === 'main' ? (a.breaking ? null : st.available ? 'main' : null) : a.safeTarget;
  // 065: every release between the running version and the target, newest first (the update dialog lists them)
  const notes = st.available ? releaseRange(st.releases || {}, current, st.channel === 'main' ? st.targetVersion : st.latest) : [];
  return { ...st, breaking: a.breaking, steps: a.steps, safeTarget, decisionVersion: a.decisionVersion, notes };
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

// ---------------------------------------------------------------- update source (084)
/** A URL without credentials (an installer given --git-token keeps a token in the remote: never shown or returned). */
const withoutAuth = (u) => String(u || '').replace(/^(https?:\/\/)[^/@]*@/, '$1');
/**
 * Where updates come from: the checkout's git remote (installed from, or changed later), as { url, repo, project,
 * official }: `repo` is its owner/name on GitHub (null for another host), `project` the repository in package.json.
 */
export async function updateSource({ root = appRoot } = {}) {
  const url = withoutAuth(await git(['config', '--get', 'remote.origin.url'], root).catch(() => ''));
  const repo = parseRepo(url)?.slug || null;
  return { url, repo, project: REPO.slug, official: sameRepo(repo, REPO.slug) };
}
/**
 * Switch the update source to another GitHub repository (owner/name or https://github.com/owner/name). Its tags are
 * fetched first (they replace the old source's); if that fails the previous source is put back. Returns the new check.
 * The root maintenance helper keeps the source in the root-owned install config (`sudo duniya source` changes both).
 */
export async function setUpdateSource(input, { root = appRoot, by = '' } = {}) {
  if (installKind() === 'docker') throw fail('Docker install: the image comes from the registry, not a git source', 400);
  const r = parseRepo(input);
  if (!r) throw bad('Enter owner/name or https://github.com/owner/name', 'repo');
  const next = repoLinks(r.slug).git;
  const prev = await git(['config', '--get', 'remote.origin.url'], root);
  if (withoutAuth(prev) === next) return { source: await updateSource({ root }), status: updateStatus() };
  await git(['remote', 'set-url', 'origin', next], root);
  try {
    await git(['fetch', '-q', '--force', '--prune', '--prune-tags', 'origin', '+refs/tags/*:refs/tags/*'], root);
  } catch (e) {
    await git(['remote', 'set-url', 'origin', prev], root);
    throw bad(`Could not read ${r.slug} on GitHub (${String(e.message).split('\n').pop().slice(0, 160)}). Is the name right and the repository public? The update source was not changed.`, 'repo');
  }
  activity('system', { summary: `Update source changed to ${r.slug}${by ? ` by ${by}` : ''}` });
  const status = await checkForUpdate({ root }).catch(() => updateStatus());
  return { source: await updateSource({ root }), status };
}

// ---------------------------------------------------------------- what's new (065)
const SEEN = (userId) => `updates:seen:${userId}`;
/**
 * The versions a user has not seen yet: { from, to } when the running version is newer than the last one this user
 * saw and the installed releases.json has notes for the range; otherwise null. A user without a record starts at the
 * version the last update came from (when it finished in the last 14 days), else at the running version.
 */
export function whatsNew(user) {
  const to = runningVersion();
  if (!user?.id || !parseVersion(to)) return null;
  let from = kvGet(SEEN(user.id));
  if (!from) {
    const lr = savedStatus()?.lastResult;
    from = lr?.ok && parseVersion(lr.from) && Date.now() - lr.at < 14 * 86400000 ? lr.from : to;
    kvSet(SEEN(user.id), from);
  }
  if (compareVersions(from, to) >= 0 || !releaseRange(installedReleases(), from, to).length) return null;
  return { from, to };
}
/** The user has seen what is new up to the running version. */
export function markSeen(user) { if (user?.id && parseVersion(runningVersion())) kvSet(SEEN(user.id), runningVersion()); return { seen: runningVersion() }; }

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
    const before = own ? await installedAt(root) : null;
    const r = await runUpdate({ root, target });
    if (own) {
      if (r.code === 0) await noteInstalled({ root, target, before, backup: made?.file || null }).catch(recordFailure('The note for the start guard (the update is installed, but not guarded)'));
      saveResult({ ok: r.code === 0, target, log: r.log, backup: made?.file || null });
      activity(r.code === 0 ? 'system' : 'error', { summary: r.code === 0 ? `Updated to ${target || 'latest'}${made ? ` (backup ${made.file} first)` : ''}${by ? ` by ${by}` : ''}` : 'Update failed (previous version kept)', detail: r.log.slice(-2000) });
    }
    return { ...r, backup: made?.file || null };
  })().finally(() => { if (own) inflight = null; });
  if (own) inflight = Object.assign(state, { promise });
  return promise;
}

// ---------------------------------------------------------------- the start guard (095)
const versionAt = (root) => { try { return `v${JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version}`; } catch { return ''; /* shown as "the new release" */ } };
/** The commit and the installed packages of a checkout (before an update); null when it cannot be told. */
const installedAt = async (root) => { const commit = await git(['rev-parse', 'HEAD'], root).catch(() => ''); return commit ? { commit, deps: depsKey(root) } : null; };

/** An update was installed: what the start guard needs to put the previous release back. Nothing when the code is the same. */
async function noteInstalled({ root, target, before, backup }) {
  if (installKind() !== GUARDED_INSTALL || !before) return;
  const commit = await git(['rev-parse', 'HEAD'], root);
  if (commit === before.commit) return; // already up to date
  noteUpdate(DATA_DIR, { from: before.commit, fromVersion: runningVersion(), to: versionAt(root), target: target || 'latest', commit, deps: depsKey(root) !== before.deps, backup });
}

const savedRollback = () => { try { return JSON.parse(kvGet('updates:rolledBack') || 'null'); } catch { return null; /* unreadable: as if nothing was rolled back */ } };
/**
 * The rollback to show: the last one, while the server runs the version it was rolled back to (or, when putting it
 * back failed, the version that did not start). { ok, error, from, to, target, commit, backup, starts, at, alerted }.
 */
export function rolledBack() {
  const r = savedRollback();
  if (!r) return null;
  const running = runningVersion();
  return r.to === running || (!r.ok && r.from === running) ? r : null;
}
/** What happened, in plain words (Activity, the owner alert, the WhatsApp answer to a confirmed update). */
export function rollbackText(r) {
  const tries = `${r.starts} ${r.starts === 1 ? 'try' : 'tries'}`;
  if (!r.ok) return `The update to ${r.from} did not start on this server (${tries}), and putting ${r.to} back failed: ${r.error || 'unknown reason'}. Check the server: sudo duniya logs.`;
  return `The update to ${r.from} did not start on this server (${tries}) and was rolled back: ${r.to} is running again. Your data was left as it is.`
    + `${r.backup ? ` The backup made before the update is ${r.backup}.` : ''} Automatic updates will not install ${r.from} again; a newer release will be installed, and you can still choose Update.`;
}
/** At the start: a rollback the guard made is taken into the status and Activity; an old notice is cleared once another version runs. */
export function takeRollback() {
  const r = takeRollbackResult(DATA_DIR);
  if (r) {
    kvSet('updates:rolledBack', JSON.stringify({ ...r, alerted: false }));
    activity('error', { summary: rollbackText(r) });
  } else if (savedRollback() && !rolledBack()) kvSet('updates:rolledBack', 'null');
  return r;
}
/** The owner was told (or cannot be): the alert is not sent again. */
export function rollbackTold() { const r = savedRollback(); if (r) kvSet('updates:rolledBack', JSON.stringify({ ...r, alerted: true })); }
/** Is `target` the release that did not start here and was rolled back (a tag; on main, the commit)? */
export function isRolledBack(target, st) {
  const r = rolledBack();
  if (!r?.ok) return false;
  return st.channel === 'main' ? !!st.latest && String(r.commit).startsWith(st.latest) : target === r.target;
}

function saveResult({ ok, target, log, backup }) {
  const st = savedStatus() || {};
  kvSet('updates:status', JSON.stringify({ ...st, lastResult: { at: Date.now(), ok, target: target || 'latest', from: runningVersion(), backup, log: String(log).slice(-1000) } }));
}

const UPDATE_MAX = 20 * 60 * 1000; // ms for fetching the release and installing its dependencies on a slow server
function runUpdate({ root, target }) {
  return new Promise((r) => {
    const p = spawn('bash', [resolve(root, 'deploy/update.sh'), ...(target ? [target] : [])], { cwd: root });
    let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
    // A download that never ends would hold "an update is running" for good: stop it (update.sh has changed nothing
    // that runs yet; the next try starts over).
    const late = setTimeout(() => { log += '\nThe update took too long and was stopped; the previous version keeps running.'; p.kill('SIGKILL'); }, UPDATE_MAX);
    const done = (code) => { clearTimeout(late); r({ code: code ?? 1, log: log.slice(-6000) }); };
    p.on('error', (e) => { log += `\nThe update could not start: ${e.message}`; done(1); }); // without this, a failed start is an uncaught error
    p.on('close', done);
  });
}
