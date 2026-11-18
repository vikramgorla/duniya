// @ts-check
// Telegram, channel adapter #2 (077): one bot, through the Bot API only (HTTPS with fetch; no dependency, no user
// account). The hub loads this module with import() only when a bot token is stored and Telegram is on.
//
// - Updates arrive by long polling: one getUpdates request at a time (50 s), backoff on errors. No other timers: the
//   per-group refresh (title, member count, admins) rides on the hub's shared upkeep tick, one group per tick.
// - Sends go through a small queue per chat, so messages keep their order and a 429 waits `retry_after` and retries.
// - People: Telegram never tells a bot phone numbers. A person links their number by sharing their own contact with
//   the "Share my number" button in a direct chat; it counts only when contact.user_id === from.id (a forwarded card
//   never links). From then on their messages carry that phone, so roles, contacts and the owner assistant apply, and
//   the same phone on WhatsApp is the same person (people.js).
// - Chat ids: "tg:<bot id>#<chat id>"; WhatsApp markup is sent as Telegram entities (format.js).
import { clip, digits, fail } from '../../core/config.js';
import { getSecret, getSetting } from '../../core/store.js';
import { activity, bus } from '../../core/events.js';
import { kvGet, kvSet, savePoll, pollByRef } from '../../core/db.js';
import { seenChats } from '../../core/chat-prefs.js';
import { chatLabel, rememberGroupNames } from '../../core/chat-names.js';
import { personFor, phoneOfIdentity, identityByPhone } from '../../core/people.js';
import { loadMedia, MAX_MEDIA_BYTES } from '../../core/media.js';
import { PREFIX } from './ids.js';
import { toEntities, chunks, reactionFor, SOME_REACTIONS } from './format.js';

export const TOKEN = 'TELEGRAM_BOT_TOKEN';
const API = 'https://api.telegram.org';
const POLL_SECONDS = 50;
const UPDATES = ['message', 'my_chat_member', 'message_reaction', 'poll_answer'];
const DOWNLOAD_LIMIT = 20 * 1048576; // getFile: Telegram serves files up to 20 MB to bots
const GROUP_TTL = 30 * 60000;
const MAX_GROUPS = 300; const MAX_NAMES = 2000; const MAX_IN_FLIGHT = 20;
const ASK_EVERY = 24 * 3600000;
const SHARE_BUTTON = 'Share my number';
const ACTIVE = ['creator', 'administrator', 'member', 'restricted'];

