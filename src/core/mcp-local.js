// Local tool services (010): MCP servers installed from npm or GitHub and run on this server over stdio.
// They are third-party code running with the app's own permissions, so: only owners add or change them (panel),
// the installed version is recorded, npm install scripts are off unless allowed, and the process gets a scrubbed
// environment (only PATH and the env the owner configured; never the app's own secrets or settings).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { DATA_DIR } from './config.js';
import { sha256 } from './crypto.js';
import { activity } from './events.js';
import { serverSize } from './resources.js';

export const LOCAL_ROOT = resolve(DATA_DIR, 'mcp-local');
const NPM_SPEC_RE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9._^~<>=*|+ -]{1,60})?$/;
const GITHUB_SPEC_RE = /^github:[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(#[A-Za-z0-9_./-]{1,100})?$/;

/** Accepts `package`, `package@1.2.3`, `@scope/package@^1`, or `github:owner/repo#ref`. */
export function validPackageSpec(spec) {
  const s = String(spec || '').trim();
  if (!s || s.startsWith('-')) return false;
  if (process.env.DUNIYA_TEST_ALLOW_FILE_SPECS === '1' && s.startsWith('file:')) return true; // tests only
  return NPM_SPEC_RE.test(s) || GITHUB_SPEC_RE.test(s);
}

// Network settings an operator may need (proxy, extra CA certificates, npm registry); never the app's own secrets.
const NET_ENV = /^(https?_proxy|no_proxy|all_proxy|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|npm_config_(registry|cafile|proxy|https_proxy|noproxy|strict_ssl))$/;
export const netEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => NET_ENV.test(k)));

// ---------- small servers (055) ----------
/**
 * May local tool services run on this server? The one rule for every path (agent and global tool services, import,
 * duplicate, admin MCP, owner assistant, MCP Registry, install buttons, and starting one): small servers (1 GB /
 * 1 CPU, serverSize()) say no, because each local service is an extra Node.js process.
 */
export function localServiceCheck() {
  const s = serverSize();
  if (s.size === 'small') {
    return { ok: false, code: 'small_server', reason: `This is a small server (${s.effectiveMb} MB memory, ${s.cpus} CPU): local tool services are not run here, because each one is an extra Node.js process. Use a hosted tool service (one with a web address) instead, or a server with at least 2 GB and 2 CPUs.` };
  }
  return { ok: true };
}
const localSig = (srv) => JSON.stringify([String(srv?.package || '').trim(), srv?.args || [], srv?.env || {}, !!srv?.allowScripts]);
/**
 * Local services in `after` that are new or changed compared with `before` ({ name: config } maps). Unchanged ones
 * are not counted, so other edits of an agent that already has a local service keep working on a small server.
 */
export function addedLocalServices(before = {}, after = {}) {
  return Object.entries(after || {}).filter(([k, v]) => v?.type === 'local'
    && !(before?.[k]?.type === 'local' && localSig(before[k]) === localSig(v))).map(([k]) => k);
}
/** Throws 400 { code: 'small_server' } when `after` adds or changes a local service on a small server. */
export function guardLocalSmall(before, after) {
  const added = addedLocalServices(before, after);
  if (!added.length) return;
  const c = localServiceCheck();
  if (!c.ok) throw Object.assign(new Error(c.reason), { status: 400, code: c.code, field: `mcpServers.${added[0]}` });
}

const dirFor = (spec, allowScripts) => join(LOCAL_ROOT, sha256(`${spec}\n${allowScripts ? 1 : 0}`).slice(0, 16));
const infoFile = (dir) => join(dir, 'duniya-install.json');

export function installedInfo(spec, allowScripts = false) {
  const f = infoFile(dirFor(spec, allowScripts));
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

function run(cmd, args, opts) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) rej(Object.assign(new Error((stderr || err.message).trim().split('\n').slice(-6).join('\n')), { status: 400 }));
      else res(stdout);
    });
  });
}

const inflight = new Map();

/** Install (or reinstall with fresh=true) a package; returns { name, version, bin }. */
export function installPackage(spec, { allowScripts = false, fresh = false, by = '' } = {}) {
  const small = localServiceCheck();
  if (!small.ok) throw Object.assign(new Error(small.reason), { status: 400, code: small.code });
  if (!validPackageSpec(spec)) throw Object.assign(new Error('Package must look like name, name@version, @scope/name or github:owner/repo#ref'), { status: 400 });
  const dir = dirFor(spec, allowScripts);
  if (inflight.has(dir)) return inflight.get(dir);
  const p = (async () => {
    if (fresh) rmSync(dir, { recursive: true, force: true });
    const existing = !fresh && installedInfo(spec, allowScripts);
    if (existing && existsSync(existing.bin)) return existing;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'duniya-local-mcp', private: true }));
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['install', '--no-audit', '--no-fund', '--omit=dev', '--save-exact', '--no-package-lock', ...(allowScripts ? [] : ['--ignore-scripts']), spec];
    await run(npm, args, {
      cwd: dir, timeout: 5 * 60 * 1000,
      env: { ...netEnv(), PATH: process.env.PATH, HOME: dir, npm_config_cache: join(LOCAL_ROOT, '.npm-cache'), npm_config_update_notifier: 'false' },
    });
    const deps = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies || {};
    const name = Object.keys(deps)[0];
    if (!name) throw Object.assign(new Error('npm installed nothing'), { status: 400 });
    const pkgDir = join(dir, 'node_modules', name);
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const bins = typeof pkg.bin === 'string' ? { [name.split('/').pop()]: pkg.bin } : (pkg.bin || {});
    const binName = bins[name.split('/').pop()] ? name.split('/').pop() : Object.keys(bins)[0];
    if (!binName) throw Object.assign(new Error(`${name} has no command to run (no "bin" in its package.json)`), { status: 400 });
    const info = { spec, allowScripts, name, version: pkg.version, bin: resolve(pkgDir, bins[binName]), dir, at: Date.now() };
    writeFileSync(infoFile(dir), JSON.stringify(info, null, 2));
    activity('config', { summary: `Installed local tool service ${name}@${pkg.version}${by ? ` (by ${by})` : ''}` });
    return info;
  })().finally(() => inflight.delete(dir));
  inflight.set(dir, p);
  return p;
}

function isNodeScript(file) {
  if (/\.(c|m)?js$/.test(file)) return true;
  try {
    const fd = openSync(file, 'r'); const buf = Buffer.alloc(80); readSync(fd, buf, 0, 80, 0); closeSync(fd);
    return /^#!.*\bnode\b/.test(buf.toString('utf8').split('\n')[0]);
  } catch { return false; }
}

/** How to start the server: { command, args, env, cwd } with a scrubbed environment. */
export async function launchSpec({ spec, allowScripts = false, args = [], env = {} }) {
  const info = installedInfo(spec, allowScripts)?.bin && existsSync(installedInfo(spec, allowScripts).bin)
    ? installedInfo(spec, allowScripts)
    : await installPackage(spec, { allowScripts, by: 'auto (first use)' });
  const node = isNodeScript(info.bin);
  return {
    command: node ? process.execPath : info.bin,
    args: node ? [info.bin, ...args] : [...args],
    cwd: dirname(info.bin),
    env: { ...netEnv(), PATH: process.env.PATH || '/usr/bin:/bin', HOME: info.dir, NODE_ENV: 'production', ...env },
  };
}
