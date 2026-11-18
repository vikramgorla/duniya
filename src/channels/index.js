// @ts-check
// The channel catalogue (075): what each channel is, what it can do, and how its chat ids look. Metadata only, so it
// is cheap to import anywhere (tools, panel, router); the adapters themselves load in hub.js with import(), only when
// a channel is set up and switched on.
//
// Chat ids: WhatsApp keeps its ids as they are (a JID, "<number>#<jid>" on other numbers), so no data migrates.
// Every other channel uses "<prefix>:<account>#<native id>", e.g. "tg:bot1#-1001234567" for a Telegram group.
import * as wa from './whatsapp/ids.js';
import * as tg from './telegram/ids.js';

/**
 * What a channel can do. Tools (chat-tools.js) name the capability they need; agents only get the tools the chat's
 * channel has. `groupAdmin` = rename, describe, picture, settings, leave; `groupMembers` = add, remove, promote.
 * @typedef {{ groups: boolean, media: boolean, voiceNotes: boolean, location: boolean, contactCards: boolean,
 *   reactions: boolean, quotes: boolean, edit: boolean, delete: boolean, polls: boolean, groupInvite: boolean,
 *   groupMembers: boolean, groupAdmin: boolean, profile: boolean, block: boolean, history: boolean,
 *   memberTags: boolean, typing: boolean, phoneNumbers: boolean, markup: 'whatsapp'|'markdown'|'plain', maxText: number }} Capabilities
 */

/** @type {Capabilities} */
const WHATSAPP_CAPS = { groups: true, media: true, voiceNotes: true, location: true, contactCards: true, reactions: true, quotes: true,
  edit: true, delete: true, polls: true, groupInvite: true, groupMembers: true, groupAdmin: true, profile: true, block: true,
  history: true, memberTags: true, typing: true, phoneNumbers: true, markup: 'whatsapp', maxText: 65536 };

/** 077: what a Telegram bot can do through the Bot API (no phone numbers, no history, no adding people by number). */
/** @type {Capabilities} */
const TELEGRAM_CAPS = { groups: true, media: true, voiceNotes: true, location: true, contactCards: true, reactions: true, quotes: true,
  edit: true, delete: true, polls: true, groupInvite: true, groupMembers: false, groupAdmin: true, profile: false, block: false,
  history: false, memberTags: false, typing: true, phoneNumbers: false, markup: 'whatsapp', maxText: 4096 };

/**
 * One entry per channel Duniya has. `prefix`: the chat id prefix ('' = unprefixed, WhatsApp only). `ids`: how its ids
 * read (isChat, isGroup, isDirect, phoneOf, personOf = the sender id of a direct chat, phoneChat = the direct chat with
 * a phone number, only on channels that use phone numbers). `setup`: how an owner connects it. `secret` (token
 * channels): the stored secret that sets it up, the pattern a value must match and what to say when it does not.
 */
export const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', prefix: '', setup: 'qr', caps: WHATSAPP_CAPS,
    ids: { isChat: wa.isWhatsAppChat, isGroup: wa.isGroupChat, isDirect: wa.isDirectChat, phoneOf: wa.phoneOfChat, personOf: wa.personJidOfChat,
      phoneChat: (account, phone) => wa.chatKey(account || wa.MAIN, wa.pnJid(phone)) } },
  { id: 'telegram', label: 'Telegram', prefix: tg.PREFIX, setup: 'token', caps: TELEGRAM_CAPS,
    secret: { name: 'TELEGRAM_BOT_TOKEN', pattern: /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/, hint: 'This does not look like a bot token from @BotFather (digits, a colon, then about 35 letters and digits).' },
    ids: { isChat: tg.isTelegramChat, isGroup: tg.isGroupChat, isDirect: tg.isDirectChat, phoneOf: () => '', personOf: tg.personOfChat } },
];
const PREFIXED = /^([a-z]{2,8}):([^#]*)#(.+)$/;

/** The catalogue entry of a channel id ('whatsapp'), or undefined. */
export const channelInfo = (id) => CHANNELS.find((c) => c.id === id);

/** The channel a chat id belongs to ('whatsapp', …), '' when none (the test console, the owner's Ask box). */
export function channelOf(chat) {
  const s = String(chat || '');
  const m = PREFIXED.exec(s);
  if (m) return CHANNELS.find((c) => c.prefix === m[1])?.id || '';
  return CHANNELS.find((c) => !c.prefix && c.ids.isChat(s))?.id || '';
}
/** { channel, account, native } of a chat id. WhatsApp: account = the number id, native = the JID. */
export function splitChatId(chat) {
  const s = String(chat || '');
  const m = PREFIXED.exec(s);
  if (m) return { channel: CHANNELS.find((c) => c.prefix === m[1])?.id || '', account: m[2], native: m[3] };
  const { number, jid } = wa.splitChat(s);
  return { channel: channelOf(s), account: number, native: jid };
}
/** The app chat id of a native chat on an account of a channel. */
export function chatKey(channel, account, native) {
  const c = channelInfo(channel);
  if (!c) throw new Error(`Unknown channel "${channel}"`);
  return c.prefix ? `${c.prefix}:${account}#${native}` : wa.chatKey(account || wa.MAIN, native);
}
const ids = (chat) => channelInfo(channelOf(chat))?.ids;
export const isGroup = (chat) => !!ids(chat)?.isGroup(String(chat));
export const isDirect = (chat) => !!ids(chat)?.isDirect(String(chat));
/** Phone digits a direct chat's id carries ('' when the channel does not use phone numbers or does not know it). */
export const phoneOf = (chat) => ids(chat)?.phoneOf(String(chat)) || '';
/** The sender id of a direct chat (WhatsApp: the person's JID), '' for groups and unknown chats. */
export const personOfChat = (chat) => ids(chat)?.personOf(String(chat)) || '';
/** The id to show when a chat has no name yet: "+41 …" for a phone, else the bare native id. Never shown for groups. */
export const displayId = (chat) => { const p = phoneOf(chat); return p ? `+${p}` : splitChatId(chat).native; };
/** Capabilities of the chat's channel, or null when no channel owns the chat id. */
export const capsOf = (chat) => channelInfo(channelOf(chat))?.caps || null;
/** The direct chat with a phone number on a phone-based channel (default: WhatsApp, first number). */
export const phoneChat = (phone, { channel = 'whatsapp', account = wa.MAIN } = {}) => {
  const make = channelInfo(channel)?.ids.phoneChat;
  if (!make) throw new Error(`${channelInfo(channel)?.label || channel} has no phone numbers`);
  return make(account, phone);
};
