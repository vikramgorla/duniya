// @ts-check
// Share results on its own (094): a tool service with a read-only tool that returns media (GIFs, stickers, pictures)
// can be used by an agent on its own — off | sometimes | often, with style words (tool-behaviour.js). Nothing here
// knows a service by name: the tool is found by what it declares (readOnlyHint, media in its output schema or in its
// results) and a free-text input.
//
// - One call: the agent gets `share_media(mood)` (for the roles allowed to use that service). It only picks the mood;
//   code searches with the mood words (names stripped) + style words, picks a fitting result it did not post in that
//   chat lately and sends it as media with the credit text the tool returns, right after the text answer.
// - Moments in code: thanks, celebrations, welcomes, jokes, praise, settled plans and requests are found by cheap
//   rules; "often" asks for one on such a moment and sends one itself when the model did not; "sometimes" only on
//   strong moments (celebrations, thanks to the agent, requests). The model can also end its text with
//   [share: mood] or [share: none]. Serious topics never get one, nor errors.
// - One per moment: at most one per answer, none when one went out in that chat in the last few minutes.
import { randomInt } from 'node:crypto';
import { clip } from './config.js';
import { kvGet, kvSet, logMessage, namesInChat } from './db.js';
import { activity } from './events.js';
import { noteSent, sentWithin } from './turns.js';
import { chatChannel } from './chat-tools.js';
import { limitStop } from './tool-behaviour.js';

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
  const props = Object.keys(schema.properties || {});
  const media = props.filter((p) => MEDIA_PROP.test(p));
  if (media.length) return media.some((p) => /gif|mp4/i.test(p)) ? 'gif' : media.some((p) => /sticker/i.test(p)) ? 'sticker' : 'image';
  for (const v of [...Object.values(schema.properties || {}), schema.items].filter(Boolean)) { const k = schemaKind(v, depth + 1); if (k) return k; }
  return '';
}
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
  ['strong', 'celebration', /\b(congrat\w*|celebrat\w*|happy birthday|birthday|anniversary|promot\w*|we did it|woo+h?o+|hurray|yay+|party)\b|[🎉🥳🎂🍾🎊]/iu],
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
/** For the system prompt (the same every turn): what it may share and when. '' when nothing is on. */
export function sharingNote(services) {
  if (!services.length) return '';
  const often = services.some((s) => s.share === 'often');
  return `Sharing: you can add one fitting ${kindWords(services)} to an answer with whatsapp__share_media (mood: two to four generic words like "happy dance", "thank you", "mind blown"; never names or private details). ${often
    ? 'Do it often: for thanks, celebrations, welcomes, jokes, praise, settled plans and when someone asks for one.'
    : 'Do it only for real celebrations, thanks to you, or when someone asks for one.'} Never for serious, worried, upset, safety or money topics; at most one per answer; your useful text comes first. Instead of the tool you may end your text with [share: mood], or [share: none] when one would not fit.`;
}

/** This turn's plan: the services that share on their own, the message's moment and the line added to the turn. */
export function sharePlan(ctx, services) {
  const on = [...services].sort((a, b) => RANK[b.share] - RANK[a.share]);
  if (!on.length || ctx.source === 'schedule') return null;
  const { serious, moment } = momentOf(ctx.text, { addressed: !ctx.unaddressed });
  const recent = sentWithin(ctx.chat, ctx.agent.id, SHARED, GAP_MS);
  const svc = on.find((s) => qualifies(s.share, moment));
  const note = !serious && !recent && svc ? `This is a lighthearted moment: after your text, end with share_media("${moment.mood}") (or [share: ${moment.mood}]) — one ${KIND_WORD[svc.kind]}.` : '';
  return { services: on, serious, moment, recent, svc, note, chosen: null };
}

const TAG = /\[(?:share|gif|sticker):\s*([^\]\n]{0,80})\]/gi;
/** Take [share: …] tags out of the text: { text, hint } (hint 'none' = the model says no). */
export function takeShareTag(text) {
  let hint = '';
  const out = String(text || '').replace(TAG, (m, mood) => { hint = String(mood).trim().toLowerCase(); return ''; }).replace(/[ \t]+\n/g, '\n').trim();
  return { text: out, hint: /^(none|no|skip|-)?$/.test(hint) ? (hint ? 'none' : '') : hint };
}

/**
 * After the model answered: what to share after the text, or null. One the model asked for (tool or tag) goes out
 * unless the topic is serious; otherwise code shares one on a moment the setting covers.
 */
export function shareAfterReply(ctx, plan, { reply, hint }) {
  if (!plan || !reply || ctx.modelError || plan.serious || plan.recent || hint === 'none') return null;
  if (plan.chosen) return plan.chosen; // share_media was called in this turn
  if (hint) return { svc: plan.services[0], mood: hint, by: 'the model' };
  return plan.svc ? { svc: plan.svc, mood: plan.moment.mood, by: 'Duniya (a lighthearted moment)' } : null;
}

