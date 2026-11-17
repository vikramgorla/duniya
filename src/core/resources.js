// @ts-check
// Small-server guardrails (043, issue #48). A 1 GB / 1 vCPU VM (OCI E2.1.Micro, Google e2-micro) must never fall over
// because of optional features. This module knows how big the server is, how much memory is free and how much the app
// itself uses, and gives the rest of the app three tools:
//  - serverSize(): RAM (incl. a Docker/cgroup limit), free memory, CPUs and a size class (small | medium | large);
//  - localEngineCheck(): may an on-server engine (speech, any local model) run here, and right now?
//  - runJob(): a concurrency limit and per-call timeouts for heavy work inside media jobs (downloads, ffmpeg,
//    transcription, image creation). Waiting and "nobody has to resend" are handled by the persisted queue in
//    media-queue.js, which bounds how much work can pile up;
//  - optionalPaused(): true while the app's own memory is above the soft limit (70 % of RAM): background summaries,
//    on-server engines and image creation wait; WhatsApp and replies keep running. Logged once per episode.
import { getSetting, updateSettings } from './store.js';
import os from 'node:os';
import { readFileSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { activity } from './events.js';

const MB = 1024 * 1024;
export const LOCAL_MIN_TOTAL_MB = 2048; // on-server engines need at least this much RAM in total
export const LOCAL_MIN_FREE_MB = 600; // … and this much free before each job
export const SOFT_LIMIT = 0.7; // app RSS above 70 % of RAM pauses optional work

const readNum = (file) => { try { const v = readFileSync(file, 'utf8').trim(); return v === 'max' ? Infinity : Number(v); } catch { return NaN; } };

/** Docker / systemd memory limit (cgroup v2, then v1) in MB, or null when none is set. */
export function cgroupLimitMb() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    const v = readNum(f);
    if (Number.isFinite(v) && v > 0 && v < 2 ** 60) return Math.round(v / MB);
  }
  return null;
}
/** MemAvailable from /proc/meminfo (what can be used without swapping), else os.freemem(). */
function availableMbReal() {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch { /* not Linux */ }
  return Math.round(os.freemem() / MB);
}
function cgroupUsedMb() {
  const v = readNum('/sys/fs/cgroup/memory.current');
  return Number.isFinite(v) ? Math.round(v / MB) : null;
}

// Tests replace the probe with fake values (setResourceProbe({ totalMb: 1000, availableMb: 200, cpus: 1, rssMb: 800 })).
const realProbe = () => {
  const limit = cgroupLimitMb();
  const total = Math.round(os.totalmem() / MB);
  let available = availableMbReal();
  if (limit && limit < total) { const used = cgroupUsedMb(); if (used != null) available = Math.min(available, Math.max(0, limit - used)); }
  return { totalMb: total, cgroupLimitMb: limit, availableMb: available, cpus: os.availableParallelism?.() || os.cpus().length || 1, rssMb: Math.round(process.memoryUsage().rss / MB) };
};
let probe = realProbe;
export function setResourceProbe(fake) { probe = fake ? () => ({ ...realProbe(), ...(typeof fake === 'function' ? fake() : fake) }) : realProbe; resetQueue(); }

/** { totalMb, cgroupLimitMb, effectiveMb, availableMb, cpus, rssMb, size, softLimitMb, pressure } */
export function serverSize() {
  const p = probe();
  const effective = p.cgroupLimitMb && p.cgroupLimitMb < p.totalMb ? p.cgroupLimitMb : p.totalMb;
  const size = effective < 2048 || p.cpus <= 1 ? 'small' : effective >= 8192 && p.cpus >= 4 ? 'large' : 'medium';
  const softLimitMb = Math.round(effective * SOFT_LIMIT);
  return { totalMb: p.totalMb, cgroupLimitMb: p.cgroupLimitMb || null, effectiveMb: effective, availableMb: p.availableMb, cpus: p.cpus, rssMb: p.rssMb,
    size, softLimitMb, pressure: p.rssMb > softLimitMb };
}
export const SIZE_TEXT = { small: 'Small server', medium: 'Medium server', large: 'Large server' };

// ---------- memory pressure: pause optional work ----------
let paused = false;
const pressureListeners = new Set();
/** fn(true) when memory gets tight, fn(false) when it is back to normal (local tool services stop on small servers). */
export const onMemoryPressure = (fn) => pressureListeners.add(fn);
/** True while the app uses more than the soft limit: optional work (summaries, on-server engines, image creation) waits. */
export function optionalPaused() {
  const s = serverSize();
  if (s.pressure !== paused) {
    paused = s.pressure;
    for (const fn of pressureListeners) { try { fn(paused); } catch { /* never crash on bookkeeping */ } }
    activity('system', { summary: paused
      ? `Memory is tight (app uses ${s.rssMb} MB of ${s.effectiveMb} MB): optional work paused — summaries, on-server speech, image creation${s.size === 'small' ? ', local tool services' : ''}. Replies continue.`
      : `Memory is back to normal (${s.rssMb} MB): optional work resumed.` });
  }
  return paused;
}
let watcher = null;
/** Check memory every 30 s so the pause/resume entry appears even when nothing optional is asked for. */
export function startResourceWatch() {
  if (watcher) return;
  watcher = setInterval(() => { try { optionalPaused(); } catch { /* never crash on bookkeeping */ } }, 30000);
  watcher.unref?.();
}

// ---------- on-server engines ----------
/**
 * May an on-server engine run? { ok, reason }. `forEnable`: only the RAM size matters (switching it on);
 * otherwise also free memory and memory pressure right now (before each job).
 */
