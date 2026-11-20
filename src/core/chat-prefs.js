// @ts-check
// Per-chat preferences (013/011): model choice and activity logging level for a single chat (group or person).
// The agent a chat talks to stays in the agent's `chats` list (one source of truth for bindings).
import { fail } from './config.js';
import { db } from './db.js';
import { cleanOverride, REF_RE } from './providers/fallback-config.js';

const TENANT = 'default';
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_prefs (
    tenant_id TEXT NOT NULL, chat TEXT NOT NULL, model TEXT NOT NULL DEFAULT 'inherit', logging TEXT NOT NULL DEFAULT 'inherit',
    enabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER, fallback TEXT NOT NULL DEFAULT '',
    private INTEGER NOT NULL DEFAULT 0, notice_off INTEGER NOT NULL DEFAULT 0, welcome TEXT NOT NULL DEFAULT 'inherit',
    PRIMARY KEY (tenant_id, chat)
  );
  CREATE TABLE IF NOT EXISTS chats_seen (
    tenant_id TEXT NOT NULL, chat TEXT NOT NULL, number TEXT NOT NULL DEFAULT 'main', is_group INTEGER NOT NULL,
    name TEXT, phone TEXT, last_at INTEGER, last_msg_id TEXT, last_from_me INTEGER, last_participant TEXT, last_msg_at INTEGER,
    PRIMARY KEY (tenant_id, chat)
  );
