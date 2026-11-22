// @ts-check
// Sending pace (080): Duniya acts on WhatsApp at a person's pace. One service, one setting (Settings → Sending pace):
//   - read receipts: in chats that are on, incoming messages are marked read (blue ticks) after a random delay within
//     the read range. A small bounded in-memory queue holds them; it drains on incoming messages and on the
//     scheduler's existing 30-second upkeep tick (no timer per message). An answered message waits for its own read
//     receipt, then the agent types; the model works meanwhile, so replies stay timely. Chats that are off are never
//     queued; a chat switched off later is dropped from the queue. Channels without read receipts (Telegram) skip it.
//   - typing: before a reply, "typing…" shows for a time that fits the reply's length (characters per second with
//     jitter), at most 8 seconds.
//   - new chats: a daily cap of new 1:1 chats per number (intros, and list messages to people who never wrote), lower
//     for a number linked in the last week (warm-up), and sending hours in the owner's time zone. listEstimate() turns
//     the gaps, the longer pause every N messages, the cap and the hours into "how long does a list of N take".
//   - list messages (082, the Sending module): the gap after each one, the longer pause, typing by length after the
//     chat's unread messages are read, and a daily cap: people who never wrote count as new chats (with warm-up and
//     twice the gap), people who wrote may get three times as many.
// Random values are bell-shaped (mean of three uniform draws), never fixed intervals.
// PACE_TIME_SCALE scales every wait (tests run with 0 or a small fraction; 1 in production).
import { bad, plural } from './config.js';
import { getSetting, updateSettings } from './store.js';
import { kvGet, kvSet } from './db.js';
import { activity } from './events.js';
import { capsOf, isGroup } from '../channels/index.js';
import { isChatEnabled } from './chat-prefs.js';
import { ownerDay, ownerNow, ownerTz } from './owner-clock.js';

const SCALE = Math.max(0, Number(process.env.PACE_TIME_SCALE ?? 1));
const MAX_TYPING_MS = 8000;
const MAX_QUEUE = 500; // read receipts waiting; the oldest is dropped beyond this
const CHATS_PER_DRAIN = 20;
const WARMUP_DAYS = 7;

/** Gaps and read delays in seconds, typing in characters per second (jitter in %), the pause in minutes. */
const PRESETS = {
  careful: { gapMin: 90, gapMax: 300, cps: 4, jitter: 30, readMin: 5, readMax: 45, dailyNew: 20, hoursFrom: '09:00', hoursTo: '20:00', pauseEvery: 10, pauseMinutes: 15 },
  normal: { gapMin: 45, gapMax: 180, cps: 6, jitter: 25, readMin: 2, readMax: 20, dailyNew: 40, hoursFrom: '09:00', hoursTo: '20:00', pauseEvery: 15, pauseMinutes: 10 },
  faster: { gapMin: 20, gapMax: 90, cps: 9, jitter: 20, readMin: 1, readMax: 8, dailyNew: 80, hoursFrom: '09:00', hoursTo: '20:00', pauseEvery: 25, pauseMinutes: 5 },
};
/** Allowed values: [min, max, label]. */
const LIMITS = { gapMin: [5, 3600, 'Shortest gap'], gapMax: [5, 3600, 'Longest gap'], cps: [2, 20, 'Typing speed'], jitter: [0, 60, 'Typing jitter'],
  readMin: [0, 600, 'Shortest read delay'], readMax: [0, 600, 'Longest read delay'], dailyNew: [1, 500, 'New chats a day'],
  pauseEvery: [0, 200, 'Longer pause every'], pauseMinutes: [1, 120, 'Longer pause'] };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The pace in force: { preset, readReceipts, ...ranges }. */
export function paceSettings() {
  const s = getSetting('sendingPace', null) || {};
  const preset = s.preset === 'custom' || PRESETS[s.preset] ? s.preset : 'normal';
  const ranges = preset === 'custom' ? { ...PRESETS.normal, ...(s.custom || {}) } : PRESETS[preset];
  return { preset, readReceipts: s.readReceipts !== false, ...ranges };
}

