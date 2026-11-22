// @ts-check
// Usage and cost (023). Every model call is recorded with tokens, agent, chat, provider, model and the feature that
// made it (092: FEATURES below, tagged at the call site with usageTag; stored in the `kind` column). Costs come only from prices the owner set or the provider publishes
// (e.g. OpenRouter); plan-based providers (ChatGPT plan, GitHub Copilot) are "included", free models cost 0, and
// anything else is reported as "price not set" — never guessed.
import { fail, zoneOffset } from './config.js';
import { ownerTz } from './owner-clock.js';
import { db } from './db.js';
import { getSetting, updateSettings } from './store.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, agent TEXT, chat TEXT, provider TEXT, model TEXT, kind TEXT,
    input INTEGER, output INTEGER, cost REAL, priced TEXT,
    account TEXT, fallback TEXT -- the account that answered and why the call switched (042)
  );
  CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
  -- 088: one row per answer of an agent on Smart model choice: the tier, why (a short reason, never text), what the
  -- answer cost and what the strong model would have cost (null when a price is missing). Pruned with usage detail.
  CREATE TABLE IF NOT EXISTS smart_turns (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, agent TEXT, chat TEXT, tier TEXT NOT NULL, reason TEXT, cost REAL, strong_cost REAL
  );
  CREATE INDEX IF NOT EXISTS smart_turns_ts ON smart_turns(ts);
