// @ts-check
// Credits of media services (2.58.1). A service whose results are media (GIFs, stickers, pictures) usually returns a
// credit with each result ("<title> · Powered by …"). Messages carry none of it: the credit lives in the panel (the
// service's card and Settings → Help → Credits), and links to media never reach the chat. Nothing here knows a service:
// the credit is the part all results of one search have in common (the title differs per result), from the standard
// fields attribution / credit / credits.
import { clip } from './config.js';
import { kvGet, kvSet } from './db.js';

const KEY = 'media-credits'; // { service: credit }
const CREDIT_MAX = 120;
const MIN_RESULTS = 2; // one result cannot tell its title from the credit
const MEDIA_LINK = /https?:\/\/[^\s)"'<>]+\.(?:mp4|gif|webp|png|jpe?g|webm|mov)(?:\?[^\s)"'<>]*)?/gi;
const TRAILING = /[\s·•|—–-]+$/; // separators left at the end of a line
const SEPARATORS_ONLY = /^[\s·•|:—–\-()[\]_*]+$/; // a line nothing is left of
const EDGE = /^[\s·•|:—–\-"“”'.,]+|[\s·•|:—–\-"“”'.,]+$/g; // separators left at the ends of a common part

/** The credit text one result carries ('' when none). */
export const creditOf = (r) => String(r?.attribution || r?.credit || r?.credits || '').trim();

const read = () => { try { return JSON.parse(kvGet(KEY) || '{}'); } catch { return {}; } };
/** { service: credit } of the media services that gave one. */
export const serviceCredits = () => read();

/** The words every credit ends with (else the words they all start with), without separators at its ends. */
function commonPart(credits) {
  const words = credits.map((c) => c.split(/\s+/));
  const shared = (pick) => {
    const out = [];
    for (let i = 0; ; i++) {
      const w = pick(words[0], i);
      if (w === undefined || !words.every((ws) => pick(ws, i) === w)) return out;
      out.push(w);
    }
  };
  const tail = shared((ws, i) => ws[ws.length - 1 - i]).reverse().join(' ').replace(EDGE, '');
  return tail || shared((ws, i) => ws[i]).join(' ').replace(EDGE, '');
}

/** Learn a service's credit from the results of one search (kept when it changes). */
export function learnCredit(service, results) {
  const credits = results.map(creditOf).filter(Boolean);
  if (credits.length < MIN_RESULTS) return;
  const credit = clip(commonPart(credits), CREDIT_MAX);
  const all = read();
  if (!credit || all[service] === credit) return;
  kvSet(KEY, JSON.stringify({ ...all, [service]: credit }));
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Text for the chat without media clutter: links to media files, the given links (media a tool returned this turn) and
 * the credits learned from media services. Lines left empty (or only separators) go too.
 */
export function withoutMediaClutter(text, links = []) {
  const credits = Object.values(read()).map((c) => new RegExp(escape(c), 'gi'));
  const clean = (line) => {
    let out = line.replace(MEDIA_LINK, '');
    for (const l of links) if (l) out = out.split(l).join('');
    for (const re of credits) out = out.replace(re, '');
    return out === line ? line : out.replace(TRAILING, ''); // what is left of a line something was taken from
  };
  const lines = String(text || '').split('\n').map(clean).filter((l) => l === '' || !SEPARATORS_ONLY.test(l));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
