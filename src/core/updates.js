// Updates (008): check the git remote for new releases (tags) or main, apply via deploy/update.sh, optional auto mode.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, env } from './config.js';
import { getSetting, updateSettings } from './store.js';
import { kvGet, kvSet } from './db.js';
import { activity } from './events.js';

const git = (args, cwd = ROOT) => new Promise((res, rej) => execFile('git', args, { cwd, timeout: 60000 }, (e, out, err) => (e ? rej(new Error((err || e.message).trim())) : res(out.trim()))));

export function installKind() {
  if (process.env.DUNIYA_INSTALL) return process.env.DUNIYA_INSTALL;
  return existsSync(resolve(ROOT, '.git')) ? 'dev' : 'unknown';
}

export const parseVersion = (v) => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '')); return m ? m.slice(1).map(Number) : null; };
export function compareVersions(a, b) {
  const x = parseVersion(a); const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
export const newestTag = (tags) => tags.filter((t) => parseVersion(t)).sort(compareVersions).at(-1) || null;

export function getUpdateSettings() {
  const s = getSetting('updates', {}) || {};
  return { mode: process.env.UPDATE_MODE || 'notify', channel: 'stable', at: '04:00', ...s };
}
export function setUpdateSettings(patch) {
  const next = { ...getUpdateSettings(), ...patch };
  if (!['off', 'notify', 'auto'].includes(next.mode)) throw Object.assign(new Error('mode: off, notify or auto'), { status: 400, field: 'mode' });
  if (!['stable', 'main'].includes(next.channel)) throw Object.assign(new Error('channel: stable or main'), { status: 400, field: 'channel' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.at)) throw Object.assign(new Error('at: HH:MM'), { status: 400, field: 'at' });
  updateSettings({ updates: next });
  return next;
}
const savedStatus = () => { try { return JSON.parse(kvGet('updates:status') || 'null'); } catch { return null; } };
// The version this process is running (read once at start; an update restarts the process).
export const RUNNING_VERSION = (() => { try { return `v${JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version}`; } catch { return 'unknown'; } })();

/** Last check, corrected for what is running now (a check saved before an update + restart is otherwise stale). */
export const updateStatus = () => {
  const st = savedStatus();
  if (!st) return null;
  if (st.channel === 'stable' && parseVersion(RUNNING_VERSION)) {
    const current = RUNNING_VERSION;
    return { ...st, current, available: !!(st.latest && parseVersion(st.latest) && compareVersions(current, st.latest) < 0) };
  }
  return st;
};

/** Check the remote. Returns status { current, latest, available, target, checkedAt }. */
export async function checkForUpdate({ root = ROOT, channel = getUpdateSettings().channel } = {}) {
  await git(['fetch', '-q', 'origin', '--tags', '--prune'], root);
  const head = await git(['rev-parse', 'HEAD'], root);
  let current = await git(['describe', '--tags', '--always'], root).catch(() => head.slice(0, 7));
  let latest; let target; let available;
  if (channel === 'stable') {
    const tag = newestTag((await git(['tag', '-l', 'v*'], root)).split('\n'));
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
    const exact = await git(['describe', '--tags', '--exact-match', 'HEAD'], root).catch(() => '');
    current = exact || `v${pkg}`;
    latest = tag; target = tag;
    available = !!tag && compareVersions(current, tag) < 0;
  } else {
    const remote = await git(['rev-parse', 'origin/main'], root);
    latest = remote.slice(0, 7); target = 'main';
    available = remote !== head && (await git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], root).then(() => true, () => false));
  }
  const status = { current, latest, available, target, channel, checkedAt: Date.now(), lastResult: savedStatus()?.lastResult || null };
  if (root === ROOT) kvSet('updates:status', JSON.stringify(status));
  return status;
}

/** Run deploy/update.sh <target>. Returns { code, log }. */
export function applyUpdate({ root = ROOT, target } = {}) {
  return new Promise((r) => {
    const p = spawn('bash', [resolve(root, 'deploy/update.sh'), ...(target ? [target] : [])], { cwd: root });
    let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
    p.on('close', (code) => {
      const out = { code, log: log.slice(-6000) };
      if (root === ROOT) {
        const st = savedStatus() || {};
        kvSet('updates:status', JSON.stringify({ ...st, lastResult: { at: Date.now(), ok: code === 0, target: target || 'latest', from: RUNNING_VERSION, log: out.log.slice(-1000) } }));
        activity(code === 0 ? 'system' : 'error', { summary: code === 0 ? `Updated to ${target || 'latest'}` : 'Update failed (previous version kept)', detail: out.log.slice(-2000) });
      }
      r(out);
    });
  });
}

export function startUpdateScheduler({ restart = () => process.exit(0) } = {}) {
  if (installKind() !== 'systemd') return; // docker/dev: notify only through the panel
  const tick = async () => {
    const s = getUpdateSettings();
    if (s.mode === 'off') return;
    const st = updateStatus();
    try {
      const fresh = !st || Date.now() - st.checkedAt > 6 * 3600 * 1000 ? await checkForUpdate({ channel: s.channel }) : st;
      if (s.mode !== 'auto' || !fresh.available) return;
      const now = new Date().toLocaleTimeString('en-GB', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit', hour12: false });
      const today = new Date().toISOString().slice(0, 10);
      if (now < s.at || kvGet('updates:autoDay') === today) return;
      kvSet('updates:autoDay', today);
      const r = await applyUpdate({ target: fresh.target });
      if (r.code === 0) setTimeout(restart, 1000);
    } catch (e) { activity('error', { summary: `Update check failed: ${e.message}` }); }
  };
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 10 * 60 * 1000).unref();
}
