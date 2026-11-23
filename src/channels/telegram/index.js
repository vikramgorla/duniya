// @ts-check
// Telegram, channel adapter #2 (077): one bot, through the Bot API only (api.js: HTTPS with fetch; no dependency, no
// user account). The hub loads this module with import() only when a bot token is stored and Telegram is on.
//
// - Updates arrive by long polling: one getUpdates request at a time (50 s), backoff on errors. No other timers: the
//   per-group refresh (title, member count, admins) rides on the hub's shared upkeep tick, one group per tick.
// - Sends go through a small queue per chat, so messages keep their order and a 429 waits `retry_after` and retries.
// - People: Telegram never tells a bot phone numbers. A person links their number by sharing their own contact with
//   the "Share my number" button in a direct chat; it counts only when contact.user_id === from.id (a forwarded card
//   never links). From then on their messages carry that phone, so roles, contacts and the owner assistant apply, and
//   the same phone on WhatsApp is the same person (people.js).
// - Chat ids: "tg:<bot id>#<chat id>" (ids.js); WhatsApp markup is sent as Telegram entities (format.js).
//
// The adapter is put together from parts that share one `bot` (the Bot API, who the bot is, its state and chat ids):
// the groups it knows, the send queue, linking a phone, what arrives (inbound.js maps it), the connection, and the
// actions the hub calls.
import { clip, digits, fail } from '../../core/config.js';
import { getSecret, getSetting } from '../../core/store.js';
import { activity, bus, recordFailure } from '../../core/events.js';
import { kvGet, kvSet, savePoll, pollByRef } from '../../core/db.js';
import { seenChats } from '../../core/chat-prefs.js';
import { chatLabel, rememberGroupNames } from '../../core/chat-names.js';
import { personFor, phoneOfIdentity, identityByPhone } from '../../core/people.js';
import { loadMedia } from '../../core/media.js';
import { PREFIX, chatParts } from './ids.js';
import { toEntities, chunks, linkMentions, reactionFor, SOME_REACTIONS, MAX_TEXT } from './format.js';
import { createBotApi } from './api.js';
import { nameOf, isGroupType, textOf, mediaOf, contentOf } from './inbound.js';

export const TOKEN = 'TELEGRAM_BOT_TOKEN';
const API = 'https://api.telegram.org';
const POLL_SECONDS = 50;
const POLL_WAIT = (POLL_SECONDS + 15) * 1000; // ms: a long poll without any answer by then is asked again
const SIGN_IN_WAIT = 20 * 1000; // ms: getMe
const SILENT_POLLS = 3; // long polls in a row without any answer before the status says so
const RETRY_FIRST = 2000; const RETRY_MAX = 60000; // ms: the connection's backoff
const UPDATES = ['message', 'edited_message', 'my_chat_member', 'message_reaction', 'poll_answer'];
const GROUP_TTL = 30 * 60000;
const MAX_GROUPS = 300; const MAX_NAMES = 2000; const MAX_IN_FLIGHT = 20; const MAX_LEFT = 500;
const ASK_EVERY = 24 * 3600000;
const SHARE_BUTTON = 'Share my number';
const START = /^\/start(@\w+)?(\s|$)/i; // how a direct chat with a bot opens
const ACTIVE = ['creator', 'administrator', 'member', 'restricted'];
const OUT = ['left', 'kicked'];
const TOO_MANY = 429; const RESENDS = 3; const RESEND_WAIT_MAX = 60; // "slow down": at most 3 more tries, 60 s each
const CAPTION_MAX = 1024; const TITLE_MAX = 128; const DESCRIPTION_MAX = 255;
const BAD_TOKEN = 'Telegram did not accept the bot token. Paste the token from @BotFather again (Replace token).';
const SECOND_READER = 'Another program is reading this bot’s messages (a second server with the same token?). Stop it, or create a new token.';
const NO_ANSWER = 'Telegram has not answered for a few minutes. Still trying.';
const MEDIA_SEND = { image: ['sendPhoto', 'photo'], gif: ['sendAnimation', 'animation'], video: ['sendVideo', 'video'], sticker: ['sendSticker', 'sticker'], document: ['sendDocument', 'document'] };

