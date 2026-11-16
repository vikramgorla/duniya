// Server metrics and maintenance (011). Read-only metrics come from /proc and standard tools (no root needed).
// Maintenance (OS updates, reboot, restarting services) is done by a root-owned helper installed by install.sh:
// the app writes one action word to a request file; a systemd path unit runs the helper, which accepts only a
// fixed list of actions and writes its status/log to a root-owned directory the app can read.
import os from 'node:os';
import { readFileSync, existsSync, writeFileSync, statfsSync, statSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { DATA_DIR, ROOT, plural } from './config.js';
import { getSetting, updateSettings } from './store.js';
import { activity } from './events.js';

const OPS_REQUEST_DIR = process.env.DUNIYA_OPS_REQUEST_DIR || '/var/lib/duniya/ops-request';
export const OPS_STATE_DIR = process.env.DUNIYA_OPS_STATE_DIR || '/var/lib/duniya-ops';
const OPS_HELPER = process.env.DUNIYA_OPS_HELPER || '/usr/local/sbin/duniya-ops';
const OPS_ACTIONS = {
  'os-update': 'Install OS updates',
  'os-update-all': 'Install OS updates, including gradual ones',
  'os-cleanup': 'Remove unused packages (apt autoremove)',
  'restart-web': 'Restart the web server (Caddy)',
  'restart-tunnel': 'Restart the Cloudflare tunnel',
  reboot: 'Reboot the server',
  'apply-web-config': 'Apply the web address & access settings',
  'update-helper': 'Update the maintenance helper',
};
// 031: the root-owned copy of deploy/ops/webconfig.mjs the helper runs (present once the installer ran with 031).
export const OPS_WEBCONFIG = process.env.DUNIYA_OPS_WEBCONFIG || '/usr/local/lib/duniya-ops/webconfig.mjs';
const LOG_UNITS = ['whatsapp-agent-duniya', 'caddy', 'cloudflared', 'duniya-ops'];

const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const run = (cmd, args, timeout = 20000) => new Promise((res) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => res({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
});

// ---------- hosting (#56): which guide the panel's "Hosting help" card opens ----------
// Docker from the install kind; Oracle Cloud and Google Cloud from the VM's DMI strings (world-readable, no root):
// OCI sets chassis_asset_tag "OracleCloud.com", Compute Engine sets product_name "Google Compute Engine".
// DUNIYA_HOST (oci | gcp | other) overrides the guess.
const HOSTS = ['oci', 'gcp', 'docker', 'server'];
export function detectHosting({ env = process.env, dmiDir = env.DUNIYA_DMI_DIR || '/sys/class/dmi/id' } = {}) {
  const install = env.DUNIYA_INSTALL || 'unknown';
  const override = String(env.DUNIYA_HOST || '').toLowerCase();
  if (HOSTS.includes(override)) return { provider: override, install, detected: false };
  if (override === 'other') return { provider: 'server', install, detected: false };
  if (install === 'docker') return { provider: 'docker', install, detected: true };
  const dmi = (f) => read(`${dmiDir}/${f}`).trim();
  if (dmi('chassis_asset_tag') === 'OracleCloud.com') return { provider: 'oci', install, detected: true };
  if (dmi('product_name') === 'Google Compute Engine' || dmi('sys_vendor') === 'Google') return { provider: 'gcp', install, detected: true };
  return { provider: install === 'systemd' ? 'server' : 'unknown', install, detected: false };
}

// ---------- metrics ----------
let lastCpu = null;
function cpuPercent() {
  const line = read('/proc/stat').split('\n')[0];
  if (!line.startsWith('cpu ')) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = n[3] + (n[4] || 0); const total = n.reduce((a, b) => a + b, 0);
  const prev = lastCpu; lastCpu = { idle, total };
  if (!prev || total === prev.total) return null;
  return Math.max(0, Math.min(100, Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 1000) / 10));
}
function meminfo() {
  const m = Object.fromEntries(read('/proc/meminfo').split('\n').filter(Boolean).map((l) => { const [k, v] = l.split(':'); return [k, parseInt(v, 10) * 1024]; }));
  const total = m.MemTotal || os.totalmem(); const available = m.MemAvailable ?? os.freemem();
  return { total, used: total - available, available, swapTotal: m.SwapTotal || 0, swapUsed: (m.SwapTotal || 0) - (m.SwapFree || 0) };
}
function disk(path) {
  try { const s = statfsSync(path); const total = s.blocks * s.bsize; const free = s.bavail * s.bsize; return { path, total, used: total - free, free }; } catch { return null; }
}
let lastNet = null;
function network() {
  let rx = 0; let tx = 0;
  for (const l of read('/proc/net/dev').split('\n').slice(2)) {
    const [name, rest] = l.split(':'); if (!rest || name.trim() === 'lo') continue;
    const f = rest.trim().split(/\s+/).map(Number); rx += f[0]; tx += f[8];
  }
  const now = Date.now(); const prev = lastNet; lastNet = { rx, tx, now };
  const dt = prev ? (now - prev.now) / 1000 : 0;
  return { rx, tx, rxRate: dt > 0 ? Math.max(0, (rx - prev.rx) / dt) : 0, txRate: dt > 0 ? Math.max(0, (tx - prev.tx) / dt) : 0 };
}
const osRelease = () => (read('/etc/os-release').match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1] || `${os.type()} ${os.release()}`;

const history = []; // { t, cpu, mem, swap, disk, rx, tx } every 30 s, 6 h
function sample() {
  const m = meminfo(); const d = disk('/'); const n = network(); const cpu = cpuPercent();
  history.push({ t: Date.now(), cpu: cpu ?? 0, mem: m.used / m.total * 100, swap: m.swapTotal ? m.swapUsed / m.swapTotal * 100 : 0, disk: d ? d.used / d.total * 100 : 0, rx: n.rxRate, tx: n.txRate });
  if (history.length > 720) history.shift();
}
/**
 * 056: after an app update (the app restarts on the new version), ask the root helper to update itself when it is
 * older than the one this release ships and can do that. Once per app version, so a failing fetch does not repeat.
 */
export function maybeUpdateHelper({ by = 'auto (after app update)', bundled = opsHelperBundled() } = {}) {
  if (!opsAvailable()) return { requested: false, reason: 'no helper' };
  const installed = opsHelperVersion();
  const v = appVersion();
  if (!(installed < bundled)) return { requested: false, reason: 'current' };
  if (installed < OPS_HELPER_SELF_UPDATE) return { requested: false, reason: 'too_old' };
  if (getSetting('opsHelperAuto', null)?.version === v) return { requested: false, reason: 'already tried' };
  updateSettings({ opsHelperAuto: { version: v, at: Date.now() } });
  try { requestOp('update-helper', by); return { requested: true }; } catch (e) { return { requested: false, reason: e.message }; }
}

export function startMetrics() {
  cpuPercent(); network();
  setTimeout(sample, 2000).unref();
  setInterval(sample, 30000).unref();
  // #96: check OS updates in the background now and then, so the Server tab badge is right without opening the page
  // (apt's simulation is short-lived; on a small server it runs at most twice a day).
  const check = () => osUpdates().catch(() => {});
  setTimeout(check, 5 * 60000).unref();
  setTimeout(() => { try { maybeUpdateHelper(); } catch { /* never crash on bookkeeping */ } }, 30000).unref();
  setInterval(check, 12 * 3600000).unref();
}

export async function snapshot() {
  const m = meminfo();
  const services = {};
  if (existsSync('/run/systemd/system')) {
    const r = await run('systemctl', ['is-active', 'whatsapp-agent-duniya', 'caddy', 'cloudflared'], 5000);
    const states = r.out.trim().split('\n');
    ['whatsapp-agent-duniya', 'caddy', 'cloudflared'].forEach((s, i) => { services[s] = states[i] || 'unknown'; });
  }
  const last = history.at(-1);
  return {
    host: os.hostname(), os: osRelease(), kernel: os.release(), arch: os.arch(), cpus: os.cpus().length,
    uptimeSec: Math.round(os.uptime()), load: os.loadavg().map((x) => Math.round(x * 100) / 100),
    cpu: last?.cpu ?? null, memory: m, disks: [disk('/'), DATA_DIR.startsWith('/') && disk(DATA_DIR)].filter(Boolean).filter((d, i, a) => a.findIndex((x) => x.total === d.total && x.used === d.used) === i),
    network: lastNet ? { rx: lastNet.rx, tx: lastNet.tx, rxRate: last?.rx ?? 0, txRate: last?.tx ?? 0 } : null,
    app: { rss: process.memoryUsage().rss, pid: process.pid, node: process.version },
    services, ...(() => { const r = rebootStatus(); return { rebootRequired: r.required, rebootPackages: r.packages, reboot: r }; })(),
    ops: opsAvailable(),
    hosting: detectHosting(),
  };
}
export const metricsHistory = () => history;

// ---------- OS updates (simulation; no root needed) ----------
// #96: the helper installs with `apt-get full-upgrade` (so kept-back kernel meta-packages install) and respects Ubuntu's
// phased updates unless the owner asks for them now (`os-update-all`). The check below simulates the same command and
// sorts packages into three groups: will install, rolling out gradually (phased) and held back (with a reason).
// A simulation as the app user may ignore phasing (apt treats it like a chroot), so phasing also comes from
// `apt-cache policy` ("(phased 20%)" next to the candidate). Security updates are never phased.
// The parsers are pure and tested on captured outputs (test/fixtures/apt/), including apt 3's new layout.
const LIST_HEADERS = [
  [/^The following upgrades have been deferred due to phasing:$/, 'phased'], [/^Not upgrading yet due to phasing:$/, 'phased'],
  [/^The following packages have been kept back:$/, 'keptBack'], [/^Not upgrading:$/, 'keptBack'],
  [/^The following NEW packages will be installed:$/, 'new'], [/^Installing(?: dependencies)?:$/, 'new'],
  [/^The following packages will be upgraded:$/, 'upgrade'], [/^Upgrading:$/, 'upgrade'],
  [/^The following packages will be REMOVED:$/, 'remove'], [/^REMOVING:$/, 'remove'],
];
const PKG = /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?$/;
const uniq = (a) => [...new Set(a)];
/** Package lists and the summary line from apt-get output (apt 2 and apt 3 layouts). */
export function parseAptLists(text = '') {
  const out = { phased: [], keptBack: [], new: [], upgrade: [], remove: [], summary: null };
  let cur = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const head = LIST_HEADERS.find(([re]) => re.test(line.trim()) && !/^\s/.test(line));
    if (head) { cur = head[1]; continue; }
    if (cur && /^\s+\S/.test(line)) {
      // names only: drop "(old => new)" version notes (apt 3 with -V) and the "*" apt adds to purged packages
      out[cur].push(...line.replace(/\([^)]*\)/g, ' ').split(/\s+/).map((w) => w.replace(/\*$/, '')).filter((w) => PKG.test(w)));
      continue;
    }
    cur = null;
    const m = line.match(/^(\d+) upgraded, (\d+) newly installed, (\d+) to remove and (\d+) not upgraded\./);
    if (m) { out.summary = { upgraded: +m[1], installed: +m[2], removed: +m[3], notUpgraded: +m[4] }; continue; }
    if (/^\s*Upgrading: \d+, /.test(line)) { // apt 3: "Upgrading: 2, Installing: 0, Removing: 0, Not Upgrading: 2"
      const kv = Object.fromEntries(line.trim().split(/,\s*/).map((p) => p.split(/:\s*/)).map(([k, v]) => [k.toLowerCase(), Number(v) || 0]));
      out.summary = { upgraded: kv.upgrading || 0, installed: (kv.installing || 0) + (kv['installing dependencies'] || 0), removed: kv.removing || 0, notUpgraded: kv['not upgrading'] || 0 };
    }
  }
  for (const k of ['phased', 'keptBack', 'new', 'upgrade', 'remove']) out[k] = uniq(out[k]);
  return out;
}
/** `apt-get -s full-upgrade` → lists + the Inst lines ({ name, from, to, security, isNew }). */
export function parseAptSimulation(text = '') {
  const lists = parseAptLists(text);
  const inst = String(text).split('\n').filter((l) => l.startsWith('Inst ')).map((l) => {
    const m = l.match(/^Inst (\S+) (?:\[([^\]]+)\] )?\((\S+) ([^)]*)\)/);
    return m ? { name: m[1], from: m[2] || '', to: m[3], security: /-security\b/i.test(m[4]), isNew: !m[2] } : { name: l.split(' ')[1], from: '', to: '', security: false, isNew: false };
  });
  return { ...lists, inst };
}
/** `apt-cache policy a b c` → { name: { installed, candidate, phased: percent | null } }. */
export function parseAptPolicy(text = '') {
  const out = {}; let cur = null;
  for (const line of String(text).split('\n')) {
    const head = line.match(/^(\S+):$/);
    if (head) { cur = out[head[1]] = { installed: '', candidate: '', phased: null }; continue; }
    if (!cur) continue;
    const kv = line.match(/^\s+(Installed|Candidate): (\S+)/);
    if (kv) { cur[kv[1].toLowerCase()] = kv[2] === '(none)' ? '' : kv[2]; continue; }
    const ver = line.match(/^\s+(?:\*\*\* )?(\S+) -?\d+(?: \(phased (\d+)%\))?$/);
    if (ver && ver[1] === cur.candidate && ver[2] !== undefined) cur.phased = Number(ver[2]);
  }
  return out;
}
/** Sort a simulation into the three groups the Server page shows. */
export function classifyUpdates(sim, policy = {}, holds = []) {
  const install = []; const phased = []; const held = [];
  const seen = new Set();
  for (const p of sim.inst) {
    seen.add(p.name);
    const pct = policy[p.name]?.phased;
    if (sim.phased.includes(p.name) || (!p.isNew && !p.security && pct != null)) phased.push({ ...p, phased: pct ?? null });
    else install.push(p);
  }
  const ver = (n) => ({ from: policy[n]?.installed || '', to: policy[n]?.candidate || '' });
  for (const n of sim.phased) if (!seen.has(n)) phased.push({ name: n, ...ver(n), security: false, isNew: false, phased: policy[n]?.phased ?? null });
  for (const n of sim.keptBack) {
    if (seen.has(n)) continue;
    const onHold = holds.includes(n);
    held.push({ name: n, ...ver(n), reason: onHold ? 'hold' : 'dependencies',
      why: onHold ? 'On hold (apt-mark hold): unhold it to update' : 'Needs a dependency change apt will not make automatically' });
  }
  return { install, phased, held };
}
/** Summary of the last os-update run from the helper's log (step markers "== step: …"). */
export function parseAptRun(log = '') {
  const steps = {}; let cur = '';
  for (const line of String(log).split('\n')) {
    const m = line.match(/^== step: ([a-z-]+)$/);
    if (m) { cur = m[1]; steps[cur] = ''; continue; }
    if (cur) steps[cur] += `${line}\n`;
  }
  const up = parseAptLists(steps['full-upgrade'] ?? steps.upgrade ?? (cur ? '' : log));
  const rm = parseAptLists(steps.autoremove || '');
  const code = Number((String(log).match(/^== finished with code (\d+)/m) || [])[1] ?? NaN);
  const s = up.summary;
  return {
    installed: s ? s.upgraded : null, newPackages: s ? s.installed : null, removed: rm.summary ? rm.summary.removed : 0,
    phased: up.phased, keptBack: up.keptBack, failed: Number.isFinite(code) && code !== 0,
    rebootRequired: /A reboot is required/.test(log), phasedIncluded: /Always-Include-Phased-Updates=true/.test(log),
  };
}
/** One line for people: "Installed 3 updates · 1 rolling out gradually · restart needed". */
export function runSummaryText(r, { rebootRequired = r?.rebootRequired } = {}) {
  if (!r || r.installed == null) return '';
  const parts = [r.failed ? 'Did not finish' : r.installed || r.newPackages ? `Installed ${plural(r.installed, 'update')}` : 'Nothing new to install'];
  if (r.newPackages) parts.push(`${plural(r.newPackages, 'new package')}`);
  if (r.removed) parts.push(`${plural(r.removed, 'old package')} removed`);
  if (r.phased.length) parts.push(`${r.phased.length} rolling out gradually`);
  if (r.keptBack.length) parts.push(`${r.keptBack.length} held back`);
  if (rebootRequired) parts.push('restart needed');
  return parts.join(' · ');
}

