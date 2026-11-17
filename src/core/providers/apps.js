// Agent apps (074): the official subscription apps run on the server as model providers — Claude Code (Claude
// subscription) and Codex (ChatGPT plan); GitHub Copilot's runtime shares the same rules. What this module does:
//  - on-demand install: an app is downloaded with npm into DATA_DIR/apps/<id> when the owner connects it (never at
//    install time), refused while memory or disk is short;
//  - one app at a time on small servers (2 / 3 on medium / large): a turn takes a slot from its start to its end, waits
//    its turn (up to 2 minutes) or fails over to the next model; an idle resident runtime (Copilot) is stopped to make
//    room;
//  - a memory check before every start, and a clear refusal ("needs about 250 MB free, 120 MB free now");
//  - per-turn processes: started for one turn, ended when it ends; turns the runner abandoned and idle residents are
//    stopped from the upkeep tick (no timers of their own), and at once when memory gets tight;
//  - measured memory per app (RSS of the app's process tree, sampled when it writes) and its start time.
// The turn itself (AppTurn) bridges the app's own agent loop to Duniya's one-step-per-call provider contract: tool
// calls arrive through the MCP bridge (app-bridge.js), are returned as tool_use blocks, and are answered when the
// runner's next call carries the tool_result blocks — so tools, roles and the confirm gate stay in Duniya's code.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, fail } from '../config.js';
import { serverSize, optionalPaused, onMemoryPressure, smallServerCheck } from '../resources.js';
import { netEnv } from '../mcp-local.js';
import { activity } from '../events.js';
import { openBridge } from './app-bridge.js';

const MB = 1024 * 1024;
export const APPS_DIR = join(DATA_DIR, 'apps');
const INSTALL_FREE_MB = 380; // measured: npm install of an app peaks at 280–355 MB
const INSTALL_DISK_MB = 1200; // the apps are 220–410 MB on disk, plus npm's cache while installing
const HEADROOM_MB = 80; // kept free beyond what the app itself needs
const WAIT_MS = 120000; // a turn waits this long for a free slot, then the next model answers
const STEP_MS = 180000; // one model step (until the app answers or calls a tool)
const ABANDON_MS = 3 * 60000; // tool calls nobody answered: the runner gave up on the turn
const IDLE_MS = { small: 2 * 60000, medium: 10 * 60000, large: 10 * 60000 };

export const appDir = (id) => join(APPS_DIR, id);
export const appHome = (id) => join(appDir(id), 'home');

// ---------- install on demand ----------
const installing = new Map(); // id -> Promise
const freeDiskMb = () => { try { const s = statfsSync(DATA_DIR); return Math.round((s.bavail * s.bsize) / MB); } catch { return Infinity; } };

/** May an app be downloaded now? Throws a clear error when memory or disk is short. */
function installCheck(name) {
  const s = serverSize();
  if (s.availableMb < INSTALL_FREE_MB) throw fail(`Downloading ${name} needs about ${INSTALL_FREE_MB} MB of free memory; ${s.availableMb} MB are free right now. Try again in a few minutes${s.size === 'small' ? ' (on a 1 GB server, keep the installer’s swap on)' : ''}.`, 503, { code: 'low_memory' });
  const disk = freeDiskMb();
  if (disk < INSTALL_DISK_MB) throw fail(`Downloading ${name} needs about ${INSTALL_DISK_MB} MB of free disk space; ${disk} MB are free.`, 507, { code: 'low_disk' });
}

/**
 * Download an app (npm package `spec`) into DATA_DIR/apps/<id>, once; `ready()` says whether it is there. Concurrent
 * calls share one download. npm runs without the app's secrets, at most 15 minutes.
 */
export function installApp({ id, name, spec, ready }) {
  if (ready()) return Promise.resolve();
  if (installing.has(id)) return installing.get(id);
  installCheck(name);
  const dir = appDir(id);
  const p = new Promise((res, rej) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `duniya-app-${id}`, private: true }));
    const started = Date.now();
    execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--omit=dev', '--no-package-lock', spec], {
      cwd: dir, timeout: 15 * 60000, maxBuffer: 8 * MB,
      env: { ...netEnv(), PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, npm_config_cache: join(dir, '.npm-cache'), npm_config_update_notifier: 'false' },
    }, (err, stdout, stderr) => {
      rmSync(join(dir, '.npm-cache'), { recursive: true, force: true });
      if (err || !ready()) return rej(fail(`Could not download ${name}: ${String(stderr || err?.message || 'the app is missing after the download').trim().split('\n').slice(-2).join(' ').slice(0, 300)}`, 502));
      activity('system', { summary: `${name} downloaded in ${Math.round((Date.now() - started) / 1000)} s (${spec})` });
      res();
    });
  }).finally(() => installing.delete(id));
  installing.set(id, p);
  return p;
}
export const isInstalling = (id) => installing.has(id);
/** Remove an app's download and its home (sign-in files) — on Disconnect. */
export function removeApp(id) { rmSync(appDir(id), { recursive: true, force: true }); }

