// Group member tags (057, #110): WhatsApp's per-group labels for members ("Driver", "Treasurer"). The sender's tag
// travels with each of their group messages (contextInfo.memberLabel), so a tag shows up as soon as the person writes
// (or from loaded history). Tag changes (GROUP_MEMBER_LABEL_CHANGE) and history-sync group metadata update it too.
// There is no query for the tags of people who have not written. Stored only for chats that are switched on (#10);
// erased with the chat's memory. An empty label means the tag was removed.
import { db } from './db.js';
import { digits } from './config.js';
import { isChatEnabled } from './chat-prefs.js';
import { mapLid, bareJid as bare } from './contacts.js';

const up = db.prepare(`INSERT INTO member_tags (chat, member, phone, label, ts) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (chat, member) DO UPDATE SET label = excluded.label, ts = excluded.ts, phone = COALESCE(NULLIF(excluded.phone, ''), member_tags.phone)
  WHERE excluded.ts >= member_tags.ts`);

/**
 * A tag event { chat (app chat id), participant (jid, often a LID), phone (digits, when known), label ('' = removed),
 * ts (ms) }. Ignored for chats that are off. Older events never replace newer ones. Returns true when stored.
 */
export function saveMemberTag({ chat, participant, phone = '', label = '', ts = Date.now() } = {}) {
  const member = bare(participant) || (digits(phone) ? `${digits(phone)}@s.whatsapp.net` : '');
  if (!chat || !member || !isChatEnabled(chat)) return false;
  const p = digits(phone);
  if (p && member.endsWith('@lid')) mapLid(member, p);
  const text = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return up.run(chat, member, p, text, Math.floor(Number(ts) || Date.now())).changes > 0;
}

/** Tags of a chat: Map with both the member jid and the phone digits as keys → label. Empty for chats that are off. */
export function tagsInChat(chat) {
  const out = new Map();
  if (!chat || !isChatEnabled(chat)) return out;
  for (const r of db.prepare("SELECT member, phone, label FROM member_tags WHERE chat = ? AND label <> ''").all(chat)) {
    out.set(r.member, r.label);
    if (r.phone) out.set(r.phone, r.label);
  }
  return out;
}
/** One member's tag in a chat (by phone digits and/or jid), '' when none. */
export function memberTag(chat, { phone = '', jid = '' } = {}, tags = null) {
  const m = tags || tagsInChat(chat);
  return m.get(digits(phone)) || m.get(bare(jid)) || (digits(phone) ? m.get(`${digits(phone)}@s.whatsapp.net`) : '') || '';
}

/** Handler the channels call (registered from index.js). */
export const createMemberTagHandler = () => async (ev) => { try { saveMemberTag(ev); } catch { /* best effort */ } };
