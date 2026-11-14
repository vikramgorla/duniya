// Bot configuration: defaults, validation and normalisation (005). Single source of truth for bot shape.
import { digits } from './config.js';

export const BOT_DEFAULTS = Object.freeze({
  name: '',
  description: '',
  enabled: true,
  model: 'auto',
  maxTokens: 1024,
  historySize: 30,
  prompt: 'You are a helpful assistant in a WhatsApp group.',
  triggers: [],
  respondToMentions: true,
  dm: 'members',
  organizers: [],
  participants: [],
  chats: [],
  mcpServers: {},
  tools: { participant: [], organizer: [], deny: [] },
  confirm: null,
  schedules: [],
  memory: { enabled: true },
  plugins: [],
  timezone: '',
});

export const BOT_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const SERVER_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const RULE_RE = /^(local|memory|[a-z][a-z0-9_]*):[\w*?.-]+$/;
const SECRET_REF_RE = /^\$\{[A-Z][A-Z0-9_]{1,63}\}$/;

export class ValidationError extends Error {
  constructor(field, message) { super(`${field}: ${message}`); this.field = field; this.status = 400; }
}
const fail = (field, msg) => { throw new ValidationError(field, msg); };

const str = (v, field, { max = 200, min = 0 } = {}) => {
  const s = String(v ?? '').trim();
  if (s.length < min) fail(field, min === 1 ? 'is required' : `must be at least ${min} characters`);
  if (s.length > max) fail(field, `must be at most ${max} characters`);
  return s;
};
const int = (v, field, lo, hi) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) fail(field, `must be a whole number ${lo}–${hi}`);
  return n;
};
const list = (v, field) => {
  if (v == null) return [];
  if (typeof v === 'string') return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) fail(field, 'must be a list');
  return v.map((x) => String(x).trim()).filter(Boolean);
};
const phones = (v, field) => [...new Set(list(v, field).map(digits))].map((d) => {
  if (d.length < 6) fail(field, `"${d}" is not a full phone number with country code`);
  return d;
});
function urlOrRef(v, field) {
  const s = str(v, field, { max: 500, min: 1 });
  if (SECRET_REF_RE.test(s)) return s;
  try {
    const u = new URL(s);
    if (!['https:', 'http:'].includes(u.protocol)) throw new Error();
  } catch { fail(field, 'must be an http(s) URL or a ${SECRET} reference'); }
  return s;
}
function tokenRef(v, field) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (!SECRET_REF_RE.test(s)) fail(field, 'must reference a secret like ${MY_TOKEN} (store the value under Secrets)');
  return s;
}

/**
 * Validate and normalise a full bot config. Unknown fields are dropped and reported in `warnings`.
 * Returns { config, warnings }.
 */
