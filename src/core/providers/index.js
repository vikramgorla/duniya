// Provider registry (006, 042): accounts, model listing, model refs ("account:model"), auto resolution, and a unified
// chat() with automatic fallback across accounts and providers.
//
// Accounts (042): every connected provider is an account with a stable id. The first account of a type keeps the type
// id (anthropic, openai, chatgpt, copilot, openrouter); more accounts get "<type>-<label>" (openai-work, chatgpt-vik).
// A model ref "account:model" therefore names exactly one account. OpenAI-compatible endpoints are accounts too; those
// with the same base URL count as accounts of one provider.
import { getSecret, getSetting, updateSettings, setSecret, onSecretChange } from '../store.js';
import * as anthropic from './anthropic.js';
import { recordUsage } from '../usage.js';
import * as chatgpt from './chatgpt.js';
import * as copilot from './copilot.js';
import { chatCompletionsProvider } from './openai-chat.js';
import { classify, REASON_TEXT } from './errors.js';
import * as breaker from './breaker.js';
import { REF_RE, cleanChain } from './fallback-config.js';
import { bad, fail } from '../config.js';
import { accountName, modelName } from '../../panel/public/app/names.js';

export { REF_RE, FALLBACK_MODES, cleanChain, cleanOverride } from './fallback-config.js';

