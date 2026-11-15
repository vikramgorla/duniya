// Server metrics and maintenance (011). Read-only metrics come from /proc and standard tools (no root needed).
// Maintenance (OS updates, reboot, restarting services) is done by a root-owned helper installed by install.sh:
// the app writes one action word to a request file; a systemd path unit runs the helper, which accepts only a
// fixed list of actions and writes its status/log to a root-owned directory the app can read.
import os from 'node:os';
import { readFileSync, existsSync, writeFileSync, statfsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { DATA_DIR } from './config.js';
import { activity } from './events.js';

export const OPS_REQUEST_DIR = process.env.DUNIYA_OPS_REQUEST_DIR || '/var/lib/duniya/ops-request';
export const OPS_STATE_DIR = process.env.DUNIYA_OPS_STATE_DIR || '/var/lib/duniya-ops';
export const OPS_HELPER = process.env.DUNIYA_OPS_HELPER || '/usr/local/sbin/duniya-ops';
export const OPS_ACTIONS = {
  'os-update': 'Install OS updates (apt upgrade)',
  'os-cleanup': 'Remove unused packages (apt autoremove)',
  'restart-web': 'Restart the web server (Caddy)',
  'restart-tunnel': 'Restart the Cloudflare tunnel',
  reboot: 'Reboot the server',
  'apply-web-config': 'Apply the web address & access settings',
};
// 031: the root-owned copy of deploy/ops/webconfig.mjs the helper runs (present once the installer ran with 031).
export const OPS_WEBCONFIG = process.env.DUNIYA_OPS_WEBCONFIG || '/usr/local/lib/duniya-ops/webconfig.mjs';
export const LOG_UNITS = ['whatsapp-agent-duniya', 'caddy', 'cloudflared', 'duniya-ops'];

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
export function startMetrics() {
  cpuPercent(); network();
  setTimeout(sample, 2000).unref();
  setInterval(sample, 30000).unref();
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
    services, rebootRequired: existsSync('/var/run/reboot-required'),
    rebootPackages: read('/var/run/reboot-required.pkgs').split('\n').filter(Boolean),
    ops: opsAvailable(),
    hosting: detectHosting(),
  };
}
export const metricsHistory = () => history;

// ---------- OS updates (simulation; no root needed) ----------
let updCache = null;
export async function osUpdates({ refresh = false } = {}) {
  if (!refresh && updCache && Date.now() - updCache.at < 30 * 60000) return updCache;
  if (!existsSync('/usr/bin/apt-get')) return (updCache = { at: Date.now(), supported: false, packages: [], security: 0 });
  const r = await run('apt-get', ['-s', '-o', 'Debug::NoLocking=1', 'upgrade'], 60000);
  const packages = r.out.split('\n').filter((l) => l.startsWith('Inst ')).map((l) => {
    const m = l.match(/^Inst (\S+) (?:\[([^\]]+)\] )?\((\S+) ([^)]*)\)/);
    return m ? { name: m[1], from: m[2] || '', to: m[3], security: /security/i.test(m[4]) } : { name: l.split(' ')[1], from: '', to: '', security: false };
  });
  updCache = { at: Date.now(), supported: true, packages, security: packages.filter((p) => p.security).length, error: r.ok ? undefined : r.err.split('\n')[0] };
  return updCache;
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
export function opsStatus() {
  let status = null;
  try { status = JSON.parse(read(`${OPS_STATE_DIR}/status.json`) || 'null'); } catch { /* none */ }
  return { available: opsAvailable(), actions: OPS_ACTIONS, status, log: read(`${OPS_STATE_DIR}/last.log`).split('\n').slice(-120).join('\n') };
}
export function requestOp(action, by = '', { files = {} } = {}) {
  if (!OPS_ACTIONS[action]) throw Object.assign(new Error('Unknown action'), { status: 400 });
  if (!opsAvailable()) throw Object.assign(new Error('Server maintenance is not set up on this install. Re-run the installer once (or redeploy) to enable it.'), { status: 400 });
  const cur = opsStatus().status;
  if (cur?.state === 'running' && Date.now() - (cur.startedAt || 0) < 60 * 60000) throw Object.assign(new Error(`Already running: ${cur.action}`), { status: 409 });
  mkdirSync(OPS_REQUEST_DIR, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(`${OPS_REQUEST_DIR}/${name}`, content, { mode: 0o640 }); // read by the helper
  writeFileSync(`${OPS_REQUEST_DIR}/request`, `${action}\n`);
  updCache = null;
  activity('system', { summary: `${OPS_ACTIONS[action]} requested${by ? ` by ${by}` : ''}` });
  return { ok: true };
}