export function validateBotConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('config', 'must be an object');
  const warnings = [];
  for (const k of Object.keys(input)) {
    if (!(k in BOT_DEFAULTS) && !['id', 'extraPrompt'].includes(k)) warnings.push(`Ignored unknown field "${k}"`);
  }
  const c = { ...structuredClone(BOT_DEFAULTS), ...input };
  const out = {};
  out.name = str(c.name, 'name', { min: 1, max: 80 });
  out.description = str(c.description, 'description', { max: 500 });
  out.enabled = !!c.enabled;
  out.model = str(c.model || 'auto', 'model', { min: 1, max: 120 });
  out.maxTokens = int(c.maxTokens, 'maxTokens', 64, 8192);
  out.historySize = int(c.historySize, 'historySize', 0, 200);
  out.prompt = str([c.prompt, input.extraPrompt].filter(Boolean).join('\n\n'), 'prompt', { min: 1, max: 20000 });
  out.triggers = [...new Set(list(c.triggers, 'triggers').map((t) => t.toLowerCase()))];
  if (out.triggers.some((t) => t.length > 40)) fail('triggers', 'each trigger must be at most 40 characters');
  out.respondToMentions = !!c.respondToMentions;
  if (!['none', 'organizers', 'members', 'anyone'].includes(c.dm)) fail('dm', 'must be none, organizers, members or anyone');
  out.dm = c.dm;
  out.organizers = phones(c.organizers, 'organizers');
  out.participants = phones(c.participants, 'participants');
  out.chats = [...new Set(list(c.chats, 'chats'))];
  out.timezone = str(c.timezone, 'timezone', { max: 60 });
  if (out.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: out.timezone }); } catch { fail('timezone', 'is not a valid IANA timezone'); }
  }

  if (typeof c.mcpServers !== 'object' || Array.isArray(c.mcpServers)) fail('mcpServers', 'must be an object');
  out.mcpServers = {};
  for (const [key, srv] of Object.entries(c.mcpServers || {})) {
    if (!SERVER_KEY_RE.test(key)) fail(`mcpServers.${key}`, 'name must be lowercase letters, digits or _');
    const tokens = srv?.tokens || {};
    const t = {
      organizer: tokenRef(tokens.organizer ?? srv?.token, `mcpServers.${key}.tokens.organizer`),
      participant: tokenRef(tokens.participant, `mcpServers.${key}.tokens.participant`),
    };
    const authMode = srv?.auth ?? (t.organizer || t.participant ? 'token' : 'none');
    if (!['oauth', 'token', 'none'].includes(authMode)) fail(`mcpServers.${key}.auth`, 'must be oauth, token or none');
    out.mcpServers[key] = { url: urlOrRef(srv?.url, `mcpServers.${key}.url`), auth: authMode, tokens: authMode === 'token' ? t : { organizer: '', participant: '' } };
  }

  const confirm = c.confirm && (c.confirm.preview || c.confirm.tool) ? c.confirm : null;
  if (confirm) {
    if (!RULE_RE.test(confirm.preview || '')) fail('confirm.preview', 'must look like server:*_preview');
    if (!RULE_RE.test(confirm.tool || '')) fail('confirm.tool', 'must look like server:confirm');
    out.confirm = {
      preview: confirm.preview, tool: confirm.tool,
      idField: str(confirm.idField || 'confirm_id', 'confirm.idField', { min: 1, max: 60 }),
      ttlMinutes: int(confirm.ttlMinutes ?? 9, 'confirm.ttlMinutes', 1, 60),
    };
  } else out.confirm = null;

  out.tools = {};
  for (const role of ['participant', 'organizer', 'deny']) {
    const rules = list(c.tools?.[role], `tools.${role}`);
    for (const r of rules) if (!RULE_RE.test(r)) fail(`tools.${role}`, `"${r}" must look like server:tool (globs * ? allowed)`);
    out.tools[role] = [...new Set(rules)];
  }
  if (out.confirm) {
    for (const role of ['participant', 'organizer']) {
      if (out.tools[role].includes(out.confirm.tool)) warnings.push(`Removed ${out.confirm.tool} from ${role} tools: confirmation is never given to the model`);
      out.tools[role] = out.tools[role].filter((r) => r !== out.confirm.tool);
    }
  }

  if (!Array.isArray(c.schedules)) fail('schedules', 'must be a list');
  const ids = new Set();
  out.schedules = c.schedules.map((s, i) => {
    const f = `schedules[${i + 1}]`;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s?.at || '')) fail(`${f}.at`, 'must be HH:MM (24h)');
    const days = String(s.days || 'daily').toLowerCase().replace(/\s/g, '');
    if (days !== 'daily' && !days.split(',').every((d) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(d))) {
      fail(`${f}.days`, 'must be "daily" or a list like mon,wed,fri');
    }
    const id = str(s.id || `s${i + 1}`, `${f}.id`, { min: 1, max: 40 });
    if (ids.has(id)) fail(`${f}.id`, 'must be unique');
    ids.add(id);
    return {
      id, at: s.at, days, prompt: str(s.prompt, `${f}.prompt`, { min: 1, max: 4000 }),
      chats: s.chats === 'all' || !s.chats ? 'all' : list(s.chats, `${f}.chats`), enabled: s.enabled !== false,
    };
  });

  out.memory = { enabled: c.memory?.enabled !== false };
  out.plugins = [...new Set(list(c.plugins, 'plugins'))];
  for (const p of out.plugins) if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(p)) fail('plugins', `"${p}" is not a valid plugin name`);
  return { config: out, warnings };
}

/** Secret names referenced by a config (${NAME}). */
export function referencedSecrets(config) {
  const names = new Set();
  JSON.stringify(config.mcpServers || {}).replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, k) => names.add(k));
  return [...names];
}

export function slugify(name) {
  const s = String(name || 'bot').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
  return BOT_ID_RE.test(s) ? s : `bot-${Date.now().toString(36)}`;
}
