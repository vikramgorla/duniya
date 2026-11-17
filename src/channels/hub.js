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
import { DATA_DIR, fail } from '../core/config.js';
import { getSetting, updateSettings } from '../core/store.js';
import { activity, bus } from '../core/events.js';
import { noteChat } from '../core/chat-prefs.js';
import { rememberGroupNames } from '../core/chat-names.js';
import { CHANNELS, channelInfo, channelOf } from './index.js';

/** How to load each channel's adapter, and whether the owner has set it up (without loading it). */
const DEFAULT_LOADERS = { whatsapp: async () => (await import('./whatsapp/index.js')).createWhatsAppAdapter() };
const numbers = () => { const l = getSetting('whatsappNumbers', null); return Array.isArray(l) ? l : []; };
const SET_UP = { whatsapp: () => numbers().length > 0 || existsSync(resolve(DATA_DIR, 'whatsapp-auth')) };
const FIRST_ACCOUNT = { whatsapp: () => { if (!numbers().length) updateSettings({ whatsappNumbers: [{ id: 'main', label: 'Main' }] }); } };
const offList = () => { const l = getSetting('channelsOff', []); return Array.isArray(l) ? l : []; };

/** Chat actions every adapter may offer; a missing one answers 501. */
const CHAT_ACTIONS = ['send', 'groupMembers', 'refreshGroup', 'sendMedia', 'sendLocation', 'sendContact', 'react', 'editMessage', 'deleteMessage', 'markRead',
  'presence', 'sendPoll', 'downloadMedia', 'fetchHistory', 'groupInfo', 'groupInviteLink', 'groupRevokeInvite', 'groupParticipants', 'groupSubject',
  'groupDescription', 'groupPicture', 'groupSettings', 'groupLeave', 'profile', 'block', 'unblock', 'setProfileName', 'setProfileStatus'];
/** WhatsApp's own account actions (QR, pairing code, numbers), used by the WhatsApp channel page and the admin MCP. */
const WHATSAPP_ACTIONS = ['pair', 'logout', 'restart', 'renameNumber', 'removeNumber', 'lookupNumber', 'groupCreate', 'refreshNames'];
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
    } });

  async function load(id) {
    if (live.has(id)) return live.get(id).adapter;
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
  const setUp = (id) => !!SET_UP[id]?.();
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
      return a[name](chat, ...args);
    };
  }
  for (const name of WHATSAPP_ACTIONS) actions[name] = (...args) => adapter('whatsapp')[name](...args);

  /** One row per channel for the panel, Health and the admin MCP. */
  async function channels() {
    const out = [];
    for (const c of CHANNELS) {
      const l = live.get(c.id);
      const st = l ? await l.adapter.status().catch((e) => ({ status: 'error', lastError: e.message })) : null;
      const accounts = st?.numbers || [];
      out.push({ id: c.id, label: c.label, setup: c.setup, state: l ? 'on' : errors.has(c.id) ? 'error' : !setUp(c.id) ? 'not_set_up' : 'off',
        error: errors.get(c.id) || '', accounts: accounts.length, connected: accounts.filter((n) => n.status === 'open').length,
        memoryMb: l?.costMb ?? null, measuring: !!l && l.costMb === null });
    }
    return out;
  }

  /** Switch a channel on (setting it up with its first account when needed) or off (adapter stopped and dropped). */
  async function setEnabled(id, on, by = '') {
    if (!channelInfo(id)) throw fail(`Unknown channel "${id}"`, 404);
    const off = offList().filter((x) => x !== id);
    updateSettings({ channelsOff: on ? off : [...off, id] });
    if (on) { FIRST_ACCOUNT[id]?.(); await load(id); } else {
      const l = live.get(id); live.delete(id);
      await l?.adapter.stop().catch(() => {});
      bus.emit('status');
    }
    activity('config', { summary: `${label(id)} switched ${on ? 'on' : 'off'}${by ? ` (${by})` : ''}` });
    return (await channels()).find((c) => c.id === id);
  }

  return {
    ...actions,
    /** Start every channel that is set up and on. */
    async start(h) {
      handlers = h;
      for (const l of live.values()) await l.adapter.start(wrapped()); // switched on in the panel before the app finished starting
      for (const c of CHANNELS) if (setUp(c.id) && !offList().includes(c.id)) await load(c.id).catch(() => {});
    },
    async typing(chat) { try { await route(chat).typing?.(chat); } catch { /* best effort */ } },
    async chatName(chat) { // 073: every subject a channel tells us is remembered for the one chat-name resolver
      try { const name = await route(chat).chatName?.(chat); rememberGroupNames([{ id: chat, name }]); return name || ''; } catch { return ''; }
    },
    async isMember(chat, phone, senderJid) { try { return !!(await route(chat).isMember?.(chat, phone, senderJid)); } catch { return false; } },
    async listChats() {
      const out = [];
      for (const { adapter: a } of live.values()) out.push(...await a.listChats().catch(() => []));
      rememberGroupNames(out);
      return out;
    },
    /** WhatsApp's first number at the top level (as the panel has always read it), its numbers, and every channel. */
    async status() {
      const wa = live.get('whatsapp');
      const st = wa ? await wa.adapter.status() : { status: setUp('whatsapp') ? 'off' : 'not_set_up', numbers: [] };
      return { ...st, channels: await channels() };
    },
    channels,
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
      const r = await list[turn++ % list.length].adapter.upkeep?.().catch(() => null);
      return r || { ok: false, reason: 'not_due' };
    },
    /** 069: graceful shutdown: every channel closes its connections. */
    async stop() { for (const l of live.values()) await l.adapter.stop().catch(() => {}); },
  };
}