export const SMALL_MODE_MIN_TOTAL_MB = 900; // a "1 GB" VM reports roughly 950–990 MB
export const SMALL_MODE_HEADROOM_MB = 150; // free memory kept beyond what the engine itself needs
// ---------- Small server mode (055): one server-wide switch ----------
/**
 * Owner's opt-in (Settings → Server → Small server mode) to allow heavier features on a small server anyway: on-server
 * speech and local tool services, each with its own extra guards. One setting for every path.
 */
export const SMALL_MODE_HINT = 'or switch on Small server mode in Settings → Server';
export const smallServerMode = () => { try { return !!getSetting('smallServerMode', false); } catch { return false; } };
export const setSmallServerMode = (on) => updateSettings({ smallServerMode: !!on }).smallServerMode;
/**
 * The shared small-server gate: { ok, small, mode, code, reason }. Not small → ok. Small → ok only with Small server
 * mode on (`mode: true`, so callers apply their own extra limits). The refusal names the alternative and the switch.
 */
export function smallServerCheck({ what, alternative }) {
  const s = serverSize();
  if (s.size !== 'small') return { ok: true, small: false, mode: false };
  if (smallServerMode()) return { ok: true, small: true, mode: true };
  return { ok: false, small: true, mode: false, code: 'small_server',
    reason: `This is a small server (${s.effectiveMb} MB memory, ${s.cpus} CPU): ${what}. ${alternative}, ${SMALL_MODE_HINT}.` };
}
export function localEngineCheck({ forEnable = false, needMb = LOCAL_MIN_FREE_MB } = {}) {
  const s = serverSize();
  let need = needMb;
  if (s.effectiveMb < LOCAL_MIN_TOTAL_MB) {
    if (!smallServerMode()) {
      return { ok: false, code: 'too_small', reason: `This server has ${s.effectiveMb} MB of memory; on-server speech normally needs ${LOCAL_MIN_TOTAL_MB} MB. Use a provider (OpenAI or OpenRouter under Models), ${SMALL_MODE_HINT} to try it anyway (slow, one voice note at a time).` };
    }
    if (s.effectiveMb < SMALL_MODE_MIN_TOTAL_MB) {
      return { ok: false, code: 'too_small', reason: `This server has only ${s.effectiveMb} MB of memory — too little for on-server speech even in small server mode. Use a provider instead.` };
    }
    need = Math.max(needMb + SMALL_MODE_HEADROOM_MB, 500); // small server mode: only when there is clearly room right now
  }
  if (forEnable) return { ok: true, small: s.effectiveMb < LOCAL_MIN_TOTAL_MB };
  if (paused || s.pressure) return { ok: false, code: 'pressure', reason: 'Memory is tight right now, so on-server speech is paused.' };
  if (s.availableMb < need) return { ok: false, code: 'low_memory', reason: `Only ${s.availableMb} MB of memory is free right now (needs ${need} MB).` };
  return { ok: true };
}
/** How many local tool services (stdio processes) may run at once. */
export const maxLocalServices = () => ({ small: 2, medium: 6, large: 12 })[serverSize().size];

// ---------- heavy-call limiter ----------
const limits = () => ({ small: { run: 1 }, medium: { run: 2 }, large: { run: 3 } })[serverSize().size];
let running = 0;
let waiting = [];
function resetQueue() { running = 0; waiting = []; }
function next() {
  const lim = limits();
  while (running < lim.run && waiting.length) { const w = waiting.shift(); running++; w(); }
}
/**
 * Run one heavy call with the server's concurrency limit (it waits its turn). Throws { code: 'timeout' } when it
 * takes longer than timeoutMs (the call's own cleanup still runs).
 */
export async function runJob(name, fn, { timeoutMs = 120000 } = {}) {
  const lim = limits();
  if (running >= lim.run) await new Promise((res) => waiting.push(res));
  else running++;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`${name} took too long`), { code: 'timeout' })), timeoutMs); timer.unref?.(); }),
    ]);
  } finally {
    clearTimeout(timer);
    running = Math.max(0, running - 1);
    next();
  }
}
export const queueState = () => ({ running, waiting: waiting.length, ...limits() });

// ---------- low-priority child processes ----------
const has = new Map();
/** Is `cmd` on the PATH? Found: cached. Missing: checked again after a minute (the installer may add it later). */
export function hasCommand(cmd) {
  const hit = has.get(cmd);
  if (hit === true || (hit && Date.now() - hit < 60000)) return hit === true;
  const found = String(process.env.PATH || '/usr/local/bin:/usr/bin:/bin').split(':').some((d) => {
    try { accessSync(join(d || '.', cmd), constants.X_OK); return true; } catch { return false; }
  });
  has.set(cmd, found ? true : Date.now());
  return found;
}
/**
 * [command, args] that runs `cmd` at low CPU priority (nice) and, for native tools like ffmpeg, with a virtual
 * memory cap (ulimit -v). Not used for Node children: V8 reserves far more address space than it uses.
 */
export function lowPriority(cmd, args, { memMb = 0 } = {}) {
  // No shell: `prlimit` caps the address space and `nice` lowers the priority, each exec'ing the next program.
  let out = [cmd, args];
  if (hasCommand('nice')) out = ['nice', ['-n', '10', out[0], ...out[1]]];
  if (memMb && hasCommand('prlimit')) out = ['prlimit', [`--as=${Math.round(memMb * 1024 * 1024)}`, '--', out[0], ...out[1]]];
  return out;
}
