// @ts-check
// The channel hub (075). The rest of the app talks to one object — router, panel, scheduler, tools — and calls
// hub.send(chat, …), hub.react(chat, …) and so on; the hub finds the channel from the chat id (index.js) and hands
// the call to that channel's adapter. Adapters load with import() only when their channel is set up and on, so a
// fresh install opens no socket and never loads Baileys. Switching a channel off stops its adapter (sockets, caches)
// and drops it; its module code stays loaded until the next restart.
//
// Adapter interface (every adapter, e.g. ./whatsapp/index.js):
//   start(handlers)  handlers = { onMessage, onHistory?, onJoin?, onMemberTag?, onPhoneActive?, onGroupChange? }
//   stop(), status() → { status, numbers?: [...] }, listChats(), upkeep?() (bounded, from the shared tick)
//   chat actions with the app chat id first: send, typing, chatName, isMember, groupMembers, refreshGroup, sendMedia,
//   react, sendPoll, … (only those its capabilities in index.js promise)
// Inbound messages are one shape for every channel: { channel, chat, number (account), isGroup, phone ('' when the
// channel has no phone numbers), senderJid (the sender's id on the channel), senderName, msgId, ts, kind, text,
// quoted, mentioned, replyToAgent, mediaInfo?, fetchMedia?, raw }.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, fail, within } from '../core/config.js';
import { getSecret, getSetting, onSecretChange, updateSettings } from '../core/store.js';
import { activity, bus, recordFailure } from '../core/events.js';
import { noteChat } from '../core/chat-prefs.js';
import { rememberGroupNames } from '../core/chat-names.js';
import { CHANNELS, channelInfo, channelOf } from './index.js';

/** How to load each channel's adapter, and whether the owner has set it up (without loading it). */
const DEFAULT_LOADERS = { whatsapp: async () => (await import('./whatsapp/index.js')).createWhatsAppAdapter(),
  telegram: async () => (await import('./telegram/index.js')).createTelegramAdapter() };
const numbers = () => { const l = getSetting('whatsappNumbers', null); return Array.isArray(l) ? l : []; };
/** Set up without loading anything: WhatsApp has numbers or a linked device; token channels (077) have their secret. */
const SET_UP = { whatsapp: () => numbers().length > 0 || existsSync(resolve(DATA_DIR, 'whatsapp-auth')) };
const isSetUp = (id) => (SET_UP[id] ? SET_UP[id]() : !!(channelInfo(id)?.secret && getSecret(channelInfo(id).secret.name)));
const FIRST_ACCOUNT = { whatsapp: () => { if (!numbers().length) updateSettings({ whatsappNumbers: [{ id: 'main', label: 'Main' }] }); } };
const offList = () => { const l = getSetting('channelsOff', []); return Array.isArray(l) ? l : []; };

/** Chat actions every adapter may offer; a missing one answers 501. */
const CHAT_ACTIONS = ['send', 'groupMembers', 'refreshGroup', 'sendMedia', 'sendLocation', 'sendContact', 'react', 'editMessage', 'deleteMessage', 'markRead',
  'presence', 'sendPoll', 'downloadMedia', 'fetchHistory', 'groupInfo', 'groupInviteLink', 'groupRevokeInvite', 'groupParticipants', 'groupSubject',
  'groupDescription', 'groupPicture', 'groupSettings', 'groupLeave', 'profile', 'block', 'unblock', 'setProfileName', 'setProfileStatus', 'askForPhone'];
