// @ts-check
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { applyPendingRestore } from './restore-apply.js';
import { parseRepo, repoLinks } from './repo.js';

export const ROOT = resolve(import.meta.dirname, '..', '..');
/** package.json of the running checkout, read once (an update restarts the process). */
export const PKG = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')); } catch { return {}; } })();
/** The running version, "vX.Y.Z" ('unknown' without a package.json). */
export const APP_VERSION = PKG.version ? `v${PKG.version}` : 'unknown';
/** 084: the project's GitHub repository and its URLs, from `repository` in package.json (the one place it lives). */
export const REPO = repoLinks(parseRepo(PKG.repository)?.slug || 'duniya/duniya');

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

// Bootstrap env: real environment wins, then ROOT/.env (local dev).
const bootEnvFile = resolve(ROOT, '.env');
if (existsSync(bootEnvFile)) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync(bootEnvFile, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || 'data');
mkdirSync(DATA_DIR, { recursive: true });
// A restore staged from the panel (007) is applied here, before anything opens the database.
// The command line tool (029) never applies it: the running service would still hold the old database.
if (process.env.DUNIYA_CLI !== '1') applyPendingRestore(DATA_DIR);

export const env = {
  panelHost: process.env.PANEL_HOST || '127.0.0.1',
  panelPort: Number(process.env.PANEL_PORT || 8080),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  timezone: process.env.TZ_DEFAULT || 'Europe/Zurich',
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 6),
  trustProxy: ['1', 'true', 'yes', 'cloudflare'].includes(String(process.env.TRUST_PROXY || '').toLowerCase()),
  memory: {
    summarizeBatch: Number(process.env.MEMORY_SUMMARIZE_BATCH || 40),
    retentionDays: Number(process.env.MEMORY_RETENTION_DAYS || 90),
    maxMessagesPerChat: Number(process.env.MEMORY_MAX_MESSAGES || 5000),
    maxNotesPerChat: 200,
    notesInContext: 40,
  },
};

export const digits = (s) => String(s ?? '').replace(/\D/g, '');
/** One line of at most `n` characters (whitespace collapsed, "…" when cut). */
export const clip = (s, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
/** An error the panel answers with `status` (default 400); `extra` (field, code, …) goes along to the client. */
/** Cents → "CHF 25.00", "€25.00": one money format for agents, module rows and the admin tools (085). */
const moneyFormats = new Map(); // one formatter per currency: building one costs more than formatting (hot paths list hundreds)
export const money = (cents, cur) => {
  const v = Number(cents || 0) / 100;
  let f = moneyFormats.get(cur);
  if (f === undefined) { try { f = new Intl.NumberFormat('en', { style: 'currency', currency: cur }); } catch { f = null; } moneyFormats.set(cur, f); }
  return f ? f.format(v).replace(/\u00a0/g, ' ') : `${cur} ${v.toFixed(2)}`;
};
export const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
/** A 400-style error the panel shows next to `field`. */
export const bad = (message, field, status = 400) => fail(message, status, field ? { field } : {});
/** "panduga:*_preview" style globs (tool rules). */
function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}
export const matchesAny = (name, patterns = []) => patterns.some((p) => globToRegex(p).test(name));
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Date, time and weekday of a moment in a time zone: { date: 'YYYY-MM-DD', hhmm: 'HH:MM', day: 'mon' }. */
export function localParts(tz, at = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(fmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, day: p.weekday.slice(0, 3).toLowerCase() };
}
export const iso = (ts) => (ts ? new Date(ts).toISOString() : null);
/** 069: restart the app after `ms` through the graceful shutdown (src/index.js); systemd or Docker starts it again. */
export const restartSoon = (ms = 500) => setTimeout(() => process.kill(process.pid, 'SIGTERM'), ms);

/** Small JSON file store with atomic writes. */
export function readJson(file, fallback) {
  const p = resolve(DATA_DIR, file);
  if (!existsSync(p)) return structuredClone(fallback);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return structuredClone(fallback); }
}
export function writeJson(file, value, mode = 0o600) {
  const p = resolve(DATA_DIR, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(value, null, 2), { mode });
  renameSync(`${p}.tmp`, p);
}

export const TEMPLATES_DIR = resolve(ROOT, process.env.TEMPLATES_DIR || 'templates');
