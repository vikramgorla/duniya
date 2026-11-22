// @ts-check
// Credits of media services (2.58.3). A media result (a GIF, a sticker, a picture) says what credit it needs in the
// schema.org property `creditText` (the IPTC "Credit Line"), without its title or link. Messages carry none of it: a
// credit every result of a service shares (a platform credit, "Powered by …") is shown in the panel (the service's card
// and Settings → Help → Credits); a result that needs its own credit (a work's author and license) is never posted on
// its own, since that credit would have to go with it. Nothing here knows a service.
import { kvGet, kvSet } from './db.js';

const KEY = 'media-credits'; // { service: credit }
const CREDIT_MAX = 120;
const MEDIA_LINK = /https?:\/\/[^\s)"'<>]+\.(?:mp4|gif|webp|png|jpe?g|webm|mov)(?:\?[^\s)"'<>]*)?/gi;
const TRAILING = /[\s·•|—–-]+$/; // separators left at the end of a line
const SEPARATORS_ONLY = /^[\s·•|:—–\-()[\]_*]+$/; // a line nothing is left of

/** The schema.org creditText of a result ('' when it needs none). */
export const creditOf = (r) => String(r?.creditText || '').trim().slice(0, CREDIT_MAX);

const read = () => { try { return JSON.parse(kvGet(KEY) || '{}'); } catch { return {}; } };
/** { service: credit } of the media services whose results share a credit. */
export const serviceCredits = () => read();

/**
 * The results of one search that may be posted without a credit in the message: those that need none, and those whose
 * credit all results share (kept for the panel). A result with its own credit stays out.
 */
export function postableResults(service, results) {
  const credits = [...new Set(results.map(creditOf).filter(Boolean))];
  const shared = credits.length === 1 ? credits[0] : '';
  if (shared && read()[service] !== shared) kvSet(KEY, JSON.stringify({ ...read(), [service]: shared }));
  return results.filter((r) => !creditOf(r) || creditOf(r) === shared);
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
