// Provider registry (006): model listing, model refs ("provider:model"), auto resolution, unified chat().
import { getSecret, getSetting, updateSettings, setSecret } from '../store.js';
import * as anthropic from './anthropic.js';
import * as chatgpt from './chatgpt.js';
import { chatCompletionsProvider } from './openai-chat.js';

const RESERVED = new Set(['anthropic', 'openai', 'chatgpt', 'auto', 'local', 'memory']);
export const COMPAT_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const keySecretFor = (id) => `PROVIDER_${id.toUpperCase().replace(/-/g, '_')}_KEY`;
const OPENAI_BASE = () => (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');

const openai = chatCompletionsProvider({ baseUrl: OPENAI_BASE(), key: () => getSecret('OPENAI_API_KEY'), official: true });

export const compatibleList = () => getSetting('providers', []) || [];

/** All providers with their adapter and whether they're configured. */
export function providers() {
  const list = [
    { id: 'anthropic', type: 'anthropic', name: 'Anthropic (Claude)', configured: anthropic.configured(), adapter: anthropic },
    { id: 'openai', type: 'openai', name: 'OpenAI (API key)', configured: !!getSecret('OPENAI_API_KEY'), adapter: openai },
    { id: 'chatgpt', type: 'chatgpt', name: 'ChatGPT plan (Sign in with ChatGPT)', configured: chatgpt.configured(), adapter: chatgpt, account: chatgpt.credentials()?.email || '' },
  ];
  for (const p of compatibleList()) {
    list.push({
      id: p.id, type: 'compatible', name: p.name || p.id, baseUrl: p.baseUrl, configured: true,
      adapter: chatCompletionsProvider({ baseUrl: p.baseUrl, key: () => getSecret(keySecretFor(p.id)) }),
    });
  }
  return list;
}
const providerById = (id) => providers().find((p) => p.id === id);

export function addCompatible({ id, name, baseUrl, key }) {
  if (!COMPAT_ID_RE.test(id || '') || RESERVED.has(id)) throw Object.assign(new Error('id: 2–31 lowercase letters/digits/-, not a reserved name'), { status: 400, field: 'id' });
  try { const u = new URL(baseUrl); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { throw Object.assign(new Error('baseUrl must be an http(s) URL'), { status: 400, field: 'baseUrl' }); }
  const list = compatibleList().filter((p) => p.id !== id);
  list.push({ id, name: String(name || id).slice(0, 60), baseUrl: baseUrl.replace(/\/+$/, '') });
  updateSettings({ providers: list });
  if (key !== undefined) setSecret(keySecretFor(id), String(key || ''));
  modelCache.delete(id);
  return list.find((p) => p.id === id);
}
export function removeCompatible(id) {
  updateSettings({ providers: compatibleList().filter((p) => p.id !== id) });
  setSecret(keySecretFor(id), '');
  modelCache.delete(id);
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
  for (const p of providers()) {
    const row = { id: p.id, type: p.type, name: p.name, connected: false, models: 0, ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}), ...(p.account ? { account: p.account } : {}) };
    if (p.configured) {
      const m = await providerModels(p, { refresh });
      row.connected = !m.error; row.models = m.models.length; if (m.error) row.error = m.error;
    }
    out.push(row);
  }
  return out;
}

export async function allModels({ refresh = false } = {}) {
  const out = [];
  for (const p of providers()) {
    if (!p.configured) continue;
    const m = await providerModels(p, { refresh });
    for (const x of m.models) out.push({ ref: `${p.id}:${x.id}`, provider: p.id, label: `${p.name} · ${x.label}` });
  }
  return out;
}

/** "auto" | "provider:model" | legacy bare Claude id → { provider, model, ref } */
export function parseRef(ref) {
  const s = String(ref || 'auto');
  if (s === 'auto') return null;
  const i = s.indexOf(':');
  if (i < 0) return { provider: 'anthropic', model: s, ref: `anthropic:${s}` };
  return { provider: s.slice(0, i), model: s.slice(i + 1), ref: s };
}

const NOT_CHAT = /embed|whisper|tts|dall-e|image|audio|moderation|realtime|transcri|search|davinci|babbage|codex-mini/i;
const SMALL = /mini|nano|haiku|flash|small|lite/i;
/** Auto choice from a provider's list: the first chat model (a small one for background work, when there is one). */
export function autoPick(models, purpose = 'bot') {
  const chat = models.map((m) => m.id).filter((id) => id && !NOT_CHAT.test(id));
  if (!chat.length) return null;
  if (purpose === 'background') return chat.find((id) => SMALL.test(id)) || chat[0];
  return chat.find((id) => !SMALL.test(id)) || chat[0];
}

/** Make sure model lists of connected providers are loaded (cached 10 min), so "auto" can choose. */
export async function warmModels() {
  await Promise.all(providers().filter((p) => p.configured && p.id !== 'anthropic').map((p) => providerModels(p)));
}

export function resolveModel(ref, purpose = 'bot') {
  const parsed = parseRef(ref);
  if (parsed && parsed.model === 'auto') { // "provider:auto": that provider's best model
    const p = providerById(parsed.provider);
    if (!p?.configured) throw Object.assign(new Error(`Provider "${parsed.provider}" is not connected`), { code: 'no_model' });
    const pick = parsed.provider === 'anthropic' ? anthropic.RECOMMENDED[purpose === 'background' ? 'background' : 'bot'] : autoPick(modelCache.get(p.id)?.models || [], purpose);
    if (!pick) throw Object.assign(new Error(`No usable model listed by ${p.name}`), { code: 'no_model' });
    return parseRef(`${parsed.provider}:${pick}`);
  }
  if (parsed) return parsed;
  const setting = purpose === 'background'
    ? getSetting('backgroundModel', process.env.SUMMARY_MODEL || 'auto')
    : getSetting('defaultModel', process.env.DEFAULT_MODEL || 'auto');
  const fromSetting = parseRef(setting);
  if (fromSetting && providerById(fromSetting.provider)?.configured) return fromSetting;
  if (purpose === 'background') {
    const def = parseRef(getSetting('defaultModel', 'auto'));
    if (anthropic.configured()) return parseRef(`anthropic:${anthropic.RECOMMENDED.background}`);
    if (def && providerById(def.provider)?.configured) return def;
  }
  if (anthropic.configured()) return parseRef(`anthropic:${anthropic.RECOMMENDED.bot}`);
  // Any other connected provider: pick from its (cached) model list, in the order providers are listed.
  for (const p of providers()) {
    if (!p.configured || p.id === 'anthropic') continue;
    const pick = autoPick(modelCache.get(p.id)?.models || [], purpose);
    if (pick) return parseRef(`${p.id}:${pick}`);
  }
  throw Object.assign(new Error('No model available: connect a provider and choose a default model (Models)'), { code: 'no_model' });
}

/**
 * Unified chat call. Input/output use Anthropic-style blocks.
 * Returns { content, stop_reason, usage, model: 'provider:model' }.
 */
export async function chat({ model = 'auto', purpose = 'bot', system, messages, tools = [], maxTokens = 1024 }) {
  if (!parseRef(model) || parseRef(model).model === 'auto') await warmModels();
  const r = resolveModel(model, purpose);
  const p = providerById(r.provider);
  if (!p) throw Object.assign(new Error(`Unknown model provider "${r.provider}"`), { code: 'no_model' });
  if (!p.configured) throw Object.assign(new Error(`Provider "${p.name}" is not connected`), { code: 'no_model' });
  const res = await p.adapter.chat({ model: r.model, system, messages, tools, maxTokens });
  return { ...res, model: r.ref };
}