`);
export const PLAN_PROVIDERS = { chatgpt: 'ChatGPT plan', copilot: 'Copilot allowance', claudecode: 'Claude subscription', codex: 'ChatGPT plan' };

/**
 * 092: what made a model call, for Usage → Cost per feature: [label, one line]. Every call site tags its call with
 * usageTag(feature, …); an unknown feature is a programming error. Keys of older rows (reply, summary …) stay valid.
 */
export const FEATURES = Object.freeze({
  reply: ['Agent answers', 'Answers on one model (Smart model choice off)'],
  'reply-light': ['Agent answers · light', 'Simple messages answered by the cheaper model'],
  'reply-strong': ['Agent answers · strong', 'Messages answered by the strong model'],
  judge: ['Judged group messages', 'Messages not addressed to an agent that it read to decide whether to answer (follow-ups, "when needed")'],
  'model-choice': ['Choosing light or strong', 'The tiny call that picks the model when the rules are unsure'],
  'self-check': ['Self-check rewrites', 'Answers rewritten because a figure did not match the records'],
  scheduled: ['Scheduled posts', 'Posts agents write on a schedule'],
  lessons: ['Lessons proposed', 'Turning a correction into a lesson to approve'],
  commitments: ['Promises', 'Noticing promises in chats, and when they are done'],
  'catch-up': ['Catch-ups', '“What did I miss?” on a chat'],
  summary: ['Summaries & memory', 'Running chat summaries that keep agents’ memory short'],
  transcribe: ['Voice notes in', 'Voice notes turned into text'],
  speech: ['Voice replies', 'Answers spoken as voice notes'],
  image: ['Pictures made', 'Pictures agents created'],
  'web-search': ['Web searches', 'Searches agents ran with their AI provider\'s built-in web search (the provider\'s price per search)'],
  sending: ['Sending: per-person wording', 'Each person’s own wording of a message to a list or a campaign step'],
  surveys: ['Surveys: invites', 'Each person’s own wording of a survey invite'],
  'ai-helper': ['AI helper', 'Drafting and changing agents with AI'],
  owner: ['Owner assistant', 'Your assistant on WhatsApp and the Ask box'],
  test: ['Tests', 'The test console and model tests'],
  faq: ['Built-in: FAQ', 'Answered from the FAQ, without AI (free)'],
  'quick reply': ['Built-in: quick replies', 'Quick replies and !help, without AI (free)'],
  welcome: ['Built-in: welcome', 'Welcome messages for new group members (free)'],
});
/**
 * 092: the usage tag of one model call (pass as `usage` to the providers' chat, or to recordUsage).
 * @param {string} feature a key of FEATURES @param {{ agent?: string, chat?: string }} [where]
 */
export function usageTag(feature, { agent = '', chat = '' } = {}) {
  if (!FEATURES[feature]) throw new Error(`Unknown usage feature "${feature}"`);
  return { agent: agent || '', chat: chat || '', feature };
}
const priceSetting = () => getSetting('modelPrices', {}) || {};

/** Owner-set prices in USD per 1M tokens: { "provider:model": { in, out } }. Empty values remove the price. */
export function setPrice(ref, { input, output }) {
  if (!/^[a-z][a-z0-9-]*:.+$/.test(ref)) throw fail('Model must look like provider:model');
  const all = { ...priceSetting() };
  const i = input === '' || input == null ? null : Number(input); const o = output === '' || output == null ? null : Number(output);
  if (i == null && o == null) delete all[ref];
  else {
    if (!(i >= 0) || !(o >= 0) || i > 10000 || o > 10000) throw fail('Prices are USD per million tokens (0–10000)');
    all[ref] = { in: i, out: o };
  }
  updateSettings({ modelPrices: all });
  return all[ref] || null;
}
export const listPrices = () => priceSetting();

/** { in, out, source: 'set' | 'provider' | 'free' | 'plan' } or null. `published` = price the provider lists. */
export function priceFor(provider, model, published = null) {
  const ref = `${provider}:${model}`;
  if (PLAN_PROVIDERS[provider]) return { in: 0, out: 0, source: 'plan' };
  const set = priceSetting()[ref];
  if (set) return { ...set, source: 'set' };
  if (/:free$/.test(model)) return { in: 0, out: 0, source: 'free' };
  if (published && Number.isFinite(published.in) && Number.isFinite(published.out)) return { in: published.in, out: published.out, source: 'provider' };
  return null;
}

const ins = db.prepare('INSERT INTO usage (ts, agent, chat, provider, model, kind, input, output, cost, priced, account, fallback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
/** provider = provider type (prices are per provider); account = the account that answered (042); fallback = why it switched. */
/**
 * Record one model call. Photos & voice (043): `cost` (USD) and `priced` record a cost known for the call itself —
 * reported by the provider (OpenRouter), an owner-set per-image price, or 0 for on-server engines.
 */
export function recordUsage({ agent = '', chat = '', provider, account = '', model, feature, input = 0, output = 0, published = null, fallback = '', cost: known, priced }) {
  if (!FEATURES[feature]) throw new Error(`Unknown usage feature "${feature}"`);
  const { cost, source } = costOf({ provider, model, input, output, published, known, priced });
  ins.run(Date.now(), agent || '', chat || '', provider, model, feature, input | 0, output | 0, cost, source, account || provider, String(fallback || '').slice(0, 300));
  return cost;
}
/** What a call cost and where that figure comes from: the cost known for the call itself, else its tokens at the model's price. */
function costOf({ provider, model, input, output, published, known, priced }) {
  if (known !== undefined && known !== null && Number.isFinite(Number(known))) return { cost: Number(known), source: priced || 'provider' };
  const price = priceFor(provider, model, published);
  return { cost: price ? (input * price.in + output * price.out) / 1e6 : null, source: price?.source || null };
}

const insTurn = db.prepare('INSERT INTO smart_turns (ts, agent, chat, tier, reason, cost, strong_cost) VALUES (?, ?, ?, ?, ?, ?, ?)');
/** 088: one answer on Smart model choice. */
export function recordSmartTurn({ agent, chat = '', tier, reason = '', cost = null, strongCost = null }) {
  insTurn.run(Date.now(), agent, chat, tier, String(reason).slice(0, 60), cost, strongCost);
}
/**
 * 088: Smart model choice in a period: answers per tier, cost per answer, and what the same answers would have cost on
 * the strong model ("saved"; only answers with known prices count). { tiers: { light, strong }, reasons, saved, … }.
 */
export function smartReport({ from = 0, to = Date.now(), agent = '' } = {}) {
  const where = ['ts >= ?', 'ts <= ?'];
  /** @type {(string|number)[]} */
  const args = [Number(from) || 0, Number(to) || Date.now()];
  if (agent) { where.push('agent = ?'); args.push(agent); }
  const w = where.join(' AND ');
  const tiers = Object.fromEntries(db.prepare(`SELECT tier, COUNT(*) AS answers, SUM(cost) AS cost, SUM(cost IS NOT NULL) AS priced FROM smart_turns WHERE ${w} GROUP BY tier`).all(...args)
    .map((r) => [r.tier, { answers: r.answers, cost: r.cost, perAnswer: r.priced ? r.cost / r.priced : null }]));
  const reasons = db.prepare(`SELECT tier, reason, COUNT(*) AS n FROM smart_turns WHERE ${w} GROUP BY 1, 2 ORDER BY n DESC LIMIT 12`).all(...args);
  const both = db.prepare(`SELECT COUNT(*) AS n, SUM(cost) AS cost, SUM(strong_cost) AS strong FROM smart_turns WHERE ${w} AND cost IS NOT NULL AND strong_cost IS NOT NULL`).get(...args);
  const answers = (tiers.light?.answers || 0) + (tiers.strong?.answers || 0);
  return { answers, tiers, reasons, compared: both.n || 0, perAnswer: both.n ? both.cost / both.n : null, perAnswerStrong: both.n ? both.strong / both.n : null,
    saved: both.n ? Math.max(0, both.strong - both.cost) : null };
}

const GROUPS = { agent: 'agent', chat: 'chat', provider: 'provider', account: "COALESCE(account, provider)", model: "COALESCE(account, provider) || ':' || model", feature: 'kind',
  fallback: "CASE WHEN fallback IS NULL OR fallback = '' THEN 'first choice' ELSE 'fallback' END" };
const DAY = 86400000;
/**
 * 070: the owner's day of a row as integer math. The owner's UTC offset is constant between daylight-saving changes,
 * so the offset is a short CASE over the changes in [lo, hi] (found here, to the second); a strftime(…'localtime')
 * per row cost twice as much. The key is the local day number: key * DAY as a UTC date is the local date.
 */
function localDayKey(lo, hi) {
  const tz = ownerTz();
  const off = (t) => zoneOffset(tz, t);
  const segs = []; let cur = off(lo);
  for (let t = lo + DAY; t < hi + DAY; t += DAY) {
    const at = Math.min(t, hi); const o = off(at);
    if (o === cur) continue;
    let a = t - DAY; let b = at;
    while (b - a > 1000) { const m = Math.floor((a + b) / 2); if (off(m) === cur) a = m; else b = m; }
    segs.push(`WHEN ts < ${Math.trunc(b)} THEN ${cur}`); cur = o;
  }
  return `(ts + ${segs.length ? `CASE ${segs.join(' ')} ELSE ${cur} END` : cur}) / ${DAY}`;
}

/** Totals and breakdowns for a period. */
export function usageReport({ from = 0, to = Date.now(), groupBy = 'agent', agent = '', chat = '' } = {}) {
  if (!GROUPS[groupBy] && groupBy !== 'day') throw fail('groupBy must be one of agent, chat, provider, account, model, feature, fallback, day');
  const where = ['ts >= ?', 'ts <= ?'];
  /** @type {(string|number)[]} */
  const args = [Number(from) || 0, Number(to) || Date.now()];
  if (agent) { where.push('agent = ?'); args.push(agent); }
  if (chat) { where.push('chat = ?'); args.push(chat); }
  const cols = `COUNT(*) AS calls, SUM(input) AS input, SUM(output) AS output, SUM(cost) AS cost,
    SUM(CASE WHEN priced IS NULL THEN 1 ELSE 0 END) AS unpriced, SUM(CASE WHEN priced = 'plan' THEN 1 ELSE 0 END) AS plan`;
  const total = db.prepare(`SELECT MIN(ts) AS lo, ${cols} FROM usage WHERE ${where.join(' AND ')}`).get(...args);
  const key = groupBy === 'day' ? localDayKey(Math.trunc(Number(total.lo ?? args[1])), Math.trunc(Number(args[1]))) : GROUPS[groupBy];
  const rows = db.prepare(`SELECT ${key} AS key, ${cols} FROM usage WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY ${groupBy === 'day' ? '1' : 'input + output DESC'} LIMIT 500`).all(...args);
  const clean = ({ lo: _lo, ...r }) => ({ ...r, ...(groupBy === 'day' && 'key' in r ? { key: new Date(r.key * DAY).toISOString().slice(0, 10) } : {}),
    input: r.input || 0, output: r.output || 0, cost: r.cost == null ? null : Math.round(r.cost * 1e6) / 1e6 });
  const named = (r) => (groupBy === 'feature' ? { ...r, label: FEATURES[r.key]?.[0] || r.key, line: FEATURES[r.key]?.[1] || '' } : r); // 092
  return { from: args[0], to: args[1], groupBy, total: clean(total), rows: rows.map(clean).map(named) };
}
