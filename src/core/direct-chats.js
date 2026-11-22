// Prepared direct chats (049, issue #92). The owner sets up a 1:1 chat — agent, on/off, private, model, logging,
// fallback, spending cap — for a phone number before that person has written. The chat id is the one WhatsApp uses:
// their private id (`…@lid`) when it is known, else the phone form `<digits>@s.whatsapp.net` (prefixed `<number>#` on
// other WhatsApp numbers, src/channels/whatsapp/ids.js). When WhatsApp later delivers their messages from the LID, a
// phone-form chat with settings or an agent (prepared here or set up on its chat page) joins the LID chat
// (chat-merge.js) and stays as an alias, so there is one chat per person. Only settings are stored here, never text.
import { db, logMessage } from './db.js';
import { digits, bad } from './config.js';
import { TENANT, getSetting } from './store.js';
import { getAgent, bindChat, agentForChat, listAgents } from './agents.js';
import { mergeChats, moveChatRows } from './chat-merge.js';
import { getChatPrefs, setChatPrefs, seenChats } from './chat-prefs.js';
import { setCap } from './budget.js';
import { lidPhone, personInfo } from './contacts.js';
import { activity } from './events.js';
import { dmNoticeOnce, dmNoticePending } from './privacy-notice.js';
import { putTtl, takeTtl } from './ttl-store.js';
import { newToken, sha256 } from './crypto.js';
import { takeNewChat } from './pace.js';
import { MAIN, chatKey, splitChat, isLidJid, pnJid, isDirectChat as isDirect, phoneOfChat } from '../channels/whatsapp/ids.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS direct_chats (
    tenant_id TEXT NOT NULL, chat TEXT NOT NULL, number TEXT NOT NULL DEFAULT 'main', phone TEXT NOT NULL, lid TEXT NOT NULL DEFAULT '',
    on_whatsapp INTEGER, created_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, first_at INTEGER, intro_at INTEGER,
    PRIMARY KEY (tenant_id, chat)
  );
  CREATE TABLE IF NOT EXISTS chat_aliases (
    tenant_id TEXT NOT NULL, alias TEXT NOT NULL, chat TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, alias)
  );