/** Custom ranges, checked: each within its limits, the shortest not above the longest, hours as two different times. */
function checkedCustom(wanted) {
  const custom = Object.fromEntries(Object.keys(PRESETS.normal).map((k) => [k, wanted[k]]));
  for (const [k, [lo, hi, label]] of /** @type {[string, [number, number, string]][]} */ (Object.entries(LIMITS))) {
    const v = Number(custom[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw bad(`${label}: ${lo}–${hi}`, k);
    custom[k] = k === 'cps' ? Math.round(v * 10) / 10 : Math.round(v);
  }
  if (custom.gapMin > custom.gapMax) throw bad('The shortest gap is longer than the longest', 'gapMin');
  if (custom.readMin > custom.readMax) throw bad('The shortest read delay is longer than the longest', 'readMin');
  for (const k of ['hoursFrom', 'hoursTo']) if (!HHMM.test(String(custom[k]))) throw bad('Use a time like 09:00', k);
  if (custom.hoursFrom === custom.hoursTo) throw bad('Sending hours need a start and an end', 'hoursTo');
  return custom;
}
/** Change the pace: { preset?, readReceipts?, custom? } (custom ranges switch the preset to custom). Validated. */
export function setPaceSettings(body = {}, by = '') {
  const cur = getSetting('sendingPace', null) || {};
  const preset = body.preset ?? (body.custom ? 'custom' : cur.preset || 'normal');
  if (preset !== 'custom' && !PRESETS[preset]) throw bad('Choose Careful, Normal, Faster or Custom', 'preset');
  const fresh = body.custom || (preset === 'custom' && !cur.custom);
  const custom = fresh ? checkedCustom({ ...paceSettings(), ...(body.custom || {}) }) : cur.custom || null; // new ranges start from the pace in force
  const next = { preset, readReceipts: body.readReceipts === undefined ? cur.readReceipts !== false : !!body.readReceipts, ...(custom ? { custom } : {}) };
  updateSettings({ sendingPace: next });
  const p = paceSettings();
  activity('config', { summary: `Sending pace: ${p.preset}, read receipts ${p.readReceipts ? 'on' : 'off'}${by ? ` (${by})` : ''}` });
  return paceStatus();
}

/** A bell-shaped random value between lo and hi (mean of three uniform draws). */
const between = (lo, hi) => lo + ((Math.random() + Math.random() + Math.random()) / 3) * (hi - lo);
const sleep = (ms) => (ms * SCALE >= 1 ? new Promise((r) => setTimeout(r, ms * SCALE)) : Promise.resolve());

// ---------- read receipts ----------
/** @type {Array<{ chat: string, ref: { msgId: string, fromMe: boolean, participant?: string }, due: number, done?: Promise<void> }>} */
const reads = [];

/** A message arrived in a chat that is on: its read receipt is due after the read delay (WhatsApp only, setting on). */
export function queueRead(msg, now = Date.now()) {
  const p = paceSettings();
  if (!p.readReceipts || !msg?.msgId || msg.fromMe || !capsOf(msg.chat)?.readReceipts) return;
  if (reads.length >= MAX_QUEUE) reads.shift();
  reads.push({ chat: msg.chat, ref: { msgId: msg.msgId, fromMe: false, ...(isGroup(msg.chat) && msg.senderJid ? { participant: msg.senderJid } : {}) },
    due: now + between(p.readMin, p.readMax) * 1000 * SCALE });
}

/** Mark a chat's queued messages read (one call per chat: like opening the chat). */
async function markChat(channel, chat) {
  const refs = [];
  for (let i = reads.length - 1; i >= 0; i--) if (reads[i].chat === chat) refs.unshift(reads.splice(i, 1)[0].ref);
  if (refs.length && isChatEnabled(chat)) await channel.markRead?.(chat, refs).catch(() => {}); // blue ticks are a courtesy: nothing depends on them
}

/** Send the read receipts that are due, a few chats at a time (incoming messages and the upkeep tick call this). */
export async function drainReads(channel, now = Date.now()) {
  const chats = [...new Set(reads.filter((r) => r.due <= now && !r.done).map((r) => r.chat))].slice(0, CHATS_PER_DRAIN);
  for (const chat of chats) await markChat(channel, chat);
  return chats.length;
}

/** The message's read receipt, when its delay is over (resolves at once when it is not queued). Shared by every caller. */
export function readWhenDue(channel, msg) {
  const r = reads.find((x) => x.chat === msg.chat && x.ref.msgId === msg.msgId);
  if (!r) return Promise.resolve();
  r.done ||= sleep((r.due - Date.now()) / (SCALE || 1)).then(() => markChat(channel, msg.chat));
  return r.done;
}

// ---------- typing ----------
/** How long "typing…" shows before a reply of this length (ms, at most 8 s). */
function typingMs(text) {
  const p = paceSettings();
  const j = p.jitter / 100;
  return Math.min(MAX_TYPING_MS, (String(text || '').length / p.cps) * 1000 * between(1 - j, 1 + j));
}
/** Before a reply: the message is read, then "typing…" shows long enough for this reply (counted from `since`). */
export async function paceReply(channel, msg, text, since = 0) {
  await readWhenDue(channel, msg);
  const start = since || Date.now();
  if (!since) await channel.typing?.(msg.chat);
  await sleep(typingMs(text) - (Date.now() - start) / (SCALE || 1));
}

// ---------- new 1:1 chats: daily cap, warm-up, sending hours (intros now, list sending in step 4) ----------
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** Is it within the sending hours (owner's time zone)? Windows may cross midnight. */
function inHours(p, now) {
  const t = minutes(ownerNow(now).hhmm); const a = minutes(p.hoursFrom); const b = minutes(p.hoursTo);
  return a < b ? t >= a && t < b : t >= a || t < b;
}
/** A number linked on this server in the last week sends fewer new chats (warm-up). */
export function noteLinked(number, now = Date.now()) { kvSet(`paceLinkedAt:${number}`, now); }
function capFor(number, p, now) {
  const at = Number(kvGet(`paceLinkedAt:${number}`) || 0);
  const days = at ? Math.floor((now - at) / 86400000) : WARMUP_DAYS;
  return days >= WARMUP_DAYS ? { cap: p.dailyNew, warmup: false } : { cap: Math.max(3, Math.round((p.dailyNew * (days + 1)) / (WARMUP_DAYS + 1))), warmup: true };
}
const usedToday = (number, now) => { const [d, n] = String(kvGet(`paceNew:${number}`) || '').split('|'); return d === ownerDay(now) ? Number(n) || 0 : 0; };

/** Today's allowance of new 1:1 chats for a number: { cap, used, left, warmup }. */
function newChats(number = 'main', now = Date.now()) {
  const { cap, warmup } = capFor(number, paceSettings(), now);
  const used = usedToday(number, now);
  return { cap, used, left: Math.max(0, cap - used), warmup };
}
/** Count one new 1:1 chat; refused (429, with the reason) when today's cap is reached. */
export function takeNewChat(number = 'main', now = Date.now()) {
  const n = newChats(number, now);
  if (!n.left) throw bad(`Today's limit of ${plural(n.cap, 'new chat')} is reached${n.warmup ? ' (a newly linked number starts lower and grows over a week)' : ''}. It resets tomorrow; change it under Settings → Sending pace.`, null, 429);
  kvSet(`paceNew:${number}`, `${ownerDay(now)}|${n.used + 1}`);
  return { ...n, used: n.used + 1, left: n.left - 1 };
}

// ---------- list messages (082): the Sending module sends one at a time on the scheduler tick ----------
const KNOWN_FACTOR = 3; // people who wrote first may get three times the new-chats cap a day
/** Is it within the sending hours now (owner's time zone)? */
export const sendingHoursNow = (now = Date.now()) => inHours(paceSettings(), now);
/** The wait after a list message (ms): a random gap within the owner's range, twice as long for someone who never
 * wrote, plus the longer pause after every `pauseEvery` messages (`count` = list messages this number sent so far). */
export function listGapMs({ known = false, count = 0 } = {}) {
  const p = paceSettings();
  const pause = p.pauseEvery && count > 0 && count % p.pauseEvery === 0 ? p.pauseMinutes * 60000 : 0;
  return Math.round(between(p.gapMin, p.gapMax) * 1000 * (known ? 1 : 2) + pause);
}
/** Count one list message on a number: someone who never wrote is a new chat (the cap with warm-up); someone who
 * wrote counts against three times that. Refused (429, with the reason) at the cap. */
export function takeListSend(number = 'main', known = false, now = Date.now()) {
  if (!known) return takeNewChat(number, now);
  const { cap } = capFor(number, paceSettings(), now);
  const [d, n] = String(kvGet(`paceKnown:${number}`) || '').split('|');
  const today = ownerDay(now);
  const used = d === today ? Number(n) || 0 : 0;
  if (used >= cap * KNOWN_FACTOR) throw bad(`Today's limit of ${plural(cap * KNOWN_FACTOR, 'list message')} to people who wrote before is reached. It resets tomorrow.`, null, 429);
  kvSet(`paceKnown:${number}`, `${today}|${used + 1}`);
  return { cap: cap * KNOWN_FACTOR, used: used + 1 };
}
/** Before a list message: the chat's unread messages are read first, then "typing…" for the message's length. */
export async function typeBefore(channel, chat, text) {
  await markChat(channel, chat);
  try { await channel.typing?.(chat); } catch { /* best effort */ }
  await sleep(typingMs(text));
}

/** About how long sending to `count` people takes at this pace: { minutes, days } (gaps, longer pauses, cap, hours). */
export function listEstimate(count, p = paceSettings()) {
  const n = Math.max(0, Math.round(count));
  const gap = (p.gapMin + p.gapMax) / 2 / 60 + 0.1;
  const pauses = p.pauseEvery ? Math.floor(Math.max(0, n - 1) / p.pauseEvery) : 0;
  const perDay = Math.min(p.dailyNew, Math.max(1, Math.floor(((minutes(p.hoursTo) - minutes(p.hoursFrom) + 1440) % 1440) / gap)));
  return { minutes: Math.round(Math.min(n, perDay) * gap + pauses * p.pauseMinutes), days: Math.max(1, Math.ceil(n / perDay)), perDay };
}

/** What Settings → Sending pace shows: the pace, the presets, today's new chats on the first number, the hours now. */
export function paceStatus(now = Date.now()) {
  const p = paceSettings();
  return { ...p, presets: PRESETS, limits: LIMITS, today: newChats('main', now), sendingHoursNow: inHours(p, now), timezone: ownerTz(), example: { count: 100, ...listEstimate(100, p) } };
}