// ---------- memory: measured, checked before each start ----------
const stats = new Map(); // id -> { peakMb, lastMb, startMs, turns }
function rssTreeMb(pid) {
  let kb = 0;
  const walk = (p, depth) => {
    try { kb += Number(readFileSync(`/proc/${p}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] || 0); } catch { return; }
    if (depth > 3) return;
    try { for (const c of readFileSync(`/proc/${p}/task/${p}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) walk(c, depth + 1); } catch { /* not Linux */ }
  };
  walk(pid, 0);
  return Math.round(kb / 1024);
}
function noteRss(id, pid) {
  const mb = rssTreeMb(pid);
  if (!mb) return;
  const s = stats.get(id) || { peakMb: 0, lastMb: 0, turns: 0 };
  s.peakMb = Math.max(s.peakMb, mb); s.lastMb = mb;
  stats.set(id, s);
}
/** What was measured for an app on this server: { peakMb, startMs, turns } (empty before its first turn). */
export const appStats = (id) => { const s = stats.get(id); return s ? { peakMb: s.peakMb, startMs: s.startMs, turns: s.turns } : {}; };

/**
 * May agent apps run on this server at all? Small servers (1 GB / 1 CPU): only with Small server mode on (055), then one
 * at a time. { ok, reason } like every small-server check.
 */
export const appsCheck = () => smallServerCheck({ what: 'agent apps (Claude Code, Codex, GitHub Copilot) run as an extra process of 140–220 MB while they answer',
  alternative: 'Use an API key or OpenRouter' });

/** Is there room to start an app that needs about needMb? Throws { code: 'low_memory' } (→ the next model answers). */
export function startCheck(name, needMb) {
  const gate = appsCheck();
  if (!gate.ok) throw fail(gate.reason, 503, { code: 'small_server' });
  const s = serverSize();
  if (optionalPaused()) throw fail(`${name} was not started: memory is tight right now (the app uses ${s.rssMb} MB). The next model answers instead.`, 503, { code: 'low_memory' });
  if (s.availableMb < needMb + HEADROOM_MB) throw fail(`${name} needs about ${needMb + HEADROOM_MB} MB of free memory to start; ${s.availableMb} MB are free right now. The next model answers instead.`, 503, { code: 'low_memory' });
}

// ---------- one app at a time on small servers ----------
const slotLimit = () => ({ small: 1, medium: 2, large: 3 })[serverSize().size];
let active = 0;
let waiting = []; // [{ resolve, timer }]
/** Resident runtimes that stay up between turns (Copilot): id -> { idle(): boolean, stop(), lastUsed } */
const residents = new Map();
export function registerResident(id, r) { residents.set(id, { ...r, lastUsed: Date.now() }); }
export function touchResident(id) { const r = residents.get(id); if (r) r.lastUsed = Date.now(); }
export const forgetResident = (id) => residents.delete(id);
function stopIdleResidents(except) {
  for (const [id, r] of [...residents]) if (id !== except && r.idle()) { residents.delete(id); try { r.stop(); } catch { /* already gone */ } }
}

/**
 * Take a slot for one app turn; resolves with release(). On small servers idle resident runtimes of other apps are
 * stopped first. Waits up to WAIT_MS (onWait() is called once when it has to wait), then throws { code: 'app_busy' }.
 */
export async function acquireSlot(id, name, { onWait } = {}) {
  if (serverSize().size === 'small') stopIdleResidents(id);
  if (active >= slotLimit()) {
    try { onWait?.(); } catch { /* cosmetic */ }
    const ok = await new Promise((resolve) => {
      const w = { resolve, timer: setTimeout(() => { waiting = waiting.filter((x) => x !== w); resolve(false); }, WAIT_MS) };
      waiting.push(w);
    });
    if (!ok) throw fail(`${name} waited 2 minutes for another agent app to finish; the next model answers instead.`, 503, { code: 'app_busy' });
  } else active++;
  let done = false;
  return () => {
    if (done) return; done = true;
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve(true); } else active = Math.max(0, active - 1);
  };
}