const RESERVED = new Set(['anthropic', 'openai', 'chatgpt', 'copilot', 'auto', 'local', 'memory']);
export const COMPAT_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const keySecretFor = (id) => `PROVIDER_${id.toUpperCase().replace(/-/g, '_')}_KEY`;
const OPENAI_BASE = () => (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');

export const compatibleList = () => getSetting('providers', []) || [];

// ---------- built-in provider types ----------
export const TYPES = Object.freeze({
  anthropic: { secret: anthropic.SECRET },
  openai: { secret: 'OPENAI_API_KEY' },
  chatgpt: { secret: chatgpt.SECRET },
  copilot: { secret: copilot.SECRET },
  openrouter: {},
});
const BUILTIN = ['anthropic', 'openai', 'chatgpt', 'copilot'];
export const STRATEGIES = ['order', 'spread'];

/** Extra accounts of built-in types and labels of first accounts: [{ id, type, label }]. */
const accountEntries = () => (getSetting('accounts', []) || []).filter((a) => a && BUILTIN.includes(a.type) && COMPAT_ID_RE.test(a.id || ''));
/** Where an account's credentials live. First accounts keep the classic secret names. */
export function secretFor(type, id) {
  if (id === type && TYPES[type]?.secret) return TYPES[type].secret;
  const base = `PROVIDER_${id.toUpperCase().replace(/-/g, '_')}`;
  return type === 'chatgpt' ? `${base}_CREDENTIALS` : `${base}_KEY`;
}

// ---------- OpenRouter preset (018) ----------
export const OPENROUTER_ID = 'openrouter';
const OPENROUTER_BASE = () => (process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1');
export const isFreeModel = (id) => /:free$/.test(String(id || ''));

/** Wrap an adapter so only free models (ids ending ":free") are listed and used. */
function freeOnlyAdapter(adapter, name) {
  return {
    streams: !!adapter.streams,
    async listModels() { return (await adapter.listModels()).filter((m) => isFreeModel(m.id)); },
    async chat(args) {
      if (!isFreeModel(args.model)) throw Object.assign(new Error(`“Free models only” is on for ${name}: choose a model ending in :free, or turn the switch off (Models)`), { code: 'free_only' });
      return adapter.chat(args);
    },
  };
}

/** One-tap OpenRouter: an OpenAI-compatible endpoint with id "openrouter"; key optional when only toggling. */
export function addOpenRouter({ key, freeOnly, label } = {}) {
  const lab = cleanLabel(label);
  if (lab) { // another OpenRouter account (042)
    if (!String(key || '').trim()) throw bad('Paste the key of the other OpenRouter account (it starts with sk-or-)', 'key');
    const id = newAccountId('openrouter', lab);
    addCompatible({ id, name: 'OpenRouter', baseUrl: OPENROUTER_BASE(), key: String(key).trim(), preset: 'openrouter', label: lab });
    return setFreeOnly(id, freeOnly === undefined ? true : !!freeOnly);
  }
  const existing = compatibleList().find((p) => p.id === OPENROUTER_ID);
  if (!existing && !String(key || '').trim()) throw bad('Paste your OpenRouter key (it starts with sk-or-)', 'key');
  const prov = addCompatible({ id: OPENROUTER_ID, name: 'OpenRouter', baseUrl: OPENROUTER_BASE(), preset: 'openrouter', ...(existing?.label ? { label: existing.label } : {}), ...(String(key || '').trim() ? { key: String(key).trim() } : {}) });
  return setFreeOnly(OPENROUTER_ID, freeOnly === undefined ? (existing ? !!existing.freeOnly : true) : !!freeOnly) || prov;
}
export function setFreeOnly(id, on) {
  const list = compatibleList().map((p) => (p.id === id ? { ...p, freeOnly: !!on } : p));
  updateSettings({ providers: list });
  modelCache.delete(id);
  return list.find((p) => p.id === id);
}

function builtinAdapter(type, secret) {
  if (type === 'anthropic') return anthropic.anthropicAdapter(secret);
  if (type === 'openai') return chatCompletionsProvider({ baseUrl: OPENAI_BASE(), key: () => getSecret(secret), official: true });
  if (type === 'chatgpt') return chatgpt.chatgptAdapter(secret);
  return copilot.copilotAdapter(secret);
}
const configuredFor = (type, secret) => (type === 'chatgpt' ? chatgpt.configured(secret) : !!getSecret(secret));

/**
 * All accounts with their adapter and whether they're configured, in the order Auto tries them: built-in types
 * (first account, then the others), then OpenRouter and other endpoints. Unconnected first accounts are listed too.
 */
export function providers() {
  const entries = accountEntries();
  const list = [];
  for (const type of BUILTIN) {
    const firstLabel = entries.find((a) => a.id === type)?.label || '';
    const accts = [{ id: type, label: firstLabel }, ...entries.filter((a) => a.type === type && a.id !== type)];
    for (const a of accts) {
      const secret = secretFor(type, a.id);
      const row = { id: a.id, type, group: type, primary: a.id === type, label: a.label || '', name: accountName(type, a.label), secret,
        configured: configuredFor(type, secret), adapter: builtinAdapter(type, secret) };
      if (type === 'chatgpt') row.account = chatgpt.credentials(secret)?.email || '';
      if (a.id !== type && !row.configured) continue; // an extra account without credentials is not listed
      list.push(row);
    }
  }
  for (const p of compatibleList()) {
    const type = p.preset === 'openrouter' || p.id === OPENROUTER_ID ? 'openrouter' : 'compatible';
    const name = type === 'openrouter' ? accountName('openrouter', p.label) : (p.name || p.id);
    const secret = keySecretFor(p.id);
    const base = chatCompletionsProvider({ baseUrl: p.baseUrl, key: () => getSecret(secret) });
    list.push({
      id: p.id, type, group: type === 'openrouter' ? 'openrouter' : `compatible:${String(p.baseUrl).toLowerCase()}`, primary: type !== 'openrouter' || p.id === OPENROUTER_ID,
      label: p.label || '', name, baseUrl: p.baseUrl, configured: true, freeOnly: !!p.freeOnly, secret,
      adapter: p.freeOnly ? freeOnlyAdapter(base, name) : base,
    });
  }
  return list;
}
const providerById = (id) => providers().find((p) => p.id === id);
export const accountById = providerById;

// Credentials changed: forget that account's pause / "needs reconnect" state.
onSecretChange((name) => { for (const p of providers()) if (p.secret === name) breaker.reset(p.id); });

// ---------- accounts (042) ----------
const cleanLabel = (v) => String(v || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
const slug = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
const takenIds = () => new Set([...BUILTIN, ...RESERVED, OPENROUTER_ID, ...accountEntries().map((a) => a.id), ...compatibleList().map((p) => p.id)]);
/** A new stable account id: "<type>-<label>" (made unique). */
export function newAccountId(type, label) {
  const base = `${type}-${slug(label) || 'account'}`.slice(0, 28).replace(/-+$/, '');
  const taken = takenIds();
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  throw bad('Too many accounts with this label', 'label');
}

/** Register another account of a built-in type (anthropic, openai, copilot; chatgpt after its sign-in). */
export function addAccount({ type, label, key, id: givenId }) {
  if (!BUILTIN.includes(type)) throw bad('Type must be anthropic, openai, chatgpt or copilot', 'type');
  const lab = cleanLabel(label);
  if (!lab) throw bad('Give the account a label, e.g. “work” or your name', 'label');
  if (accountEntries().some((a) => a.type === type && a.id !== type && a.label.toLowerCase() === lab.toLowerCase())) throw bad(`There is already a ${accountName(type)} account called “${lab}”`, 'label');
  const id = givenId || newAccountId(type, lab);
  updateSettings({ accounts: [...accountEntries().filter((a) => a.id !== id), { id, type, label: lab }] });
  if (key !== undefined) setSecret(secretFor(type, id), String(key || ''));
  modelCache.delete(id);
  return providerById(id) || { id, type, label: lab, name: accountName(type, lab), configured: false };
}

/** Rename any account (the id stays). */
export function renameAccount(id, label) {
  const lab = cleanLabel(label);
  const p = providerById(id);
  if (!p) throw bad('No such account', 'id', 404);
  if (p.type === 'openrouter' || p.type === 'compatible') {
    updateSettings({ providers: compatibleList().map((x) => (x.id === id ? (p.type === 'openrouter' ? { ...x, label: lab } : { ...x, name: lab || x.id }) : x)) });
  } else {
    const rest = accountEntries().filter((a) => a.id !== id);
    updateSettings({ accounts: lab || !p.primary ? [...rest, { id, type: p.type, label: lab || p.label }] : rest });
  }
  return providerById(id);
}

/** Remove an extra account (first accounts are disconnected with their own buttons). */
export async function removeAccount(id) {
  const p = providerById(id) || accountEntries().find((a) => a.id === id);
  if (!p) throw bad('No such account', 'id', 404);
  if (p.type === 'openrouter' || p.type === 'compatible') removeCompatible(id);
  else {
    if (id === p.type) throw bad('Disconnect the first account with its own button', 'id');
    const secret = secretFor(p.type, id);
    if (p.type === 'chatgpt') await chatgpt.disconnect(secret);
    else if (p.type === 'copilot') copilot.disconnect(secret);
    else setSecret(secret, '');
    updateSettings({ accounts: accountEntries().filter((a) => a.id !== id) });
  }
  modelCache.delete(id); extrasCache.delete(id); breaker.reset(id); lastUsed.delete(id);
  return { ok: true };
}

/** "order" (failover, default) or "spread" (least recently used first) per provider (group). */
export const strategies = () => getSetting('accountStrategy', {}) || {};
export function setStrategy(group, strategy) {
  if (!STRATEGIES.includes(strategy)) throw bad('Strategy must be order or spread', 'strategy');
  if (!group || String(group).length > 300) throw bad('Which provider?', 'group');
  const next = { ...strategies() };
  if (strategy === 'order') delete next[group]; else next[group] = strategy;
  updateSettings({ accountStrategy: next });
  return next;
}

export function addCompatible({ id, name, baseUrl, key, preset, label }) {
  if (!COMPAT_ID_RE.test(id || '') || RESERVED.has(id)) throw fail('id: 2–31 lowercase letters/digits/-, not a reserved name', 400, { field: 'id' });
  if (accountEntries().some((a) => a.id === id)) throw bad('That id is used by another account', 'id');
  try { const u = new URL(baseUrl); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { throw fail('baseUrl must be an http(s) URL', 400, { field: 'baseUrl' }); }
  const before = compatibleList().find((p) => p.id === id);
  const list = compatibleList().filter((p) => p.id !== id);
  const lab = cleanLabel(label ?? before?.label);
  list.push({ id, name: String(name || id).slice(0, 60), baseUrl: baseUrl.replace(/\/+$/, ''), ...(before?.freeOnly ? { freeOnly: true } : {}),
    ...(preset || before?.preset ? { preset: preset || before.preset } : {}), ...(lab ? { label: lab } : {}) });
  updateSettings({ providers: list });
  if (key !== undefined) setSecret(keySecretFor(id), String(key || ''));
  modelCache.delete(id);
  return list.find((p) => p.id === id);
}
export function removeCompatible(id) {
  updateSettings({ providers: compatibleList().filter((p) => p.id !== id) });
  setSecret(keySecretFor(id), '');
  modelCache.delete(id); breaker.reset(id);
}

// ---------- models ----------
const modelCache = new Map(); // providerId -> { at, models, error }
export async function providerModels(p, { refresh = false } = {}) {
  const hit = modelCache.get(p.id);
  if (!refresh && hit && Date.now() - hit.at < 10 * 60000) return hit;
  let entry;
  try { entry = { at: Date.now(), models: await p.adapter.listModels(), error: null }; } catch (e) { entry = { at: Date.now(), models: [], error: e.message }; }
  modelCache.set(p.id, entry);
  return entry;
}
export const clearModelCache = (id) => (id ? modelCache.delete(id) : modelCache.clear());

export async function status({ refresh = false } = {}) {
  const out = [];
  const strat = strategies();
  const groups = new Map();
  for (const p of providers()) if (p.configured) groups.set(p.group, (groups.get(p.group) || 0) + 1);
  for (const p of providers()) {
    const row = { id: p.id, type: p.type, name: p.name, label: p.label, primary: p.primary, group: p.group, connected: false, models: 0,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}), ...(p.account ? { account: p.account } : {}), ...(p.type === 'compatible' || p.type === 'openrouter' ? { freeOnly: p.freeOnly } : {}) };
    if (p.configured) {
      const m = await providerModels(p, { refresh });
      row.connected = !m.error; row.models = m.models.length; if (m.error) row.error = m.error;
      if (row.connected && p.type === 'copilot') Object.assign(row, await copilotExtras(p, { refresh }));
      row.health = breaker.accountState(p.id); // 042: { state: ok | paused | probing | reconnect, text }
      row.accounts = groups.get(p.group) || 1;
      row.strategy = strat[p.group] || 'order';
      if (lastUsed.has(p.id)) row.lastUsed = lastUsed.get(p.id);
    }
    out.push(row);
  }
  return out;
}

const extrasCache = new Map(); // account id -> { at, value }
async function copilotExtras(p, { refresh }) {
  const hit = extrasCache.get(p.id);
  if (!refresh && hit && Date.now() - hit.at < 5 * 60000) return hit.value;
  const [account, quota] = await Promise.all([copilot.account(p.secret), copilot.quota(p.secret).catch(() => null)]);
  const value = { ...(account ? { account } : {}), ...(quota ? { quota } : {}) };
  extrasCache.set(p.id, { at: Date.now(), value });
  return value;
}
export function clearCopilotExtras(id) { if (id) extrasCache.delete(id); else extrasCache.clear(); }

export async function allModels({ refresh = false } = {}) {
  const out = [];
  for (const p of providers()) {
    if (!p.configured) continue;
    const m = await providerModels(p, { refresh });
    for (const x of m.models) out.push({ ref: `${p.id}:${x.id}`, provider: p.id, type: p.type, label: `${p.name} · ${modelName(x.id, x.label)}` });
  }
  return out;
}

/** "auto" | "account:model" → { provider (account id), model, ref }; "auto" (or anything without an account) → null */
export function parseRef(ref) {
  const s = String(ref || 'auto');
  const i = s.indexOf(':');
  if (i < 0) return null;
  return { provider: s.slice(0, i), model: s.slice(i + 1), ref: s };
}

const NOT_CHAT = /embed|whisper|tts|dall-e|image|audio|moderation|realtime|transcri|search|davinci|babbage|codex-mini/i;
const SMALL = /mini|nano|haiku|flash|small|lite/i;
/** Auto choice from a provider's list: the first chat model (a small one for background work, when there is one). */
export function autoPick(models, purpose = 'agent') {
  const chat = models.map((m) => m.id).filter((id) => id && !NOT_CHAT.test(id));
  if (!chat.length) return null;
  if (purpose === 'background') return chat.find((id) => SMALL.test(id)) || chat[0];
  return chat.find((id) => !SMALL.test(id)) || chat[0];
}
/** An account's Auto model (from its cached list; Anthropic has fixed recommendations). */
const autoFor = (p, purpose) => (p.type === 'anthropic' ? anthropic.RECOMMENDED[purpose === 'background' ? 'background' : 'agent'] : autoPick(modelCache.get(p.id)?.models || [], purpose));

/** Make sure model lists of connected accounts are loaded (cached 10 min), so "auto" can choose. Paused accounts wait. */
export async function warmModels() {
  await Promise.all(providers().filter((p) => p.configured && p.type !== 'anthropic' && !breaker.isPaused(p.id)).map((p) => providerModels(p)));
}

/** The model a ref means right now (without fallback). */
export function resolveModel(ref, purpose = 'agent') {
  const parsed = parseRef(ref);
  if (parsed && parsed.model === 'auto') { // "account:auto": that account's best model
    const p = providerById(parsed.provider);
    if (!p?.configured) throw Object.assign(new Error(`Provider "${parsed.provider}" is not connected`), { code: 'no_model' });
    const pick = autoFor(p, purpose);
    if (!pick) throw Object.assign(new Error(`No usable model listed by ${p.name}`), { code: 'no_model' });
    return parseRef(`${parsed.provider}:${pick}`);
  }
  if (parsed) return parsed;
  const all = providers().filter((p) => p.configured);
  const setting = purpose === 'background'
    ? getSetting('backgroundModel', process.env.SUMMARY_MODEL || 'auto')
    : getSetting('defaultModel', process.env.DEFAULT_MODEL || 'auto');
  const fromSetting = parseRef(setting);
  if (fromSetting && all.some((p) => p.id === fromSetting.provider)) {
    if (fromSetting.model !== 'auto') return fromSetting;
    const p = all.find((x) => x.id === fromSetting.provider); const pick = autoFor(p, purpose);
    if (pick) return parseRef(`${p.id}:${pick}`);
  }
  const firstAnthropic = all.find((p) => p.type === 'anthropic');
  if (purpose === 'background') {
    if (firstAnthropic) return parseRef(`${firstAnthropic.id}:${anthropic.RECOMMENDED.background}`);
    const def = parseRef(getSetting('defaultModel', 'auto'));
    if (def && def.model !== 'auto' && all.some((p) => p.id === def.provider)) return def;
  }
  // Any connected account: Anthropic first, then the others in the order they are listed.
  for (const p of firstAnthropic ? [firstAnthropic, ...all.filter((x) => x !== firstAnthropic)] : all) {
    const pick = autoFor(p, purpose);
    if (pick) return parseRef(`${p.id}:${pick}`);
  }
  throw Object.assign(new Error('No model available: connect a provider and choose a default model (Models)'), { code: 'no_model' });
}

// ---------- fallback (042) ----------
/** Global fallback settings: { enabled (default on), chain: ["account:model" | "account:auto", …] (empty = any other connected account's Auto) }. */
export function fallbackSettings() {
  const f = getSetting('fallback', null) || {};
  return { enabled: f.enabled !== false, chain: Array.isArray(f.chain) ? f.chain.filter((r) => REF_RE.test(r)) : [] };
}
export function setFallbackSettings({ enabled, chain } = {}) {
  const cur = fallbackSettings();
  const next = { enabled: enabled === undefined ? cur.enabled : !!enabled, chain: chain === undefined ? cur.chain : cleanChain(chain) };
  updateSettings({ fallback: next });
  return next;
}
/**
 * The fallback that applies to a call: global settings, then the agent's override, then the chat's (the most specific
 * wins). Returns { enabled, chain, source: global | agent | chat }.
 */
export function effectiveFallback({ agent = null, chatPrefs = null } = {}) {
  const g = fallbackSettings();
  const out = { ...g, source: 'global' };
  for (const [src, o] of [['agent', agent?.fallback], ['chat', chatPrefs?.fallback]]) {
    if (!o) continue;
    if (o.mode && o.mode !== 'inherit') { out.enabled = o.mode === 'on'; out.source = src; }
    if (o.chain?.length) { out.chain = o.chain; out.source = src; }
  }
  return out;
}

const lastUsed = new Map(); // account id -> last time it was called (shown on Models)
const useOrder = new Map(); // account id -> call sequence number (for "spread": least recently used first)
let useSeq = 0;

/** Same model on the other accounts of the same provider, ordered by that provider's strategy. */
function siblings(p, all, strat) {
  const same = all.filter((x) => x.group === p.group);
  if ((strat[p.group] || 'order') === 'spread') {
    return same.map((x, i) => ({ x, i })).sort((a, b) => (useOrder.get(a.x.id) || 0) - (useOrder.get(b.x.id) || 0) || a.i - b.i).map((o) => o.x);
  }
  return [p, ...same.filter((x) => x !== p)];
}

/**
 * Candidates for one model call, in the order they are tried: [{ id (account), model ('auto' or model id) }].
 * 1. the chosen model (Auto: the default model) — on each account of its provider, by the provider's strategy;
 * 2. if fallback is on: the chain (or, when empty, every other connected account's Auto), expanded the same way.
 * `sticky` (a ref that already answered in this turn) goes first, so a turn stays on one account.
 */
export function planCandidates({ model = 'auto', purpose = 'agent', fallback = fallbackSettings(), sticky = '' } = {}) {
  const all = providers().filter((p) => p.configured);
  const strat = strategies();
  const parsed = parseRef(model);
  const first = [];
  if (parsed) first.push({ id: parsed.provider, model: parsed.model });
  else { try { const r = resolveModel('auto', purpose); first.push({ id: r.provider, model: r.model }); } catch { /* nothing resolvable: the chain decides */ } }
  const chain = !fallback.enabled ? [] : fallback.chain.length
    ? fallback.chain.map((r) => parseRef(r)).filter(Boolean).map((r) => ({ id: r.provider, model: r.model }))
    : all.map((p) => ({ id: p.id, model: 'auto' }));
  const out = []; const seen = new Set();
  const push = (c) => { const k = `${c.id}:${c.model}`; if (!seen.has(k)) { seen.add(k); out.push(c); } };
  const st = parseRef(sticky);
  if (st) push({ id: st.provider, model: st.model });
  for (const c of [...first, ...chain]) {
    const p = all.find((x) => x.id === c.id);
    if (!p) { push(c); continue; } // not connected: reported as unavailable when tried
    for (const s of siblings(p, all, strat)) push({ id: s.id, model: c.model });
  }
  return out;
}

const describeFailures = (failures) => failures.map((f) => `${f.name} (${f.paused ? 'paused: ' : ''}${REASON_TEXT[f.reason] || f.reason})`).join(', ');

/**
 * Unified chat call with automatic fallback (042). Input/output use Anthropic-style blocks.
 * Returns { content, stop_reason, usage, model: 'account:model', account, answeredBy, failures: [{ ref, name, reason }] }.
 * Fallback happens per model call: the caller's conversation (incl. tool results) is sent unchanged to the next
 * candidate, so tools that already ran never run again. Only retryable errors move on (see errors.js).
 * opts: fallback ({ enabled, chain }), turn ({ ref } shared by the calls of one agent turn), direct (one account, no
 * fallback, ignores pauses — the Test button), accept (async ref → bool: candidates it refuses are skipped, e.g. models
 * that cannot see the photo of this turn, #67; they are listed in err.skipped when nothing answered), lastResort
 * (refs tried after the chain when fallback is on, e.g. the vision fallback model).
 * Streaming (047, #83): onText(delta) gets the answer's text as it arrives, from adapters that stream (Anthropic,
 * OpenAI-compatible, OpenRouter, ChatGPT; Copilot answers whole). Nothing reaches onText before an account's first
 * token, so a stream that fails before it falls back as usual. A failure after the first token calls
 * onRestart({ reason, account }) — the caller drops the partial text — and the same account is asked once more without
 * streaming, then the chain continues without streaming. Usage is recorded once, from the answer that is returned.
 */
export async function chat({ model = 'auto', purpose = 'agent', system, messages, tools = [], maxTokens = 1024, usage = {}, fallback, turn = null, direct = false, accept = null, lastResort = [], onText = null, onRestart = null }) {
  let streamOn = typeof onText === 'function';
  if (!direct && (!parseRef(model) || parseRef(model).model === 'auto')) await warmModels();
  const fb = direct ? { enabled: false, chain: [] } : (fallback || fallbackSettings());
  const cands = direct ? [{ id: parseRef(model)?.provider, model: parseRef(model)?.model }] : planCandidates({ model, purpose, fallback: fb, sticky: turn?.ref || '' });
  if (!direct && fb.enabled) {
    for (const r of lastResort.map((x) => parseRef(x)).filter(Boolean)) if (!cands.some((c) => c.id === r.provider && c.model === r.model)) cands.push({ id: r.provider, model: r.model });
  }
  const failures = []; const paused = []; let lastErr = null; let configErr = null;
  const skipped = []; // refused by `accept` (#67)
  const tried = new Set();
  // A paused account counts as a reason for the switch ("after Anthropic (paused: usage limit reached)").
  const notePaused = (p) => {
    if (paused.some((x) => x.id === p.id)) return;
    paused.push(p);
    if (failures.some((f) => f.account === p.id)) return; // it already failed in this call
    failures.push({ ref: `${p.id}:auto`, account: p.id, name: p.name, reason: breaker.accountState(p.id).reason || 'server', paused: true });
  };
  // Second pass (last resort): when every candidate was paused and nothing was tried, accounts paused for a
  // transient error (outage, network, timeout) are tried once anyway — there is no one else to ask. Accounts paused
  // for limits, quota or sign-in stay paused.
  const TRANSIENT = new Set(['server', 'network', 'timeout']);
  for (const pass of [0, 1]) {
    if (pass === 1 && (lastErr || !paused.some((x) => TRANSIENT.has(breaker.accountState(x.id).reason)))) break;
    const force = pass === 1 ? new Set(paused.filter((x) => TRANSIENT.has(breaker.accountState(x.id).reason)).map((x) => x.id)) : new Set();
    for (const c of cands) {
      if (pass === 1 && !force.has(c.id)) continue;
      const p = providerById(c.id);
      if (pass === 0 && (!p || !p.configured)) {
        configErr ??= Object.assign(new Error(p ? `Provider "${p.name}" is not connected` : `Unknown model provider "${c.id}"`), { code: 'no_model' });
        failures.push({ ref: `${c.id}:${c.model}`, account: c.id, name: p?.name || c.id, reason: 'unavailable' });
        continue;
      }
      if (!p?.configured) continue;
      if (!direct && !force.has(p.id) && breaker.isPaused(p.id, { name: p.name })) { notePaused(p); continue; }
      let modelId = c.model;
      if (modelId === 'auto') {
        if (p.type !== 'anthropic') await providerModels(p);
        modelId = autoFor(p, purpose);
        if (!modelId) { configErr ??= Object.assign(new Error(`No usable model listed by ${p.name}`), { code: 'no_model' }); continue; }
      }
      const ref = `${p.id}:${modelId}`;
      if (tried.has(ref)) continue;
      if (accept && !direct && !(await accept(ref))) {
        if (!skipped.some((x) => x.ref === ref)) skipped.push({ ref, account: p.id, name: p.name });
        continue;
      }
      if (!direct && !force.has(p.id) && !breaker.canTry(p.id, { name: p.name })) { notePaused(p); continue; }
      tried.add(ref);
      lastUsed.set(p.id, Date.now()); useOrder.set(p.id, ++useSeq);
      let res;
      const args = { model: modelId, system, messages, tools, maxTokens };
      let started = false; // 047: this account already sent text to onText
      const streamed = streamOn && p.adapter.streams ? { ...args, onText: (d) => { started = true; try { onText(d); } catch { /* a closed stream must not break the call */ } } } : null;
      try {
        try {
          res = await p.adapter.chat(streamed || args);
        } catch (e) {
          if (!started) throw e;
          // Failed after the first token (047): the caller drops the partial text (onRestart) and this account is asked
          // once more without streaming; if that fails too, the normal fallback continues, without streaming.
          streamOn = false;
          try { onRestart?.({ reason: classify(e).reason, account: p.id }); } catch { /* ignore */ }
          res = await p.adapter.chat(args);
        }
      } catch (e) {
        const cls = classify(e);
        if (cls.breaker) breaker.recordFailure(p.id, cls, { name: p.name, message: e.message });
        else breaker.release(p.id);
        lastErr = e;
        failures.push({ ref, account: p.id, name: p.name, reason: cls.reason, message: String(e.message || '').slice(0, 200) });
        if (!cls.next || direct) { e.failures = failures; e.fallbackReason = cls.reason; throw e; }
        continue;
      }
      breaker.recordSuccess(p.id, { name: p.name });
      const failed = failures.filter((f) => f.reason !== 'unavailable' && !(f.paused && f.account === p.id));
      const fbText = failed.length ? `after ${describeFailures(failed)}` : '';
      try { // usage & cost (023): the account and model that actually answered, and why it switched (042)
        const published = modelCache.get(p.id)?.models?.find((m) => m.id === modelId)?.price || null;
        recordUsage({ ...usage, kind: usage.kind || (purpose === 'background' ? 'summary' : 'reply'), provider: p.type === 'compatible' ? p.id : p.type, account: p.id, model: modelId,
          input: res.usage?.input_tokens || 0, output: res.usage?.output_tokens || 0, published, fallback: fbText });
      } catch { /* never fail a reply because of bookkeeping */ }
      const firstFail = failed.find((f) => f.account !== p.id);
    if (firstFail) breaker.noteSwitch({ from: firstFail.name, to: p.name, reason: firstFail.reason, agent: usage.agent, chat: usage.chat });
      if (turn) turn.ref = ref;
      return { ...res, model: ref, account: p.id, answeredBy: p.name, failures: failed };
    }
  }
  // Nothing answered.
  const failed = failures.filter((f) => f.reason !== 'unavailable');
  let err = lastErr;
  if (!err && paused.length) {
    const until = breaker.nextTry(paused.map((p) => p.id));
    const st = breaker.accountState(paused[0].id);
    err = Object.assign(new Error(`All usable AI providers are paused (${paused.map((p) => `${p.name}: ${breaker.accountState(p.id).text}`).join('; ')})`), { code: 'all_paused', until, fallbackReason: st.reason });
  }
  if (!err) err = configErr || Object.assign(new Error('No model available: connect a provider and choose a default model (Models)'), { code: 'no_model' });
  err.failures = failures;
  err.skipped = skipped;
  if (lastErr) err.fallbackReason ??= classify(lastErr).reason;
  if (failed.length) breaker.allFailed(describeFailures(failed));
  throw err;
}

/** Connection test (018): send "Say hi" to one account (its Auto model unless one is given); reply + latency. */
export async function testProvider(id, model) {
  const p = providerById(id);
  if (!p) throw fail(`Unknown model provider "${id}"`, 404);
  if (!p.configured) throw fail(`${p.name} is not connected yet`);
  const started = Date.now();
  try {
    if (!model) await providerModels(p);
    const res = await chat({ model: model ? `${id}:${model}` : `${id}:auto`, purpose: 'background', maxTokens: 60, usage: { kind: 'test' }, direct: true,
      system: 'You are checking a connection. Answer in one short friendly sentence.', messages: [{ role: 'user', content: 'Say hi' }] });
    const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { ok: true, model: res.model, reply: reply.slice(0, 500) || '(empty reply)', ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e.message, ms: Date.now() - started };
  }
}