const sleep = (ms, signal) => new Promise((r) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); r(undefined); }, { once: true });
});
/** A Map that forgets its oldest entry past `max` (bounded caches). */
const remember = (map, key, value, max) => { map.delete(key); map.set(key, value); if (map.size > max) map.delete(map.keys().next().value); };
const nameOf = (u) => clip([u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || '', 60);
const isGroupType = (t) => t === 'group' || t === 'supergroup';

/**
 * `fetch` and `token` are replaceable (tests and the demo pass a fake Bot API). The token is read when needed and never
 * leaves this module: it is not logged, not in errors and not in status.
 */
export function createTelegramAdapter({ fetch: doFetch = globalThis.fetch, token = () => getSecret(TOKEN), api = API } = {}) {
  /** @type {any} */ let on = null; // the hub's handlers
  let me = null; // getMe
  let state = { status: 'stopped', lastError: '', since: 0 };
  let ctl = new AbortController();
  let offset = 0; let inFlight = 0;
  const groups = new Map(); // native chat id → { title, size, admins: [{ id, status, name }], perms, at }
  const names = new Map(); // user id → name (for mentions in welcomes)
  const queues = new Map(); // native chat id → tail promise of its sends
  const asked = new Map(); // native chat id → when "Share my number" was last offered
  const account = () => String(me?.id || '');
  const key = (native) => `${PREFIX}:${account()}#${native}`;
  const nativeOf = (chat) => {
    const m = /^tg:(\d+)#(-?\d+)$/.exec(String(chat));
    if (!m) throw fail('Not a Telegram chat');
    if (me && m[1] !== account()) throw fail('This chat belongs to another Telegram bot (the token was replaced)', 409);
    return m[2];
  };
  const setState = (status, lastError = '') => {
    if (state.status === status && state.lastError === lastError) return;
    state = { status, lastError, since: status === 'open' ? (state.status === 'open' ? state.since : Date.now()) : state.since };
    bus.emit('status');
  };

  // ---------- Bot API ----------
  async function call(method, params = {}, { signal = AbortSignal.timeout(30000), form = null } = {}) {
    const t = token();
    if (!t) throw fail('Telegram is not set up: no bot token', 409);
    const scrub = (s) => String(s || '').split(t).join('…');
    let r;
    try {
      r = await doFetch(`${api}/bot${t}/${method}`, form ? { method: 'POST', body: form, signal }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal });
    } catch (e) { throw fail(`Telegram could not be reached (${scrub(e?.cause?.code || e?.name || 'network')})`, 503, { tg: 0 }); }
    /** @type {any} */
    const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    if (j.ok) return j.result;
    const code = j.error_code || r.status;
    throw fail(scrub(j.description || `Telegram error ${code}`).replace(/^(Bad Request|Forbidden|Unauthorized|Conflict): /, ''), code === 401 ? 409 : code === 429 ? 429 : 502,
      { tg: code, retryAfter: Number(j.parameters?.retry_after) || 0, migrateTo: j.parameters?.migrate_to_chat_id ? String(j.parameters.migrate_to_chat_id) : '' });
  }
  /** The same with a file: params plus { field: { buffer, mimetype, fileName } } as multipart. */
  function upload(method, params, field, file) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    form.append(field, new Blob([file.buffer], { type: file.mimetype }), file.fileName || 'file');
    return call(method, {}, { form, signal: AbortSignal.timeout(120000) });
  }

  /** Per-chat send queue: in order, and a 429 waits retry_after (at most 3 tries, 60 s each). */
  function queued(native, fn) {
    const run = (queues.get(native) || Promise.resolve()).then(async () => {
      for (let i = 0; ; i++) {
        try { return await fn(); } catch (e) {
          if (e.tg !== 429 || i >= 3 || ctl.signal.aborted) throw e;
          await sleep(Math.min(e.retryAfter || 1, 60) * 1000, ctl.signal);
        }
      }
    });
    const tail = run.catch(() => {});
    queues.set(native, tail);
    tail.then(() => { if (queues.get(native) === tail) queues.delete(native); });
    return run;
  }
  const replyTo = (opts = {}) => {
    const id = Number(opts.quoted?.message_id || opts.quote?.msgId || 0);
    return id ? { reply_parameters: { message_id: id, allow_sending_without_reply: true } } : {};
  };
  const sentId = (m) => ({ msgId: m?.message_id ? String(m.message_id) : null });

  // ---------- people ----------
  const phoneOf = (userId) => phoneOfIdentity('telegram', String(userId));
  /** The direct chat's keyboard with the one button that shares the person's own number. */
  const shareKeyboard = { keyboard: [[{ text: SHARE_BUTTON, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  async function offerShare(native, text) {
    remember(asked, native, Date.now(), MAX_NAMES);
    await queued(native, () => call('sendMessage', { chat_id: native, text, reply_markup: shareKeyboard }));
  }
  /** A contact in a direct chat: links the phone only when it is the sender's own (contact.user_id === from.id). */
  async function linkContact(m) {
    const c = m.contact; const native = String(m.chat.id);
    const phone = digits(c.phone_number);
    if (!c.user_id || c.user_id !== m.from.id || phone.length < 6) return false;
    personFor({ channel: 'telegram', externalId: String(m.from.id), phone });
    activity('config', { chat: key(native), summary: `${nameOf(m.from) || 'Someone'} linked their phone number to Telegram` });
    await queued(native, () => call('sendMessage', { chat_id: native, reply_markup: { remove_keyboard: true },
      text: 'Thanks, your number is linked. I now know you here as on WhatsApp, with the same roles.' })).catch(() => {});
    return true;
  }

  // ---------- inbound ----------
  /** What agents see for messages without text: a placeholder, never the media itself (as on WhatsApp). */
  function describe(m) {
    const cap = m.caption ? `: ${clip(m.caption, 300)}` : '';
    if (m.photo) return `[image${cap}]`;
    if (m.animation) return `[GIF${cap}]`;
    if (m.video || m.video_note) return `[video${cap}]`;
    if (m.sticker) return '[sticker]';
    if (m.voice) return '[voice note]';
    if (m.audio) return `[audio${cap}]`;
    if (m.document) return `[document: ${clip(m.document.file_name || 'file', 120)}${m.caption ? ` — ${clip(m.caption, 200)}` : ''}]`;
    if (m.venue) return `[location: ${clip(m.venue.title, 100)}, ${clip(m.venue.address, 120)} (${m.venue.location.latitude.toFixed(5)}, ${m.venue.location.longitude.toFixed(5)})]`;
    if (m.location) return `[location (${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)})]`;
    if (m.contact) return `[contact: ${clip(nameOf(m.contact) || 'contact', 80)}]`;
    if (m.poll) return `[poll: ${clip(m.poll.question, 200)} — ${m.poll.options.map((o) => clip(o.text, 60)).join(' / ')}]`;
    return '';
  }
  /** Photos & voice: what the message holds, without downloading it (`size` is Telegram's declared size). */
  function mediaOf(m) {
    if (m.photo?.length) { const p = m.photo.filter((x) => (x.file_size || 0) <= DOWNLOAD_LIMIT).at(-1) || m.photo[0]; return { info: { type: 'image', mimetype: 'image/jpeg', size: p.file_size || 0 }, ref: p.file_id }; }
    if (m.voice) return { info: { type: 'audio', mimetype: m.voice.mime_type || 'audio/ogg', size: m.voice.file_size || 0, seconds: m.voice.duration || 0, ptt: true }, ref: m.voice.file_id };
    if (m.audio) return { info: { type: 'audio', mimetype: m.audio.mime_type || 'audio/mpeg', size: m.audio.file_size || 0, seconds: m.audio.duration || 0 }, ref: m.audio.file_id };
    if (m.sticker && !m.sticker.is_animated && !m.sticker.is_video) return { info: { type: 'sticker', mimetype: 'image/webp', size: m.sticker.file_size || 0 }, ref: m.sticker.file_id };
    if (m.document) return { info: { type: 'document', mimetype: m.document.mime_type || '', size: m.document.file_size || 0, fileName: m.document.file_name || '' }, ref: m.document.file_id };
    return null;
  }
  const textOf = (m) => m.text || m.caption || '';
  const entitiesOf = (m) => m.entities || m.caption_entities || [];

  async function onUpdate(u) {
    if (u.message) return onTelegramMessage(u.message);
    if (u.my_chat_member) return onMembership(u.my_chat_member);
    if (u.message_reaction) {
      const r = u.message_reaction;
      if (!r.user || r.user.is_bot) return;
      const emoji = (r.new_reaction || []).find((x) => x.type === 'emoji')?.emoji || '';
      return on.onMessage(base(r.chat, r.user, { msgId: '', ts: r.date * 1000, kind: 'reaction', text: '', target: String(r.message_id), emoji }));
    }
    if (u.poll_answer) {
      const a = u.poll_answer;
      const p = a.user && pollByRef(`tg:${a.poll_id}`);
      if (!p) return;
      const native = nativeOf(p.chat);
      return on.onMessage(base({ id: native, type: Number(native) < 0 ? 'group' : 'private' }, a.user,
        { msgId: '', ts: Date.now(), kind: 'poll_vote', text: '', pollId: p.msg_id, selected: (a.option_ids || []).map((i) => p.options[i]).filter(Boolean) }));
    }
  }
  /** The fields every inbound event shares. */
  function base(chat, from, extra) {
    const native = String(chat.id);
    if (from?.id) remember(names, String(from.id), nameOf(from), MAX_NAMES);
    return { channel: 'telegram', chat: key(native), number: account(), isGroup: isGroupType(chat.type) || Number(native) < 0, phone: from?.id ? phoneOf(from.id) : '',
      senderJid: from?.id ? String(from.id) : '', senderName: nameOf(from), fromMe: false, raw: null, ...extra };
  }

  async function onTelegramMessage(m) {
    const native = String(m.chat.id);
    if (m.chat.type === 'channel' || !m.from || m.from.is_bot) return;
    const group = isGroupType(m.chat.type);
    if (group && m.chat.title) noteGroup(native, { title: m.chat.title });
    if (m.migrate_to_chat_id) { // Telegram made the group a supergroup: its id changes; settings, agent and memory move
      const to = String(m.migrate_to_chat_id);
      groups.delete(native);
      await on.onChatMoved?.({ from: key(native), to: key(to) });
      return;
    }
    if (m.new_chat_members?.length) {
      const people = m.new_chat_members.filter((u) => !u.is_bot);
      for (const u of people) remember(names, String(u.id), nameOf(u), MAX_NAMES);
      if (people.length) await on.onJoin?.({ chat: key(native), participants: people.map((u) => ({ jid: String(u.id), phone: phoneOf(u.id) })) });
      return;
    }
    if (!group && m.contact && await linkContact(m)) return;
    let text = textOf(m);
    const cmd = /^\/(start|help)(@\w+)?(\s|$)/i.exec(text);
    if (!group && cmd?.[1].toLowerCase() === 'start') { // a direct chat always opens with /start
      if (phoneOf(m.from.id)) await queued(native, () => call('sendMessage', { chat_id: native, text: `Hi ${nameOf(m.from) || 'there'}! Write your question and I’ll answer.` })).catch(() => {});
      else await offerShare(native, `Hi ${nameOf(m.from) || 'there'}! I’m ${me.first_name}. Tap “${SHARE_BUTTON}” below so I know who you are (the same person as on WhatsApp, with the same roles). Or just write your question.`).catch(() => {});
      return;
    }
    // mentions: "@bot" (entity) or a text mention of the bot; the "@bot" itself is dropped from the text
    const ents = entitiesOf(m);
    const handle = `@${String(me.username || '').toLowerCase()}`;
    let mentioned = false;
    for (const e of [...ents].sort((a, b) => b.offset - a.offset)) {
      const part = text.slice(e.offset, e.offset + e.length);
      if ((e.type === 'mention' && part.toLowerCase() === handle) || (e.type === 'text_mention' && e.user?.id === me.id)) mentioned = true;
      if (e.type === 'mention' && part.toLowerCase() === handle) text = `${text.slice(0, e.offset)}${text.slice(e.offset + e.length)}`;
      if (e.type === 'bot_command' && part.toLowerCase().endsWith(handle)) { mentioned = true; text = `${text.slice(0, e.offset)}${part.slice(0, -handle.length)}${text.slice(e.offset + e.length)}`; }
    }
    text = text.replace(/\s{2,}/g, ' ').trim();
    const placeholder = describe(m);
    const media = mediaOf(m);
    const body = placeholder && !m.text ? placeholder : text;
    if (!String(body).trim()) return;
    const quotedMsg = m.reply_to_message;
    const msg = base(m.chat, m.from, {
      msgId: String(m.message_id), ts: m.date * 1000, kind: 'text', text: body, caption: placeholder ? text : '', media: !!placeholder,
      quoted: quotedMsg ? clip(textOf(quotedMsg) || describe(quotedMsg), 500) : '',
      mentioned, replyToAgent: !!me && quotedMsg?.from?.id === me.id, raw: { message_id: m.message_id },
      ...(media ? { mediaInfo: media.info, mediaRef: media.ref, fetchMedia: () => download(media.ref, media.info.size) } : {}),
    });
    return on.onMessage(msg);
  }

  /** The bot was added to, removed from, or promoted in a group. */
  async function onMembership(u) {
    const native = String(u.chat.id);
    if (!isGroupType(u.chat.type)) return;
    const left = ['left', 'kicked'].includes(u.new_chat_member?.status);
    const gone = new Set(leftGroups()); if (left) gone.add(native); else gone.delete(native);
    kvSet('telegram:left', JSON.stringify([...gone].slice(-500)));
    if (left) { groups.delete(native); activity('config', { chat: key(native), summary: `The Telegram bot left “${clip(u.chat.title, 60)}”` }); bus.emit('status'); return; }
    noteGroup(native, { title: u.chat.title, at: 0 }); // refreshed at the next upkeep tick
    if (u.old_chat_member?.status === 'left' || u.old_chat_member?.status === 'kicked') {
      // a new group shows up in Chats (off until switched on): metadata only, through the hub's chat list
      await on.onSeen?.({ chat: key(native), number: account(), isGroup: true });
      activity('config', { chat: key(native), summary: `The Telegram bot was added to “${clip(u.chat.title, 60)}”: switch it on in Chats to let an agent answer there` });
    }
    bus.emit('status');
  }
  const leftGroups = () => { try { return JSON.parse(kvGet('telegram:left') || '[]'); } catch { return []; } };
  function noteGroup(native, patch) {
    const g = { title: '', size: 0, admins: [], perms: null, at: 0, ...groups.get(native), ...patch };
    remember(groups, native, g, MAX_GROUPS);
    if (g.title) rememberGroupNames([{ id: key(native), name: g.title }]);
    return g;
  }
  /** Title, member count, admins and permissions of a group (cached 30 minutes; `fresh` asks Telegram now). */
  async function group(native, fresh = false) {
    const g = groups.get(native);
    if (g?.at && !fresh && Date.now() - g.at < GROUP_TTL) return g;
    const [chat, size, admins] = await Promise.all([call('getChat', { chat_id: native }), call('getChatMemberCount', { chat_id: native }).catch(() => g?.size || 0),
      call('getChatAdministrators', { chat_id: native }).catch(() => [])]);
    return noteGroup(native, { title: chat.title || '', description: chat.description || '', size, perms: chat.permissions || null, at: Date.now(),
      admins: admins.filter((a) => !a.user.is_bot || a.user.id === me?.id).map((a) => ({ id: a.user.id, status: a.status, name: nameOf(a.user), canInvite: !!a.can_invite_users })) });
  }

  // ---------- the long poll ----------
  async function pollLoop(signal) {
    let backoff = 0;
    while (!signal.aborted) {
      try {
        const list = await call('getUpdates', { offset, timeout: POLL_SECONDS, allowed_updates: UPDATES }, { signal: AbortSignal.any([signal, AbortSignal.timeout((POLL_SECONDS + 15) * 1000)]) });
        backoff = 0; setState('open');
        for (const u of list) {
          offset = u.update_id + 1;
          while (inFlight >= MAX_IN_FLIGHT && !signal.aborted) await sleep(50, signal); // a burst waits instead of piling up
          inFlight++;
          Promise.resolve().then(() => onUpdate(u)).catch((e) => activity('error', { summary: `Telegram message not handled: ${e.message}` })).finally(() => { inFlight--; });
        }
      } catch (e) {
        if (signal.aborted) break;
        if (e.tg === 401 || e.tg === 404) { setState('error', 'Telegram did not accept the bot token. Paste the token from @BotFather again (Replace token).'); return; }
        if (e.tg === 409 && /webhook/i.test(e.message)) { // another setup sends this bot's updates to a webhook: take them back
          await call('deleteWebhook', {}).then(() => activity('config', { summary: 'Telegram: the bot had a webhook; it now delivers to this server' })).catch(() => {});
          continue;
        }
        setState('error', e.tg === 409 ? 'Another program is reading this bot’s messages (a second server with the same token?). Stop it, or create a new token.' : e.message);
        backoff = Math.min(60000, e.retryAfter ? e.retryAfter * 1000 : backoff ? backoff * 2 : 2000);
        await sleep(backoff, signal);
      }
    }
  }

  // ---------- media ----------
  async function download(fileId, declared = 0) {
    const limit = Math.min(DOWNLOAD_LIMIT, MAX_MEDIA_BYTES);
    if (declared > limit) throw fail('Media is too large', 413);
    const f = await call('getFile', { file_id: fileId });
    if (!f.file_path || (f.file_size || 0) > limit) throw fail('Media is too large', 413);
    const r = await doFetch(`${api}/file/bot${token()}/${f.file_path}`, { signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (!r?.ok || !r.body) throw fail('Telegram did not send the file', 502);
    const parts = []; let size = 0;
    for await (const part of r.body) { size += part.length; if (size > limit) throw fail('Media is too large', 413); parts.push(part); }
    return Buffer.concat(parts);
  }
  const MEDIA_SEND = { image: ['sendPhoto', 'photo'], gif: ['sendAnimation', 'animation'], video: ['sendVideo', 'video'], sticker: ['sendSticker', 'sticker'], document: ['sendDocument', 'document'] };

  /** Text with "@<user id>" mentions of `ids` replaced by the person's name, linked to them. */
  function withMentions(text, ids = []) {
    let out = text; const extra = [];
    for (const id of ids.map((x) => String(x).split('@')[0])) {
      const tag = `@${id}`; const i = out.indexOf(tag);
      if (!/^\d+$/.test(id) || i < 0) continue;
      const name = names.get(id) || 'there';
      out = `${out.slice(0, i)}${name}${out.slice(i + tag.length)}`;
      for (const e of extra) if (e.offset > i) e.offset += name.length - tag.length;
      extra.push({ type: 'text_mention', offset: i, length: name.length, user: { id: Number(id) } });
    }
    return { out, extra };
  }

  /** Groups the bot is in: the ones it has seen (a bot cannot list them) minus those it left. */
  function listChats() {
    if (!me) return [];
    const gone = new Set(leftGroups().map(key));
    return seenChats({ groups: true }).filter((c) => c.id.startsWith(`${PREFIX}:${account()}#`) && !gone.has(c.id))
      .map((c) => ({ id: c.id, name: groups.get(nativeOf(c.id))?.title || chatLabel(c.id), size: groups.get(nativeOf(c.id))?.size || 0 }));
  }
  const g = async (chat) => { const n = nativeOf(chat); if (Number(n) > 0) throw fail('This only works in a group'); return n; };
  const needAdmin = (e) => { throw e.tg === 400 || e.tg === 403 ? fail(`${e.message}. The bot must be a group admin with this right.`) : e; };

  return {
    id: 'telegram',
    async start(handlers) {
      on = handlers;
      ctl = new AbortController();
      setState('starting');
      try { me = await call('getMe', {}, { signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(20000)]) }); } catch (e) {
        setState('error', e.tg === 401 || e.tg === 404 ? 'Telegram did not accept the bot token. Paste the token from @BotFather again (Replace token).' : e.message);
        if (e.tg === 401 || e.tg === 404) return;
        throw e;
      }
      setState('open'); // the token works; the long poll keeps it so, or reports what went wrong
      pollLoop(ctl.signal).catch(() => {});
    },
    async stop() { ctl.abort(); setState('stopped'); queues.clear(); groups.clear(); names.clear(); asked.clear(); },
    async status() {
      const bot = me ? { id: account(), username: me.username, name: me.first_name, canReadAll: !!me.can_read_all_group_messages, canJoinGroups: me.can_join_groups !== false,
        dmAgent: getSetting('telegram', {})?.dmAgent || '', link: `https://t.me/${me.username}`, groupLink: `https://t.me/${me.username}?startgroup=duniya` } : null;
      const st = { status: state.status, lastError: state.lastError, since: state.since };
      return { ...st, numbers: [{ id: account() || 'bot', label: bot ? `@${bot.username}` : 'Telegram bot', ...st }], info: bot, cache: { groups: groups.size, names: names.size, queues: queues.size } };
    },
    listChats: async () => listChats(),
    /** Shared upkeep tick: one group whose details are older than 30 minutes is refreshed. */
    async upkeep() {
      if (state.status !== 'open') return { ok: false, reason: 'not_due' };
      const due = listChats().map((c) => nativeOf(c.id)).find((n) => Date.now() - (groups.get(n)?.at || 0) > GROUP_TTL);
      if (!due) return { ok: false, reason: 'not_due' };
      await group(due, true).catch(() => null);
      return { ok: true };
    },
    async chatName(chat) { const n = nativeOf(chat); return Number(n) < 0 ? (groups.get(n)?.title || (await group(n).catch(() => null))?.title || '') : ''; },
    async typing(chat) { const n = nativeOf(chat); await call('sendChatAction', { chat_id: n, action: 'typing' }).catch(() => {}); },
    async presence(chat) { await call('sendChatAction', { chat_id: nativeOf(chat), action: 'typing' }).catch(() => {}); return { ok: true }; },
    async isMember(chat, phone, senderJid) {
      const n = nativeOf(chat);
      const user = /^\d+$/.test(String(senderJid || '')) ? String(senderJid) : identityByPhone('telegram', phone);
      if (!user) return false;
      const r = await call('getChatMember', { chat_id: n, user_id: Number(user) }).catch(() => null);
      return !!r && (ACTIVE.includes(r.status) && (r.status !== 'restricted' || r.is_member !== false));
    },
    /** Admins only (a bot cannot list members); phone when the admin linked it. */
    async groupMembers(chat) { const x = await group(await g(chat)); return x.admins.map((a) => ({ jid: String(a.id), phone: phoneOf(a.id), admin: a.status === 'creator' ? 'superadmin' : 'admin', name: a.name })); },
    async refreshGroup(chat) { await group(await g(chat), true); return { ok: true }; },
    /** 077: offer "Share my number" in a direct chat (at most once a day per chat). */
    async askForPhone(chat, why = '') {
      const n = nativeOf(chat);
      if (Number(n) < 0 || Date.now() - (asked.get(n) || 0) < ASK_EVERY) return { asked: false };
      await offerShare(n, `${why || 'I don’t know who you are yet.'} Tap “${SHARE_BUTTON}” so I can check your role (the same as on WhatsApp).`);
      return { asked: true };
    },
    async send(chat, text, opts = {}) {
      const n = nativeOf(chat);
      const { out, extra } = withMentions(String(text ?? ''), opts.mentions || []);
      let first = null;
      for (const [i, part] of chunks(out).entries()) {
        const f = toEntities(part);
        const mentions = i === 0 ? extra.filter((e) => e.offset + e.length <= f.text.length) : []; // names are plain text: offsets hold when no markup precedes them
        const sent = await queued(n, () => call('sendMessage', { chat_id: n, text: f.text, entities: [...f.entities, ...mentions], link_preview_options: { is_disabled: true }, ...(i === 0 ? replyTo(opts) : {}) }));
        first ||= sent;
      }
      return sentId(first);
    },
    /** @param {string} chat @param {any} media */
    async sendMedia(chat, { kind, url, base64, mimetype, caption = '', fileName = '', voiceNote = true, quote }) {
      const n = nativeOf(chat);
      const m = await loadMedia(kind, { url, base64, mimetype, fileName });
      const cap = caption ? toEntities(clip(caption, 1024)) : null;
      const common = { chat_id: n, ...(cap ? { caption: cap.text, caption_entities: cap.entities } : {}), ...replyTo({ quote }) };
      const [method, field] = kind === 'audio' ? (voiceNote && m.mimetype === 'audio/ogg' ? ['sendVoice', 'voice'] : ['sendAudio', 'audio'])
        : kind === 'gif' && m.mimetype === 'image/gif' ? ['sendPhoto', 'photo'] : MEDIA_SEND[kind] || MEDIA_SEND.document;
      const sent = await queued(n, () => upload(method, kind === 'sticker' ? { chat_id: n } : common, field, m));
      return { ...sentId(sent), mimetype: m.mimetype, bytes: m.buffer.length, asStill: kind === 'gif' && m.mimetype === 'image/gif' };
    },
    async sendLocation(chat, { latitude, longitude, name = '', address = '' }) {
      const n = nativeOf(chat); const lat = Number(latitude); const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail('latitude/longitude out of range');
      return sentId(await queued(n, () => (name ? call('sendVenue', { chat_id: n, latitude: lat, longitude: lng, title: clip(name, 100), address: clip(address || name, 200) })
        : call('sendLocation', { chat_id: n, latitude: lat, longitude: lng }))));
    },
    async sendContact(chat, { name, phone }) {
      const n = nativeOf(chat); const d = digits(phone);
      if (!name || d.length < 6) throw fail('A contact needs a name and a phone number with country code');
      return sentId(await queued(n, () => call('sendContact', { chat_id: n, phone_number: `+${d}`, first_name: clip(name, 60) })));
    },
    async react(chat, ref, emoji = '') {
      const n = nativeOf(chat); const e = reactionFor(emoji);
      if (e === null) throw fail(`Telegram allows only some reactions, e.g. ${SOME_REACTIONS}`);
      if (!ref?.msgId) throw fail('Which message? (msg id missing)');
      await call('setMessageReaction', { chat_id: n, message_id: Number(ref.msgId), reaction: e ? [{ type: 'emoji', emoji: e }] : [] });
      return { ok: true };
    },
    async editMessage(chat, msgId, text) {
      const n = nativeOf(chat); const f = toEntities(chunks(String(text))[0]);
      return sentId(await queued(n, () => call('editMessageText', { chat_id: n, message_id: Number(msgId), text: f.text, entities: f.entities })));
    },
    async deleteMessage(chat, ref) { const n = nativeOf(chat); await call('deleteMessage', { chat_id: n, message_id: Number(ref?.msgId) }).catch(needAdmin); return { ok: true }; },
    /** Non-anonymous polls, so each vote arrives (poll_answer) and poll_results can say who voted. */
    async sendPoll(chat, { name, options, multi = false }) {
      const n = nativeOf(chat);
      const values = [...new Set((options || []).map((o) => String(o).trim()).filter(Boolean))];
      if (!String(name || '').trim() || values.length < 2 || values.length > 12) throw fail('A poll needs a question and 2–12 different options');
      const sent = await queued(n, () => call('sendPoll', { chat_id: n, question: clip(name, 300), options: values.map((text) => ({ text: clip(text, 100) })), is_anonymous: false, allows_multiple_answers: !!multi }));
      savePoll({ chat, msgId: String(sent.message_id), name: String(name).trim(), options: values, selectable: multi ? 0 : 1, creator: account(), message: `tg:${sent.poll?.id || ''}` });
      return sentId(sent);
    },
    async downloadMedia(chat, ref, declared = 0) { nativeOf(chat); return download(ref, declared); },
    // ---------- groups (the bot must be an admin with the matching right) ----------
    async groupInfo(chat) {
      const n = await g(chat); const x = await group(n, true);
      const p = x.perms || {};
      return { id: chat, subject: x.title, description: x.description || '', owner: '', size: x.size, announcement: p.can_send_messages === false, locked: p.can_change_info === false,
        joinApproval: false, participants: x.admins.filter((a) => a.id !== me.id).map((a) => ({ phone: phoneOf(a.id), jid: String(a.id), admin: a.status === 'creator' ? 'superadmin' : 'admin' })) };
    },
    async groupInviteLink(chat) { const n = await g(chat); return { link: (await call('getChat', { chat_id: n })).invite_link || await call('exportChatInviteLink', { chat_id: n }).catch(needAdmin) }; },
    async groupRevokeInvite(chat) { const n = await g(chat); return { link: await call('exportChatInviteLink', { chat_id: n }).catch(needAdmin) }; },
    async groupSubject(chat, subject) { const n = await g(chat); await call('setChatTitle', { chat_id: n, title: clip(subject, 128) }).catch(needAdmin); noteGroup(n, { title: clip(subject, 128) }); return { ok: true }; },
    async groupDescription(chat, text) { const n = await g(chat); await call('setChatDescription', { chat_id: n, description: String(text || '').slice(0, 255) }).catch(needAdmin); return { ok: true }; },
    async groupPicture(chat, { url }) { const n = await g(chat); const m = await loadMedia('image', { url }); await upload('setChatPhoto', { chat_id: n }, 'photo', m).catch(needAdmin); return { ok: true }; },
    /** @param {string} chat @param {any} change */
    async groupSettings(chat, { announcement, locked, joinApproval }) {
      const n = await g(chat);
      if (typeof joinApproval === 'boolean') throw fail('On Telegram, join requests are set per invite link in the app, not here');
      const cur = (await group(n, true)).perms || {};
      const next = { ...cur, ...(typeof announcement === 'boolean' ? { can_send_messages: !announcement } : {}), ...(typeof locked === 'boolean' ? { can_change_info: !locked } : {}) };
      await call('setChatPermissions', { chat_id: n, permissions: next, use_independent_chat_permissions: false }).catch(needAdmin);
      noteGroup(n, { perms: next });
      return { ok: true };
    },
    async groupLeave(chat) { const n = await g(chat); await call('leaveChat', { chat_id: n }); return { ok: true }; },
  };
}