const fakeApt = () => process.env.DUNIYA_FAKE_APT || ''; // tests and the demo panel: captured outputs instead of apt
const aptRun = async (name, cmd, args, timeout) => {
  if (fakeApt()) return { ok: true, out: read(`${fakeApt()}/${name}.txt`), err: '' };
  return run(cmd, args, timeout);
};
let updCache = null;
export async function osUpdates({ refresh = false } = {}) {
  if (!refresh && updCache && Date.now() - updCache.at < 30 * 60000) return updCache;
  if (!fakeApt() && !existsSync('/usr/bin/apt-get')) return (updCache = { at: Date.now(), supported: false, install: [], phased: [], held: [], count: 0, security: 0 });
  const r = await aptRun('simulate', 'apt-get', ['-s', '-o', 'Debug::NoLocking=1', 'full-upgrade'], 60000);
  const sim = parseAptSimulation(r.out);
  const names = uniq([...sim.inst.filter((p) => !p.isNew).map((p) => p.name), ...sim.phased, ...sim.keptBack]).filter((n) => PKG.test(n)).slice(0, 300);
  const policy = names.length ? parseAptPolicy((await aptRun('policy', 'apt-cache', ['policy', ...names], 30000)).out) : {};
  const holds = sim.keptBack.length ? (await aptRun('holds', 'apt-mark', ['showhold'], 10000)).out.split('\n').map((x) => x.trim()).filter(Boolean) : [];
  const g = classifyUpdates(sim, policy, holds);
  const upgrades = g.install.filter((p) => !p.isNew);
  updCache = {
    at: Date.now(), supported: true, ...g,
    count: upgrades.length, security: upgrades.filter((p) => p.security).length, newPackages: g.install.length - upgrades.length,
    error: r.ok ? undefined : r.err.split('\n')[0],
  };
  return updCache;
}
/** The last check without running apt (for the Server tab badge); null before the first check. */
export const osUpdatesCached = () => (updCache?.supported ? { count: updCache.count, security: updCache.security, at: updCache.at } : null);