/** WhatsApp's own account actions (QR, pairing code, numbers), used by the WhatsApp channel page and the admin MCP. */
const WHATSAPP_ACTIONS = ['pair', 'logout', 'restart', 'renameNumber', 'removeNumber', 'lookupNumber', 'groupCreate', 'refreshNames'];
// Reads a screen, a list or a reply waits for: bounded at READ_WAIT, so a channel that does not answer (a group that
// does not exist, a socket half gone) fails in plain words instead of holding the panel or a turn. Sends, uploads and
// group changes are not cut off here: they may legitimately take longer, and the channel bounds them itself.
const READS = new Set(['groupMembers', 'groupInfo', 'groupInviteLink', 'groupParticipants', 'profile', 'fetchHistory', 'lookupNumber']);
const READ_WAIT = 10 * 1000; // ms
// Sends an adapter refused because it is offline right now (`offline` on the error: nothing left the server) are tried
// again while it reconnects, so an answer that is already written is not lost to a short drop.
const SENDS = new Set(['send', 'sendMedia', 'sendPoll', 'sendLocation', 'sendContact']);
const RESEND_AFTER = [2000, 5000, 10000]; // ms between tries
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function whileOffline(run) {
  for (const wait of RESEND_AFTER) {
    try { return await run(); } catch (e) { if (!e?.offline) throw e; }
    await pause(wait);
  }
  return run();
}
const CHATS_RETRY = 60 * 1000; // ms before upkeep asks a channel for its groups again when it did not answer
const CHATS_WAIT = 1500; // ms a caller waits for a new list of groups once one is known
const MB = 1048576;
const MEASURE_AFTER_MS = 60000;

