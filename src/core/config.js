import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

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

export const BOTS_DIR = resolve(ROOT, process.env.BOTS_DIR || 'bots');

export const env = {
  panelHost: process.env.PANEL_HOST || '127.0.0.1',
  panelPort: Number(process.env.PANEL_PORT || 8080),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  timezone: process.env.TZ_DEFAULT || 'Europe/Zurich',
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 6),
  summaryModel: process.env.SUMMARY_MODEL || 'claude-haiku-5-5',
  memory: {
    summarizeBatch: Number(process.env.MEMORY_SUMMARIZE_BATCH || 40),
    retentionDays: Number(process.env.MEMORY_RETENTION_DAYS || 90),
    maxMessagesPerChat: Number(process.env.MEMORY_MAX_MESSAGES || 5000),
    maxNotesPerChat: 200,
    notesInContext: 40,
  },
};

export const digits = (s) => String(s ?? '').replace(/\D/g, '');

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

// ---- Secrets: managed from the panel, stored in DATA_DIR/secrets.json (0600) ----
let secrets = readJson('secrets.json', {});
const secretListeners = new Set();

export function getSecret(name) {
  return secrets[name] ?? process.env[name] ?? '';
}
export function listSecrets() {
  const names = new Set([...Object.keys(secrets)]);
  return [...names].sort().map((name) => ({ name, set: !!secrets[name] }));
}
export function setSecret(name, value) {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new Error('Secret names must be UPPER_SNAKE_CASE');
  if (value) secrets[name] = value; else delete secrets[name];
  writeJson('secrets.json', secrets);
  for (const fn of secretListeners) fn(name);
}
export const onSecretChange = (fn) => secretListeners.add(fn);

/** Replace ${VAR} with secrets/env values. */
export function interpolate(value) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => getSecret(k));
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)]));
  }
  return value;
}

// ---- Global settings (panel-editable) ----
let settings = readJson('settings.json', { paused: false, defaultDmBot: '' });
export const getSettings = () => settings;
export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  writeJson('settings.json', settings);
  return settings;
}

export function reloadForTests() {
  secrets = readJson('secrets.json', {});
  settings = readJson('settings.json', { paused: false, defaultDmBot: '' });
}
