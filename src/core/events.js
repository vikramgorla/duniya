import { EventEmitter } from 'node:events';
import { insertActivity } from './db.js';

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
export function activity(type, { bot, chat, summary, detail } = {}) {
  const entry = { ts: Date.now(), type, bot: bot || '', chat: chat || '', summary: String(summary ?? '').slice(0, 500) };
  if (detail !== undefined) entry.detail = trim(detail);
  try { entry.id = insertActivity(entry); } catch (e) { console.error('activity insert failed', e.message); }
  bus.emit('activity', entry);
  if (type === 'error') console.error(`[${bot || 'core'}] ${entry.summary}`);
  return entry;
}