// ---------- restart needed (#96) ----------
const REBOOT_FILE = () => process.env.DUNIYA_REBOOT_REQUIRED_FILE || '/var/run/reboot-required';
/** { required, since, packages, kernel } from /var/run/reboot-required(.pkgs). */
export function rebootStatus() {
  const f = REBOOT_FILE();
  let since;
  try { since = statSync(f).mtimeMs; } catch { return { required: false, since: null, packages: [], kernel: false }; }
  const packages = uniq(read(`${f}.pkgs`).split('\n').map((x) => x.trim()).filter(Boolean));
  return { required: true, since, packages, kernel: packages.some((p) => /^linux-(image|base)/.test(p)) };
}

// ---------- logs ----------
export async function logs(unit, lines = 200) {
  if (!LOG_UNITS.includes(unit)) throw Object.assign(new Error('Unknown service'), { status: 400 });
  const n = Math.max(10, Math.min(1000, Number(lines) || 200));
  const r = await run('journalctl', ['-u', unit, '-n', String(n), '--no-pager', '-o', 'short-iso'], 15000);
  if (!r.ok || /No journal files|insufficient permissions|not seeing messages/i.test(r.err + r.out)) {
    return { unit, lines: [], note: 'Logs are not readable yet. Re-run the installer once (it adds the app to the systemd-journal group).' };
  }
  return { unit, lines: r.out.split('\n').filter(Boolean).slice(-n) };
}

