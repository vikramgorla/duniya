// @ts-check
// WhatsApp ids (075): the one place that knows JIDs. No Baileys here, so the rest of the app can ask about a chat id
// without loading WhatsApp. Chats on the first number ("main") keep their plain WhatsApp id; chats on other numbers
// are "<number>#<jid>" (012). A group is "<id>@g.us"; a person is "<digits>@s.whatsapp.net" (phone form) or
// "<id>@lid" (WhatsApp's private id, the phone may be unknown).
import { digits } from '../../core/config.js';

export const MAIN = 'main';
export const chatKey = (number, jid) => (number === MAIN ? jid : `${number}#${jid}`);
export const splitChat = (chat) => { const s = String(chat); const i = s.indexOf('#'); return i > 0 ? { number: s.slice(0, i), jid: s.slice(i + 1) } : { number: MAIN, jid: s }; };
const jidOf = (chat) => splitChat(chat).jid;

export const isGroupJid = (jid) => String(jid || '').endsWith('@g.us');
export const isLidJid = (jid) => /@(lid|hosted\.lid)$/.test(String(jid || ''));
export const isPnJid = (jid) => /@(s\.whatsapp\.net|c\.us|hosted)$/.test(String(jid || ''));
/** user part of a jid without device: "123:4@lid" → "123@lid". */
export const bareJid = (j) => { const s = String(j || ''); const at = s.indexOf('@'); return at < 0 ? '' : `${s.slice(0, at).split(':')[0]}${s.slice(at)}`; };
/** Phone digits of a phone-form jid ("41791234567:3@s.whatsapp.net" → "41791234567"), '' for a LID or a group. */
export const pnDigits = (j) => (isPnJid(j) ? digits(String(j).split('@')[0].split(':')[0]) : '');
/** The phone-form jid of a number (any format). */
export const pnJid = (phone) => `${digits(phone)}@s.whatsapp.net`;

/** Does this app chat id belong to WhatsApp? */
export const isWhatsAppChat = (chat) => /@(g\.us|s\.whatsapp\.net|lid)$/.test(jidOf(chat || ''));
export const isGroupChat = (chat) => isGroupJid(jidOf(chat));
export const isDirectChat = (chat) => /@(s\.whatsapp\.net|lid)$/.test(jidOf(chat));
/** Phone digits a direct chat id carries (phone form only), else ''. */
export const phoneOfChat = (chat) => pnDigits(jidOf(chat));
/** The sender jid of a direct chat (for name lookups), '' for groups. */
export const personJidOfChat = (chat) => (isDirectChat(chat) ? jidOf(chat) : '');
