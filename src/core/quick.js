// @ts-check
// Built-in answers (054, issue #102): quick replies, the optional "!help" list and FAQ auto-answers. No AI, no tokens:
// the owner writes the answers, the router sends them before (or instead of) a model call. Pure functions; the
// router and the panel's test console share them, so both take the same path.
export const QUICK_WHO = ['everyone', 'organizers'];
export const FAQ_STRICTNESS = ['strict', 'normal'];
/** Score an FAQ entry needs (0–1): strict = the whole question or every keyword; normal = most of it. */
const FAQ_THRESHOLD = { strict: 0.95, normal: 0.6 };
/** The FAQ given to the model as reference context is capped (characters) so it stays a small part of the prompt. */
const FAQ_CONTEXT_MAX = 1500;
export const DEFAULT_WELCOME = 'Welcome {name} to {group}! 👋';

// Small words that say nothing about the topic (English, French, German, Italian): ignored when comparing questions.
const STOP = new Set(`a an the is are was were be been am do does did to of in on at for from by with and or but if it its this that
these those there here what when where who whom which why how can could would should will shall may might must i me my we our you your
he she they them their his her us any some much many please hi hello hey ok okay thanks thank tell know about get got have has had
le la les un une des de du et ou est sont que qui quoi quand ou comment pourquoi je tu il elle nous vous ils elles on mon ma mes ton ta
tes son sa ses ce cette ces au aux en dans pour par avec sur pas ne plus svp merci bonjour salut
der die das ein eine einen dem den des und oder ist sind wann wo wer wie warum was ich du er sie wir ihr mein dein sein im am zu mit
für auf nicht bitte danke hallo il lo gli una di da che chi come quando dove perche io tu lui lei noi voi loro`.split(/\s+/));

/** Lowercase, accents removed, only letters and digits (word separators collapsed to one space). */
function normalizeText(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const contentWords = (norm) => norm.split(' ').filter((w) => w && !STOP.has(w));
/** Does the normalised text contain the normalised phrase as whole words? */
const hasPhrase = (norm, phrase) => !!phrase && ` ${norm} `.includes(` ${phrase} `);

/** Today's date in the agent's timezone, e.g. "Sunday 15 November 2026". */
export function todayText(tz, now = Date.now()) {
  try { return new Date(now).toLocaleDateString('en-GB', { timeZone: tz || undefined, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', ''); } catch {
    return new Date(now).toDateString();
  }
}

/** Replace {name}, {group}, {date} (and {rules} for welcomes). Unknown placeholders stay as written. */
export function fillPlaceholders(text, values = {}) {
  return String(text ?? '').replace(/\{(name|group|date|rules)\}/g, (m, k) => (values[k] === undefined ? m : String(values[k] ?? '')))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The command a message starts with: the whole message or its first word, lowercased, trailing ?!.,: removed. */
function leadingWord(text) {
  const t = String(text ?? '').trim().toLowerCase();
  const first = t.split(/\s+/)[0] || '';
  return first.length > 1 ? first.replace(/[?.,:;]+$/, '') : first;
}

/**
 * The quick reply a message asks for, or null. `texts` = the message as written and without a leading trigger
 * ("!carpool !rides"). Returns { item, allowed } — allowed is false when the command is for organizers only.
 */
function findQuickReply(agent, texts, role) {
  const list = agent?.quickReplies || [];
  if (!list.length) return null;
  for (const t of texts) {
    const w = leadingWord(t);
    if (!w) continue;
    const item = list.find((q) => q.command === w);
    if (item) return { item, allowed: item.who !== 'organizers' || role === 'organizer' };
  }
  return null;
}

/** The built-in "!help" text: the agent's quick replies this person may use and how to wake the agent. */
function helpText(agent, role) {
  const cmds = (agent.quickReplies || []).filter((q) => q.who !== 'organizers' || role === 'organizer');
  const lines = [`*${agent.name}*${agent.description ? ` — ${agent.description}` : ''}`];
  if (cmds.length) lines.push('', 'Quick commands:', ...cmds.map((q) => `- ${q.command}${q.who === 'organizers' ? ' (organizers)' : ''}`));
  const wake = [(agent.triggers || []).length ? `start or mention ${agent.triggers.map((t) => `"${t}"`).join(' or ')} in a message` : '',
    agent.respondToMentions ? '@mention me or reply to my message' : ''].filter(Boolean);
  if (wake.length) lines.push('', `To ask me something: ${wake.join(', or ')}.`);
  return lines.join('\n');
}

/** Score one FAQ entry for a normalised message (0–1). */
function faqScore(item, norm) {
  if (!norm) return 0;
  const words = new Set(contentWords(norm));
  let best = 0;
  for (const q of item.questions || []) {
    const qn = normalizeText(q);
    if (!qn) continue;
    if (hasPhrase(norm, qn)) return 1;
    const qw = [...new Set(contentWords(qn))];
    if (!qw.length) continue;
    const hit = qw.filter((w) => words.has(w)).length;
    // One shared word is not a match unless the question has only that word.
    if (hit < Math.min(2, qw.length)) continue;
    best = Math.max(best, hit / qw.length);
  }
  const kws = (item.keywords || []).map(normalizeText).filter(Boolean);
  if (kws.length) best = Math.max(best, kws.filter((k) => hasPhrase(norm, k)).length / kws.length);
  return best;
}

/** The best FAQ entry for a message, or null: { item, score }. */
function matchFaq(agent, text) {
  const items = agent?.faq?.items || [];
  if (!items.length) return null;
  const norm = normalizeText(text);
  const need = FAQ_THRESHOLD[agent.faq.strictness] ?? FAQ_THRESHOLD.normal;
  let best = null;
  for (const item of items) {
    const score = faqScore(item, norm);
    if (score >= need && (!best || score > best.score)) best = { item, score };
  }
  return best;
}

/** The FAQ as short reference context for the model (capped), or ''. */
export function faqContext(agent) {
  const items = agent?.faq?.items || [];
  if (!items.length) return '';
  let out = 'Reference answers the organisers wrote (use them when they fit; do not mention this list):';
  for (const it of items) {
    const line = `\n- Q: ${(it.questions[0] || it.keywords.join(', ')).replace(/\s+/g, ' ')} A: ${it.answer.replace(/\s+/g, ' ')}`;
    if (out.length + line.length > FAQ_CONTEXT_MAX) { out += '\n- …'; break; }
    out += line;
  }
  return out;
}

/**
 * Which built-in answer a message gets, if any: { kind: 'quick' | 'help' | 'faq', text, label } or null.
 * texts: [as written, without a leading trigger]; question: the text without triggers/mentions (for the FAQ);
 * faqAllowed: the message would wake the agent, or the agent answers FAQ in the whole group.
 */
export function builtinAnswer(agent, { texts, question, role, faqAllowed, values }) {
  const quick = findQuickReply(agent, texts, role);
  if (quick?.allowed) return { kind: 'quick', text: fillPlaceholders(quick.item.text, values), label: `quick reply ${quick.item.command}` };
  if (!quick && agent.help && texts.some((t) => leadingWord(t) === '!help')) return { kind: 'help', text: helpText(agent, role), label: 'quick reply !help' };
  if (faqAllowed) {
    const m = matchFaq(agent, question);
    if (m) return { kind: 'faq', text: fillPlaceholders(m.item.answer, values), label: 'FAQ' };
  }
  return null;
}