`);
// chat_prefs: fallback = per-chat fallback override (JSON { mode, chain }, 042); private = hidden from the owner
// assistant's cross-chat tools and the Ask box, notice_off = privacy-notice opt-out (044); welcome = "Welcome new
// members" override inherit | on | off (054). chats_seen.last_*: the newest message key and time per chat (any chat,
// also chats that are off): what WhatsApp needs to send earlier messages on demand (#91). Never text or names.
export const WELCOME_MODES = ['inherit', 'on', 'off'];
const parseFallback = (v) => { try { return v ? cleanOverride(JSON.parse(v)) : { mode: 'inherit', chain: [] }; } catch { return { mode: 'inherit', chain: [] }; } };

export const LOGGING_LEVELS = ['inherit', 'off', 'minimal', 'normal', 'verbose'];
const validModel = (v) => v === 'inherit' || v === 'auto' || v === 'smart' || REF_RE.test(v); // 088: smart = light or strong per message

// 032 (issue #10): chats are OFF until an admin switches them on. Messages from chats that are off are never stored
// or sent to a model (chat_prefs.enabled).
const cache = new Map();
export function getChatPrefs(chat) {
  if (!chat) return { model: 'inherit', logging: 'inherit', enabled: false, fallback: parseFallback(''), private: false, noticeOff: false, welcome: 'inherit' };
  if (cache.has(chat)) return cache.get(chat);
  const r = db.prepare('SELECT model, logging, enabled, fallback, private, notice_off, welcome FROM chat_prefs WHERE tenant_id = ? AND chat = ?').get(TENANT, chat);
  const v = { model: r?.model || 'inherit', logging: r?.logging || 'inherit', enabled: !!r?.enabled, fallback: parseFallback(r?.fallback), private: !!r?.private, noticeOff: !!r?.notice_off, welcome: WELCOME_MODES.includes(r?.welcome) ? r.welcome : 'inherit' };
  cache.set(chat, v);
  return v;
}
/**
 * Change some of a chat's settings; what is left out stays as it is.
 * @param {string} chat
 * @param {{ model?: string, logging?: string, enabled?: boolean, fallback?: any, private?: boolean, noticeOff?: boolean, welcome?: string }} change
 */
export function setChatPrefs(chat, { model, logging, enabled, fallback, private: priv, noticeOff, welcome }) {
  const cur = getChatPrefs(chat);
  const next = { model: model ?? cur.model, logging: logging ?? cur.logging, enabled: enabled === undefined ? cur.enabled : !!enabled,
    fallback: fallback === undefined ? cur.fallback : cleanOverride(fallback, 'fallback'),
    private: priv === undefined ? cur.private : !!priv, noticeOff: noticeOff === undefined ? cur.noticeOff : !!noticeOff,
    welcome: welcome ?? cur.welcome };
  if (!validModel(next.model)) throw fail('model must be inherit, auto, smart, provider:auto or provider:model', 400, { field: 'model' });
  if (!WELCOME_MODES.includes(next.welcome)) throw fail('welcome must be inherit, on or off', 400, { field: 'welcome' });
  if (!LOGGING_LEVELS.includes(next.logging)) throw fail(`logging must be one of ${LOGGING_LEVELS.join(', ')}`, 400, { field: 'logging' });
  const fb = next.fallback.mode === 'inherit' && !next.fallback.chain.length ? '' : JSON.stringify(next.fallback);
  db.prepare('INSERT OR REPLACE INTO chat_prefs (tenant_id, chat, model, logging, enabled, fallback, private, notice_off, welcome, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, chat, next.model, next.logging, next.enabled ? 1 : 0, fb, next.private ? 1 : 0, next.noticeOff ? 1 : 0, next.welcome, Date.now());
  cache.set(chat, next);
  return next;
}
/** 077: a chat's settings (on/off, model, private…), its Chats entry and its privacy-notice record move to a new id. */
export function moveChatPrefs(from, to) {
  for (const t of ['chat_prefs', 'chats_seen', 'privacy_notices']) {
    try { db.prepare(`UPDATE OR REPLACE ${t} SET chat = ? WHERE tenant_id = ? AND chat = ?`).run(to, TENANT, from); } catch { /* table not created in this process */ }
  }
  cache.delete(from); cache.delete(to);
}
export const allChatPrefs = () => Object.fromEntries(db.prepare('SELECT chat, model, logging, enabled, fallback, private, notice_off, welcome FROM chat_prefs WHERE tenant_id = ?').all(TENANT)
  .map((r) => [r.chat, { model: r.model, logging: r.logging, enabled: !!r.enabled, fallback: parseFallback(r.fallback), private: !!r.private, noticeOff: !!r.notice_off,
    welcome: WELCOME_MODES.includes(r.welcome) ? r.welcome : 'inherit' }]));
/** 044: chats marked "private to members" (never visible to the owner assistant or the Ask box). */
export const privateChats = () => db.prepare('SELECT chat FROM chat_prefs WHERE tenant_id = ? AND private = 1').all(TENANT).map((r) => r.chat);
export const isChatPrivate = (chat) => getChatPrefs(chat).private;
export const isChatEnabled = (chat) => getChatPrefs(chat).enabled;
export const enabledChats = () => db.prepare('SELECT chat FROM chat_prefs WHERE tenant_id = ? AND enabled = 1').all(TENANT).map((r) => r.chat);
/** Count of messages ignored because the chat is off (shown on the Chats page; in memory only). */
export const ignoredCounts = new Map();

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
export const seenChats = ({ groups = null } = {}) => db.prepare('SELECT chat, number, is_group, name, phone, last_at FROM chats_seen WHERE tenant_id = ? AND last_at IS NOT NULL ORDER BY last_at DESC LIMIT 500').all(TENANT)
  .filter((r) => groups === null || !!r.is_group === groups)
  .map((r) => ({ id: r.chat, number: r.number, isGroup: !!r.is_group, name: r.name || '', phone: r.phone || '', lastAt: r.last_at }));

/**
 * #91: remember the newest message key of chats (metadata only: id, fromMe, participant jid, time). `list` items:
 * { chat, number, isGroup, msgId, fromMe, participant, ts }. Only newer keys replace older ones. A chat known only this way
 * (last_at NULL) stays out of seenChats(): the People list shows only people who messaged while the app ran.
 */
const upsertKey = db.prepare(`INSERT INTO chats_seen (tenant_id, chat, number, is_group, last_at, last_msg_id, last_from_me, last_participant, last_msg_at)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
  ON CONFLICT(tenant_id, chat) DO UPDATE SET last_msg_id = excluded.last_msg_id, last_from_me = excluded.last_from_me,
    last_participant = excluded.last_participant, last_msg_at = excluded.last_msg_at
  WHERE COALESCE(chats_seen.last_msg_at, 0) < excluded.last_msg_at`);
export function noteLatestKeys(list) {
  const newest = new Map();
  for (const k of list || []) {
    if (!k?.chat || !k.msgId || !Number(k.ts)) continue;
    if ((newest.get(k.chat)?.ts || 0) < k.ts) newest.set(k.chat, k);
  }
  if (!newest.size) return 0;
  db.exec('BEGIN');
  try {
    for (const k of newest.values()) {
      upsertKey.run(TENANT, k.chat, k.number || 'main', k.isGroup ? 1 : 0, String(k.msgId).slice(0, 128), k.fromMe ? 1 : 0, String(k.participant || '').slice(0, 128), Number(k.ts));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return newest.size;
}
/** #91: the newest message key remembered for a chat, or null. */
export function latestKey(chat) {
  const r = db.prepare('SELECT last_msg_id, last_from_me, last_participant, last_msg_at FROM chats_seen WHERE tenant_id = ? AND chat = ?').get(TENANT, chat);
  return r?.last_msg_id ? { msgId: r.last_msg_id, fromMe: !!r.last_from_me, participant: r.last_participant || '', ts: r.last_msg_at } : null;
}
