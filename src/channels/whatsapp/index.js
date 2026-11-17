// @ts-check
// WhatsApp, channel adapter #1 (075; several numbers since 012). Each number is its own linked-device session
// (session.js, Baileys). The adapter looks like one channel to the hub: chats on the first number keep their plain
// WhatsApp id (no migration), chats on other numbers are prefixed "<number>#<jid>", and every action routes to the
// right session from the chat id. The hub loads this module with import() only when WhatsApp is set up and on.
import { resolve } from 'node:path';
import { DATA_DIR, fail } from '../../core/config.js';
import { getSetting, updateSettings } from '../../core/store.js';
import { activity } from '../../core/events.js';
import { resolveDirectChat } from '../../core/direct-chats.js';
import { MAIN, chatKey, splitChat } from './ids.js';
import { createWhatsAppSession } from './session.js';

const NUMBER_ID_RE = /^[a-z][a-z0-9-]{1,23}$/;

/** WhatsApp actions (026) that act on one chat: adapter.<name>(chat, ...args) → session.<name>(jid, ...args). */
const CHAT_ACTIONS = ['send', 'groupMembers', 'refreshGroup', 'sendMedia', 'sendLocation', 'sendContact', 'react', 'editMessage', 'deleteMessage', 'markRead', 'presence', 'sendPoll',
  'downloadMedia', 'fetchHistory', 'groupInfo', 'groupInviteLink', 'groupRevokeInvite', 'groupParticipants', 'groupSubject', 'groupDescription', 'groupPicture', 'groupSettings', 'groupLeave'];
/** Actions of the number itself: adapter.<name>(chat, ...args) → session.<name>(...args) on the chat's number. */
const NUMBER_ACTIONS = ['profile', 'block', 'unblock', 'setProfileName', 'setProfileStatus'];

const numbersSetting = () => {
  const list = getSetting('whatsappNumbers', null);
  return Array.isArray(list) && list.length ? list : [{ id: MAIN, label: 'Main' }];
};

