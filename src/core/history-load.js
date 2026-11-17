// #91: load recent messages of a chat from the linked phone when it is switched on (or on request).
// Chats that are off store no message content, only the newest message key and time (chat-prefs.noteLatestKeys).
// When a chat goes on, WhatsApp is asked for the messages before the oldest one we know (Baileys fetchMessageHistory,
// at most 50 per request, so larger loads go page by page). The phone answers with a history batch (syncType
// ON_DEMAND) that the router hands to storeLoadedBatch(); the phone must be online, so a request can stay unanswered.
// 057 (#110, "no chores for the owner"): an unanswered or failed load retries by itself — on a backoff (2 min, 15 min,
// 1 h, 6 h, then daily for 3 days), sooner when the phone is seen online (connection opens, the owner writes from the
// phone) — only while the chat is on, and stops once messages arrive. Pending retries survive a restart (kv); they
// are due times the shared upkeep tick checks, not timers.
import { fail } from './config.js';
import { getSetting } from './store.js';
import { isChatEnabled, latestKey } from './chat-prefs.js';
import { oldestStoredMessage, insertEarlierMessages, kvGet, kvSet } from './db.js';
import { agentForChat } from './agents.js';
import { activity } from './events.js';
import { summarizeAfterLoad } from './memory.js';

const PAGE_SIZE = 50; // WhatsApp sends at most 50 messages per on-demand request
export const MAX_LOAD = 200;
const DEFAULT_LOAD = 50;
const COOLDOWN_MS = 30000; // "Load recent messages" at most every 30 s per chat
const waitMs = () => Number(process.env.HISTORY_WAIT_MS || 45000); // per page; the phone may be offline
const KEEP_MS = 10 * 60000; // late chunks of a finished load still count for this long

let channel = null;
export const setHistoryChannel = (ch) => { channel = ch; };

const loads = new Map(); // chat -> { state, requested, loaded, pages, at, doneAt, error, ids, timer, by }
const lastStart = new Map();

// ---------- automatic retries (057) ----------
// No timers of their own: each pending chat has a due time (kept in kv, so it survives a restart) and the shared
// upkeep tick (upkeep.js, run by the scheduler every 30 s) runs at most RETRIES_PER_TICK due ones.
const MIN = 60000;
const RETRY_BACKOFF_MS = [2 * MIN, 15 * MIN, 60 * MIN, 6 * 60 * MIN, 24 * 60 * MIN, 24 * 60 * MIN, 24 * 60 * MIN];
const ONLINE_GAP_MS = 60000; // "phone seen online" makes a chat due at most once a minute
const RETRIES_PER_TICK = 2;
const RETRY_KEY = 'historyRetries';
const retries = new Map(); // chat -> { attempt, nextAt, requested }
const saveRetries = () => kvSet(RETRY_KEY, JSON.stringify(Object.fromEntries(retries)));
function dropRetry(chat) { if (retries.delete(chat)) saveRetries(); }
/** After a load ended without messages: plan the next try (or give up after the last step). */
function planRetry(chat, l, attempt) {
  if (!isChatEnabled(chat) || attempt >= RETRY_BACKOFF_MS.length) { dropRetry(chat); return; }
  retries.set(chat, { attempt, nextAt: Date.now() + RETRY_BACKOFF_MS[attempt], requested: l.requested, lastTry: l.at });
  saveRetries();
}
async function runRetry(chat) {
  const r = retries.get(chat);
  if (!r) return false;
  if (!isChatEnabled(chat)) { dropRetry(chat); return false; }
  if (typeof channel?.fetchHistory !== 'function' || loads.get(chat)?.state === 'loading') return false;
  await loadChatHistory(chat, { count: r.requested, by: 'automatic retry', reason: 'retry', attempt: r.attempt + 1 }).catch(() => {});
  return true;
}
/** Shared upkeep tick: run the retries that are due (a few per tick). Returns how many ran. */
export async function historyRetryTick(now = Date.now()) {
  let n = 0;
  for (const [chat, r] of [...retries].sort((a, b) => a[1].nextAt - b[1].nextAt)) {
    if (r.nextAt > now || n >= RETRIES_PER_TICK) break;
    if (await runRetry(chat)) n++;
  }
  return n;
}
/**
 * The phone was seen online (a WhatsApp connection opened, or the owner wrote from the phone): pending loads become
 * due now (at most once a minute per chat); the next upkeep tick runs them.
 */
export function historyPhoneOnline(now = Date.now()) {
  let changed = false;
  for (const [, r] of retries) {
    if (r.nextAt <= now) continue;
    r.nextAt = Math.max(now, (r.lastTry || 0) + ONLINE_GAP_MS); changed = true;
  }
  if (changed) saveRetries();
}
/**
 * A message of a chat reached the server: a chat that is on and had no message to anchor a load on ('no_anchor') now
 * has one, so its recent messages load on the next upkeep tick.
 */
