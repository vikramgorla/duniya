import { EventEmitter } from 'node:events';
import { insertActivity, pruneActivity } from './db.js';
import { getChatPrefs } from './chat-prefs.js';
import { getSetting } from './store.js';

/** Process-wide event bus. Everything the bot does is recorded here and streamed to the panel. */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

const trim = (v, n = 4000) => {
  if (v == null) return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : (typeof v === 'string' ? v : JSON.parse(s));
};

/**
 * Record an activity entry.
 * type: message.in | message.out | tool.call | tool.error | confirm.created | confirm.applied |
 *       confirm.cancelled | channel.status | bot.updated | schedule.run | error | system
 */
// ---------- what gets logged (011) ----------
export const LOG_CATEGORIES = {
  messages: 'Messages in and out', tools: 'Tool calls', models: 'Model usage (tokens)', memory: 'Memory (summaries, notes)',
  schedules: 'Scheduled posts', backups: 'Backups', system: 'System (start, updates, maintenance)', mcp: 'AI assistants (MCP)',
};
// Always recorded, whatever the settings: errors, confirmations of changes, configuration changes, channel status.
const ALWAYS = new Set(['errors', 'confirmations', 'config', 'channel']);
export const LOGGING_DEFAULTS = Object.freeze({ level: 'normal', categories: Object.fromEntries(Object.keys(LOG_CATEGORIES).map((k) => [k, true])), retentionDays: 30, maxEntries: 5000 });

export function categoryOf(type) {
  if (type === 'error' || type === 'tool.error') return 'errors';
  if (type.startsWith('message.')) return 'messages';
  if (type === 'tool.call') return 'tools';
  if (type.startsWith('confirm.')) return 'confirmations';
  if (type === 'model.usage') return 'models';
  if (type.startsWith('memory.')) return 'memory';
  if (type.startsWith('schedule.')) return 'schedules';
  if (type === 'channel.status') return 'channel';
  if (type.startsWith('bot.') || type === 'config' || type === 'backup.settings') return 'config';
  if (type.startsWith('backup.')) return 'backups';
  if (type.startsWith('mcp.')) return 'mcp';
  return 'system';
}

let cfgCache = null;
export function loggingSettings() {
  if (cfgCache && Date.now() - cfgCache.at < 5000) return cfgCache.v;
  let v = LOGGING_DEFAULTS;
  try { const s = getSetting('logging', null); if (s) v = { ...LOGGING_DEFAULTS, ...s, categories: { ...LOGGING_DEFAULTS.categories, ...(s.categories || {}) } }; } catch { /* db not ready */ }
  cfgCache = { at: Date.now(), v };
  return v;
}
export const resetLoggingCache = () => { cfgCache = null; };

/** null = do not record; otherwise the max detail size to keep. */
export function logPolicy(type, chat) {
  const cat = categoryOf(type);
  if (ALWAYS.has(cat)) return 4000;
  const cfg = loggingSettings();
  let level = cfg.level;
  if (chat) {
    const pref = getChatPrefs(chat).logging;
    if (pref === 'off') return null;
    if (pref !== 'inherit') level = pref;
  }
  if (level === 'minimal') return cat === 'system' ? 1000 : null;
  if (cfg.categories[cat] === false) return null;
  return level === 'verbose' ? 4000 : 1000;
}

export function activity(type, { bot, chat, summary, detail } = {}) {
  const entry = { ts: Date.now(), type, bot: bot || '', chat: chat || '', summary: String(summary ?? '').slice(0, 500) };
  let max = 4000;
  try { max = logPolicy(type, entry.chat); } catch { /* keep */ }
  if (max === null) {
    if (type === 'error') console.error(`[${bot || 'core'}] ${entry.summary}`);
    return null;
  }
  if (detail !== undefined) entry.detail = trim(detail, max);
  try {
    entry.id = insertActivity(entry);
    if (Math.random() < 0.02) { const c = loggingSettings(); pruneActivity({ days: c.retentionDays, max: c.maxEntries }); }
  } catch (e) { console.error('activity insert failed', e.message); }
  bus.emit('activity', entry);
  if (type === 'error') console.error(`[${bot || 'core'}] ${entry.summary}`);
  return entry;
}