`);

const INTRO_KIND = 'dm-intro';
const INTRO_TTL = 10 * 60000;

/** A phone number in E.164 form (+41 79 123 45 67, 0041…, spaces/dashes allowed) → digits; throws a 400 otherwise. */
export function normalizePhone(input) {
  const s = String(input ?? '').trim();
  const hint = 'Enter the number with country code, e.g. +41 79 123 45 67';
  if (!s) throw bad(hint, 'phone');
  if (!/^\+?[\d\s().\-/]+$/.test(s)) throw bad(`"${s.slice(0, 30)}" is not a phone number. ${hint}`, 'phone');
  let d = digits(s);
  if (!s.startsWith('+') && d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) throw bad(`The number needs its country code. ${hint}`, 'phone');
  if (d.length < 8 || d.length > 15) throw bad(`A phone number has 8 to 15 digits with its country code. ${hint}`, 'phone');
  return d;
}

/** The WhatsApp numbers set up on this server (first one: main). */
const numbersList = () => { const l = getSetting('whatsappNumbers', null); return Array.isArray(l) && l.length ? l : [{ id: MAIN, label: 'Main' }]; };
function resolveNumber(v) {
  const want = String(v || MAIN).trim().toLowerCase();
  const n = numbersList().find((x) => x.id === want || String(x.label || '').toLowerCase() === want);
  if (!n) throw bad(`Unknown WhatsApp number "${v}". Use one of: ${numbersList().map((x) => x.id).join(', ')}`, 'number');
  return n;
}

// ---------------------------------------------------------------- cache (one lookup per incoming direct message)
let cache = null; // { prepared: Map(chat -> row), aliases: Map(alias -> chat) }
function load() {
  if (cache) return cache;
  cache = {
    prepared: new Map(db.prepare('SELECT * FROM direct_chats WHERE tenant_id = ?').all(TENANT).map((r) => [r.chat, r])),
    aliases: new Map(db.prepare('SELECT alias, chat FROM chat_aliases WHERE tenant_id = ?').all(TENANT).map((r) => [r.alias, r.chat])),
  };
  return cache;
}
const reload = () => { cache = null; return load(); };

/** Does this chat id have settings or an agent of its own? (Then it is never aliased to another chat.) */
const hasOwnEntry = (chat) => !!db.prepare('SELECT 1 FROM chat_prefs WHERE tenant_id = ? AND chat = ?').get(TENANT, chat) || !!agentForChat(chat);

function addAlias(alias, chat) {
  if (!alias || alias === chat) return;
  db.prepare('INSERT OR REPLACE INTO chat_aliases (tenant_id, alias, chat, created_at) VALUES (?, ?, ?, ?)').run(TENANT, alias, chat, Date.now());
  load().aliases.set(alias, chat);
}

export const isChatAlias = (chat) => load().aliases.has(chat);

/** The phone-form id of a direct chat WhatsApp delivers from a LID ('' for other chats, or without a phone). */
function phoneFormOf(chat, phone) {
  const { number, jid } = splitChat(chat);
  const p = digits(phone);
  return isLidJid(jid) && p ? chatKey(number, pnJid(p)) : '';
}
/** The phone-form chat of a direct message from a LID, when it has settings, an agent or a prepared entry: '' else. */
function phoneTwin(msg) {
  const twin = phoneFormOf(msg.chat, msg.phone);
  return twin && (load().prepared.has(twin) || hasOwnEntry(twin)) ? twin : '';
}

/** The phone-form chat joins the LID chat WhatsApp uses: settings, agent, cap and memory; the prepared entry moves too. */
async function adoptTwin(twin, chat, phone) {
  await mergeChats(twin, chat, `Direct chat with +${phone}: WhatsApp now writes from its private id`);
  db.prepare('UPDATE direct_chats SET lid = ? WHERE tenant_id = ? AND chat = ?').run(splitChat(chat).jid, TENANT, chat); // the prepared entry moved with the rest
  reload();
  addAlias(twin, chat);
}

let settledFor = null; // the alias list that was last settled
/**
 * Nothing is kept under an alias: once per start and after each merge, rows found under an old id (an earlier release
 * moved only messages and memory; anything written there since) join the chat the alias points to.
 */
function settleAliases() {
  const known = load();
  if (settledFor === known) return;
  settledFor = known;
  for (const [alias, chat] of known.aliases) moveChatRows(alias, chat);
}

/** Phone-form direct chats that were set up: prepared, with settings, or with an agent. Empty once each joined its LID chat. */
function setUpPhoneChats() {
  const chats = [...load().prepared.keys(), ...db.prepare('SELECT chat FROM chat_prefs WHERE tenant_id = ?').all(TENANT).map((r) => r.chat), ...listAgents().flatMap((a) => a.chats)];
  return new Set(chats.filter((c) => isDirect(c) && !isLidJid(splitChat(c).jid)));
}
/**
 * A twin the server already knows about joins without waiting for the person's next message: a chat WhatsApp delivers
 * from a LID whose phone-form chat was set up (the owner marked that one private, or gave it an agent). One pair per
 * call (upkeep.js); returns the chat that stays, '' when there is none.
 */
export async function adoptKnownTwin() {
  settleAliases();
  const waiting = setUpPhoneChats();
  if (!waiting.size) return '';
  for (const c of seenChats({ groups: false })) {
    const phone = c.phone || lidPhone(splitChat(c.id).jid);
    const twin = phoneFormOf(c.id, phone);
    if (!waiting.has(twin)) continue;
    await adoptTwin(twin, c.id, digits(phone));
    return c.id;
  }
  return '';
}

/** The first message of a prepared chat: noted once (the panel stops showing it as waiting). */
function noteFirstMessage(chat) {
  const row = load().prepared.get(chat);
  if (!row || row.first_at) return;
  row.first_at = Date.now();
  db.prepare('UPDATE direct_chats SET first_at = ? WHERE tenant_id = ? AND chat = ?').run(row.first_at, TENANT, chat);
  activity('config', { chat, summary: 'Prepared direct chat: first message arrived' });
}

/**
 * Router entry: a direct message from a known alias gets its chat id; one from a LID whose phone-form chat was set up
 * first makes the two one chat (under the LID). Groups and other chats pass unchanged. Never throws.
 */
export async function resolveDirectChat(msg) {
  if (!msg || msg.isGroup || !msg.chat) return msg;
  try {
    const aliased = load().aliases.get(msg.chat);
    const out = aliased ? { ...msg, chat: aliased, phone: msg.phone || load().prepared.get(aliased)?.phone || '', viaAlias: msg.chat } : msg;
    const twin = aliased ? '' : phoneTwin(msg);
    if (twin) await adoptTwin(twin, msg.chat, digits(msg.phone));
    noteFirstMessage(out.chat);
    return out;
  } catch { return msg; }
}

// ---------------------------------------------------------------- views
function view(row, prefs = getChatPrefs(row.chat)) {
    const n = numbersList().find((x) => x.id === row.number);
  return {
    chat: row.chat, phone: row.phone, name: personInfo({ phone: row.phone }).label, number: row.number, numberLabel: n?.label || row.number,
    agent: agentForChat(row.chat)?.id || '', enabled: prefs.enabled, private: prefs.private, model: prefs.model, logging: prefs.logging,
    onWhatsApp: row.on_whatsapp == null ? null : !!row.on_whatsapp, waiting: !row.first_at, firstAt: row.first_at || null,
    introAt: row.intro_at || null, createdAt: row.created_at, createdBy: row.created_by,
  };
}
export const listDirectChats = () => [...load().prepared.values()].sort((a, b) => b.created_at - a.created_at).map((r) => view(r));
export const getDirectChat = (chat) => { const r = load().prepared.get(chat); return r ? view(r) : null; };

// ---------------------------------------------------------------- prepare
/** Check a number (format and, when connected, whether it is on WhatsApp) without saving anything. */
export async function checkDirectNumber({ phone, number } = {}, { channel } = {}) {
  const d = normalizePhone(phone);
  const n = resolveNumber(number);
  const look = await lookup(channel, n.id, d);
  const chat = targetChat(n.id, d, look.lid);
  return { phone: d, number: n.id, chat, name: personInfo({ phone: d }).name, onWhatsApp: look.onWhatsApp, existing: getDirectChat(chat), warning: lookWarning(look) };
}

async function lookup(channel, number, phone) {
  if (typeof channel?.lookupNumber !== 'function') return { onWhatsApp: null, lid: '' };
  try {
    const r = await channel.lookupNumber(number, phone);
    return r ? { onWhatsApp: !!r.exists, lid: String(r.lid || '') } : { onWhatsApp: null, lid: '' };
  } catch { return { onWhatsApp: null, lid: '' }; } // offline / not linked: checked later, never blocks
}
const lookWarning = (look) => (look.onWhatsApp === false ? 'This number does not seem to be on WhatsApp. The chat is set up anyway and starts when they write.'
  : look.onWhatsApp === null ? 'WhatsApp is not connected, so the number could not be checked. The chat is set up anyway.' : '');

/** The chat id to prepare: the one WhatsApp uses for this person — an alias, their LID (told by the number check, or a
 *  chat seen from it) — else the phone form. */
function targetChat(number, phone, lid = '') {
  const pn = chatKey(number, pnJid(phone));
  const alias = load().aliases.get(pn);
  if (alias) return alias;
  if (lid) return chatKey(number, lid);
  const seenLid = seenChats({ groups: false }).find((c) => c.number === number && c.phone === phone && c.id !== pn && isLidJid(splitChat(c.id).jid));
  return seenLid ? seenLid.id : pn;
}

function checkCap(cap) {
  if (!cap) return null;
  const cost = cap.cost === '' || cap.cost == null ? null : Number(cap.cost);
  const tokens = cap.tokens === '' || cap.tokens == null ? null : Number(cap.tokens);
  if (cost != null && !(cost > 0 && cost <= 100000)) throw bad('Monthly cost cap must be between 0.01 and 100000 USD', 'cap');
  if (tokens != null && !(Number.isInteger(tokens) && tokens >= 1000 && tokens <= 1e11)) throw bad('Monthly token cap must be a whole number of at least 1000', 'cap');
  return cost == null && tokens == null ? null : { cost, tokens, fallback: cap.fallback || '' };
}

/**
 * Set up a direct chat before any message: { phone, number, agent, enabled, private, model, logging, fallback, cap }.
 * enabled defaults to on when an agent is given (for a new chat). Returns the chat view plus `warning`.
 */
export async function prepareDirectChat(input = {}, { channel, by = '' } = {}) {
  const d = normalizePhone(input.phone);
  const n = resolveNumber(input.number);
  const agentId = input.agent === undefined ? undefined : String(input.agent || '');
  if (agentId && !getAgent(agentId)) throw bad(`Unknown agent "${agentId}"`, 'agent', 404);
  const cap = checkCap(input.cap);
  const look = await lookup(channel, n.id, d);
  const chat = targetChat(n.id, d, look.lid);
  const pn = chatKey(n.id, pnJid(d));
  if (chat !== pn && (load().prepared.has(pn) || hasOwnEntry(pn))) await adoptTwin(pn, chat, d); // set up under the phone before
  const isNew = !hasOwnEntry(chat);

  // Settings first (validated before anything is written), then the cap, then the agent.
  const enabled = input.enabled !== undefined ? !!input.enabled : isNew ? !!agentId : undefined;
  setChatPrefs(chat, { enabled, private: input.private === undefined ? undefined : !!input.private, model: input.model || undefined,
    logging: input.logging || undefined, fallback: input.fallback || undefined });
  if (cap) setCap('chat', chat, cap);
  if (agentId !== undefined) await bindChat(chat, agentId || null, by);

  const seen = seenChats({ groups: false }).find((c) => c.id === chat);
  db.prepare(`INSERT INTO direct_chats (tenant_id, chat, number, phone, lid, on_whatsapp, created_by, created_at, first_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, chat) DO UPDATE SET on_whatsapp = excluded.on_whatsapp, lid = CASE WHEN excluded.lid <> '' THEN excluded.lid ELSE direct_chats.lid END`)
    .run(TENANT, chat, n.id, d, look.lid, look.onWhatsApp == null ? null : look.onWhatsApp ? 1 : 0, String(by).slice(0, 60), Date.now(), seen?.lastAt || null);
  reload();
  if (chat !== pn) addAlias(pn, chat); // their phone-form id (a send by number, a message without the LID) finds this chat
  const prefs = getChatPrefs(chat);
  const agent = agentForChat(chat);
  activity('config', { chat, agent: agent?.id || '', summary: `Direct chat set up for +${d}${n.id !== MAIN ? ` on ${n.label || n.id}` : ''}: ${agent ? `agent ${agent.name}` : 'no agent'}, ${prefs.enabled ? 'on' : 'off'}${prefs.private ? ', private to members' : ''}${look.onWhatsApp === false ? ' (not on WhatsApp?)' : ''} (${by || 'panel'})` });
  return { ...view(load().prepared.get(chat), prefs), warning: lookWarning(look) };
}

// ---------------------------------------------------------------- optional intro message (needs an explicit confirm)
function introTarget(chat) {
  if (!chat || !isDirect(chat)) throw bad('An intro can only be sent to a direct chat', 'chat');
  const prefs = getChatPrefs(chat);
  if (!prefs.enabled) throw bad('Switch this chat on first: agents never write to chats that are off', 'chat', 409);
  const agent = agentForChat(chat);
  if (!agent) throw bad('Assign an agent to this chat first', 'agent', 409);
  if (!agent.enabled) throw bad(`The agent ${agent.name} is switched off`, 'agent', 409);
  const row = load().prepared.get(chat);
  const phone = row?.phone || phoneOfChat(chat);
  return { agent, phone, row };
}
const defaultIntro = (agent, name) => {
  const first = String(name || '').startsWith('+') ? '' : String(name || '').split(/\s+/)[0];
  const about = String(agent.description || '').trim().replace(/\.$/, '').slice(0, 160);
  return `Hi${first ? ` ${first}` : ''}! I'm ${agent.name}${about ? ` (${about.charAt(0).toLowerCase()}${about.slice(1)})` : ''}. Write to me here whenever you need me.`;
};

