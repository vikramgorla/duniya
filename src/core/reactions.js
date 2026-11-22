// @ts-check
// Reactions on their own (094): a tool service that finds reaction media (GIFs, stickers, memes; e.g. the KLIPY GIF
// service) can be used by an agent on its own: off | sometimes | often, with style keywords, per agent and service
// (the service's own setting is the default). Nothing here is GIF-specific: any service whose search tool returns
// media URLs works the same way.
//
// - Which services: a search tool marked `_meta["duniya/reaction"]` (true or the media kind), or named like
//   search_gifs / search_stickers / search_memes / search_reactions; a service's setting `reactions.media` (auto | on |
//   off) overrides the guess.
// - One call: the agent gets `send_reaction(mood)` (every role, when such a service is on for it). It only picks the
//   mood; code searches the service with the mood words (names stripped) + style keywords, picks a fitting result it
//   did not send here lately and sends it as media with the service's credit, right after the text answer.
// - Moments in code: thanks, celebrations, welcomes, jokes, praise, settled plans and requests are found by cheap
//   rules; "often" asks for a reaction on such a moment and sends one itself when the model did not; "sometimes" only
//   on strong moments (celebrations, thanks to the agent, requests). The model can also end its text with
//   [reaction: mood] or [reaction: none]. Serious topics never get one, nor errors.
// - One per moment: at most one per answer, none when one went out in that chat in the last few minutes.
import { randomInt } from 'node:crypto';
import { clip } from './config.js';
import { kvGet, kvSet, logMessage, namesInChat } from './db.js';
import { activity } from './events.js';
import { noteSent, sentWithin } from './turns.js';
import { chatChannel } from './chat-tools.js';

const MEDIA_KINDS = ['gif', 'sticker', 'image'];
const META_KEY = 'duniya/reaction';
const NAME_RE = /^search_?(gif|sticker|meme|reaction)s?$/i;
const GAP_MS = 3 * 60000; // none when one went out in the chat this recently (the duplicate guard's window)
const KEEP_IDS = 30; // results not picked again in a chat
const RANK = { off: 0, sometimes: 1, often: 2 };

const kindOf = (name) => (/sticker/i.test(name) ? 'sticker' : /meme/i.test(name) ? 'image' : 'gif');
/** The search tool of a reaction media service, { tool, kind, query, limit } (argument names), or null. */
export function reactionTool(tools, media = 'auto') {
  if (media === 'off') return null;
  const meta = (t) => t?._meta?.[META_KEY];
  const t = tools.find((x) => meta(x)) || tools.find((x) => NAME_RE.test(x.name)) || (media === 'on' ? tools.find((x) => /^search/i.test(x.name)) : null);
  if (!t) return null;
  const m = meta(t);
  const props = t.inputSchema?.properties || {};
  const query = (t.inputSchema?.required || []).find((k) => props[k]?.type === 'string') || (props.q ? 'q' : 'query');
  return { tool: t.name, kind: MEDIA_KINDS.includes(m) ? m : kindOf(t.name), query, limit: props.limit ? 'limit' : '' };
}

/** An agent's choice for one service: its own (unless "inherit"), else the service's default. */
export function reactionSettings(agent, key, srv) {
  const own = agent?.reactions?.[key] || {};
  const dflt = srv?.reactions || {};
  return { mode: own.mode && own.mode !== 'inherit' ? own.mode : dflt.mode || 'off', style: own.style || dflt.style || '' };
}

