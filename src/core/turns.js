// @ts-check
// One turn at a time per agent and chat, and no double answers (087).
//
// Turns: while an agent works on a message in a chat, later messages for the same agent in the same chat wait here
// (in memory, at most MAX_WAITING; the oldest go first when more arrive). When the turn ends the router handles what
// waited in ONE follow-up turn that sees the reply just sent — so a burst of messages ("No gif?", "Well said raju")
// gets one answer, not one per message. No timers: the end of a turn drains its queue.
//
// Duplicates: what an agent sent in a chat in the last few minutes (text fingerprints, GIFs, stickers, reactions) is
// kept in memory, and a send that repeats one made after the answered message arrived is dropped before it reaches the
// chat (silence reason "already answered"). Fingerprints only; nothing is stored on disk.
const MAX_WAITING = 8;
/** @type {Map<string, { waiting: any[] }>} */
const busy = new Map();

/** Start a turn for agent + chat. false: one is running; `item` waits for it. */
export function claimTurn(key, item) {
  const b = busy.get(key);
  if (!b) { busy.set(key, { waiting: [] }); return true; }
  b.waiting.push(item);
  if (b.waiting.length > MAX_WAITING) b.waiting.shift();
  return false;
}
/** The turn ended: what waited for it (the key is free again). */
export function releaseTurn(key) {
  const b = busy.get(key);
  busy.delete(key);
  return b?.waiting || [];
}

// ---------- duplicate guard ----------
// A send repeats an earlier one when the agent already sent the same thing in this chat after the message it is
// answering arrived (`since`): two turns raced, or a follow-up turn repeats the answer above it. Asking the same
// question again later gets an answer again.
const WINDOW_MS = 3 * 60000;
const KEEP = 20;
/** @type {Map<string, Array<{ agent: string, ts: number, kind: string, key: string, words?: Set<string> }>>} */
const sent = new Map();

const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (t) => new Set(norm(t).split(' ').filter(Boolean));
/** Jaccard similarity of the words of two texts (0…1). */
export function similarity(a, b) {
  const x = a instanceof Set ? a : wordsOf(a); const y = b instanceof Set ? b : wordsOf(b);
  if (!x.size && !y.size) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

function recent(chat, now) {
  const list = (sent.get(chat) || []).filter((s) => now - s.ts < WINDOW_MS);
  if (list.length) sent.set(chat, list); else sent.delete(chat);
  return list;
}

/**
 * Would this send repeat what the agent sent here since `since` (when the message it answers arrived)? `what`:
 * { kind: 'text', text } | { kind: 'gif' | 'sticker' | 'image' | …, url } | { kind: 'react', target, emoji }.
 * Text: the same or nearly the same words; GIFs and stickers: any second one; other media: the same file; reactions:
 * the same emoji on the same message.
 */
export function isDuplicate(chat, agent, what, since, now = Date.now()) {
  for (const s of recent(chat, now)) {
    if (s.agent !== agent || s.ts <= since || s.kind !== what.kind) continue;
    if (what.kind === 'text') {
      const n = norm(what.text);
      if (n && (s.key === n || similarity(wordsOf(n), s.words || new Set()) >= 0.85)) return true;
    } else if (what.kind === 'react') {
      if (s.key === `${what.target}|${what.emoji}`) return true;
    } else if (['gif', 'sticker'].includes(what.kind) || s.key === `${what.kind}|${what.url || ''}`) return true;
  }
  return false;
}
/** Remember a send (after it went out). */
export function noteSent(chat, agent, what, now = Date.now()) {
  const list = recent(chat, now);
  const key = what.kind === 'text' ? norm(what.text) : what.kind === 'react' ? `${what.target}|${what.emoji}` : `${what.kind}|${what.url || ''}`;
  list.push({ agent, ts: now, kind: what.kind, key, ...(what.kind === 'text' ? { words: wordsOf(what.text) } : {}) });
  sent.set(chat, list.slice(-KEEP));
}
