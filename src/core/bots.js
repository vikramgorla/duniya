// Bot registry (005): bots are database records; templates are JSON files; plugins are optional code.
import { readdirSync, readFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, DATA_DIR, PLUGINS_DIR, TEMPLATES_DIR, digits } from './config.js';
import { validateBotConfig, referencedSecrets, slugify, BOT_ID_RE, ValidationError } from './schema.js';
import {
  listBotRows, getBotRow, saveBotRow, deleteBotRow, countBots, setSecret, getSecret, updateSettings,
} from './store.js';
import { activity } from './events.js';
import { deleteBotConnections } from './mcp-oauth.js';

const LEGACY_BOTS_DIR = resolve(ROOT, process.env.BOTS_DIR || 'bots');
let bots = new Map();
const pluginCache = new Map();

// ---------- plugins ----------
async function loadPlugin(name) {
  if (pluginCache.has(name)) return pluginCache.get(name);
  const candidates = [resolve(PLUGINS_DIR, name, 'index.js'), resolve(LEGACY_BOTS_DIR, name, 'index.js')];
  const file = candidates.find((f) => existsSync(f));
  let mod = null;
  if (file) {
    try { mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default || null; } catch (e) {
      activity('error', { summary: `Plugin "${name}" failed to load: ${e.message}` });
    }
  }
  pluginCache.set(name, mod);
  return mod;
}

export function listPlugins() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(PLUGINS_DIR, d.name, 'index.js')))
    .map((d) => ({ name: d.name, tools: (pluginCache.get(d.name)?.tools || []).map((t) => t.name) }));
}

async function hooksFor(config, id) {
  const hooks = { tools: [], onMessage: null, role: null, missing: [] };
  const handlers = [];
  const roles = [];
  for (const name of config.plugins || []) {
    const p = await loadPlugin(name);
    if (!p) { hooks.missing.push(name); continue; }
    for (const t of p.tools || []) hooks.tools.push({ ...t, plugin: name });
    if (p.onMessage) handlers.push(p.onMessage);
    if (p.role) roles.push(p.role);
    try { await p.init?.({ bot: { id, ...config } }); } catch (e) { activity('error', { bot: id, summary: `Plugin ${name} init: ${e.message}` }); }
  }
  if (handlers.length) {
    hooks.onMessage = async (ctx) => {
      for (const h of handlers) { const r = await h(ctx); if (typeof r === 'string' && r) return r; }
      return undefined;
    };
  }
  if (roles.length) {
    hooks.role = async (msg, bot) => {
      for (const r of roles) { const v = await r(msg, bot); if (v) return v; }
      return undefined;
    };
  }
  if (hooks.missing.length) activity('error', { bot: id, summary: `Missing plugin(s): ${hooks.missing.join(', ')}` });
  return hooks;
}

async function toRuntime(row) {
  return { ...row.config, id: row.id, updatedAt: row.updatedAt, hooks: await hooksFor(row.config, row.id) };
}