const sleep = (ms, signal) => new Promise((r) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); r(undefined); }, { once: true });
});
/** A Map that forgets its oldest entry past `max` (bounded caches). */
const remember = (map, key, value, max) => { map.delete(key); map.set(key, value); if (map.size > max) map.delete(map.keys().next().value); };
const isBadToken = (e) => e.tg === 401 || e.tg === 404;
/** Telegram says the bot is not in this chat: it was removed, or the chat is gone. */
const isGone = (e) => e.tg === 403 || (e.tg === 400 && /chat not found/i.test(e.message));
const needAdmin = (e) => { throw e.tg === 400 || e.tg === 403 ? fail(`${e.message}. The bot must be a group admin with this right.`) : e; };
const sentId = (m) => ({ msgId: m?.message_id ? String(m.message_id) : null });
const replyTo = (opts = {}) => {
  const id = Number(opts.quoted?.message_id || opts.quote?.msgId || 0);
  return id ? { reply_parameters: { message_id: id, allow_sending_without_reply: true } } : {};
};
/** The Bot API method and file field for a kind of media: audio is a voice note when it is OGG and wanted as one. */
const mediaMethod = (kind, mimetype, voiceNote) => (kind !== 'audio' ? MEDIA_SEND[kind] || MEDIA_SEND.document
  : voiceNote && mimetype === 'audio/ogg' ? ['sendVoice', 'voice'] : ['sendAudio', 'audio']);

/**
 * What every part shares. `fetch` and `token` are replaceable (tests and the demo pass a fake Bot API).
 * @param {{ fetch?: typeof globalThis.fetch, token?: () => string, api?: string }} [options]
 */
function createBot({ fetch: doFetch = globalThis.fetch, token = () => getSecret(TOKEN), api = API } = {}) {
  const bot = {
    api: createBotApi({ fetch: doFetch, token, api }),
    /** @type {any} */ on: null, // the hub's handlers
    /** @type {any} */ me: null, // getMe
    ctl: new AbortController(),
    state: { status: 'stopped', lastError: '', since: 0 },
    names: new Map(), // user id → name (for mentions in welcomes)
    moved: new Map(), // a group's old Telegram id → its new one (it became a supergroup)
    account: () => String(bot.me?.id || ''),
    key: (native) => `${PREFIX}:${bot.account()}#${native}`,
    phoneOf: (userId) => phoneOfIdentity('telegram', String(userId)),
    /** Telegram's chat id of an app chat id (for a group that moved: where it is now). */
    nativeOf(chat) {
      const c = chatParts(chat);
      if (!c) throw fail('Not a Telegram chat');
      if (bot.me && c.account !== bot.account()) throw fail('This chat belongs to another Telegram bot (the token was replaced)', 409);
      return bot.moved.get(c.native) || c.native;
    },
    /** The same for an action that only works in a group. */
    groupOf(chat) { const n = bot.nativeOf(chat); if (Number(n) > 0) throw fail('This only works in a group'); return n; },
    /** The connection's state; Activity hears when it breaks and when it is back (not every change of the reason). */
    setState(status, lastError = '') {
      const was = bot.state;
      if (was.status === status && was.lastError === lastError) return;
      bot.state = { status, lastError, since: status === 'open' && was.status !== 'open' ? Date.now() : was.since };
      if (status === 'error' && was.status !== 'error') activity('error', { summary: `Telegram connection: ${lastError}` });
      if (status === 'open' && was.status === 'error') activity('system', { summary: 'Telegram is connected again' });
      bus.emit('status');
    },
  };
  return bot;
}

