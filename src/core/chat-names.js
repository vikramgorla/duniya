// @ts-check
// One resolver for chat names (073). Everything that shows a chat — the panel API (silences, activity, pending, usage,
// caps, Review, search), the admin MCP tools, the owner assistant and its alerts — asks here, so a chat is its name
// everywhere and never its id: a group is its WhatsApp subject (remembered in chats_seen, so it is known while
// WhatsApp is offline), "Unnamed group" until it is known; a person is the contacts resolver's label (own name,
// phone contact, business or profile name, else +number, else "Unknown (hidden number)").
import { db } from './db.js';
import './chat-prefs.js'; // chats_seen
import { personInfo } from './contacts.js';
import { isGroup, personOfChat, testChatOf } from '../channels/index.js';

const TENANT = 'default';
export const UNNAMED_GROUP = 'Unnamed group';
const TEST_LABEL = 'Panel test'; // the test console's chats (testChatId)
const getSeen = db.prepare('SELECT name, phone FROM chats_seen WHERE tenant_id = ? AND chat = ?');
// A group that is new to chats_seen stays out of seenChats() (last_at NULL): it only carries the name.
const putName = db.prepare(`INSERT INTO chats_seen (tenant_id, chat, is_group, name) VALUES (?, ?, 1, ?)
  ON CONFLICT(tenant_id, chat) DO UPDATE SET name = excluded.name WHERE COALESCE(chats_seen.name, '') <> excluded.name`);
const subjects = new Map(); // group → subject, so a known name costs no query
const asked = new Map(); // group → when WhatsApp was last asked without an answer
const ASK_AGAIN = 10 * 60 * 1000; // ms before a group that did not answer is asked again
const NAMES_PER_TICK = 3; // groups asked per upkeep tick
const WANTED_MAX = 500; // groups waiting for a name, at most
const wanted = new Set(); // groups a list showed without a name

/** Remember group subjects WhatsApp told us ([{ id, name }]); the channel registry calls this for every lookup. */
export function rememberGroupNames(list) {
  for (const g of list || []) {
    const name = String(g?.name || '').trim().slice(0, 100);
    if (!g?.id || !name || !isGroup(g.id) || subjects.get(g.id) === name) continue;
    subjects.set(g.id, name); asked.delete(g.id); wanted.delete(g.id);
    try { putName.run(TENANT, g.id, name); } catch { /* best effort */ }
  }
}

/** The name to show for a chat, from what is stored (no network). Never an id for a channel's chat. */
export function chatLabel(id) {
  const chat = String(id || '');
  if (!chat) return '';
  if (isGroup(chat)) {
    if (!subjects.has(chat)) { const n = getSeen.get(TENANT, chat)?.name; if (n) subjects.set(chat, n); }
    return subjects.get(chat) || UNNAMED_GROUP;
  }
  const test = testChatOf(chat);
  if (test) return test.chat ? `${TEST_LABEL} in ${chatLabel(test.chat)}` : TEST_LABEL;
  const jid = personOfChat(chat);
  if (!jid) return chat; // not a chat on a channel
  const seen = getSeen.get(TENANT, chat);
  return personInfo({ phone: seen?.phone || '', jid, fallbackName: seen?.name || '' }).label;
}

/**
 * Names for many chats, from what is stored: a list never asks a channel. A group without a name yet is noted and
 * asked in the background (namesTick), so a later load shows it. Returns a Map id → name.
 */
export function chatLabels(ids) {
  const out = new Map();
  for (const id of new Set([...(ids || [])].filter(Boolean).map(String))) {
    const name = chatLabel(id);
    if (name === UNNAMED_GROUP && isGroup(id) && wanted.size < WANTED_MAX) wanted.add(id);
    out.set(id, name);
  }
  return out;
}

/** Upkeep: ask the channel for a few names lists were missing (the hub remembers every answer). A group that does not
 *  answer is asked again after ASK_AGAIN at the earliest. Returns how many were asked. */
export async function namesTick(channel, now = Date.now()) {
  if (typeof channel?.chatName !== 'function') return 0;
  const due = [...wanted].filter((id) => now - (asked.get(id) || 0) > ASK_AGAIN).slice(0, NAMES_PER_TICK);
  await Promise.all(due.map(async (id) => {
    asked.set(id, now);
    rememberGroupNames([{ id, name: await channel.chatName(id).catch(() => '') }]);
  }));
  return due.length;
}

/** Adds `chatName` to rows that have a `chat` (activity entries, silences, pending changes, usage rows…). */
export function withChatNames(rows, key = 'chat') {
  const names = chatLabels(rows.map((r) => r?.[key]));
  return rows.map((r) => (r?.[key] ? { ...r, chatName: names.get(String(r[key])) } : r));
}
