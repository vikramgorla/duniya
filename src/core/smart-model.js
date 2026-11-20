// @ts-check
// Smart model choice (088): an agent on "Auto: light for simple, strong when needed" gets, per turn, a light model for
// simple messages (greetings, thanks, short questions that need no records) and a strong one when it matters (the
// owner, photos, changes, long or multi-step messages, long conversations, looking things up). Rules decide first, in
// code; only when they are unsure, and when the owner allows it, one tiny classifier call (at most 4 output tokens,
// 400 characters of the message) asks the light model. The light and strong models are settings (Settings → Models)
// that an agent can override; "auto" means the background model (light) and the default model (strong), so every
// provider gets sensible picks and OpenRouter's free models work. A light answer that fails moves to the strong model.
import { getSetting, updateSettings } from './store.js';
import { bad, clip } from './config.js';
import { usageTag } from './usage.js';
import { chat as modelChat, resolveModel, REF_RE } from './providers/index.js';

export const SMART = 'smart';
const DEFAULTS = { light: 'auto', strong: 'auto', classifier: true };

/** Settings → Models → Smart choice: { light, strong, classifier }. */
export function smartSettings() {
  const s = getSetting('smartModels', null) || {};
  const ref = (v) => (v === 'auto' || REF_RE.test(String(v || '')) ? String(v) : 'auto');
  return { light: ref(s.light ?? DEFAULTS.light), strong: ref(s.strong ?? DEFAULTS.strong), classifier: s.classifier ?? DEFAULTS.classifier };
}
export function setSmartSettings(patch = {}) {
  const cur = smartSettings();
  for (const k of ['light', 'strong']) {
    if (patch[k] === undefined) continue;
    const v = String(patch[k] || 'auto');
    if (v !== 'auto' && !REF_RE.test(v)) throw bad(`${k} must be "auto" or provider:model`, k);
    cur[k] = v;
  }
  if (patch.classifier !== undefined) cur.classifier = !!patch.classifier;
  updateSettings({ smartModels: cur });
  return cur;
}

/**
 * The models of the two tiers for an agent: { light, strong } as refs a model call takes ("account:model" or "auto").
 * The agent's own choice (modelTiers) wins over the settings. "auto" light = the background model right now.
 */
export function tierModels(agent) {
  const s = smartSettings();
  const own = agent?.modelTiers || {};
  const strong = own.strong || s.strong;
  let light = own.light || s.light;
  if (light === 'auto') { try { light = resolveModel('auto', 'background').ref; } catch { light = strong; } }
  return { light, strong };
}
/** The strong model's concrete ref (for "what it would have cost"), or ''. */
export function strongRef(agent) {
  try { return resolveModel(tierModels(agent).strong, 'agent').ref; } catch { return ''; }
}

const GREETING = /^(hi+|hello|hey+|hiya|yo|good (morning|afternoon|evening|night)|gm|gn|thanks?( you)?( so much)?|thank u|thx|ty|ok(ay)?|cool|great|nice|super|perfect|done|got it|sure|yes|no|yep|nope|bye|see you|cheers|namaste|bonjour|merci|salut|ciao|danke|hola|gracias|👍|🙏|❤️|😊|🙂)\b[\s!.,?🙏👍😊🙂]*$/iu;
const CHANGE = /\b(add|change|update|move|cancel|delete|remove|register|unregister|book|assign|pay|paid|record|send|create|schedule|remind|invite|rename|set|mark|refund|confirm|swap|replace)\b/i;
const LOOKUP = /\b(how (many|much)|who (is|are|has|have|paid|owes?|registered|comes?|is coming)|list|registered|owe|owes|paid|balance|total|status|my order|my registration|which (families|people)|count|sum)\b/i;
const MULTI = /\b(and then|after that|first|second|step|also|plus|compare|explain why|summari[sz]e|plan)\b/i;
const LONG_TEXT = 300;
const LONG_CONTEXT = 12000;

/**
 * Rules first: { tier: 'light' | 'strong' | null, reason } — null = unsure. `turn`: { text, ownerTurn, attachments,
 * source, unaddressed, hasTools, contextChars }.
 */
function ruleTier(turn) {
  const text = String(turn.text || '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  if (turn.ownerTurn) return { tier: 'strong', reason: 'the owner' };
  if (turn.attachments) return { tier: 'strong', reason: 'a photo or file' };
  if (turn.source === 'schedule') return { tier: 'strong', reason: 'a scheduled post' };
  if (GREETING.test(text)) return { tier: 'light', reason: 'a greeting or thanks' };
  if (turn.hasTools && CHANGE.test(text)) return { tier: 'strong', reason: 'asks for a change' };
  if (text.length > LONG_TEXT || (text.match(/\?/g) || []).length >= 3 || MULTI.test(text)) return { tier: 'strong', reason: 'a long or multi-step message' };
  if (turn.contextChars > LONG_CONTEXT) return { tier: 'strong', reason: 'a long conversation' };
  if (turn.hasTools && LOOKUP.test(text)) return { tier: 'strong', reason: 'needs the records' };
  if (turn.unaddressed) return { tier: 'light', reason: 'deciding whether to join in' };
  if (words <= 12) return { tier: 'light', reason: 'a short question' };
  return { tier: null, reason: '' };
}

const CLASSIFY = 'You route messages for a chat assistant. Answer with one word. LIGHT: a small model answers it well (small talk, a simple fact, a short answer). STRONG: it needs tools, records, careful reasoning, several steps or exact numbers.';
/**
 * The tier of one turn: rules, then (unsure, classifier on) one tiny call to the light model, else strong.
 * Returns { tier, reason, model } where model is the ref to call.
 */
export async function chooseTier(agent, turn, { chat = '' } = {}) {
  const models = tierModels(agent);
  let pick = ruleTier(turn);
  if (!pick.tier) {
    pick = { tier: 'strong', reason: 'unsure, so the strong model' };
    if (smartSettings().classifier) {
      try {
        const res = await modelChat({ model: models.light, purpose: 'background', maxTokens: 4, fallback: { enabled: false, chain: [] },
          usage: usageTag('model-choice', { agent: agent.id, chat }), system: CLASSIFY, messages: [{ role: 'user', content: clip(turn.text, 400) }] });
        const word = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
        pick = /light/i.test(word) && !/strong/i.test(word) ? { tier: 'light', reason: 'judged simple' } : { tier: 'strong', reason: 'judged complex' };
      } catch { /* the classifier failed: strong, to be safe */ }
    }
  }
  return { ...pick, model: models[pick.tier] };
}