/** The share_media action for the agent's sharing services (the roles allowed to use them). */
export function shareToolDef(services) {
  return {
    name: 'share_media', roles: ['organizer', 'participant'], annotations: { readOnlyHint: false, destructiveHint: false },
    description: `Add one fitting ${kindWords(services)} after your text answer: give the mood in two to four generic words ("happy dance", "thank you", "applause"); never names or private details. Duniya finds a fitting one and posts it right after your text. At most one per answer.`,
    input_schema: { type: 'object', properties: {
      mood: { type: 'string', maxLength: 60, description: 'The mood, e.g. "celebration", "thank you", "laughing"' },
      ...(services.length > 1 ? { service: { type: 'string', enum: services.map((s) => s.key), description: 'Which service (default: the first)' } } : {}),
    }, required: ['mood'] },
    async run(input, ctx) {
      const plan = ctx.sharePlan; // shared by the turn (tools get a copy of ctx)
      const svc = (plan?.services || []).find((s) => s.key === input.service) || plan?.services[0];
      if (!plan || !svc) return { queued: false, note: 'Not here; answer in text only.' };
      if (plan.chosen) return { queued: false, note: 'One per answer; one is already on its way.' };
      if (plan.serious) return { queued: false, note: 'Not for this topic; answer in text only.' };
      if (sentWithin(ctx.chat, ctx.agent.id, SHARED, GAP_MS)) return { queued: false, note: 'One was posted here a few minutes ago, so none now. Do not try again.' };
      if (!moodWords(input.mood, namesOf(ctx))) return { queued: false, note: 'Give the mood in generic words (no names).' };
      plan.chosen = { svc, mood: String(input.mood || ''), by: 'the model' };
      return { queued: true, note: `A fitting ${KIND_WORD[svc.kind]} goes out right after your text. Do not send another one.` };
    },
  };
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
/** The URL to post: for GIFs the MP4 (what chat apps send) when given, for stickers the WebP; any media field else. */
function urlFor(r, kind) {
  const fields = Object.entries(r).filter(([k, v]) => typeof v === 'string' && /^https:\/\//.test(v) && (MEDIA_PROP.test(k) || k === 'url') && !/preview|thumb/i.test(k));
  const by = (re) => fields.find(([k, v]) => re.test(k) || re.test(v))?.[1];
  const url = kind === 'gif' ? by(/mp4/i) || (r.fileSizeBytes > MAX_BYTES ? '' : by(/gif/i)) : kind === 'sticker' ? by(/webp|sticker/i) : by(/png|jpe?g|image|img/i);
  return url || (r.fileSizeBytes > MAX_BYTES ? '' : r.url) || '';
}
/** The credit text the tool returns with a result (an attribution line, a credit), shown as the caption. */
const creditOf = (r) => clip(String(r.attribution || r.credit || r.credits || ''), 200);

/**
 * Search with the mood words and the style words, pick a fitting result not posted here lately (a random one of the
 * first few) and post it to the chat. Returns { sent }. Never throws.
 */
export async function shareMedia(ctx, { svc, mood, by }) {
  const chat = ctx.chat; const agent = ctx.agent;
  const channel = chatChannel();
  if (!channel || sentWithin(chat, agent.id, SHARED, GAP_MS)) return { sent: false };
  if (limitStop(ctx, svc.key, svc.behaviour, ctx.uses || new Map())) return { sent: false };
  const words = moodWords(mood, namesOf(ctx)) || 'happy';
  const query = clip([words, svc.style].filter(Boolean).join(' '), 200);
  try {
    const res = await svc.conn.call(svc.tool, { [svc.query]: query, ...(svc.limit ? { [svc.limit]: 12 } : {}) });
    if (res.isError) throw new Error(clip(res.text, 200));
    const seen = new Set(recentIds(chat, svc.key));
    const usable = resultsOf(res).filter((r) => urlFor(r, svc.kind));
    const fresh = usable.filter((r) => !seen.has(String(r.id || urlFor(r, svc.kind))));
    const pool = (fresh.length ? fresh : usable).slice(0, 6);
    if (!pool.length) { activity('whatsapp.action', { agent: agent.id, chat, summary: `No ${KIND_WORD[svc.kind]} found for "${words}" (${svc.key})`, detail: { tool: 'share_media', service: svc.key, query } }); return { sent: false }; }
    const pick = pool[randomInt(pool.length)];
    const url = urlFor(pick, svc.kind); const id = String(pick.id || url);
    const r = await channel.sendMedia(chat, { kind: svc.kind, url, caption: creditOf(pick) });
    noteSent(chat, agent.id, { kind: 'share', url });
    kvSet(recentKey(chat, svc.key), JSON.stringify([...seen].filter((x) => x !== id).concat(id).slice(-KEEP_IDS)));
    const label = `[${svc.kind}: ${words}]`;
    if (!(ctx.ownerChat && chat === ctx.ownerChat)) logMessage({ chat, agent: agent.id, msgId: r?.msgId || null, sender: 'agent', name: 'Assistant', text: label, fromAgent: true });
    activity('whatsapp.action', { agent: agent.id, chat, summary: `Shared a ${KIND_WORD[svc.kind]} (${words}) from ${svc.key}, chosen by ${by}`,
      detail: { tool: 'share_media', service: svc.key, query, url, by, role: ctx.role } });
    return { sent: true };
  } catch (e) {
    activity('whatsapp.action', { agent: agent.id, chat, summary: `Could not share a ${KIND_WORD[svc.kind]} from ${svc.key}: ${clip(e.message, 160)}`, detail: { tool: 'share_media', service: svc.key, error: clip(e.message, 300) } });
    return { sent: false };
  }
}