// ---------- a turn of an app (process + bridge) ----------
const turns = new Set(); // live AppTurn objects
const held = new Map(); // tool_use id -> AppTurn
const blocksOf = (m) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || []);
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : JSON.stringify(x))).join('\n') : JSON.stringify(c ?? ''));

/**
 * One app turn. `def` is the app: { id, name, launch({ model, systemFile, bridge, home }) → { cmd, args, env, stdin },
 * parse(json, turn) }. parse() reports through turn.text(t), turn.usage(u), turn.expect(n), turn.fail(err),
 * turn.limit(err) and turn.end().
 */
class AppTurn {
  constructor(def, release) {
    this.def = def; this.release = release;
    this.pending = new Map(); // id -> { name, input, resolve, answered }
    this.texts = []; this.used = { input_tokens: 0, output_tokens: 0 };
    this.expected = 0; this.waiter = null; this.error = null; this.ended = false; this.closed = false;
    this.lastActive = Date.now(); this.started = Date.now(); this.firstOut = 0;
    turns.add(this);
  }
  async start({ model, system, prompt, tools }) {
    const home = appHome(this.def.id);
    mkdirSync(home, { recursive: true, mode: 0o700 });
    // The system prompt goes in a private file (not on the command line, where `ps` would show it).
    this.systemFile = join(home, `.prompt-${randomBytes(6).toString('hex')}.md`);
    writeFileSync(this.systemFile, system || 'You are a helpful assistant.', { mode: 0o600 });
    this.bridge = await openBridge({ tools, onCall: (name, input) => this.toolCall(name, input) });
    const { cmd, args, env, stdin } = this.def.launch({ model, systemFile: this.systemFile, bridge: this.bridge, home, prompt });
    const child = spawn(cmd, args, { cwd: home, env: { PATH: process.env.PATH || '/usr/bin:/bin', ...netEnv(), HOME: home, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buf = ''; let errTail = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (!this.firstOut) this.firstOut = Date.now();
      noteRss(this.def.id, child.pid);
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        try { this.def.parse(j, this); } catch { /* an unknown shape is ignored */ }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
    child.on('error', (e) => this.fail(Object.assign(new Error(`${this.def.name} could not start: ${e.message}`), { code: 'app_start' })));
    child.on('exit', (code, sig) => {
      if (!this.ended && !this.error) {
        const last = errTail.trim().split('\n').filter((l) => !/^WARNING:/.test(l)).slice(-2).join(' ').slice(0, 300);
        if (code === 0 && !sig) this.end();
        else this.fail(this.def.error?.(last) || Object.assign(new Error(`${this.def.name} stopped${sig ? ` (${sig})` : ` with code ${code}`}${last ? `: ${last}` : ''}`), { code: 'app_exit' }));
      }
      this.close();
    });
    child.stdin.on('error', () => { /* the app closed its input early */ });
    child.stdin.end(stdin ?? prompt);
  }
  // ---- reported by parse() ----
  text(t) { if (t) this.texts.push(t); this.check(); }
  usage(u) { this.used.input_tokens += u.input_tokens || 0; this.used.output_tokens += u.output_tokens || 0; }
  expect(n) { this.expected = n; this.check(); }
  fail(err) { if (!this.error) this.error = err; this.check(); }
  end() { this.ended = true; this.check(); }
  // ---- tool calls from the bridge ----
  toolCall(name, input) {
    const id = `toolu_app_${randomBytes(8).toString('hex')}`;
    this.lastActive = Date.now();
    return new Promise((resolve) => { this.pending.set(id, { name, input, resolve, answered: false }); this.check(); });
  }
  answer(id, block) {
    const p = this.pending.get(id); if (!p || p.answered) return;
    p.answered = true; held.delete(id); this.lastActive = Date.now();
    p.resolve({ text: resultText(block.content), isError: !!block.is_error });
  }
  open() { return [...this.pending].filter(([, p]) => !p.answered); }
  check() {
    if (!this.waiter) return;
    if (this.error) return this.finish();
    const open = this.open();
    if (open.length) {
      clearTimeout(this.grace); // parallel calls of one step arrive together; a short wait collects them
      this.grace = setTimeout(() => this.finish(), open.length >= this.expected ? 0 : 200);
      return;
    }
    if (this.ended) this.finish();
  }
  step() {
    return new Promise((resolve) => {
      this.waiter = resolve; this.lastActive = Date.now();
      this.timer = setTimeout(() => this.fail(Object.assign(new Error(`${this.def.name} did not answer in time`), { code: 'timeout' })), STEP_MS);
      this.check();
    });
  }
  finish() {
    const w = this.waiter; if (!w) return;
    this.waiter = null; clearTimeout(this.timer); clearTimeout(this.grace);
    const text = this.texts.join('\n').trim(); this.texts = [];
    const usage = this.used; this.used = { input_tokens: 0, output_tokens: 0 };
    const calls = this.error ? [] : this.open();
    this.expected = Math.max(0, this.expected - calls.length);
    w({ error: this.error, text, usage, calls });
  }
  kill(reason) {
    for (const [, p] of this.open()) { p.answered = true; p.resolve({ text: reason, isError: true }); }
    try { this.child?.kill('SIGTERM'); } catch { /* gone */ }
    this.close();
  }
  close() {
    if (this.closed) return; this.closed = true;
    turns.delete(this);
    for (const id of this.pending.keys()) held.delete(id);
    clearTimeout(this.timer); clearTimeout(this.grace);
    this.bridge?.close();
    if (this.systemFile) rmSync(this.systemFile, { force: true });
    const s = stats.get(this.def.id) || { peakMb: 0, lastMb: 0, turns: 0 };
    s.turns++; if (this.firstOut) s.startMs = this.firstOut - this.started;
    stats.set(this.def.id, s);
    this.release?.();
    if (this.waiter) this.finish();
  }
}

/** One provider step from a turn's state: Anthropic-style blocks. */
async function run(turn) {
  const r = await turn.step();
  if (r.error) { turn.kill('Turn ended'); throw r.error; }
  const content = r.text ? [{ type: 'text', text: r.text }] : [];
  if (r.calls.length) {
    for (const [id, p] of r.calls) { content.push({ type: 'tool_use', id, name: p.name, input: p.input }); held.set(id, turn); }
    return { content, stop_reason: 'tool_use', usage: r.usage };
  }
  turn.kill('Turn ended');
  return { content, stop_reason: 'end_turn', usage: r.usage };
}

/**
 * The provider chat() of an app. A call that answers held tool calls continues that turn; any other call starts a new
 * turn: install check, memory check, a slot, the process. `toPrompt(messages)` makes the conversation one prompt.
 */
export async function appChat(def, { model, system, messages, tools = [], onWait }, toPrompt) {
  const last = messages.at(-1);
  const results = last?.role === 'user' ? blocksOf(last).filter((b) => b.type === 'tool_result') : [];
  const turn = results.length && held.get(results[0].tool_use_id);
  if (turn && !turn.closed) {
    for (const b of results) turn.answer(b.tool_use_id, b);
    return run(turn);
  }
  if (!def.ready()) throw fail(`${def.name} is not downloaded yet: connect it again under Models`, 503, { code: 'app_missing' });
  startCheck(def.name, def.needMb);
  const release = await acquireSlot(def.id, def.name, { onWait });
  const t = new AppTurn(def, release);
  try { await t.start({ model, system, prompt: toPrompt(messages), tools }); } catch (e) { t.kill('Not started'); throw e; }
  return run(t);
}

/**
 * Upkeep (from the scheduler's 30 s tick): end turns whose tool calls nobody answered for 3 minutes (the runner gave
 * up), and stop resident runtimes that were idle too long (2 minutes on small servers) or while memory is tight.
 */
export function appsTick(now = Date.now()) {
  for (const t of [...turns]) if (!t.waiter && t.open().length && now - t.lastActive > ABANDON_MS) t.kill('No answer from the agent');
  const idleFor = IDLE_MS[serverSize().size];
  const tight = optionalPaused();
  for (const [id, r] of [...residents]) {
    if (r.idle() && (tight || now - r.lastUsed > idleFor)) { residents.delete(id); try { r.stop(); } catch { /* gone */ } }
  }
}
// Memory got tight: stop idle residents at once (a running turn finishes).
onMemoryPressure((tight) => { if (tight) stopIdleResidents(''); });

/** Run an app command that is not a turn (status, model list, logout): execFile, its own env, a time limit. */
export function appExec(def, args, { env = {}, timeoutMs = 30000, input } = {}) {
  return new Promise((res, rej) => {
    const home = appHome(def.id);
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const child = execFile(def.bin(), args, { cwd: home, timeout: timeoutMs, maxBuffer: 16 * MB, env: { PATH: process.env.PATH || '/usr/bin:/bin', ...netEnv(), HOME: home, ...env } },
      (err, stdout, stderr) => (err && !stdout ? rej(Object.assign(new Error(String(stderr || err.message).trim().split('\n').filter((l) => !/^WARNING:/.test(l)).slice(-2).join(' ').slice(0, 300)), { code: err.code })) : res({ stdout: String(stdout), stderr: String(stderr), code: err?.code || 0 })));
    if (input !== undefined) child.stdin?.end(input);
  });
}
