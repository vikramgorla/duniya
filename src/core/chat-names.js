// @ts-check
// One resolver for chat names (073). Everything that shows a chat — the panel API (silences, activity, pending, usage,
// caps, Review, search), the admin MCP tools, the owner assistant and its alerts — asks here, so a chat is its name
// everywhere and never its id: a group is its WhatsApp subject (remembered in chats_seen, so it is known while
// WhatsApp is offline), "Unnamed group" until it is known; a person is the contacts resolver's label (own name,
// phone contact, business or profile name, else +number, else "Unknown (hidden number)").
import { db } from './db.js';
import './chat-prefs.js'; // chats_seen
import { personInfo } from './contacts.js';

const TENANT = 'default';
export const UNNAMED_GROUP = 'Unnamed group';
const jidOf = (chat) => chat.slice(chat.indexOf('#') + 1); // "<number>#<jid>" on other numbers (012)
const isGroup = (chat) => jidOf(String(chat)).endsWith('@g.us');
const getSeen = db.prepare('SELECT name, phone FROM chats_seen WHERE tenant_id = ? AND chat = ?');
// A group that is new to chats_seen stays out of seenChats() (last_at NULL): it only carries the name.
const putName = db.prepare(`INSERT INTO chats_seen (tenant_id, chat, is_group, name) VALUES (?, ?, 1, ?)
  ON CONFLICT(tenant_id, chat) DO UPDATE SET name = excluded.name WHERE COALESCE(chats_seen.name, '') <> excluded.name`);
const subjects = new Map(); // group → subject, so a known name costs no query
const asked = new Map(); // group → when WhatsApp was last asked without an answer (asked again after 10 minutes)

/** Remember group subjects WhatsApp told us ([{ id, name }]); the channel registry calls this for every lookup. */
export function rememberGroupNames(list) {
  for (const g of list || []) {
    const name = String(g?.name || '').trim().slice(0, 100);
    if (!g?.id || !name || !isGroup(g.id) || subjects.get(g.id) === name) continue;
    subjects.set(g.id, name); asked.delete(g.id);
    try { putName.run(TENANT, g.id, name); } catch { /* best effort */ }
  }
}

/** The name to show for a chat, from what is stored (no network). Never an id for a WhatsApp chat. */
export function chatLabel(id) {
  const chat = String(id || '');
  if (!chat) return '';
  if (isGroup(chat)) {
    if (!subjects.has(chat)) { const n = getSeen.get(TENANT, chat)?.name; if (n) subjects.set(chat, n); }
    return subjects.get(chat) || UNNAMED_GROUP;
  }
  const jid = jidOf(chat);
  if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) return chat; // not a WhatsApp chat (the test console's own words)
  const seen = getSeen.get(TENANT, chat);
  return personInfo({ phone: seen?.phone || '', jid, fallbackName: seen?.name || '' }).label;
}

/**
 * Names for many chats: groups not known yet are asked from WhatsApp once (then remembered; a group that does not
 * answer is asked again after 10 minutes at the earliest). Returns a Map id → name.
 */
export async function chatLabels(ids, channel) {
  const out = new Map();
  for (const id of new Set([...(ids || [])].filter(Boolean).map(String))) {
    if (isGroup(id) && chatLabel(id) === UNNAMED_GROUP && channel?.chatName && Date.now() - (asked.get(id) || 0) > 600000) {
      asked.set(id, Date.now());
      rememberGroupNames([{ id, name: await channel.chatName(id).catch(() => '') }]);
    }
    out.set(id, chatLabel(id));
  }
  return out;
}

/** Adds `chatName` to rows that have a `chat` (activity entries, silences, pending changes, usage rows…). */
export async function withChatNames(rows, channel, key = 'chat') {
  const names = await chatLabels(rows.map((r) => r?.[key]), channel);
  return rows.map((r) => (r?.[key] ? { ...r, chatName: names.get(String(r[key])) } : r));
}