// ---------- legacy migration (pre-005 file-based bots) ----------
function readJsonFile(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function migrateLegacy() {
  const secretsFile = resolve(DATA_DIR, 'secrets.json');
  if (existsSync(secretsFile)) {
    for (const [k, v] of Object.entries(readJsonFile(secretsFile, {}))) if (v && !getSecret(k)) setSecret(k, v);
    rmSync(secretsFile, { force: true });
    activity('system', { summary: 'Migrated secrets to encrypted storage' });
  }
  const settingsFile = resolve(DATA_DIR, 'settings.json');
  if (existsSync(settingsFile)) {
    updateSettings(readJsonFile(settingsFile, {}));
    renameSync(settingsFile, `${settingsFile}.migrated`);
  }
  if (countBots() > 0 || !existsSync(LEGACY_BOTS_DIR)) return;
  for (const ent of readdirSync(LEGACY_BOTS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || /^[_.]/.test(ent.name)) continue;
    const dir = resolve(LEGACY_BOTS_DIR, ent.name);
    if (!existsSync(resolve(dir, 'bot.json'))) continue;
    try {
      const def = readJsonFile(resolve(dir, 'bot.json'), {});
      const promptFile = resolve(dir, def.prompt || 'prompt.md');
      const overrides = readJsonFile(resolve(DATA_DIR, 'bots', `${ent.name}.json`), {});
      const merged = {
        ...def, ...overrides, name: def.name || ent.name,
        prompt: existsSync(promptFile) ? readFileSync(promptFile, 'utf8') : (def.prompt || 'You are a helpful assistant.'),
        extraPrompt: overrides.extraPrompt || def.extraPrompt || '',
        plugins: existsSync(resolve(dir, 'index.js')) ? [ent.name] : [],
      };
      const { config } = validateBotConfig(merged);
      saveBotRow(ent.name, config, 'migration');
      activity('system', { bot: ent.name, summary: `Imported legacy bot "${config.name}"` });
    } catch (e) {
      activity('error', { bot: ent.name, summary: `Legacy bot import failed: ${e.message}` });
    }
  }
}

// ---------- registry ----------
export async function loadBots() {
  migrateLegacy();
  const next = new Map();
  for (const row of listBotRows()) next.set(row.id, await toRuntime(row));
  bots = next;
  return [...bots.values()];
}
async function refresh(id) {
  const row = getBotRow(id);
  if (row) bots.set(id, await toRuntime(row)); else bots.delete(id);
  return bots.get(id);
}

export const listBots = () => [...bots.values()];
export const getBot = (id) => bots.get(id);
export const botForChat = (chat) => listBots().find((b) => b.chats.includes(chat));
export const roleIn = (bot, phone) => (phone && bot.organizers.includes(digits(phone)) ? 'organizer' : 'participant');

function releaseChats(chats, exceptId, by) {
  for (const other of listBots()) {
    if (other.id === exceptId) continue;
    const kept = other.chats.filter((c) => !chats.includes(c));
    if (kept.length !== other.chats.length) {
      const row = getBotRow(other.id);
      saveBotRow(other.id, { ...row.config, chats: kept }, by);
      other.chats = kept;
    }
  }
}

export async function createBot({ id, config, by = '' }) {
  const { config: clean, warnings } = validateBotConfig(config);
  let botId = id ? String(id).toLowerCase() : slugify(clean.name);
  if (!BOT_ID_RE.test(botId)) throw new ValidationError('id', 'must be 2–41 lowercase letters, digits or -');
  if (getBotRow(botId)) {
    if (id) throw Object.assign(new Error(`A bot with id "${botId}" already exists`), { status: 409 });
    let n = 2; while (getBotRow(`${botId}-${n}`)) n++;
    botId = `${botId}-${n}`;
  }
  if (clean.chats.length) releaseChats(clean.chats, botId, by);
  saveBotRow(botId, clean, by);
  activity('bot.created', { bot: botId, summary: `Created "${clean.name}"${by ? ` by ${by}` : ''}`, detail: { warnings } });
  return { bot: await refresh(botId), warnings };
}

export async function updateBot(id, patch, by = '') {
  const row = getBotRow(id);
  if (!row) throw Object.assign(new Error(`Unknown bot ${id}`), { status: 404 });
  const { config: clean, warnings } = validateBotConfig({ ...row.config, ...patch });
  if (patch.chats) releaseChats(clean.chats, id, by);
  saveBotRow(id, clean, by);
  if (patch.plugins) for (const p of clean.plugins) pluginCache.delete(p);
  activity('bot.updated', { bot: id, summary: `Updated ${Object.keys(patch).join(', ')}${by ? ` by ${by}` : ''}`, detail: { warnings } });
  return { bot: await refresh(id), warnings };
}

export function deleteBot(id, by = '') {
  if (!deleteBotRow(id)) throw Object.assign(new Error(`Unknown bot ${id}`), { status: 404 });
  bots.delete(id);
  deleteBotConnections(id);
  activity('bot.deleted', { bot: id, summary: `Deleted${by ? ` by ${by}` : ''}` });
}

export async function bindChat(chat, botId, by = '') {
  for (const b of listBots()) {
    if (b.chats.includes(chat) && b.id !== botId) await updateBot(b.id, { chats: b.chats.filter((c) => c !== chat) }, by);
  }
  if (botId) {
    const b = getBot(botId);
    if (!b) throw Object.assign(new Error(`Unknown bot ${botId}`), { status: 404 });
    if (!b.chats.includes(chat)) await updateBot(botId, { chats: [...b.chats, chat] }, by);
  }
}

// ---------- templates, export/import ----------
export function listTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const t = readJsonFile(resolve(TEMPLATES_DIR, f), {});
    return { id: f.replace(/\.json$/, ''), name: t.name || f, description: t.description || '' };
  }).sort((a, b) => (a.id === 'blank' ? -1 : b.id === 'blank' ? 1 : a.name.localeCompare(b.name)));
}
export function templateConfig(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new ValidationError('template', 'invalid');
  const file = resolve(TEMPLATES_DIR, `${id}.json`);
  if (!existsSync(file)) throw Object.assign(new Error(`Unknown template ${id}`), { status: 404 });
  return readJsonFile(file, {});
}

export function exportBot(id) {
  const row = getBotRow(id);
  if (!row) throw Object.assign(new Error(`Unknown bot ${id}`), { status: 404 });
  const { chats, organizers, participants, ...config } = row.config;
  return { format: 'duniya-bot', version: 1, id, exportedAt: new Date().toISOString(), config, secrets: referencedSecrets(row.config) };
}

export async function importBot(doc, by = '') {
  if (!doc || doc.format !== 'duniya-bot' || !doc.config) throw new ValidationError('file', 'not a bot export (format duniya-bot)');
  const config = { ...doc.config, chats: [], organizers: [], participants: [] };
  return createBot({ config, by });
}

export function botView(bot) {
  const config = { ...bot };
  delete config.hooks; delete config.id; delete config.updatedAt;
  const needs = referencedSecrets(bot).filter((s) => !getSecret(s));
  return {
    id: bot.id, name: bot.name, description: bot.description, enabled: bot.enabled, config, needs,
    updatedAt: bot.updatedAt,
    localTools: (bot.hooks?.tools || []).map((t) => t.name),
    missingPlugins: bot.hooks?.missing || [],
  };
}