/** `factory` makes one session per number (tests pass fakes). */
export function createWhatsAppAdapter({ factory = createWhatsAppSession } = {}) {
  const sessions = new Map(); // id -> session
  /** @type {any} */ let on = null; // the hub's handlers

  const make = (n) => factory({ number: n.id, label: n.label, authDir: resolve(DATA_DIR, n.id === MAIN ? 'whatsapp-auth' : `whatsapp-auth-${n.id}`) });
  const wrapMsg = (n) => (m) => ({ ...m, chat: chatKey(n.id, m.chat), number: n.id });
  async function startOne(n) {
    const ch = make(n);
    sessions.set(n.id, ch);
    if (!on) return ch;
    const wrap = wrapMsg(n);
    // 049: a prepared person's LID chat arrives under the prepared chat id
    await ch.start(async (m) => on.onMessage(resolveDirectChat(wrap(m))), { onHistory: async (msgs, meta = {}) => on.onHistory?.(msgs.map(wrap), { ...meta, // #91: keys and chats in app chat ids
      keys: (meta.keys || []).map((k) => ({ ...k, chat: chatKey(n.id, k.chat), number: n.id })), chats: (meta.chats || []).map((c) => chatKey(n.id, c)) }),
    onJoin: async (ev) => on.onJoin?.({ ...ev, chat: chatKey(n.id, ev.chat) }), // 054: welcome
    onMemberTag: async (ev) => on.onMemberTag?.({ ...ev, chat: chatKey(n.id, ev.chat) }), // 057: member tags
    onPhoneActive: (ev) => on.onPhoneActive?.({ ...ev, number: n.id }), // 057: retry history loads
    onGroupChange: (ev) => on.onGroupChange?.({ ...ev, chat: chatKey(n.id, ev.chat) }) }); // 057: refresh member list
    return ch;
  }
  const route = (chat) => {
    const { number, jid } = splitChat(chat);
    const ch = sessions.get(number);
    if (!ch) throw new Error(`WhatsApp number "${number}" is not set up`);
    return { ch, jid };
  };
  const byNumber = (id = MAIN) => {
    const ch = sessions.get(id || MAIN);
    if (!ch) throw fail(`Unknown number "${id}"`, 404);
    return ch;
  };

  const actions = {};
  for (const name of CHAT_ACTIONS) {
    actions[name] = async (chat, ...args) => {
      const { ch, jid } = route(chat);
      if (typeof ch[name] !== 'function') throw fail(`This WhatsApp number cannot ${name}`, 501);
      return ch[name](jid, ...args);
    };
  }
  for (const name of NUMBER_ACTIONS) {
    actions[name] = async (chat, ...args) => {
      const { ch } = route(chat);
      if (typeof ch[name] !== 'function') throw fail(`This WhatsApp number cannot ${name}`, 501);
      return ch[name](...args);
    };
  }

  return {
    id: 'whatsapp',
    ...actions,
    /** New group on a number; returns its chat id as the rest of the app sees it. */
    async groupCreate(number, subject, people) {
      const g = await byNumber(number).groupCreate(subject, people);
      return { ...g, id: chatKey(number || MAIN, g.id) };
    },
    /** Connect every number. `handlers` = { onMessage, onHistory?, onJoin?, onMemberTag?, onPhoneActive?, onGroupChange? }. */
    async start(handlers) {
      on = handlers;
      for (const n of numbersSetting()) await startOne(n);
    },
    async typing(chat) { const { ch, jid } = route(chat); await ch.typing?.(jid); },
    async chatName(chat) { const { ch, jid } = route(chat); return (await ch.chatName?.(jid)) || ''; },
    async isMember(chat, phone, senderJid) { const { ch, jid } = route(chat); return ch.isMember(jid, phone, senderJid); },
    async listChats() {
      const out = [];
      for (const n of numbersSetting()) {
        const ch = sessions.get(n.id); if (!ch) continue;
        for (const g of await ch.listChats().catch(() => [])) out.push({ ...g, id: chatKey(n.id, g.id), number: n.id, numberLabel: n.label });
      }
      return out;
    },
    /** First number's status at the top level (as before) plus every number under `numbers`. */
    async status() {
      const numbers = [];
      for (const n of numbersSetting()) {
        const ch = sessions.get(n.id);
        numbers.push({ id: n.id, label: n.label, dmAgent: n.dmAgent || '', ...(ch ? await ch.status() : { status: 'stopped' }) });
      }
      return { ...(numbers[0] || { status: 'stopped' }), numbers };
    },
    /** 049: is this phone on WhatsApp (and its LID, when WhatsApp shares it)? { exists, jid, lid } or null when unknown. */
    async lookupNumber(number, phone) { const ch = byNumber(number); return ch.lookupNumber ? ch.lookupNumber(phone) : null; },
    /** 057: shared upkeep tick — the first number whose names refresh is due does it (one per tick). */
    async upkeep() {
      for (const ch of sessions.values()) { const r = await ch.upkeep?.().catch(() => null); if (r?.ok || (r && r.reason !== 'not_due')) return r; }
      return { ok: false, reason: 'not_due' };
    },
    /** 057: refresh address-book names on every number (each number also does this by itself). */
    async refreshNames() {
      const out = [];
      for (const [id, ch] of sessions) out.push({ number: id, ...(ch.refreshNames ? await ch.refreshNames().catch(() => ({ ok: false })) : { ok: false, reason: 'unsupported' }) });
      return out;
    },
    /** 069: graceful shutdown, 075: switched off: every number's socket closes (still linked), no reconnect. */
    async stop() { for (const ch of sessions.values()) await ch.stop?.().catch(() => {}); },
    pair: (phone, number) => byNumber(number).pair(phone),
    logout: (number) => byNumber(number).logout(),
    restart: (number) => byNumber(number).restart(),
    async addNumber({ id, label }) {
      const list = numbersSetting();
      const nid = String(id || '').trim().toLowerCase() || `n${list.length + 1}`;
      if (!NUMBER_ID_RE.test(nid) || nid === MAIN) throw fail('Id: 2–24 lowercase letters, digits or -', 400, { field: 'id' });
      if (list.some((n) => n.id === nid)) throw fail('That id is already used', 400, { field: 'id' });
      const n = { id: nid, label: String(label || nid).trim().slice(0, 40) };
      updateSettings({ whatsappNumbers: [...list, n] });
      await startOne(n);
      activity('config', { summary: `WhatsApp number added: ${n.label}` });
      return n;
    },
    async renameNumber(id, label) {
      const list = numbersSetting().map((n) => (n.id === id ? { ...n, label: String(label || n.label).trim().slice(0, 40) } : n));
      updateSettings({ whatsappNumbers: list });
      return list.find((n) => n.id === id);
    },
    async removeNumber(id) {
      if (id === MAIN) throw fail('The first number can be unlinked, not removed');
      const ch = sessions.get(id);
      if (!ch) throw fail('Unknown number', 404);
      await ch.remove?.();
      sessions.delete(id);
      updateSettings({ whatsappNumbers: numbersSetting().filter((n) => n.id !== id) });
      activity('config', { summary: `WhatsApp number removed: ${id}` });
      return { ok: true };
    },
  };
}
