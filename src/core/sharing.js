// @ts-check
// Share results on its own (094): a tool service with a read-only tool that returns media (GIFs, stickers, pictures)
// can be used by an agent on its own — off | sometimes | often, with style words (tool-behaviour.js). Nothing here
// knows a service by name: the tool is found by what it declares (readOnlyHint, media in its output schema or in its
// results) and a free-text input.
//
// - The model decides, every turn: it ends its answer with [share: two to four mood words] or [share: none] — a choice
//   it must make, not an optional extra it skips. It reads the whole conversation, so any culture, language or kind of
//   good news counts; "sometimes" asks for one where it clearly adds warmth, "often" whenever the mood is light.
// - Code keeps what a prompt cannot be trusted with: serious topics never get one (a cheap veto), at most one per
//   answer and none shortly after another, the limits, mood words only (names stripped). Code searches with the mood
//   + style words, picks a result it did not post in that chat lately and sends it with the answer as its caption (one
//   message; a long answer or a sticker: right after it). Credits and media links never go in a message: a result's
//   schema.org creditText is shown in the panel, and a result that needs its own credit is not posted (credits.js).
// - A model that forgets the tag falls back to cheap rules (celebrations, thanks, requests; "often" also jokes,
//   welcomes, praise), so a weak model still behaves.
// - One per moment: at most one per answer, none when one went out in that chat in the last few minutes.
import { randomInt } from 'node:crypto';
import { clip } from './config.js';
import { kvGet, kvSet, logMessage, namesInChat } from './db.js';
import { activity } from './events.js';
import { noteSent, sentWithin } from './turns.js';
import { chatChannel } from './chat-tools.js';
import { limitStop } from './tool-behaviour.js';
import { countStat } from './stats.js';
import { creditOf, postableResults } from './credits.js';

const GAP_MS = 3 * 60000; // none when one went out in the chat this recently (the duplicate guard's window)
const KEEP_IDS = 30; // results not picked again in a chat
const RANK = { off: 0, sometimes: 1, often: 2 };
const SHARED = ['gif', 'sticker', 'image', 'share'];