// ---------- maintenance via the root helper ----------
export function opsAvailable() {
  return existsSync(OPS_HELPER) && existsSync(OPS_REQUEST_DIR);
}
// #96: the installed helper says which version it is ("# duniya-ops-version: N"). The in-panel app update runs as
// the app user and cannot replace the root-owned helper, so features that need a newer one check this first.
const OPS_HELPER_NEEDED = 2;
// 056: from this version on the helper can replace itself with the one of a release (action update-helper).
const OPS_HELPER_SELF_UPDATE = 3;
const helperVersionOf = (text) => { const m = String(text).slice(0, 4096).match(/^# duniya-ops-version: (\d+)$/m); return m ? Number(m[1]) : 0; };
function opsHelperVersion() {
  return helperVersionOf(read(OPS_HELPER)) || (existsSync(OPS_HELPER) ? 1 : 0);
}
/** The helper version this app release ships (deploy/ops/duniya-ops in the app's checkout; read, never run). */
const opsHelperBundled = () => helperVersionOf(read(`${ROOT}/deploy/ops/duniya-ops`));
export const appVersion = () => { try { return `v${JSON.parse(read(`${ROOT}/package.json`)).version}`; } catch { return ''; } };
const RELEASE_RE = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export function opsStatus() {
  let status = null;
  try { status = JSON.parse(read(`${OPS_STATE_DIR}/status.json`) || 'null'); } catch { /* none */ }
  const full = read(`${OPS_STATE_DIR}/last.log`);
  const reboot = rebootStatus();
  let result = null;
  if (status && /^os-update/.test(status.action) && status.state !== 'running') {
    const r = parseAptRun(full);
    result = { ...r, rebootRequired: reboot.required, text: runSummaryText(r, { rebootRequired: reboot.required }) };
  }
  const helperVersion = opsHelperVersion();
  const helperBundled = opsHelperBundled();
  return { available: opsAvailable(), actions: OPS_ACTIONS, status, result, reboot, helperVersion, helperCurrent: helperVersion >= OPS_HELPER_NEEDED,
    // 056: older than this release's helper? Then either the panel can update it (selfUpdate) or root must run once.
    helperBundled, helperOutdated: !!helperVersion && helperVersion < helperBundled, helperSelfUpdate: helperVersion >= OPS_HELPER_SELF_UPDATE,
    log: full.split('\n').slice(-120).join('\n') };
}
export function requestOp(action, by = '', { files = {} } = {}) {
  if (!OPS_ACTIONS[action]) throw Object.assign(new Error('Unknown action'), { status: 400 });
  if (!opsAvailable()) throw Object.assign(new Error('Server maintenance is not set up on this install. Re-run the installer once (or redeploy) to enable it.'), { status: 400 });
  if (action === 'os-update-all' && opsHelperVersion() < OPS_HELPER_NEEDED) {
    throw Object.assign(new Error('Including gradual updates needs the newer maintenance helper: run sudo duniya update on the server (or re-run the installer) once.'), { status: 400 });
  }
  if (action === 'update-helper') {
    if (opsHelperVersion() < OPS_HELPER_SELF_UPDATE) {
      throw Object.assign(new Error('This server\'s maintenance helper is too old to update itself: run sudo duniya update on the server once, or reinstall if you have no SSH access. After that it updates itself.'), { status: 400, code: 'helper_too_old' });
    }
    const v = appVersion();
    if (!RELEASE_RE.test(v)) throw Object.assign(new Error('The app version is not a release number'), { status: 400 });
    files = { ...files, 'helper-version': `${v}\n` }; // the helper accepts only vX.Y.Z and fetches that release itself
  }
  const cur = opsStatus().status;
  if (cur?.state === 'running' && Date.now() - (cur.startedAt || 0) < 60 * 60000) throw Object.assign(new Error(`Already running: ${cur.action}`), { status: 409 });
  mkdirSync(OPS_REQUEST_DIR, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(`${OPS_REQUEST_DIR}/${name}`, content, { mode: 0o640 }); // read by the helper
  writeFileSync(`${OPS_REQUEST_DIR}/request`, `${action}\n`);
  updCache = null;
  activity('system', { summary: `${OPS_ACTIONS[action]} requested${by ? ` by ${by}` : ''}` });
  return { ok: true };
}