/** `loaders` replaces how adapters load (tests pass fakes). */
export function createHub({ loaders = DEFAULT_LOADERS } = {}) {
  /** @type {Map<string, { adapter: any, rssBefore: number, loadedAt: number, costMb: number|null }>} */
  const live = new Map();
  const errors = new Map(); // channel -> last load error
  /** @type {any} */ let handlers = null;
  let turn = 0; // round-robin upkeep

  const wrapped = () => ({ ...handlers,
    onMessage: async (m) => { // every channel's chats are noted for the Chats list (metadata only, also while off)
      try { noteChat({ chat: m.chat, number: m.number, isGroup: m.isGroup, name: m.isGroup ? '' : m.senderName, phone: m.isGroup ? '' : m.phone }); } catch { /* best effort */ }
      return handlers.onMessage(m);
    },
    onSeen: (c) => { try { noteChat(c); } catch { /* best effort */ } } }); // 077: a group the bot was added to, before anyone writes

  const loading = new Map(); // id → the load in progress (a token saved while the channel is switched on loads once)
  function load(id) {
    if (live.has(id)) return Promise.resolve(live.get(id).adapter);
    if (!loading.has(id)) loading.set(id, loadNow(id).finally(() => loading.delete(id)));
    return loading.get(id);
  }
  async function loadNow(id) {
    const make = loaders[id];
    if (!make) throw fail(`Unknown channel "${id}"`, 404);
    const rssBefore = process.memoryUsage().rss;
    try {
      const adapter = await make();
      live.set(id, { adapter, rssBefore, loadedAt: Date.now(), costMb: null });
      errors.delete(id);
      if (handlers) await adapter.start(wrapped());
      bus.emit('status');
      return adapter;
    } catch (e) {
      live.delete(id); errors.set(id, e.message);
      activity('error', { summary: `${channelInfo(id)?.label || id} did not start: ${e.message}` });
      throw e;
    }
  }
  // The groups of each channel as it last told them. A channel that does not answer in time keeps its last list.
  const lastChats = new Map(); // channel id → [{ id, name, size }]
  let chatsKnown = false; // every live channel answered at least once since the start
  let asking = null; // the listing in progress (one at a time)
  let chatsAskedAt = 0; // when upkeep last asked because nothing was known yet
  async function askChats() {
    const lists = await Promise.all([...live].map(async ([id, { adapter: a }]) => {
      try { lastChats.set(id, await within(a.listChats(), READ_WAIT, 'chat list')); } catch { /* it did not answer: its last list stands */ }
      return lastChats.get(id) || [];
    }));
    chatsKnown = [...live.keys()].every((id) => lastChats.has(id));
    const all = lists.flat();
    rememberGroupNames(all);
    return all;
  }
  /**
   * The groups every channel is in. The channels are asked each time (the names they tell are remembered), but once a
   * list is known a caller waits for the new one only for CHATS_WAIT: a screen then shows the last known list and the
   * new one is there for the next look.
   */
  function listChats() {
    asking ||= askChats().finally(() => { asking = null; });
    return chatsKnown ? within(asking, CHATS_WAIT, 'chat list').catch(() => [...lastChats.values()].flat()) : asking;
  }
  const setUp = isSetUp;
  const label = (id) => channelInfo(id)?.label || id;
  /** The live adapter of a channel; a 409 that says why when it is not running. */
  function adapter(id) {
    const a = live.get(id)?.adapter;
    if (a) return a;
    throw fail(!setUp(id) ? `${label(id)} is not set up` : offList().includes(id) ? `${label(id)} is switched off` : `${label(id)} is not running`, 409);
  }
  const route = (chat) => {
    const id = channelOf(chat);
    if (!id) throw fail('This chat does not belong to any channel', 400);
    return adapter(id);
  };

  const actions = {};
  for (const name of CHAT_ACTIONS) {
    actions[name] = async (chat, ...args) => {
      const a = route(chat);
      if (typeof a[name] !== 'function') throw fail(`${label(channelOf(chat))} cannot ${name}`, 501);
      if (SENDS.has(name)) return whileOffline(() => route(chat)[name](chat, ...args)); // route again: the adapter may have been reloaded
      return READS.has(name) ? within(a[name](chat, ...args), READ_WAIT, label(channelOf(chat))) : a[name](chat, ...args);
    };
  }
  for (const name of WHATSAPP_ACTIONS) actions[name] = (...args) => (READS.has(name) ? within(adapter('whatsapp')[name](...args), READ_WAIT, 'WhatsApp') : adapter('whatsapp')[name](...args));

  /** One row per channel for the panel, Health and the admin MCP. */
  async function channels() {
    const out = [];
    for (const c of CHANNELS) {
      const l = live.get(c.id);
      const st = l ? await l.adapter.status().catch((e) => ({ status: 'error', lastError: e.message })) : null;
      const accounts = st?.numbers || [];
      out.push({ id: c.id, label: c.label, setup: c.setup, state: l ? 'on' : errors.has(c.id) ? 'error' : !setUp(c.id) ? 'not_set_up' : 'off',
        error: errors.get(c.id) || '', accounts: accounts.length, connected: accounts.filter((n) => n.status === 'open').length,
        memoryMb: l?.costMb ?? null, measuring: !!l && l.costMb === null, info: st?.info || null, status: st?.status || '', lastError: st?.lastError || '' });
    }
    return out;
  }

  /** Every account of every running channel, for the connection watch (upkeep.js): { key, channel, app, label, status, lastError }. */
  async function accounts() {
    const out = [];
    for (const [id, { adapter: a }] of live) {
      const st = await a.status().catch((e) => ({ numbers: [{ id, status: 'error', lastError: e.message }] }));
      for (const n of st.numbers || []) out.push({ key: `${id}:${n.id}`, channel: id, app: label(id), label: n.label || n.id, status: n.status, lastError: n.lastError || '' });
    }
    return out;
  }

  /** Switch a channel on (setting it up with its first account when needed) or off (adapter stopped and dropped). */
  async function setEnabled(id, on, by = '') {
    if (!channelInfo(id)) throw fail(`Unknown channel "${id}"`, 404);
    if (on && !setUp(id) && !FIRST_ACCOUNT[id]) throw fail(`${label(id)} is not set up yet: ${channelInfo(id).secret ? 'paste its token first' : 'set it up first'}`, 409);
    const off = offList().filter((x) => x !== id);
    updateSettings({ channelsOff: on ? off : [...off, id] });
    if (on) { FIRST_ACCOUNT[id]?.(); await load(id); } else {
      const l = live.get(id); live.delete(id); lastChats.delete(id);
      await l?.adapter.stop().catch(() => {}); // it is dropped either way
      bus.emit('status');
    }
    activity('config', { summary: `${label(id)} switched ${on ? 'on' : 'off'}${by ? ` (${by})` : ''}` });
    return (await channels()).find((c) => c.id === id);
  }

  /** 077: a token channel's secret was saved or removed: (re)start it with the new token, or stop it. */
  async function secretChanged(name) {
    const c = CHANNELS.find((x) => x.secret?.name === name);
    if (!c) return;
    const l = live.get(c.id); live.delete(c.id); lastChats.delete(c.id);
    await l?.adapter.stop().catch(() => {}); // it is dropped either way
    errors.delete(c.id);
    if (setUp(c.id) && !offList().includes(c.id)) await load(c.id).catch(() => {}); // load() records why a channel did not start
    else bus.emit('status');
  }

  return {
    ...actions,
    /** Start every channel that is set up and on. */
    async start(h) {
      handlers = h;
      onSecretChange((name) => { secretChanged(name).catch(recordFailure('Restarting a channel after its token changed')); });
      for (const l of live.values()) await l.adapter.start(wrapped()); // switched on in the panel before the app finished starting
      for (const c of CHANNELS) if (setUp(c.id) && !offList().includes(c.id)) await load(c.id).catch(() => {}); // load() records why a channel did not start
    },
    async typing(chat) { try { await route(chat).typing?.(chat); } catch { /* best effort */ } },
    async chatName(chat) { // 073: every subject a channel tells us is remembered for the one chat-name resolver
      try { const name = await within(Promise.resolve(route(chat).chatName?.(chat)), READ_WAIT, 'chat name'); rememberGroupNames([{ id: chat, name }]); return name || ''; } catch { return ''; }
    },
    async isMember(chat, phone, senderJid) { try { return !!(await within(Promise.resolve(route(chat).isMember?.(chat, phone, senderJid)), READ_WAIT, 'member check')); } catch { return false; } },
    listChats,
    /** WhatsApp's first number at the top level (as the panel has always read it), its numbers, and every channel. */
    async status() {
      const wa = live.get('whatsapp');
      const st = wa ? await wa.adapter.status() : { status: setUp('whatsapp') ? 'off' : 'not_set_up', numbers: [] };
      return { ...st, channels: await channels() };
    },
    channels,
    accounts,
    setEnabled,
    /** A new WhatsApp number (WhatsApp is switched on first when it was not running). */
    async addNumber(n) { if (!live.has('whatsapp')) await setEnabled('whatsapp', true); return adapter('whatsapp').addNumber(n); },
    /**
     * Shared upkeep tick (057): the load cost of a channel is measured once, a minute after it started (RSS delta,
     * approximate); then one channel per tick, in turn, does its own bounded upkeep.
     */
    async upkeep(now = Date.now()) {
      const rss = process.memoryUsage().rss;
      for (const l of live.values()) if (l.costMb === null && now - l.loadedAt >= MEASURE_AFTER_MS) l.costMb = Math.max(0, Math.round((rss - l.rssBefore) / MB));
      const list = [...live.values()];
      if (!list.length) return { ok: false, reason: 'not_due' };
      // after a start: the groups each channel is in, once, so lists have their names before anyone opens Chats
      if (!chatsKnown && now - chatsAskedAt >= CHATS_RETRY) { chatsAskedAt = now; await listChats(); }
      const r = await list[turn++ % list.length].adapter.upkeep?.().catch(() => null);
      return r || { ok: false, reason: 'not_due' };
    },
    /** 069: graceful shutdown: every channel closes its connections. */
    async stop() { for (const l of live.values()) await l.adapter.stop().catch(() => {}); }, // the app is stopping: the other channels still close
  };
}