// ---------- which tools return media ----------
const MEDIA_URL = /https:\/\/[^\s)"'<>]+\.(mp4|gif|webp|png|jpe?g)(\?[^\s)"'<>]*)?/gi;
const kindOfUrl = (u) => (/\.(mp4|gif)(\?|$)/i.test(u) ? 'gif' : /\.webp(\?|$)/i.test(u) ? 'sticker' : 'image');
const MEDIA_PROP = /(gif|mp4|webp|image|img|sticker|thumbnail|preview)/i;
/** Media property names in an output schema (results of any depth): the media kind they suggest, or ''. */
function schemaKind(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 4) return '';
  const declared = formatKind(schema.properties?.encodingFormat); // schema.org: the format a result declares
  if (declared) return declared;
  const props = Object.keys(schema.properties || {});
  const media = props.filter((p) => MEDIA_PROP.test(p));
  if (media.length) return media.some((p) => /gif|mp4/i.test(p)) ? 'gif' : media.some((p) => /sticker/i.test(p)) ? 'sticker' : 'image';
  for (const v of [...Object.values(schema.properties || {}), schema.items].filter(Boolean)) { const k = schemaKind(v, depth + 1); if (k) return k; }
  return '';
}
// schema.org media (ImageObject, MediaObject): `encodingFormat` says what a result is, `contentUrl` where it is,
// `encoding` lists the same item in other formats (an MP4 of a GIF is what chat apps send)
const kindOfFormat = (f) => (/gif|^video\//i.test(f) ? 'gif' : /webp/i.test(f) ? 'sticker' : /^image\//i.test(f) ? 'image' : '');
/** The media kind an output schema's encodingFormat declares (const, or the first of an enum), or ''. */
function formatKind(prop) { const v = prop?.const ?? prop?.enum?.[0]; return v ? kindOfFormat(String(v)) : ''; }
const learnedKey = (key, tool) => `media:${key}:${tool}`;
/** Remember that a read-only tool returned media (from a normal call's result), so it can be shared on its own. */
export function noteToolOutput(key, tool, text) {
  const urls = String(text || '').match(MEDIA_URL);
  const kind = /"type":"image"/.test(String(text || '')) ? 'image' : urls ? kindOfUrl(urls[0]) : '';
  if (kind && kvGet(learnedKey(key, tool)) !== kind) kvSet(learnedKey(key, tool), kind);
}
const QUERY_PROP = /^(q|query|search|keywords?|text|terms?|prompt|topic|mood)$/i;
/**
 * A service's tool that can be shared on its own: read-only (readOnlyHint), returns media (by its output schema or
 * a result seen before) and takes free text. { tool, kind, query, limit } (argument names), or null.
 */
export function mediaTool(key, tools) {
  for (const t of tools) {
    if (t.annotations?.readOnlyHint !== true) continue;
    const props = t.inputSchema?.properties || {};
    const query = Object.keys(props).find((p) => QUERY_PROP.test(p) && props[p]?.type === 'string');
    const kind = schemaKind(t.outputSchema) || kvGet(learnedKey(key, t.name)) || '';
    if (query && kind) return { tool: t.name, kind, query, limit: props.limit ? 'limit' : '' };
  }
  return null;
}

// ---------- moments (cheap rules, no model call) ----------
const SERIOUS = /\b(sorry|sad|sick|ill|hospital|doctor|accident|emergency|urgent|police|died|death|passed away|funeral|condolences?|rip|injur\w*|hurt|unsafe|danger\w*|worr(y|ied)|upset|angry|complain\w*|late|delay\w*|stuck|broke down|breakdown|refund|owes?|dispute|unfair|money|payment|problem|cancel\w*)\b|[😢😭😡😞😟💔🚑]/iu;
/** @type {Array<[string, string, RegExp]>} */
const MOMENTS = [
  // [strength, mood, test] — strong: worth one whenever sharing is on; light: only for "often"
  ['strong', 'excited yes', /\b(gifs?|stickers?|memes?)\b/i],
  // festival greetings in any language's name ("happy Diwali", "happy Pongal", "happy new year"), not "happy to help"
  ['strong', 'celebration', /\b(congrat\w*|celebrat\w*|happy birthday|birthday|anniversary|promot\w*|we did it|woo+h?o+|hurray|yay+|party|festival|best wishes|season'?s greetings)\b|\bhappy (?!to\b|with\b|for\b|about\b|that\b|now\b|hour\b|enough\b)\p{L}{3,}|[🎉🥳🎂🍾🎊🪔]/iu],
  ['thanks', 'thank you', /\b(thanks?|thank (you|u)|thx|ty|dhanyavad\w*|merci|danke|gracias)\b|🙏/iu],
  ['light', 'welcome', /\b(welcome|glad to have you)\b/i],
  ['light', 'laughing', /\b(haha\w*|hehe\w*|lol|lmao|rofl|funny|joke)\b|[😂🤣😆]/iu],
  ['light', 'applause well done', /\b(well said|well done|great job|good job|awesome|superb|brilliant|legend|hero|super|bravo|kudos|nice one)\b|[👏🔥💯]/iu],
  ['light', 'thumbs up deal', /\b(all set|confirmed|deal|done deal|see you|sounds good|perfect|great)\b|👍/iu],
];
const EMOJI = /\p{Extended_Pictographic}/gu;
/**
 * The moment of a message: { serious, moment: { strength: 'strong' | 'light', mood } | null }. Thanks are strong when
 * said to the agent (it was addressed), light otherwise; three or more emoji count as a light moment.
 */
function momentOf(text, { addressed = false } = {}) {
  const t = String(text || '');
  if (SERIOUS.test(t)) return { serious: true, moment: null };
  for (const [s, mood, re] of MOMENTS) if (re.test(t)) return { serious: false, moment: { strength: s === 'thanks' ? (addressed ? 'strong' : 'light') : s, mood } };
  if ((t.match(EMOJI) || []).length >= 3) return { serious: false, moment: { strength: 'light', mood: 'happy' } };
  return { serious: false, moment: null };
}
const qualifies = (mode, m) => !!m && (mode === 'often' || (mode === 'sometimes' && m.strength === 'strong'));

// ---------- privacy: mood words only ----------
const STOP = new Set('a an the and or of for to in on at with by from is are was be it this that my your our his her their me we they i so very just some one gif gifs sticker stickers meme memes send please'.split(' '));
/**
 * The words sent to the tool: letters only, no stop words, never a name the chat knows (people who wrote here, the
 * sender, the agent, the group), at most five words.
 */
function moodWords(mood, names = []) {
  const banned = new Set(names.flatMap((n) => String(n || '').toLowerCase().split(/[^\p{L}]+/u)).filter((w) => w.length > 1));
  const words = String(mood || '').toLowerCase().replace(/https?:\S+|\S+@\S+/g, ' ').split(/[^\p{L}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w) && !banned.has(w));
  return [...new Set(words)].slice(0, 5).join(' ');
}
const namesOf = (ctx) => [...Object.values(namesInChat(ctx.chat)), ctx.senderName, ctx.agent?.name, ctx.chatName];

// ---------- the agent's instructions ----------
const KIND_WORD = { gif: 'GIF', sticker: 'sticker', image: 'picture' };
const kindWords = (services) => [...new Set(services.map((s) => KIND_WORD[s.kind]))].join(' or ');
const WHEN_SHARE = {
  sometimes: 'when one clearly adds warmth or fun: celebrations and festivals of any culture, good news, thanks to you, or when someone asks for one',
  often: 'whenever the mood is light: also thanks, welcomes, jokes, praise and settled plans',
};
/** For the system prompt (the same every turn): the choice it makes at the end of every answer. '' when nothing is on. */
export function sharingNote(services) {
  if (!services.length) return '';
  const mode = services.some((s) => s.share === 'often') ? 'often' : 'sometimes';
  return `Sharing: end every answer with one tag on its own line — [share: two to four generic English mood words, e.g. "happy dance", "festive lights", "thank you"] to add one fitting ${kindWords(services)} after your text, or [share: none]. Share ${WHEN_SHARE[mode]}. Never for serious, worried, upset, safety or money topics. Mood words only: never names or private details. The tag is never shown. Never write links to GIFs or their credits: Duniya adds the GIF and keeps its credit in its panel.`;
}

/** This turn's plan: the services that share on their own, the code's veto (serious, too soon) and its fallback moment. */
export function sharePlan(ctx, services) {
  const on = [...services].sort((a, b) => RANK[b.share] - RANK[a.share]);
  if (!on.length || ctx.source === 'schedule') return null;
  const { serious, moment } = momentOf(ctx.text, { addressed: !ctx.unaddressed });
  const recent = sentWithin(ctx.chat, ctx.agent.id, SHARED, GAP_MS);
  const fallback = on.find((s) => qualifies(s.share, moment)); // only when the model gives no tag
  const note = serious || recent ? '' : 'End with [share: mood] or [share: none].';
  return { services: on, serious, moment, recent, fallback, note };
}

const TAG = /\[(?:share|gif|sticker):\s*([^\]\n]{0,80})\]/gi;
/** Take [share: …] tags out of the text: { text, hint } (hint 'none' = the model says no). */
export function takeShareTag(text) {
  let hint = '';
  const out = String(text || '').replace(TAG, (m, mood) => { hint = String(mood).trim().toLowerCase(); return ''; }).replace(/[ \t]+\n/g, '\n').trim();
  return { text: out, hint: /^(none|no|skip|-)?$/.test(hint) ? (hint ? 'none' : '') : hint };
}

/**
 * After the model answered: what to share after the text, or null. The model's tag decides; without one, the
 * fallback rules do. Never on a serious topic, after an error, or shortly after another one.
 */
export function shareAfterReply(ctx, plan, { reply, hint }) {
  if (!plan || !reply || ctx.modelError || plan.serious || plan.recent || hint === 'none') return null;
  if (hint) return { svc: plan.services[0], mood: hint, by: 'the model' };
  return plan.fallback ? { svc: plan.fallback, mood: plan.moment.mood, by: 'Duniya (no tag; a lighthearted moment)' } : null;
}

// ---------- search, pick, send ----------
const recentKey = (chat, svc) => `shared:${svc}:${chat}`;
const recentIds = (chat, svc) => { try { return JSON.parse(kvGet(recentKey(chat, svc)) || '[]'); } catch { return []; } };
/** Results of a search: the structured list when the tool gives one, else media URLs found in its text. */
function resultsOf(res) {
  const d = res?.data;
  const list = Array.isArray(d) ? d : Array.isArray(d?.results) ? d.results : Array.isArray(d?.items) ? d.items : null;
  if (list) return list.filter((r) => r && typeof r === 'object');
  return [...new Set(String(res?.text || '').match(MEDIA_URL) || [])].map((url) => ({ id: url, url }));
}
const MAX_BYTES = 15 * 1024 * 1024;
const UNIT = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9 };
/** Bytes of a result: its size field, or a schema.org contentSize such as "6.3 MB" (0 when unknown). */
function sizeOf(r) {
  if (r.fileSizeBytes) return Number(r.fileSizeBytes);
  const m = String(r.contentSize || '').match(/([\d.]+)\s*(b|kb|mb|gb)\b/i);
  return m ? Number(m[1]) * UNIT[m[2].toLowerCase()] : 0;
}
/** schema.org: the rendition of the wanted kind from `encoding`, else `contentUrl` (unless too big), else ''. */
function schemaOrgUrl(r, kind) {
  const want = kind === 'gif' ? /^video\/mp4/i : kind === 'sticker' ? /webp/i : /^image\/(png|jpe?g)/i;
  const alt = (Array.isArray(r.encoding) ? r.encoding : []).find((e) => want.test(e?.encodingFormat || '') && /^https:\/\//.test(e?.contentUrl || ''));
  return alt?.contentUrl || (sizeOf(r) > MAX_BYTES ? '' : r.contentUrl);
}
/** The URL to post: for GIFs the MP4 (what chat apps send) when given, for stickers the WebP; any media field else. */
function urlFor(r, kind) {
  if (typeof r.contentUrl === 'string' && /^https:\/\//.test(r.contentUrl)) return schemaOrgUrl(r, kind);
  const fields = Object.entries(r).filter(([k, v]) => typeof v === 'string' && /^https:\/\//.test(v) && (MEDIA_PROP.test(k) || k === 'url') && !/preview|thumb/i.test(k));
  const by = (re) => fields.find(([k, v]) => re.test(k) || re.test(v))?.[1];
  const url = kind === 'gif' ? by(/mp4/i) || (sizeOf(r) > MAX_BYTES ? '' : by(/gif/i)) : kind === 'sticker' ? by(/webp|sticker/i) : by(/png|jpe?g|image|img/i);
  return url || (sizeOf(r) > MAX_BYTES ? '' : r.url) || '';
}
/** A result's id (schema.org: identifier), else its URL: what is not picked again in a chat. */
const idOf = (r, kind) => String(r.id || r.identifier || urlFor(r, kind));

/**
 * Search with the mood words and the style words and pick a fitting result not posted here lately (a random one of
 * the first few): { ctx, svc, by, words, query, url, id, credit, seen } or null. Never throws.
 */
export async function findMedia(ctx, { svc, mood, by }) {
  const chat = ctx.chat; const agent = ctx.agent;
  if (!chatChannel() || sentWithin(chat, agent.id, SHARED, GAP_MS)) return null;
  if (limitStop(ctx, svc.key, svc.behaviour, ctx.uses || new Map())) return null;
  const words = moodWords(mood, namesOf(ctx)) || 'happy';
  const query = clip([words, svc.style].filter(Boolean).join(' '), 200);
  try {
    const res = await svc.conn.call(svc.tool, { [svc.query]: query, ...(svc.limit ? { [svc.limit]: 12 } : {}) });
    if (res.isError) throw new Error(clip(res.text, 200));
    const seen = new Set(recentIds(chat, svc.key));
    // a shared credit (schema.org creditText) is shown in the panel, never in the message; one of its own keeps it out
    const usable = postableResults(svc.key, resultsOf(res)).filter((r) => urlFor(r, svc.kind));
    const fresh = usable.filter((r) => !seen.has(idOf(r, svc.kind)));
    const pool = (fresh.length ? fresh : usable).slice(0, 6);
    if (!pool.length) { activity('whatsapp.action', { agent: agent.id, chat, summary: `No ${KIND_WORD[svc.kind]} found for "${words}" (${svc.key})`, detail: { tool: 'share_media', service: svc.key, query } }); return null; }
    const pick = pool[randomInt(pool.length)];
    const url = urlFor(pick, svc.kind);
    return { ctx, svc, by, words, query, url, id: idOf(pick, svc.kind), credit: creditOf(pick), seen };
  } catch (e) {
    activity('whatsapp.action', { agent: agent.id, chat, summary: `Could not share a ${KIND_WORD[svc.kind]} from ${svc.key}: ${clip(e.message, 160)}`, detail: { tool: 'share_media', service: svc.key, error: clip(e.message, 300) } });
    return null;
  }
}

const CAPTION_MAX = 500; // a longer answer goes as its own message, the media after it
/** Can the answer go as the media's caption (one message)? Stickers take no caption. */
export const fitsCaption = (m, text) => !!m && m.svc.kind !== 'sticker' && String(text || '').length <= CAPTION_MAX;

/**
 * Post a found result: alone (no caption), or with the answer as its caption (`text`: one message). Its credit goes
 * to Activity and the panel, never into the chat. Returns the stored message's id (or undefined); records it as shared.
 */
export async function postMedia(m, { text = '', quote = undefined } = {}) {
  const { ctx, svc, words } = m; const chat = ctx.chat; const agent = ctx.agent;
  const r = await chatChannel().sendMedia(chat, { kind: svc.kind, url: m.url, caption: text, ...(quote ? { quote } : {}) });
  noteSent(chat, agent.id, { kind: 'share', url: m.url });
  countStat(m.by === 'the model' ? 'shared_ai' : 'shared_rule', { agent: agent.id }); // who picks them: the card shows it
  kvSet(recentKey(chat, svc.key), JSON.stringify([...m.seen].filter((x) => x !== m.id).concat(m.id).slice(-KEEP_IDS)));
  const label = `[${svc.kind}: ${words}]`;
  const id = ctx.ownerChat && chat === ctx.ownerChat ? undefined
    : logMessage({ chat, agent: agent.id, msgId: r?.msgId || null, sender: 'agent', name: 'Assistant', text: text ? `${text}\n${label}` : label, fromAgent: true });
  activity('whatsapp.action', { agent: agent.id, chat, summary: `Shared a ${KIND_WORD[svc.kind]} (${words}) from ${svc.key}, chosen by ${m.by}${text ? ', with the answer' : ''}`,
    detail: { tool: 'share_media', service: svc.key, query: m.query, url: m.url, credit: m.credit, by: m.by, role: ctx.role } });
  return id;
}
