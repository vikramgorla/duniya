// @ts-check
// Rich messages (096): what a stored message's media is, and the file when the panel shows it. A stored message keeps
// the media's kind and the channel's reference to it (`messages.media`), never the file itself. The panel asks for the
// file when a message scrolls into view: it comes from the chat app (WhatsApp, Telegram) a few at a time, within a
// deadline and a size cap that is smaller on small servers, and is not kept on the server (the browser caches it).
import { fail, within } from './config.js';
import { onMemoryPressure, serverSize } from './resources.js';
import { channelInfo, channelOf } from '../channels/index.js';

const TYPES = ['image', 'sticker', 'gif', 'video', 'audio', 'document'];
// What the panel shows inline, by type: only these content types are ever served (never HTML, SVG or scripts)
const SHOWN = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  sticker: ['image/webp', 'image/png'],
  gif: ['video/mp4', 'image/gif'],
  video: ['video/mp4'],
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac'],
};
const MB = 1024 * 1024;
const SHOW_MAX = { small: 4 * MB, medium: 12 * MB, large: 16 * MB }; // bytes of one file the panel shows, by server size
const REF_MAX = 4000; // characters of a channel's reference; a longer one is not kept (WhatsApp's slim reference is ~1 KB)
const FETCH_DEADLINE = 30 * 1000; // ms for the chat app to hand over one file
const AT_ONCE = 2; // files fetched at the same time; the others wait their turn
const WAITING_MAX = 30; // more than this many waiting: the panel is told to try again (a long scroll asks for many)
const GONE_TTL = 10 * 60 * 1000; // ms a file the chat app no longer has is not asked for again
const LATE_TTL = 60 * 1000; // ms after a file did not come in time
const GONE_KEEP = 500; // remembered failures, the oldest dropped first
// Files just shown stay in memory a little: a video player asks for it in parts, and a page is often opened twice
const KEPT_MAX = { small: 6 * MB, medium: 24 * MB, large: 48 * MB };

const baseType = (mimetype) => String(mimetype || '').split(';')[0].trim().toLowerCase();
const parse = (stored) => { try { return stored ? JSON.parse(stored) : null; } catch { return null; } };
/** Can the panel show this media inline: a type and content type it serves, within this server's size cap? */
const isShown = (m) => !!m && (SHOWN[m.type] || []).includes(m.mimetype) && Number(m.size || 0) <= SHOW_MAX[serverSize().size];

/**
 * What to store with a message for its media, as the channel describes it (inbound messages and the results of
 * `sendMedia`: `mediaInfo` and `mediaRef`), or '' for none.
 */
export function storedMedia(m) {
  const info = m?.mediaInfo; const ref = m?.mediaRef;
  if (!info || !TYPES.includes(info.type) || !ref) return '';
  const r = typeof ref === 'string' ? ref : JSON.stringify(ref);
  if (r.length > REF_MAX) return '';
  return JSON.stringify({ type: info.type, mimetype: baseType(info.mimetype), size: Number(info.size) || 0,
    ...(info.seconds ? { seconds: Number(info.seconds) } : {}), ...(info.fileName ? { fileName: String(info.fileName).slice(0, 200) } : {}), ref: r });
}

/** What the panel and Activity see of stored media (never the reference), or null for none. `shown`: it shows inline. */
export function mediaView(stored) {
  const m = parse(stored);
  if (!m || !TYPES.includes(m.type)) return null;
  return { type: m.type, mimetype: m.mimetype, size: m.size || 0, ...(m.seconds ? { seconds: m.seconds } : {}), ...(m.fileName ? { fileName: m.fileName } : {}), shown: isShown(m) };
}

/** An Activity entry's detail for a message with media: { media } (what it is), or nothing. */
export const mediaDetail = (stored) => { const v = mediaView(stored); return v ? { media: v } : {}; };

// ---------- the file, for the panel ----------
const gone = new Map(); // `${chat}:${id}` → { until, message }
const kept = new Map(); // `${chat}:${id}` → { body, mimetype }, the least recently shown first
const fetching = new Map(); // `${chat}:${id}` → the fetch under way
let keptBytes = 0;
let active = 0;
const waiting = [];
const appName = (chat) => channelInfo(channelOf(chat))?.label || 'The chat app';

function keep(key, file) {
  if (serverSize().pressure) return;
  kept.set(key, file); keptBytes += file.body.length;
  for (const [k, f] of kept) {
    if (keptBytes <= KEPT_MAX[serverSize().size]) break;
    kept.delete(k); keptBytes -= f.body.length;
  }
}
function keptFile(key) {
  const file = kept.get(key);
  if (file) { kept.delete(key); kept.set(key, file); } // now the most recently shown
  return file;
}
/** Memory is tight: what is kept goes (resources.js calls the listeners of memory pressure). */
onMemoryPressure((tight) => { if (tight) { kept.clear(); keptBytes = 0; } });
async function turn() {
  if (active < AT_ONCE) { active++; return; }
  if (waiting.length >= WAITING_MAX) throw fail('Many pictures are loading; this one shows in a moment', 503);
  await new Promise((resolve) => waiting.push(resolve)); // the finished fetch hands its place over (active stays)
}
function done() {
  const next = waiting.shift();
  if (next) next(); else active--;
}

/**
 * The file of a stored message's media: { body, mimetype }. Throws with a status and plain words: 404 not shown in the
 * panel, 410 the chat app no longer has it, 503 the server, the panel or the chat app is busy (try again), 504 it did
 * not come in time. Asked twice at once (a video player asks for parts), it is fetched once.
 * @param {{ downloadMedia: (chat: string, ref: string, declared?: number) => Promise<Buffer> }} channel
 * @param {{ id: number, chat: string, media?: string | null }} row a stored message
 */
export async function mediaFile(channel, row) {
  const m = parse(row.media);
  if (!isShown(m)) throw fail('This message has no picture, video or sound the panel shows', 404);
  const key = `${row.chat}:${row.id}`;
  const ready = keptFile(key) || fetching.get(key);
  if (ready) return ready;
  const failed = gone.get(key);
  if (failed && failed.until > Date.now()) throw fail(failed.message, 410);
  if (serverSize().pressure) throw fail('Memory is tight right now; pictures show again in a moment', 503);
  const job = fetchFile(channel, row.chat, m).then((file) => { keep(key, file); return file; }, (e) => { noteFailure(key, row.chat, e); throw e; });
  fetching.set(key, job);
  try { return await job; } finally { fetching.delete(key); }
}
async function fetchFile(channel, chat, m) {
  await turn();
  let body;
  try { body = await within(channel.downloadMedia(chat, m.ref, m.size), FETCH_DEADLINE, appName(chat)); } finally { done(); }
  if (body.length > SHOW_MAX[serverSize().size]) throw fail('Too large to show here', 404);
  return { body, mimetype: m.mimetype };
}
/** Why it did not come, remembered for a while so it is not asked for again and again; a busy app is not remembered. */
function noteFailure(key, chat, e) {
  if (e.offline || e.status === 409 || e.status === 503 || e.status === 404) return; // offline, busy or not shown: tried again next time
  const late = e.status === 504;
  const message = late ? `${appName(chat)} did not send it in time` : `${appName(chat)} no longer has it`;
  gone.set(key, { until: Date.now() + (late ? LATE_TTL : GONE_TTL), message });
  if (gone.size > GONE_KEEP) gone.delete(gone.keys().next().value);
  Object.assign(e, { status: late ? 504 : 410, message });
}