/** What "Send intro now" would send: { chat, to, agent, text, notice, token } — the token confirms exactly this text. */
export function introPreview(chat, { text } = {}) {
  const { agent, phone } = introTarget(chat);
  const name = phone ? personInfo({ phone }).label : chat;
  const body = String(text ?? '').trim() || defaultIntro(agent, name);
  if (body.length > 1000) throw bad('Keep the intro under 1000 characters', 'text');
  const notice = dmNoticePending(phone || chat);
  const token = newToken(16);
  putTtl(INTRO_KIND, token, { chat, hash: sha256(body), text: body }, Date.now() + INTRO_TTL);
  return { chat, to: name, agent: agent.id, agentName: agent.name, text: body, notice, token, expiresInSec: INTRO_TTL / 1000 };
}

/** Send the previewed intro (single-use token from introPreview). */
export async function sendIntro(chat, { token } = {}, { channel, by = '' } = {}) {
  const t = token ? takeTtl(INTRO_KIND, String(token)) : null;
  if (!t || t.chat !== chat) throw bad('Preview the intro first and confirm it within 10 minutes', 'token', 409);
  const { agent, phone } = introTarget(chat);
  if (!channel?.send) throw bad('WhatsApp is not available', null, 503);
  takeNewChat(splitChat(chat).number); // 080: counts toward today's new chats (Settings → Sending pace); refused at the cap
  let text = t.text;
  const notice = dmNoticeOnce(phone || chat); // 044: the DM privacy line, once per person
  if (notice) text = `${text}\n\n_${notice}_`;
  const sent = await channel.send(chat, text);
  logMessage({ channel: 'whatsapp', chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text, fromAgent: true });
  db.prepare('UPDATE direct_chats SET intro_at = ? WHERE tenant_id = ? AND chat = ?').run(Date.now(), TENANT, chat);
  reload();
  activity('message.out', { agent: agent.id, chat, summary: `Intro: ${t.text}`, detail: { intro: true, by } });
  return { ok: true, chat, msgId: sent?.msgId || null, text };
}
