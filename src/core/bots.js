import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOTS_DIR, digits, readJson, writeJson } from './config.js';
import { activity } from './events.js';

/**
 * A bot is a folder in bots/ with a bot.json (and optional prompt.md and index.js hooks).
 * Folders starting with "_" or "." are ignored (templates).
 *
 * Fields an admin can change from the panel are stored as overrides in DATA_DIR/bots/<id>.json,
 * so the repo stays the source of defaults and deploys never clobber live settings.
 */
export const EDITABLE = [
  'enabled', 'model', 'maxTokens', 'triggers', 'respondToMentions', 'chats', 'dm',
  'organizers', 'participants', 'extraPrompt', 'schedules', 'historySize',
];

const DEFAULTS = {
  enabled: true,
  model: 'claude-sonnet-5-5',
  maxTokens: 1024,
  triggers: [],
  respondToMentions: true,
  chats: [],
  dm: 'members', // none | organizers | members | anyone
  organizers: [],
  participants: [],
  extraPrompt: '',
  schedules: [],
  historySize: 20,
  mcpServers: {},
  tools: { participant: [], organizer: [], deny: [] },
  confirm: null,
};

let bots = new Map();

function validatePatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!EDITABLE.includes(k)) throw new Error(`Field "${k}" is not editable`);
    switch (k) {
      case 'enabled': case 'respondToMentions': out[k] = !!v; break;
      case 'maxTokens': case 'historySize': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 8192) throw new Error(`${k} must be 1–8192`);
        out[k] = n; break;
      }
      case 'model': case 'extraPrompt': out[k] = String(v ?? '').slice(0, 8000); break;
      case 'dm':
        if (!['none', 'organizers', 'members', 'anyone'].includes(v)) throw new Error('dm must be none|organizers|members|anyone');
        out[k] = v; break;
      case 'triggers': out[k] = (v || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean); break;
      case 'chats': out[k] = [...new Set((v || []).map(String).filter(Boolean))]; break;
      case 'organizers': case 'participants': out[k] = [...new Set((v || []).map(digits).filter((d) => d.length >= 6))]; break;
      case 'schedules':
        if (!Array.isArray(v)) throw new Error('schedules must be a list');
        out[k] = v.map((s, i) => {
          if (!/^\d{2}:\d{2}$/.test(s.at || '')) throw new Error(`schedule ${i + 1}: "at" must be HH:MM`);
          return {
            id: String(s.id || `s${i + 1}`), at: s.at, days: String(s.days || 'daily'),
            prompt: String(s.prompt || ''), chats: s.chats === 'all' || !s.chats ? 'all' : [].concat(s.chats),
            enabled: s.enabled !== false,
          };
        });
        break;
      default: out[k] = v;
    }
  }
  return out;
}

async function loadOne(dir) {
  const id = dir;
  const base = resolve(BOTS_DIR, dir);
  const def = JSON.parse(readFileSync(resolve(base, 'bot.json'), 'utf8'));
  const promptFile = resolve(base, def.prompt || 'prompt.md');
  const prompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf8') : '';
  let hooks = {};
  const hookFile = resolve(base, 'index.js');
  if (existsSync(hookFile)) {
    const mod = await import(`${pathToFileURL(hookFile).href}?t=${Date.now()}`);
    hooks = mod.default || mod;
  }
  const overrides = readJson(`bots/${id}.json`, {});
  const bot = {
    ...DEFAULTS, ...def, ...overrides, id, name: def.name || id, description: def.description || '',
    tools: { ...DEFAULTS.tools, ...(def.tools || {}) }, prompt, hooks, dir: base,
  };
  bot.organizers = bot.organizers.map(digits);
  bot.participants = bot.participants.map(digits);
  return bot;
}

export async function loadBots() {
  const next = new Map();
  if (existsSync(BOTS_DIR)) {
    for (const ent of readdirSync(BOTS_DIR, { withFileTypes: true })) {
      if (!ent.isDirectory() || /^[_.]/.test(ent.name)) continue;
      if (!existsSync(resolve(BOTS_DIR, ent.name, 'bot.json'))) continue;
      try {
        const bot = await loadOne(ent.name);
        next.set(bot.id, bot);
        await bot.hooks.init?.({ bot });
      } catch (e) {
        activity('error', { bot: ent.name, summary: `Failed to load bot: ${e.message}` });
      }
    }
  }
  bots = next;
  return [...bots.values()];
}

export const listBots = () => [...bots.values()];
export const getBot = (id) => bots.get(id);

export function updateBot(id, patch) {
  const bot = bots.get(id);
  if (!bot) throw new Error(`Unknown bot ${id}`);
  const clean = validatePatch(patch);
  if (clean.chats) {
    // A chat belongs to one bot: remove it from others.
    for (const other of bots.values()) {
      if (other.id === id) continue;
      const kept = other.chats.filter((c) => !clean.chats.includes(c));
      if (kept.length !== other.chats.length) {
        other.chats = kept;
        writeJson(`bots/${other.id}.json`, { ...readJson(`bots/${other.id}.json`, {}), chats: kept });
      }
    }
  }
  Object.assign(bot, clean);
  writeJson(`bots/${id}.json`, { ...readJson(`bots/${id}.json`, {}), ...clean });
  activity('bot.updated', { bot: id, summary: `Updated ${Object.keys(clean).join(', ')}` });
  return bot;
}

export function bindChat(chat, botId) {
  for (const b of bots.values()) {
    if (b.chats.includes(chat) && b.id !== botId) updateBot(b.id, { chats: b.chats.filter((c) => c !== chat) });
  }
  if (botId) {
    const b = bots.get(botId);
    if (!b) throw new Error(`Unknown bot ${botId}`);
    if (!b.chats.includes(chat)) updateBot(botId, { chats: [...b.chats, chat] });
  }
}

export const botForChat = (chat) => listBots().find((b) => b.chats.includes(chat));

export function roleIn(bot, phone) {
  if (phone && bot.organizers.includes(phone)) return 'organizer';
  return 'participant';
}

/** Public view for the panel (no hooks, no secrets). */
export function botView(bot) {
  const { hooks, dir, prompt, ...rest } = bot;
  return {
    ...rest,
    promptPreview: prompt.slice(0, 2000),
    hasHooks: Object.keys(hooks || {}).length > 0,
    localTools: (hooks?.tools || []).map((t) => t.name),
    mcpServers: Object.fromEntries(Object.entries(bot.mcpServers).map(([k, v]) => [k, { url: v.url }])),
  };
}