/** The groups the bot knows: title, size, admins and permissions (kept 30 minutes), the ones it left, and where one moved. */
function groupBook(bot) {
  const groups = new Map(); // Telegram chat id → { title, size, admins: [{ id, status, name }], perms, at, tried }
  const leftGroups = () => { try { return JSON.parse(kvGet('telegram:left') || '[]'); } catch { return []; /* unreadable: as if it never left one */ } };
  /** The bot left a group (`out`) or is back in it: kept, because a bot cannot list its groups. */
  function setLeft(native, out) {
    const left = new Set(leftGroups());
    if (out) left.add(native); else left.delete(native);
    kvSet('telegram:left', JSON.stringify([...left].slice(-MAX_LEFT)));
  }
  function note(native, patch) {
    const g = { title: '', size: 0, admins: [], perms: null, at: 0, ...groups.get(native), ...patch };
    remember(groups, native, g, MAX_GROUPS);
    if (g.title) rememberGroupNames([{ id: bot.key(native), name: g.title }]);
    return g;
  }
  /** The bot is no longer in a group: it leaves the Chats list. */
  function left(native, title = groups.get(native)?.title || chatLabel(bot.key(native))) {
    setLeft(native, true);
    groups.delete(native);
    activity('config', { chat: bot.key(native), summary: `The Telegram bot left “${clip(title, 60)}”` });
    bus.emit('status');
  }
  /** Telegram made a group a supergroup: its id changes; settings, agent and memory move, and sends follow. */
  async function moved(from, to) {
    groups.delete(from);
    bot.moved.set(from, to);
    await bot.on.onChatMoved?.({ from: bot.key(from), to: bot.key(to) });
  }
  /** Title, member count, admins and permissions of a group (kept 30 minutes; `fresh` asks Telegram now). */
  async function details(native, fresh = false) {
    const g = groups.get(native);
    if (g?.at && !fresh && Date.now() - g.at < GROUP_TTL) return g;
    const { call } = bot.api;
    const [chat, size, admins] = await Promise.all([call('getChat', { chat_id: native }), call('getChatMemberCount', { chat_id: native }).catch(() => g?.size || 0),
      call('getChatAdministrators', { chat_id: native }).catch(() => [])]);
    return note(native, { title: chat.title || '', description: chat.description || '', size, perms: chat.permissions || null, at: Date.now(),
      admins: admins.filter((a) => !a.user.is_bot || a.user.id === bot.me?.id).map((a) => ({ id: a.user.id, status: a.status, name: nameOf(a.user), canInvite: !!a.can_invite_users })) });
  }
  /** Groups the bot is in: the ones it has seen (a bot cannot list them) minus those it left. */
  function list() {
    if (!bot.me) return [];
    const gone = new Set(leftGroups().map(bot.key));
    return seenChats({ groups: true }).filter((c) => c.id.startsWith(`${PREFIX}:${bot.account()}#`) && !gone.has(c.id))
      .map((c) => { const g = groups.get(bot.nativeOf(c.id)); return { id: c.id, name: g?.title || chatLabel(c.id), size: g?.size || 0 }; });
  }
  const askedAt = (native) => Math.max(groups.get(native)?.at || 0, groups.get(native)?.tried || 0);
  /**
   * Shared upkeep tick: one group that was not asked about for 30 minutes is refreshed. True when one was due. A group
   * Telegram does not answer for waits its 30 minutes like the others (so they all get their turn); one the bot is no
   * longer in leaves the list; one that became a supergroup moves.
   */
  async function refreshDue() {
    const due = list().map((c) => bot.nativeOf(c.id)).find((n) => Date.now() - askedAt(n) > GROUP_TTL);
    if (!due) return false;
    try { await details(due, true); } catch (e) {
      if (e.migrateTo) await moved(due, e.migrateTo);
      else if (isGone(e)) left(due);
      else note(due, { tried: Date.now() });
    }
    return true;
  }
  return { note, setLeft, left, moved, details, list, refreshDue, cached: (native) => groups.get(native), size: () => groups.size, clear: () => groups.clear() };
}

/**
 * Sends in order per chat. "Slow down" (429) waits retry_after and tries again; a group that became a supergroup is
 * followed to its new id (`moved` tells the app).
 */
function sendQueue(bot, moved) {
  const queues = new Map(); // Telegram chat id → tail promise of its sends
  async function attempt(native, send) {
    let to = native;
    for (let tries = 0; ; tries++) {
      try { return await send(to); } catch (e) {
        if (e.migrateTo && to === native) { to = e.migrateTo; await moved(native, to); continue; }
        if (e.tg !== TOO_MANY || tries >= RESENDS || bot.ctl.signal.aborted) throw e;
        await sleep(Math.min(e.retryAfter || 1, RESEND_WAIT_MAX) * 1000, bot.ctl.signal);
      }
    }
  }
  /** `send(chatId)` runs after the chat's earlier sends; the caller gets its result or its failure. */
  function queued(native, send) {
    const run = (queues.get(native) || Promise.resolve()).then(() => attempt(native, send));
    const tail = run.catch(() => {}); // the caller of `run` gets its failure; the queue only needs to know it ended
    queues.set(native, tail);
    tail.then(() => { if (queues.get(native) === tail) queues.delete(native); });
    return run;
  }
  return { queued, size: () => queues.size, clear: () => queues.clear() };
}