export function historyChatActive(chat) {
  const l = loads.get(chat);
  if (l?.state !== 'no_anchor' || !isChatEnabled(chat) || retries.has(chat)) return;
  retries.set(chat, { attempt: 0, nextAt: Date.now(), requested: l.requested });
  saveRetries();
}
/** Start: pick up retries planned before a restart (only for chats still on). */
export function resumeHistoryRetries() {
  let saved;
  try { saved = JSON.parse(kvGet(RETRY_KEY) || '{}'); } catch { saved = {}; }
  retries.clear();
  for (const [chat, r] of Object.entries(saved)) {
    if (!isChatEnabled(chat)) continue;
    const x = { attempt: Number(r.attempt) || 0, nextAt: Number(r.nextAt) || Date.now(), requested: Number(r.requested) || DEFAULT_LOAD };
    retries.set(chat, x);
    if (!loads.has(chat)) loads.set(chat, { state: 'no_response', requested: x.requested, loaded: 0, pages: 0, at: x.nextAt, doneAt: x.nextAt, ids: [], attempt: x.attempt });
  }
  saveRetries();
}

/** How many earlier messages to ask for when a chat is switched on (setting historyLoadCount; 0 = don't). */
export function historyLoadCount() {
  const v = getSetting('historyLoadCount', 50);
  return v === undefined || v === null || v === '' ? DEFAULT_LOAD : Math.max(0, Math.min(MAX_LOAD, Math.round(Number(v)) || 0));
}

/** Status shown on the Chats page and returned by the API (no message content). */
export function historyStatus(chat) {
  const l = loads.get(chat);
  if (!l) return null;
  const r = retries.get(chat);
  return { state: l.state, requested: l.requested, loaded: l.loaded, at: l.at, doneAt: l.doneAt || null, ...(l.error ? { error: l.error } : {}),
    ...(r && l.state !== 'loading' && l.state !== 'loaded' ? { retryAt: r.nextAt, automatic: true } : {}) };
}


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
    summary: state === 'loaded' ? `Loaded ${l.loaded} earlier message(s) from the phone` : state === 'no_response' ? 'The phone did not send earlier messages (it may be offline); retrying automatically' : `Loading earlier messages failed: ${error}; retrying automatically` });
  if (l.ids.length) summarizeAfterLoad(chat, agent, l.ids).catch(() => {});
  if (state === 'loaded') dropRetry(chat);
  else if (state === 'no_response' || state === 'failed') planRetry(chat, l, l.attempt || 0);
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
/** @param {string} chat  @param {{ count?: number, by?: string, reason?: string, attempt?: number }} [o] */
export async function loadChatHistory(chat, { count, by = 'panel', reason = 'button', attempt = 0 } = {}) {
  if (!isChatEnabled(chat)) throw fail('Switch the chat on first: chats that are off store nothing', 409);
  if (typeof channel?.fetchHistory !== 'function') throw fail('Loading messages from the phone is not available', 501);
  const cur = loads.get(chat);
  if (cur?.state === 'loading') return historyStatus(chat);
  const since = Date.now() - (lastStart.get(chat) || 0);
  if (reason === 'button' && since < COOLDOWN_MS) throw fail(`Please wait ${Math.ceil((COOLDOWN_MS - since) / 1000)} s before asking the phone again`, 429);
  const n = Math.max(1, Math.min(MAX_LOAD, Math.round(Number(count)) || historyLoadCount() || DEFAULT_LOAD));
  const anchor = anchorOf(chat);
  lastStart.set(chat, Date.now());
  if (reason !== 'retry') dropRetry(chat);
  const l = { state: 'loading', requested: n, loaded: 0, pages: 0, at: Date.now(), ids: [], by, attempt: reason === 'retry' ? attempt : 0 };
  loads.set(chat, l);
  if (!anchor) {
    l.state = 'no_anchor'; l.doneAt = Date.now();
    dropRetry(chat);
    return historyStatus(chat);
  }
  activity('memory.history', { agent: agentForChat(chat)?.id || '', chat, summary: `Asked the phone for up to ${n} earlier message(s) (${reason === 'switch_on' ? 'chat switched on' : reason === 'retry' ? `automatic retry ${attempt}` : 'Load recent messages'}, ${by})` });
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
  if (stored.length) dropRetry(chat);
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
export function resetHistoryLoads() {
  for (const l of loads.values()) clearTimeout(l.timer);
  loads.clear(); lastStart.clear(); retries.clear(); kvSet(RETRY_KEY, '{}');
}
