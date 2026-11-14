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

export function resolveModel(ref, purpose = 'bot') {
  const parsed = parseRef(ref);
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
  throw Object.assign(new Error('No model available: connect a provider and choose a default model (Models)'), { code: 'no_model' });
}

/**
 * Unified chat call. Input/output use Anthropic-style blocks.
 * Returns { content, stop_reason, usage, model: 'provider:model' }.
 */
export async function chat({ model = 'auto', purpose = 'bot', system, messages, tools = [], maxTokens = 1024 }) {
  const r = resolveModel(model, purpose);
  const p = providerById(r.provider);
  if (!p) throw Object.assign(new Error(`Unknown model provider "${r.provider}"`), { code: 'no_model' });
  if (!p.configured) throw Object.assign(new Error(`Provider "${p.name}" is not connected`), { code: 'no_model' });
  const res = await p.adapter.chat({ model: r.model, system, messages, tools, maxTokens });
  return { ...res, model: r.ref };
}
