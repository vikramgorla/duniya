// Per-chat preferences (013/011): model choice and activity logging level for a single chat (group or person).
// The bot a chat talks to stays in the bot's `chats` list (one source of truth for bindings).
import { db } from './db.js';

const TENANT = 'default';
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_prefs (
    tenant_id TEXT NOT NULL, chat TEXT NOT NULL, model TEXT NOT NULL DEFAULT 'inherit', logging TEXT NOT NULL DEFAULT 'inherit',
    updated_at INTEGER, PRIMARY KEY (tenant_id, chat)
  );
  CREATE TABLE IF NOT EXISTS chats_seen (
    tenant_id TEXT NOT NULL, chat TEXT NOT NULL, number TEXT NOT NULL DEFAULT 'main', is_group INTEGER NOT NULL,
    name TEXT, phone TEXT, last_at INTEGER, PRIMARY KEY (tenant_id, chat)
  );
`);

export const LOGGING_LEVELS = ['inherit', 'off', 'minimal', 'normal', 'verbose'];
const MODEL_RE = /^(inherit|auto|[a-z][a-z0-9-]{1,30}:[A-Za-z0-9._:/@+-]{1,120})$/;

const cache = new Map();
export function getChatPrefs(chat) {
  if (!chat) return { model: 'inherit', logging: 'inherit' };
  if (cache.has(chat)) return cache.get(chat);
  const r = db.prepare('SELECT model, logging FROM chat_prefs WHERE tenant_id = ? AND chat = ?').get(TENANT, chat);
  const v = { model: r?.model || 'inherit', logging: r?.logging || 'inherit' };
  cache.set(chat, v);
  return v;
}
export function setChatPrefs(chat, { model, logging }) {
  const cur = getChatPrefs(chat);
  const next = { model: model ?? cur.model, logging: logging ?? cur.logging };
  if (!MODEL_RE.test(next.model)) throw Object.assign(new Error('model must be inherit, auto, provider:auto or provider:model'), { status: 400, field: 'model' });
  if (!LOGGING_LEVELS.includes(next.logging)) throw Object.assign(new Error(`logging must be one of ${LOGGING_LEVELS.join(', ')}`), { status: 400, field: 'logging' });
  db.prepare('INSERT OR REPLACE INTO chat_prefs (tenant_id, chat, model, logging, updated_at) VALUES (?, ?, ?, ?, ?)').run(TENANT, chat, next.model, next.logging, Date.now());
  cache.set(chat, next);
  return next;
}
export const allChatPrefs = () => Object.fromEntries(db.prepare('SELECT chat, model, logging FROM chat_prefs WHERE tenant_id = ?').all(TENANT).map((r) => [r.chat, { model: r.model, logging: r.logging }]));

/** Remember chats the numbers have seen (name/number only, never message text), so 1:1 chats can be managed. */
const seenAt = new Map();
export function noteChat({ chat, number = 'main', isGroup, name = '', phone = '' }) {
  if (!chat) return;
  const last = seenAt.get(chat) || 0;
  if (Date.now() - last < 60000) return; // at most once a minute per chat
  seenAt.set(chat, Date.now());
  db.prepare(`INSERT INTO chats_seen (tenant_id, chat, number, is_group, name, phone, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, chat) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), name), phone = COALESCE(NULLIF(excluded.phone, ''), phone), last_at = excluded.last_at, number = excluded.number`)
    .run(TENANT, chat, number, isGroup ? 1 : 0, String(name).slice(0, 100), String(phone).slice(0, 20), Date.now());
}
export const seenChats = ({ groups = null } = {}) => db.prepare('SELECT chat, number, is_group, name, phone, last_at FROM chats_seen WHERE tenant_id = ? ORDER BY last_at DESC LIMIT 500').all(TENANT)
  .filter((r) => groups === null || !!r.is_group === groups)
  .map((r) => ({ id: r.chat, number: r.number, isGroup: !!r.is_group, name: r.name || '', phone: r.phone || '', lastAt: r.last_at }));
