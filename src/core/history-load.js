// #91: load recent messages of a chat from the linked phone when it is switched on (or on request).
// Chats that are off store no message content, only the newest message key and time (chat-prefs.noteLatestKeys).
// When a chat goes on, WhatsApp is asked for the messages before the oldest one we know (Baileys fetchMessageHistory,
// at most 50 per request, so larger loads go page by page). The phone answers with a history batch (syncType
// ON_DEMAND) that the router hands to storeLoadedBatch(); the phone must be online, so a request can stay unanswered.
import { getSettings } from './store.js';
import { isChatEnabled, latestKey } from './chat-prefs.js';
import { oldestStoredMessage, insertEarlierMessages } from './db.js';
import { agentForChat } from './agents.js';
import { activity } from './events.js';
import { summarizeAfterLoad } from './memory.js';

export const PAGE_SIZE = 50; // WhatsApp sends at most 50 messages per on-demand request
export const MAX_LOAD = 200;
export const DEFAULT_LOAD = 50;
const COOLDOWN_MS = 30000; // "Load recent messages" at most every 30 s per chat
const waitMs = () => Number(process.env.HISTORY_WAIT_MS || 45000); // per page; the phone may be offline
const KEEP_MS = 10 * 60000; // late chunks of a finished load still count for this long

let channel = null;
export const setHistoryChannel = (ch) => { channel = ch; };

const loads = new Map(); // chat -> { state, requested, loaded, pages, at, doneAt, error, ids, timer, by }
const lastStart = new Map();

/** How many earlier messages to ask for when a chat is switched on (setting historyLoadCount; 0 = don't). */
export function historyLoadCount() {
  const v = getSettings().historyLoadCount;
  return v === undefined || v === null || v === '' ? DEFAULT_LOAD : Math.max(0, Math.min(MAX_LOAD, Math.round(Number(v)) || 0));
}

/** Status shown on the Chats page and returned by the API (no message content). */
export function historyStatus(chat) {
  const l = loads.get(chat);
  if (!l) return null;
  return { state: l.state, requested: l.requested, loaded: l.loaded, at: l.at, doneAt: l.doneAt || null, ...(l.error ? { error: l.error } : {}) };
}

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The key WhatsApp needs: the oldest stored message of the chat, else the newest key seen while it was off. */
function anchorOf(chat) {
  const m = oldestStoredMessage(chat);
  if (m) return { msgId: m.msg_id, fromMe: !!m.from_agent, participant: m.sender_jid || '', ts: m.ts };
  return latestKey(chat);
}

function finish(chat, l, state, error = '') {
  clearTimeout(l.timer);
  l.state = state; l.doneAt = Date.now(); if (error) l.error = error;
  const agent = agentForChat(chat);
  activity('memory.history', { agent: agent?.id || '', chat,
    summary: state === 'loaded' ? `Loaded ${l.loaded} earlier message(s) from the phone` : state === 'no_response' ? 'The phone did not send earlier messages (it may be offline)' : `Loading earlier messages failed: ${error}` });
  if (l.ids.length) summarizeAfterLoad(chat, agent, l.ids).catch(() => {});
}

async function requestPage(chat, l, anchor) {
  const count = Math.min(PAGE_SIZE, l.requested - l.loaded);
  l.pages++; l.pageCount = count; l.pageAnchor = anchor.msgId;
  clearTimeout(l.timer);
  l.timer = setTimeout(() => { if (l.state === 'loading') finish(chat, l, l.loaded ? 'loaded' : 'no_response'); }, waitMs());
  l.timer.unref?.();
  try {
    await channel.fetchHistory(chat, count, anchor);
  } catch (e) {
    if (l.loaded) finish(chat, l, 'loaded'); else finish(chat, l, 'failed', String(e.message || e).slice(0, 200));
  }
}

/**
 * Ask the phone for up to `count` messages before the oldest one known. reason: 'switch_on' | 'button'.
 * Returns the status. Throws 409 when the chat is off, 429 when asked again within 30 s, 501 without a channel.
 */
export async function loadChatHistory(chat, { count, by = 'panel', reason = 'button' } = {}) {
  if (!isChatEnabled(chat)) throw fail('Switch the chat on first: chats that are off store nothing', 409);
  if (typeof channel?.fetchHistory !== 'function') throw fail('Loading messages from the phone is not available', 501);
  const cur = loads.get(chat);
  if (cur?.state === 'loading') return historyStatus(chat);
  const since = Date.now() - (lastStart.get(chat) || 0);
  if (reason === 'button' && since < COOLDOWN_MS) throw fail(`Please wait ${Math.ceil((COOLDOWN_MS - since) / 1000)} s before asking the phone again`, 429);
  const n = Math.max(1, Math.min(MAX_LOAD, Math.round(Number(count)) || historyLoadCount() || DEFAULT_LOAD));
  const anchor = anchorOf(chat);
  lastStart.set(chat, Date.now());
  const l = { state: 'loading', requested: n, loaded: 0, pages: 0, at: Date.now(), ids: [], by };
  loads.set(chat, l);
  if (!anchor) {
    l.state = 'no_anchor'; l.doneAt = Date.now();
    return historyStatus(chat);
  }
  activity('memory.history', { agent: agentForChat(chat)?.id || '', chat, summary: `Asked the phone for up to ${n} earlier message(s) (${reason === 'switch_on' ? 'chat switched on' : 'Load recent messages'}, ${by})` });
  await requestPage(chat, l, anchor);
  return historyStatus(chat);
}

/**
 * A history batch the phone sent on demand, for one chat (rows in logMessage form, any order). Stored only when the
 * chat is on; they are older than what is stored, so they go before it. Returns how many were new.
 */
export function storeLoadedBatch(chat, rows) {
  if (!isChatEnabled(chat)) return 0;
  const l = loads.get(chat);
  const ours = l && (l.state === 'loading' || Date.now() - (l.doneAt || 0) < KEEP_MS);
  const stored = rows.length ? insertEarlierMessages(chat, rows) : [];
  if (!ours) {
    if (stored.length) {
      activity('memory.history', { agent: agentForChat(chat)?.id || '', chat, summary: `Stored ${stored.length} earlier message(s) the phone sent` });
      summarizeAfterLoad(chat, agentForChat(chat), stored.map((r) => r.id)).catch(() => {});
    }
    return stored.length;
  }
  l.loaded += stored.length; l.ids.push(...stored.map((r) => r.id));
  if (l.state !== 'loading') { // a late chunk of a finished load
    if (stored.length) { l.state = 'loaded'; delete l.error; summarizeAfterLoad(chat, agentForChat(chat), stored.map((r) => r.id)).catch(() => {}); }
    return stored.length;
  }
  const oldest = [...rows].sort((a, b) => (a.ts || 0) - (b.ts || 0))[0];
  const more = rows.length >= l.pageCount && l.loaded < l.requested && oldest?.msgId && oldest.msgId !== l.pageAnchor;
  if (more) {
    requestPage(chat, l, { msgId: oldest.msgId, fromMe: !!oldest.fromAgent, participant: oldest.senderJid || '', ts: oldest.ts });
  } else finish(chat, l, 'loaded');
  return stored.length;
}

/** Tests: forget statuses and cooldowns. */
export function resetHistoryLoads() { for (const l of loads.values()) clearTimeout(l.timer); loads.clear(); lastStart.clear(); }
