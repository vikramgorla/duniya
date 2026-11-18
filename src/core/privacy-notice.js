// Privacy notice (044, issue #50; owner decision: on by default). When a group chat is switched on, the WhatsApp number
// posts one short notice that messages are stored. It is posted again after the chat was off only when the text changed
// or the last post is more than 90 days old. Per-chat opt-out is possible and recorded. Direct messages never get a
// post: the notice is added once per person to the agent's first reply instead. Chats that are off never get anything.
import { db } from './db.js';
import { getSetting, updateSettings, TENANT } from './store.js';
import { getChatPrefs, setChatPrefs } from './chat-prefs.js';
import { agentForChat } from './agents.js';
import { activity } from './events.js';
import { sha256 } from './crypto.js';
import { bad } from './config.js';
import { isGroup } from '../channels/index.js';
import { noticePostedInGroup, noticeSeenInDm } from './people-access.js';

export const DEFAULT_GROUP_TEXT = 'Messages in this group are stored so the assistant has context. The group\'s organiser can review them. Ask an organiser if you have questions.';
export const DEFAULT_DM_TEXT = 'Messages in this chat are stored so the assistant has context. The organiser can review them.';
const REPOST_DAYS = 90;

db.exec(`
  CREATE TABLE IF NOT EXISTS privacy_notices (
    tenant_id TEXT NOT NULL, chat TEXT NOT NULL, text_hash TEXT NOT NULL, posted_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, chat)
  );
  CREATE TABLE IF NOT EXISTS privacy_dm_seen (
    tenant_id TEXT NOT NULL, who TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (tenant_id, who)
  );
`);

/** { enabled, text, dmFirstReply, dmText } with defaults (enabled and DM notice on). */
export function noticeSettings() {
  const s = getSetting('privacyNotice', null) || {};
  return {
    enabled: s.enabled !== false,
    text: String(s.text || '').trim() || DEFAULT_GROUP_TEXT,
    dmFirstReply: s.dmFirstReply !== false,
    dmText: String(s.dmText || '').trim() || DEFAULT_DM_TEXT,
  };
}
export function setNoticeSettings({ enabled, text, dmFirstReply, dmText } = {}, by = '') {
  const cur = noticeSettings();
  const clean = (v, field) => {
    const t = String(v ?? '').trim();
    if (t.length > 500) throw bad('Keep the notice under 500 characters', field);
    return t;
  };
  const next = {
    enabled: enabled === undefined ? cur.enabled : !!enabled,
    text: text === undefined ? cur.text : clean(text, 'text') || DEFAULT_GROUP_TEXT,
    dmFirstReply: dmFirstReply === undefined ? cur.dmFirstReply : !!dmFirstReply,
    dmText: dmText === undefined ? cur.dmText : clean(dmText, 'dmText') || DEFAULT_DM_TEXT,
  };
  updateSettings({ privacyNotice: next });
  activity('config', { summary: `Privacy notice: ${next.enabled ? 'posted when a group is switched on' : 'off'}; direct messages ${next.dmFirstReply ? 'see it once' : 'don\'t see it'} (${by || 'panel'})` });
  return next;
}

const lastPost = (chat) => db.prepare('SELECT text_hash, posted_at FROM privacy_notices WHERE tenant_id = ? AND chat = ?').get(TENANT, chat) || null;

/** Why the notice would (not) be posted in a chat now: { post, reason }. */
export function noticeDecision(chat, now = Date.now()) {
  const s = noticeSettings();
  if (!isGroup(chat)) return { post: false, reason: 'not a group' };
  if (!getChatPrefs(chat).enabled) return { post: false, reason: 'chat is off' };
  if (!s.enabled) return { post: false, reason: 'notice is off' };
  if (getChatPrefs(chat).noticeOff) return { post: false, reason: 'opted out for this chat' };
  const last = lastPost(chat);
  if (!last) return { post: true, reason: 'first time' };
  if (last.text_hash !== sha256(s.text)) return { post: true, reason: 'text changed' };
  if (now - last.posted_at > REPOST_DAYS * 86400000) return { post: true, reason: `last posted over ${REPOST_DAYS} days ago` };
  return { post: false, reason: 'already posted' };
}

/** Called when a chat is switched on. Never throws; returns { posted, reason }. */
export async function maybePostNotice(chat, channel) {
  const d = noticeDecision(chat);
  if (!d.post || !channel?.send) return { posted: false, reason: d.reason };
  const { text } = noticeSettings();
  const agent = agentForChat(chat);
  try {
    await channel.send(chat, text);
  } catch (e) {
    activity('error', { chat, agent: agent?.id || '', summary: `Privacy notice not posted: ${e.message}` });
    return { posted: false, reason: e.message };
  }
  db.prepare('INSERT OR REPLACE INTO privacy_notices (tenant_id, chat, text_hash, posted_at) VALUES (?, ?, ?, ?)').run(TENANT, chat, sha256(text), Date.now());
  noticePostedInGroup(chat); // 079: a consent record for everyone known to be in the group (later members when noted)
  activity('config', { chat, agent: agent?.id || '', summary: `Privacy notice posted (${d.reason})` });
  return { posted: true, reason: d.reason };
}

/** Per-chat opt-out of the notice (recorded in Activity). */
export function setChatNoticeOff(chat, off, by = '') {
  const out = setChatPrefs(chat, { noticeOff: !!off });
  activity('config', { chat, summary: `Privacy notice ${off ? 'switched OFF for this chat' : 'back ON for this chat'} (${by || 'panel'})` });
  return out;
}

/** When the notice was last posted in a chat (for the Chats page), or null. */
export const noticePostedAt = (chat) => lastPost(chat)?.posted_at || null;

/**
 * Direct messages: the notice line to add to the agent's first reply to this person, once (or '' if not needed).
 * `who` is the sender's phone digits (or the chat id when WhatsApp hides the number).
 */
export function dmNoticeOnce(who) {
  const s = noticeSettings();
  if (!s.enabled || !s.dmFirstReply || !who) return '';
  const r = db.prepare('INSERT OR IGNORE INTO privacy_dm_seen (tenant_id, who, ts) VALUES (?, ?, ?)').run(TENANT, String(who), Date.now());
  if (r.changes) noticeSeenInDm(who); // 079: recorded on the person (consent: privacy notice seen)
  return r.changes ? s.dmText : '';
}
/** The DM notice line the next message to this person would carry (or ''), without recording it (049: intro preview). */
export function dmNoticePending(who) {
  const s = noticeSettings();
  if (!s.enabled || !s.dmFirstReply || !who) return '';
  return db.prepare('SELECT 1 FROM privacy_dm_seen WHERE tenant_id = ? AND who = ?').get(TENANT, String(who)) ? '' : s.dmText;
}