/** Linking a phone: the "Share my number" button of a direct chat. Only the sender's own contact counts. */
function phoneLinking(bot, queue) {
  const asked = new Map(); // Telegram chat id → when "Share my number" was last offered
  const keyboard = { keyboard: [[{ text: SHARE_BUTTON, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  const say = (native, text, extra = {}) => queue.queued(native, (id) => bot.api.call('sendMessage', { chat_id: id, text, ...extra }));
  function offer(native, text) {
    remember(asked, native, Date.now(), MAX_NAMES);
    return say(native, text, { reply_markup: keyboard });
  }
  return {
    /** A contact in a direct chat: links the phone only when it is the sender's own (contact.user_id === from.id). */
    async link(m) {
      const c = m.contact; const native = String(m.chat.id);
      const phone = digits(c.phone_number);
      if (!c.user_id || c.user_id !== m.from.id || phone.length < 6) return false;
      personFor({ channel: 'telegram', externalId: String(m.from.id), phone });
      activity('config', { chat: bot.key(native), summary: `${nameOf(m.from) || 'Someone'} linked their phone number to Telegram` });
      await say(native, 'Thanks, your number is linked. I now know you here as on WhatsApp, with the same roles.', { reply_markup: { remove_keyboard: true } })
        .catch(recordFailure('The Telegram note that the number is linked'));
      return true;
    },
    /** A direct chat opens with /start: a greeting, with the button for someone whose phone is not linked yet. */
    async greet(m) {
      const native = String(m.chat.id); const hi = `Hi ${nameOf(m.from) || 'there'}!`;
      const sent = bot.phoneOf(m.from.id) ? say(native, `${hi} Write your question and I’ll answer.`)
        : offer(native, `${hi} I’m ${bot.me.first_name}. Tap “${SHARE_BUTTON}” below so I know who you are (the same person as on WhatsApp, with the same roles). Or just write your question.`);
      await sent.catch(recordFailure('The Telegram greeting'));
    },
    /** 077: offer "Share my number" in a direct chat (at most once a day per chat). */
    async askForPhone(chat, why = '') {
      const n = bot.nativeOf(chat);
      if (Number(n) < 0 || Date.now() - (asked.get(n) || 0) < ASK_EVERY) return { asked: false };
      await offer(n, `${why || 'I don’t know who you are yet.'} Tap “${SHARE_BUTTON}” so I can check your role (the same as on WhatsApp).`);
      return { asked: true };
    },
    clear: () => asked.clear(),
  };
}

/** What arrives: each kind of update becomes the hub's message, join, move or "seen" (inbound.js maps the content). */
function inbound(bot, { groups, phones }) {
  /** The fields every inbound event shares. */
  function base(chat, from, extra) {
    const native = String(chat.id);
    if (from?.id) remember(bot.names, String(from.id), nameOf(from), MAX_NAMES);
    return { channel: 'telegram', chat: bot.key(native), number: bot.account(), isGroup: isGroupType(chat.type) || Number(native) < 0, phone: from?.id ? bot.phoneOf(from.id) : '',
      senderJid: from?.id ? String(from.id) : '', senderName: nameOf(from), fromMe: false, raw: null, ...extra };
  }
  async function onJoin(native, people) {
    for (const u of people) remember(bot.names, String(u.id), nameOf(u), MAX_NAMES);
    if (people.length) await bot.on.onJoin?.({ chat: bot.key(native), participants: people.map((u) => ({ jid: String(u.id), phone: bot.phoneOf(u.id) })) });
  }
  async function onMessage(m) {
    const native = String(m.chat.id);
    if (m.chat.type === 'channel' || !m.from || m.from.is_bot) return;
    const group = isGroupType(m.chat.type);
    if (group && m.chat.title) groups.note(native, { title: m.chat.title });
    if (m.migrate_to_chat_id) return groups.moved(native, String(m.migrate_to_chat_id));
    if (m.new_chat_members?.length) return onJoin(native, m.new_chat_members.filter((u) => !u.is_bot));
    if (!group && m.contact && await phones.link(m)) return;
    if (!group && START.test(textOf(m))) return phones.greet(m);
    const content = contentOf(m, bot.me);
    if (!content) return;
    const media = mediaOf(m);
    return bot.on.onMessage(base(m.chat, m.from, { ...content,
      ...(media ? { mediaInfo: media.info, mediaRef: media.ref, fetchMedia: () => bot.api.download(media.ref, media.info.size) } : {}) }));
  }
  /** 087: someone edited their message: the stored copy changes. */
  function onEdit(m) {
    if (!m.from || m.from.is_bot || !textOf(m)) return;
    return bot.on.onMessage(base(m.chat, m.from, { msgId: '', ts: (m.edit_date || m.date) * 1000, kind: 'edited', text: textOf(m), target: String(m.message_id) }));
  }
  function onReaction(r) {
    if (!r.user || r.user.is_bot) return;
    const emoji = (r.new_reaction || []).find((x) => x.type === 'emoji')?.emoji || '';
    return bot.on.onMessage(base(r.chat, r.user, { msgId: '', ts: r.date * 1000, kind: 'reaction', text: '', target: String(r.message_id), emoji }));
  }
  function onPollAnswer(a) {
    const p = a.user && pollByRef(`tg:${a.poll_id}`);
    if (!p) return;
    const native = bot.nativeOf(p.chat);
    return bot.on.onMessage(base({ id: native, type: Number(native) < 0 ? 'group' : 'private' }, a.user,
      { msgId: '', ts: Date.now(), kind: 'poll_vote', text: '', pollId: p.msg_id, selected: (a.option_ids || []).map((i) => p.options[i]).filter(Boolean) }));
  }
  /** The bot was added to, removed from, or promoted in a group. */
  async function onMembership(u) {
    const native = String(u.chat.id);
    if (!isGroupType(u.chat.type)) return;
    if (OUT.includes(u.new_chat_member?.status)) return groups.left(native, u.chat.title);
    groups.setLeft(native, false);
    groups.note(native, { title: u.chat.title, at: 0 }); // refreshed at the next upkeep tick
    if (OUT.includes(u.old_chat_member?.status)) {
      // a new group shows up in Chats (off until switched on): metadata only, through the hub's chat list
      await bot.on.onSeen?.({ chat: bot.key(native), number: bot.account(), isGroup: true });
      activity('config', { chat: bot.key(native), summary: `The Telegram bot was added to “${clip(u.chat.title, 60)}”: switch it on in Chats to let an agent answer there` });
    }
    bus.emit('status');
  }
  const handlers = { message: onMessage, edited_message: onEdit, my_chat_member: onMembership, message_reaction: onReaction, poll_answer: onPollAnswer };
  /** One update, handled by what it carries. */
  return async function onUpdate(u) {
    const kind = UPDATES.find((k) => u[k]);
    if (kind) await handlers[kind](u[kind]);
  };
}

/** The connection: who the bot is (getMe), then one long poll at a time. Trouble shows in the status and is retried. */
function connection(bot, onUpdate, { groups, queue, phones }) {
  let offset = 0; let inFlight = 0;
  const waitFor = (signal, ms) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);

  /** One getMe. 'open': the bot is known. 'refused': the token is wrong. 'later': Telegram was not reached. */
  async function signIn(signal) {
    try { bot.me = await bot.api.call('getMe', {}, { signal: waitFor(signal, SIGN_IN_WAIT) }); } catch (e) {
      if (!signal.aborted) bot.setState('error', isBadToken(e) ? BAD_TOKEN : e.message);
      return isBadToken(e) ? 'refused' : 'later';
    }
    bot.setState('open'); // the token works; the long poll keeps it so, or reports what went wrong
    return 'open';
  }
  /** Each update is handled on its own; a burst waits instead of piling up. */
  async function hand(list, signal) {
    for (const u of list) {
      offset = u.update_id + 1;
      while (inFlight >= MAX_IN_FLIGHT && !signal.aborted) await sleep(50, signal);
      inFlight++;
      onUpdate(u).catch((e) => activity('error', { summary: `Telegram message not handled: ${e.message}` })).finally(() => { inFlight--; });
    }
  }
  /**
   * A long poll failed. Returns what the status shows while the connection waits before it asks again, '' to ask
   * again at once, or null when the token is refused (polling ends). `silent`: polls in a row without any answer.
   */
  async function pollTrouble(e, silent) {
    if (e.timedOut) return silent < SILENT_POLLS ? '' : NO_ANSWER; // one long poll that outlived its wait is routine
    if (isBadToken(e)) return null;
    if (e.tg !== 409) return e.message;
    if (!/webhook/i.test(e.message)) return SECOND_READER;
    // another setup sends this bot's updates to a webhook: take them back
    try { await bot.api.call('deleteWebhook', {}); } catch (err) { return `The bot’s webhook could not be removed (${err.message})`; }
    activity('config', { summary: 'Telegram: the bot had a webhook; it now delivers to this server' });
    return '';
  }
  async function pollLoop(signal) {
    let backoff = 0; let silent = 0;
    while (!signal.aborted) {
      try {
        // after trouble the first poll does not wait for updates: an answer at once says the connection is back
        const timeout = bot.state.status === 'open' ? POLL_SECONDS : 0;
        const list = await bot.api.call('getUpdates', { offset, timeout, allowed_updates: UPDATES }, { signal: waitFor(signal, POLL_WAIT) });
        backoff = 0; silent = 0; bot.setState('open');
        await hand(list, signal);
      } catch (e) {
        if (signal.aborted) break;
        silent = e.timedOut ? silent + 1 : 0;
        const trouble = await pollTrouble(e, silent);
        if (trouble === null) { bot.setState('error', BAD_TOKEN); return; }
        if (!trouble) continue;
        bot.setState('error', trouble);
        backoff = Math.min(RETRY_MAX, e.retryAfter ? e.retryAfter * 1000 : backoff ? backoff * 2 : RETRY_FIRST);
        await sleep(backoff, signal);
      }
    }
  }
  /** After the first getMe: when Telegram was not reached it is asked again, with backoff; then the long poll runs. */
  async function connect(signal, first) {
    let outcome = first;
    for (let wait = RETRY_FIRST; outcome === 'later' && !signal.aborted; wait = Math.min(RETRY_MAX, wait * 2)) {
      await sleep(wait, signal);
      if (!signal.aborted) outcome = await signIn(signal);
    }
    if (outcome === 'open' && !signal.aborted) await pollLoop(signal);
  }
  return {
    /** Resolves after the first getMe: connected, or the status says why not (an unreachable Telegram is asked again). */
    async start(handlers) {
      bot.on = handlers;
      bot.ctl.abort(); // a start while it runs: the earlier long poll ends, so two never read the same bot
      bot.ctl = new AbortController();
      bot.setState('starting');
      const first = await signIn(bot.ctl.signal);
      connect(bot.ctl.signal, first).catch(recordFailure('The Telegram connection'));
    },
    async stop() { bot.ctl.abort(); bot.setState('stopped'); queue.clear(); groups.clear(); bot.names.clear(); phones.clear(); },
    async status() {
      const { me } = bot;
      const info = me ? { id: bot.account(), username: me.username, name: me.first_name, canReadAll: !!me.can_read_all_group_messages, canJoinGroups: me.can_join_groups !== false,
        dmAgent: getSetting('telegram', {})?.dmAgent || '', link: `https://t.me/${me.username}`, groupLink: `https://t.me/${me.username}?startgroup=duniya` } : null;
      const st = { status: bot.state.status, lastError: bot.state.lastError, since: bot.state.since };
      return { ...st, numbers: [{ id: bot.account() || 'bot', label: info ? `@${info.username}` : 'Telegram bot', ...st }], info, cache: { groups: groups.size(), names: bot.names.size, queues: queue.size() } };
    },
    /** Shared upkeep tick: one group whose details are older than 30 minutes is refreshed. */
    async upkeep() { return bot.state.status === 'open' && await groups.refreshDue() ? { ok: true } : { ok: false, reason: 'not_due' }; },
  };
}

/** What the hub asks about chats and people. */
function lookups(bot, { groups, phones }) {
  const { call } = bot.api;
  return {
    listChats: async () => groups.list(),
    async chatName(chat) {
      const n = bot.nativeOf(chat);
      if (Number(n) > 0) return '';
      return groups.cached(n)?.title || (await groups.details(n).catch(() => null))?.title || ''; // no answer: no name yet (upkeep asks again)
    },
    async isMember(chat, phone, senderJid) {
      const n = bot.nativeOf(chat);
      const user = /^\d+$/.test(String(senderJid || '')) ? String(senderJid) : identityByPhone('telegram', phone);
      if (!user) return false;
      const r = await call('getChatMember', { chat_id: n, user_id: Number(user) }).catch(() => null); // no answer: not let in (a permission is never guessed)
      return !!r && (ACTIVE.includes(r.status) && (r.status !== 'restricted' || r.is_member !== false));
    },
    /** Admins only (a bot cannot list members); phone when the admin linked it. */
    async groupMembers(chat) {
      const g = await groups.details(bot.groupOf(chat));
      return g.admins.map((a) => ({ jid: String(a.id), phone: bot.phoneOf(a.id), admin: a.status === 'creator' ? 'superadmin' : 'admin', name: a.name }));
    },
    async refreshGroup(chat) { await groups.details(bot.groupOf(chat), true); return { ok: true }; },
    askForPhone: phones.askForPhone,
    async downloadMedia(chat, ref, declared = 0) { bot.nativeOf(chat); return bot.api.download(ref, declared); },
  };
}

/** The people a text names as "@<user id>": who to link, and the name to show. */
const mentionedIn = (ids, names) => [...new Set((ids || []).map((x) => String(x).split('@')[0]))].filter((id) => /^\d+$/.test(id))
  .map((id) => ({ id, name: names.get(id) || 'there' }));
/** How much longer a text gets when its "@<user id>" tags become names. */
const growth = (people) => people.reduce((n, p) => n + Math.max(0, p.name.length - `@${p.id}`.length), 0);

/** What the hub sends. Messages go through the chat's queue, so they keep their order. */
function sends(bot, queue) {
  const { call, upload } = bot.api;
  const courtesy = (chat) => call('sendChatAction', { chat_id: bot.nativeOf(chat), action: 'typing' }).catch(() => {}); // "typing…" is a courtesy: the answer goes out without it
  return {
    async typing(chat) { await courtesy(chat); },
    async presence(chat) { await courtesy(chat); return { ok: true }; },
    async send(chat, text, opts = {}) {
      const n = bot.nativeOf(chat);
      const people = mentionedIn(opts.mentions, bot.names);
      let first = null;
      for (const [i, part] of chunks(String(text ?? ''), MAX_TEXT - growth(people)).entries()) {
        const f = linkMentions(toEntities(part), people);
        const sent = await queue.queued(n, (id) => call('sendMessage', { chat_id: id, text: f.text, entities: f.entities, link_preview_options: { is_disabled: true }, ...(i === 0 ? replyTo(opts) : {}) }));
        first ||= sent;
      }
      return sentId(first);
    },
    /** @param {string} chat @param {any} media */
    async sendMedia(chat, { kind, url, base64, mimetype, caption = '', fileName = '', voiceNote = true, quote }) {
      const n = bot.nativeOf(chat);
      const m = await loadMedia(kind, { url, base64, mimetype, fileName });
      const cap = caption ? toEntities(clip(caption, CAPTION_MAX)) : null;
      const [method, field] = mediaMethod(kind, m.mimetype, voiceNote);
      const sent = await queue.queued(n, (id) => upload(method, kind === 'sticker' ? { chat_id: id }
        : { chat_id: id, ...(cap ? { caption: cap.text, caption_entities: cap.entities } : {}), ...replyTo({ quote }) }, field, m));
      const media = mediaOf(sent || {}); // 096: what it is, stored with the message
      return { ...sentId(sent), ...(media ? { mediaInfo: media.info, mediaRef: media.ref } : {}), mimetype: m.mimetype, bytes: m.buffer.length };
    },
    async sendLocation(chat, { latitude, longitude, name = '', address = '' }) {
      const n = bot.nativeOf(chat); const lat = Number(latitude); const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail('latitude/longitude out of range');
      return sentId(await queue.queued(n, (id) => (name ? call('sendVenue', { chat_id: id, latitude: lat, longitude: lng, title: clip(name, 100), address: clip(address || name, 200) })
        : call('sendLocation', { chat_id: id, latitude: lat, longitude: lng }))));
    },
    async sendContact(chat, { name, phone }) {
      const n = bot.nativeOf(chat); const d = digits(phone);
      if (!name || d.length < 6) throw fail('A contact needs a name and a phone number with country code');
      return sentId(await queue.queued(n, (id) => call('sendContact', { chat_id: id, phone_number: `+${d}`, first_name: clip(name, 60) })));
    },
    async react(chat, ref, emoji = '') {
      const n = bot.nativeOf(chat); const e = reactionFor(emoji);
      if (e === null) throw fail(`Telegram allows only some reactions, e.g. ${SOME_REACTIONS}`);
      if (!ref?.msgId) throw fail('Which message? (msg id missing)');
      await call('setMessageReaction', { chat_id: n, message_id: Number(ref.msgId), reaction: e ? [{ type: 'emoji', emoji: e }] : [] });
      return { ok: true };
    },
    async editMessage(chat, msgId, text) {
      const n = bot.nativeOf(chat); const f = toEntities(chunks(String(text))[0]);
      return sentId(await queue.queued(n, (id) => call('editMessageText', { chat_id: id, message_id: Number(msgId), text: f.text, entities: f.entities })));
    },
    async deleteMessage(chat, ref) { await call('deleteMessage', { chat_id: bot.nativeOf(chat), message_id: Number(ref?.msgId) }).catch(needAdmin); return { ok: true }; },
    /** Non-anonymous polls, so each vote arrives (poll_answer) and poll_results can say who voted. */
    async sendPoll(chat, { name, options, multi = false }) {
      const n = bot.nativeOf(chat);
      const values = [...new Set((options || []).map((o) => String(o).trim()).filter(Boolean))];
      if (!String(name || '').trim() || values.length < 2 || values.length > 12) throw fail('A poll needs a question and 2–12 different options');
      const sent = await queue.queued(n, (id) => call('sendPoll', { chat_id: id, question: clip(name, 300), options: values.map((text) => ({ text: clip(text, 100) })), is_anonymous: false, allows_multiple_answers: !!multi }));
      savePoll({ chat, msgId: String(sent.message_id), name: String(name).trim(), options: values, selectable: multi ? 0 : 1, creator: bot.account(), message: `tg:${sent.poll?.id || ''}` });
      return sentId(sent);
    },
  };
}

/** What the hub does to a group. The bot must be an admin with the matching right. */
function groupActions(bot, groups) {
  const { call, upload } = bot.api;
  const role = (a) => (a.status === 'creator' ? 'superadmin' : 'admin');
  return {
    async groupInfo(chat) {
      const g = await groups.details(bot.groupOf(chat), true);
      const p = g.perms || {};
      return { id: chat, subject: g.title, description: g.description || '', owner: '', size: g.size, announcement: p.can_send_messages === false, locked: p.can_change_info === false,
        joinApproval: false, participants: g.admins.filter((a) => a.id !== bot.me.id).map((a) => ({ phone: bot.phoneOf(a.id), jid: String(a.id), admin: role(a) })) };
    },
    async groupInviteLink(chat) { const n = bot.groupOf(chat); return { link: (await call('getChat', { chat_id: n })).invite_link || await call('exportChatInviteLink', { chat_id: n }).catch(needAdmin) }; },
    async groupRevokeInvite(chat) { return { link: await call('exportChatInviteLink', { chat_id: bot.groupOf(chat) }).catch(needAdmin) }; },
    async groupSubject(chat, subject) {
      const n = bot.groupOf(chat); const title = clip(subject, TITLE_MAX);
      await call('setChatTitle', { chat_id: n, title }).catch(needAdmin);
      groups.note(n, { title });
      return { ok: true };
    },
    async groupDescription(chat, text) { await call('setChatDescription', { chat_id: bot.groupOf(chat), description: String(text || '').slice(0, DESCRIPTION_MAX) }).catch(needAdmin); return { ok: true }; },
    async groupPicture(chat, { url }) { const n = bot.groupOf(chat); await upload('setChatPhoto', { chat_id: n }, 'photo', await loadMedia('image', { url })).catch(needAdmin); return { ok: true }; },
    /** @param {string} chat @param {any} change */
    async groupSettings(chat, { announcement, locked, joinApproval }) {
      const n = bot.groupOf(chat);
      if (typeof joinApproval === 'boolean') throw fail('On Telegram, join requests are set per invite link in the app, not here');
      const cur = (await groups.details(n, true)).perms || {};
      const next = { ...cur, ...(typeof announcement === 'boolean' ? { can_send_messages: !announcement } : {}), ...(typeof locked === 'boolean' ? { can_change_info: !locked } : {}) };
      await call('setChatPermissions', { chat_id: n, permissions: next, use_independent_chat_permissions: false }).catch(needAdmin);
      groups.note(n, { perms: next });
      return { ok: true };
    },
    async groupLeave(chat) { await call('leaveChat', { chat_id: bot.groupOf(chat) }); return { ok: true }; },
  };
}

/** @param {{ fetch?: typeof globalThis.fetch, token?: () => string, api?: string }} [options] */
export function createTelegramAdapter(options) {
  const bot = createBot(options);
  const groups = groupBook(bot);
  const queue = sendQueue(bot, groups.moved);
  const phones = phoneLinking(bot, queue);
  const parts = { groups, queue, phones };
  return { id: 'telegram', ...connection(bot, inbound(bot, parts), parts), ...lookups(bot, parts), ...sends(bot, queue), ...groupActions(bot, groups) };
}
