import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { applyPendingRestore } from './restore-apply.js';

export const ROOT = resolve(import.meta.dirname, '..', '..');

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
/** A 400-style error the panel shows next to `field`. */
export const bad = (message, field, status = 400) => Object.assign(new Error(message), { status, ...(field ? { field } : {}) });
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const iso = (ts) => (ts ? new Date(ts).toISOString() : null);
export const isGroup = (chat) => String(chat).endsWith('@g.us');

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