// ---------- moments (cheap rules, no model call) ----------
const SERIOUS = /\b(sorry|sad|sick|ill|hospital|doctor|accident|emergency|urgent|police|died|death|passed away|funeral|condolences?|rip|injur\w*|hurt|unsafe|danger\w*|worr(y|ied)|upset|angry|complain\w*|late|delay\w*|stuck|broke down|breakdown|refund|owes?|dispute|unfair|money|payment|problem|cancel\w*)\b|[😢😭😡😞😟💔🚑]/iu;
/** @type {Array<[string, string, RegExp]>} */
const MOMENTS = [
  // [strength, mood, test] — strong: always worth one when reactions are on; light: only for "often"
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
 * The moment of a message: { strength: 'strong' | 'light', mood } or null, and whether it is serious. Thanks are strong
 * when said to the agent (it was addressed), light otherwise; three or more emoji count as a light moment.
 */
export function momentOf(text, { addressed = false } = {}) {
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
 * The words sent to the service: letters only, no stop words, never a name the chat knows (people who wrote here, the
 * sender, the agent, the group), at most five words.
 */
export function moodWords(mood, names = []) {
  const banned = new Set(names.flatMap((n) => String(n || '').toLowerCase().split(/[^\p{L}]+/u)).filter((w) => w.length > 1));
  const words = String(mood || '').toLowerCase().replace(/https?:\S+|\S+@\S+/g, ' ').split(/[^\p{L}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w) && !banned.has(w));
  return [...new Set(words)].slice(0, 5).join(' ');
}
const namesOf = (ctx) => [...Object.values(namesInChat(ctx.chat)), ctx.senderName, ctx.agent?.name, ctx.chatName];

// ---------- the agent's instructions ----------
const KIND_WORD = { gif: 'GIF', sticker: 'sticker', image: 'meme' };
const kindWords = (services) => [...new Set(services.map((s) => KIND_WORD[s.kind]))].join(' or ');
/** For the system prompt (the same every turn): what it may send and when. '' when no service is on. */
export function reactionsNote(services) {
  const on = services.filter((s) => s.mode !== 'off');
  if (!on.length) return '';
  const often = on.some((s) => s.mode === 'often');
  return `Reactions: you can add one fitting ${kindWords(on)} to an answer with whatsapp__send_reaction (mood: two to four generic words like "happy dance", "thank you", "mind blown"; never names or private details). ${often
    ? 'Use one often: for thanks, celebrations, welcomes, jokes, praise, settled plans and when someone asks for one.'
    : 'Use one only for real celebrations, thanks to you, or when someone asks for one.'} Never for serious, worried, upset, safety or money topics; at most one per answer; your useful text comes first and the ${kindWords(on)} follows it. Instead of the tool you may end your text with [reaction: mood], or [reaction: none] when one would not fit.`;
}

/** This turn's plan: the services that are on, the message's moment and the line added to the turn, if any. */
export function reactionPlan(ctx, services) {
  const on = services.filter((s) => s.mode !== 'off').sort((a, b) => RANK[b.mode] - RANK[a.mode]);
  if (!on.length || ctx.source === 'schedule') return null;
  const { serious, moment } = momentOf(ctx.text, { addressed: !ctx.unaddressed });
  const recent = sentWithin(ctx.chat, ctx.agent.id, ['gif', 'sticker', 'reaction'], GAP_MS);
  const svc = on.find((s) => qualifies(s.mode, moment));
  const note = !serious && !recent && svc ? `This is a lighthearted moment: after your text, end with send_reaction("${moment.mood}") (or [reaction: ${moment.mood}]) — one ${KIND_WORD[svc.kind]}.` : '';
  return { services: on, serious, moment, recent, svc, note };
}

const TAG = /\[(?:reaction|gif|sticker):\s*([^\]\n]{0,80})\]/gi;
/** Take [reaction: …] tags out of the text: { text, hint } (hint 'none' = the model says no reaction). */
export function takeReactionTag(text) {
  let hint = '';
  const out = String(text || '').replace(TAG, (m, mood) => { hint = String(mood).trim().toLowerCase(); return ''; }).replace(/[ \t]+\n/g, '\n').trim();
  return { text: out, hint: /^(none|no|skip|-)?$/.test(hint) ? (hint ? 'none' : '') : hint };
}

/**
 * After the model answered: the reaction to send after the text, or null. One the model asked for (tool or tag) goes
 * out unless the topic is serious; otherwise code sends one on a moment the agent's setting covers.
 */
export function reactionAfterReply(ctx, plan, { reply, hint }) {
  if (!plan || !reply || ctx.modelError || plan.serious || plan.recent || hint === 'none') return null;
  if (plan.chosen) return plan.chosen; // send_reaction was called in this turn
  if (hint) return { svc: plan.services[0], mood: hint, by: 'the model' };
  return plan.svc ? { svc: plan.svc, mood: plan.moment.mood, by: 'Duniya (a lighthearted moment)' } : null;
}

/** The send_reaction tool for the agent's reaction services (every role; it is harmless). */
export function reactionToolDef(services) {
  const on = services.filter((s) => s.mode !== 'off');
  return {
    name: 'send_reaction', roles: ['organizer', 'participant'],
    description: `Add one fitting ${kindWords(on)} after your text answer: give the mood in two to four generic words ("happy dance", "thank you", "applause"); never names or private details. Duniya finds a fitting one and sends it right after your text. At most one per answer.`,
    input_schema: { type: 'object', properties: {
      mood: { type: 'string', maxLength: 60, description: 'The mood or reaction, e.g. "celebration", "thank you", "laughing"' },
      ...(on.length > 1 ? { service: { type: 'string', enum: on.map((s) => s.key), description: 'Which service (default: the first)' } } : {}),
    }, required: ['mood'] },
    async run(input, ctx) {
      const svc = on.find((s) => s.key === input.service) || on[0];
      const plan = ctx.reactionPlan; // shared by the turn (tools get a copy of ctx)
      if (!plan) return { queued: false, note: 'Not here; answer in text only.' };
      if (plan.chosen) return { queued: false, note: 'One reaction per answer; one is already on its way.' };
      if (plan.serious) return { queued: false, note: 'Not for this topic; answer in text only.' };
      if (sentWithin(ctx.chat, ctx.agent.id, ['gif', 'sticker', 'reaction'], GAP_MS)) return { queued: false, note: 'One was sent here a few minutes ago, so none now. Do not try again.' };
      if (!moodWords(input.mood, namesOf(ctx))) return { queued: false, note: 'Give the mood in generic words (no names).' };
      plan.chosen = { svc, mood: String(input.mood || ''), by: 'the model' };
      return { queued: true, note: `A fitting ${KIND_WORD[svc.kind]} goes out right after your text. Do not send another one.` };
    },
  };
}

// ---------- search, pick, send ----------
const recentKey = (chat, svc) => `reactions:recent:${svc}:${chat}`;
const recentIds = (chat, svc) => { try { return JSON.parse(kvGet(recentKey(chat, svc)) || '[]'); } catch { return []; } };
/** Results of a search: the structured list when the service gives one, else media URLs found in its text. */
function resultsOf(res) {
  const d = res?.data;
  const list = Array.isArray(d) ? d : Array.isArray(d?.results) ? d.results : Array.isArray(d?.items) ? d.items : null;
  if (list) return list.filter((r) => r && typeof r === 'object');
  return [...new Set(String(res?.text || '').match(/https:\/\/[^\s)"'<>]+\.(?:mp4|gif|webp)/gi) || [])].map((url) => ({ id: url, url }));
}
const MAX_BYTES = 15 * 1024 * 1024;
const urlFor = (r, kind) => (kind === 'sticker' ? r.webpUrl || r.url : kind === 'gif' ? r.mp4Url || (r.fileSizeBytes > MAX_BYTES ? '' : r.url) : r.url) || '';
/** The service's credit to show with it (KLIPY asks for "Powered by KLIPY"; open licences their attribution line). */
const creditOf = (r) => (r.source === 'klipy' || /klipy/i.test(r.attribution || '') ? 'Powered by KLIPY' : r.attributionRequired && r.attribution ? clip(r.attribution, 200) : '');

/**
 * Search the service with the mood words and the style keywords, pick a fitting result not sent here lately (a random
 * one of the first few) and send it to the chat. Returns { sent, ... }. Never throws.
 */
export async function sendReaction(ctx, { svc, mood, by }) {
  const chat = ctx.chat; const agent = ctx.agent;
  const channel = chatChannel();
  if (!channel || sentWithin(chat, agent.id, ['gif', 'sticker', 'reaction'], GAP_MS)) return { sent: false };
  const words = moodWords(mood, namesOf(ctx)) || 'happy';
  const query = clip([words, svc.style].filter(Boolean).join(' '), 200);
  try {
    const res = await svc.conn.call(svc.tool, { [svc.query]: query, ...(svc.limit ? { [svc.limit]: 12 } : {}) });
    if (res.isError) throw new Error(clip(res.text, 200));
    const seen = new Set(recentIds(chat, svc.key));
    const usable = resultsOf(res).filter((r) => urlFor(r, svc.kind));
    const fresh = usable.filter((r) => !seen.has(String(r.id || urlFor(r, svc.kind))));
    const pool = (fresh.length ? fresh : usable).slice(0, 6);
    if (!pool.length) { activity('whatsapp.action', { agent: agent.id, chat, summary: `No ${KIND_WORD[svc.kind]} found for "${words}" (${svc.key})`, detail: { tool: 'send_reaction', service: svc.key, query } }); return { sent: false }; }
    const pick = pool[randomInt(pool.length)];
    const url = urlFor(pick, svc.kind); const id = String(pick.id || url);
    const caption = creditOf(pick);
    const r = await channel.sendMedia(chat, { kind: svc.kind, url, caption });
    noteSent(chat, agent.id, { kind: svc.kind, url });
    if (svc.kind === 'image') noteSent(chat, agent.id, { kind: 'reaction', url });
    kvSet(recentKey(chat, svc.key), JSON.stringify([...seen].filter((x) => x !== id).concat(id).slice(-KEEP_IDS)));
    const label = `[${svc.kind}: ${words}]`;
    if (!(ctx.ownerChat && chat === ctx.ownerChat)) logMessage({ chat, agent: agent.id, msgId: r?.msgId || null, sender: 'agent', name: 'Assistant', text: label, fromAgent: true });
    activity('whatsapp.action', { agent: agent.id, chat, summary: `Sent a ${KIND_WORD[svc.kind]} (${words}) from ${svc.key}, chosen by ${by}`,
      detail: { tool: 'send_reaction', service: svc.key, query, url, by, role: ctx.role } });
    return { sent: true, url };
  } catch (e) {
    activity('whatsapp.action', { agent: agent.id, chat, summary: `Could not send a ${KIND_WORD[svc.kind]} from ${svc.key}: ${clip(e.message, 160)}`, detail: { tool: 'send_reaction', service: svc.key, error: clip(e.message, 300) } });
    return { sent: false };
  }
}
