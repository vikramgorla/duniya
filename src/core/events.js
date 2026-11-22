// @ts-check
import { EventEmitter } from 'node:events';
import { diskFullError, insertActivity, writesPaused } from './db.js';
import { getChatPrefs } from './chat-prefs.js';
import { getSetting } from './store.js';

/** Process-wide event bus. Everything the agent does is recorded here and streamed to the panel. */
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
 *       confirm.cancelled | change.auto (093: changed without asking) | limit (094: a tool service limit stopped a use) | channel.status | agent.updated | schedule.run | error | system
 */
// ---------- what gets logged (011) ----------
export const LOG_CATEGORIES = {
  messages: 'Messages in and out', tools: 'Tool calls', models: 'Model usage (tokens)', memory: 'Memory (summaries, notes)',
  schedules: 'Scheduled posts', backups: 'Backups', system: 'System (start, updates, maintenance)', mcp: 'AI assistants (MCP)',
  whatsapp: 'WhatsApp actions', media: 'Photos & voice (transcripts, created pictures)', silences: 'Why agents stayed silent (at most hourly per chat)',
};
// Always recorded, whatever the settings: errors, confirmations of changes, configuration changes, channel status, and
// the owner assistant's audit trail (044: every question and action).
const ALWAYS = new Set(['errors', 'confirmations', 'config', 'channel', 'owner']);
export const LOGGING_DEFAULTS = Object.freeze({ level: 'normal', categories: Object.fromEntries(Object.keys(LOG_CATEGORIES).map((k) => [k, true])), retentionDays: 30, maxEntries: 5000 });

export function categoryOf(type) {
  if (type === 'error' || type === 'tool.error') return 'errors';
  if (type.startsWith('message.')) return 'messages';
  if (type === 'tool.call') return 'tools';
  if (type.startsWith('confirm.')) return 'confirmations';
  if (type === 'model.usage') return 'models';
  if (type === 'model.fallback' || type === 'model.provider') return 'system'; // provider switches and pauses (042)
  if (type.startsWith('memory.')) return 'memory';
  if (type.startsWith('schedule.')) return 'schedules';
  if (type === 'channel.status') return 'channel';
  if (type.startsWith('agent.') || type === 'config' || type === 'backup.settings') return 'config';
  if (type.startsWith('backup.')) return 'backups';
  if (type.startsWith('mcp.')) return 'mcp';
  if (type === 'whatsapp.action') return 'whatsapp';
  if (type === 'whatsapp.reaction' || type === 'whatsapp.vote') return 'messages';
  if (type === 'silence') return 'silences';
  if (type.startsWith('owner.')) return 'owner';
  if (type.startsWith('media.')) return 'media';
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

/** Console lines stay one line, whatever the summary contains (no forged log lines). */
const oneLine = (s) => String(s).replace(/\n|\r/g, '').replace(/[\u2028\u2029]/g, '');

/** @param {string} type  @param {{ agent?: string, chat?: string, summary?: string, detail?: any }} [entry] */
export function activity(type, { agent, chat, summary, detail } = {}) {
  const entry = { ts: Date.now(), type, agent: agent || '', chat: chat || '', summary: String(summary ?? '').slice(0, 500) };
  let max = 4000;
  try { max = logPolicy(type, entry.chat); } catch { /* keep */ }
  if (max === null) {
    if (type === 'error') console.error(`[${oneLine(agent || 'core')}] ${oneLine(entry.summary)}`);
    return null;
  }
  if (detail !== undefined) entry.detail = trim(detail, max);
  // 069: disk almost full: only what is always recorded (errors, changes, channel status) is still written
  if (!writesPaused() || ALWAYS.has(categoryOf(type))) {
    try { entry.id = insertActivity(entry); } catch (e) { diskFullError(e); console.error('activity insert failed', e.message); }
  }
  bus.emit('activity', entry);
  if (type === 'error') console.error(`[${oneLine(agent || 'core')}] ${oneLine(entry.summary)}`);
  return entry;
}
