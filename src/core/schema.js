// @ts-check
// Agent configuration: defaults, validation and normalisation (005). Single source of truth for agent shape.
import { validPackageSpec } from './mcp-local.js';
import { digits } from './config.js';
import { cleanOverride, REF_RE } from './providers/fallback-config.js';
import { QUICK_WHO, FAQ_STRICTNESS } from './quick.js';

export const AGENT_DEFAULTS = Object.freeze({
  name: '',
  description: '',
  enabled: true,
  model: 'auto',
  maxTokens: 1024,
  fallback: { mode: 'inherit', chain: [] }, // 042: inherit | on | off, and an own chain (empty = Models setting)
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
  globalMcp: { disabled: [] },
  timezone: '',
  // Photos & voice (043): what the agent does with photos, PDFs and voice notes, and when it answers with voice.
  media: { photos: true, documents: true, stickers: false, voiceNotes: true, voiceReply: 'never', createImages: { organizer: true, participant: false } },
  // Built-in answers (054): no AI, no tokens. Quick replies [{ command, text, who }], the "!help" list, a welcome for new
  // group members and FAQ auto-answers [{ questions, keywords, answer }].
  quickReplies: [],
  help: false,
  welcome: { enabled: false, text: '', rules: '' },
  faq: { items: [], strictness: 'normal', wholeGroup: false },
  // 059: where owner alerts go (the built-in owner assistant only; empty for every other agent).
  alerts: { to: '' },
});
/** Kinds of schedule entries: a prompt the agent answers, or (built-in owner assistant only) the weekly summary. */
const SCHEDULE_KINDS = ['prompt', 'weekly-summary'];

export const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const SERVER_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
/** Rule prefixes of built-in tools: a tool service may not use these names. */
export const RESERVED_SERVER_KEYS = ['local', 'memory', 'contacts', 'whatsapp', 'media'];
const TOOL_GLOB_RE = /^[\w*?.-]+$/;
const RULE_RE = /^(local|memory|[a-z][a-z0-9_]*):[\w*?.-]+$/;
const SECRET_REF_RE = /^\$\{[A-Z][A-Z0-9_]{1,63}\}$/;

export class ValidationError extends Error {
  constructor(field, message) { super(`${field}: ${message}`); this.field = field; this.status = 400; }
}
const fail = (field, msg) => { throw new ValidationError(field, msg); };
const HEADER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** { NAME: value } with validated names; values are text or contain ${SECRET} references. */
function kvMap(v, field, nameRe, reserved = []) {
  if (v == null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) fail(field, 'must be an object of name: value');
  const out = {};
  const entries = Object.entries(v);
  if (entries.length > 30) fail(field, 'at most 30 entries');
  for (const [k, val] of entries) {
    if (!nameRe.test(k)) fail(field, `"${k}" is not a valid name`);
    if (reserved.includes(k.toLowerCase()) || reserved.includes(k)) fail(field, `"${k}" is managed by the app`);
    out[k] = str(val, `${field}.${k}`, { max: 2000 });
  }
  return out;
}

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

/** Validate one tool service (MCP server) definition: remote (URL + token/OAuth/none) or local (npm/GitHub package). */
function validateServer(key, srv, f = key) {
  if (!SERVER_KEY_RE.test(key)) fail(f, 'name must be lowercase letters, digits or _');
  if (RESERVED_SERVER_KEYS.includes(key)) fail(f, `"${key}" is the name of built-in tools; choose another name`);
  const tokens = srv?.tokens || {};
  const t = {
    organizer: tokenRef(tokens.organizer, `${f}.tokens.organizer`),
    participant: tokenRef(tokens.participant, `${f}.tokens.participant`),
  };
  const type = srv?.type ?? 'remote';
  if (!['remote', 'local'].includes(type)) fail(`${f}.type`, 'must be remote or local');
  if (type === 'local') {
    const spec = str(srv?.package, `${f}.package`, { min: 1, max: 200 }).trim();
    if (!validPackageSpec(spec)) fail(`${f}.package`, 'must look like name, name@version, @scope/name or github:owner/repo#ref');
    const args = list(srv?.args ?? [], `${f}.args`).map((a) => str(a, `${f}.args`, { max: 500 }));
    if (args.length > 30) fail(`${f}.args`, 'at most 30 arguments');
    return { type, package: spec, args, env: kvMap(srv?.env, `${f}.env`, ENV_NAME_RE, ['PATH', 'HOME']), allowScripts: !!srv?.allowScripts };
  }
  const authMode = srv?.auth ?? (t.organizer || t.participant ? 'token' : 'none');
  if (!['oauth', 'token', 'none'].includes(authMode)) fail(`${f}.auth`, 'must be oauth, token or none');
  const entry = { type, url: urlOrRef(srv?.url, `${f}.url`), auth: authMode, tokens: authMode === 'token' ? t : { organizer: '', participant: '' },
    headers: kvMap(srv?.headers, `${f}.headers`, HEADER_NAME_RE, ['host', 'content-length', 'content-type', 'accept', 'authorization', 'mcp-session-id', 'mcp-protocol-version']) };
  const oc = srv?.oauthClient;
  if (authMode === 'oauth' && oc && (oc.id || oc.secret)) {
    entry.oauthClient = { id: str(oc.id, `${f}.oauthClient.id`, { min: 1, max: 300 }).trim(), secret: tokenRef(oc.secret, `${f}.oauthClient.secret`) };
  }
  return entry;
}

/**
 * Validate and normalise a full agent config. Unknown fields are dropped and reported in `warnings`.
 * Returns { config, warnings }.
 */
export function validateAgentConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('config', 'must be an object');
  const warnings = [];
  for (const k of Object.keys(input)) {
    if (!(k in AGENT_DEFAULTS) && k !== 'id') warnings.push(`Ignored unknown field "${k}"`);
  }
  const c = { ...structuredClone(AGENT_DEFAULTS), ...input };
  const out = {};
  out.name = str(c.name, 'name', { min: 1, max: 80 });
  out.description = str(c.description, 'description', { max: 500 });
  out.enabled = !!c.enabled;
  out.model = str(c.model || 'auto', 'model', { min: 1, max: 120 });
  if (out.model !== 'auto' && !REF_RE.test(out.model)) fail('model', 'must be "auto" or "account:model"');
  out.maxTokens = int(c.maxTokens, 'maxTokens', 64, 8192);
  try { out.fallback = cleanOverride(c.fallback, 'fallback'); } catch (e) { fail(e.field || 'fallback', e.message); }
  out.historySize = int(c.historySize, 'historySize', 0, 200);
  out.prompt = str(c.prompt, 'prompt', { min: 1, max: 20000 });
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
  for (const [key, srv] of Object.entries(c.mcpServers || {})) out.mcpServers[key] = validateServer(key, srv, `mcpServers.${key}`);

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
    const kind = s.kind ?? 'prompt';
    if (!SCHEDULE_KINDS.includes(kind)) fail(`${f}.kind`, `must be ${SCHEDULE_KINDS.join(' or ')}`);
    return {
      id, at: s.at, days, kind, prompt: kind === 'prompt' ? str(s.prompt, `${f}.prompt`, { min: 1, max: 4000 }) : '',
      chats: s.chats === 'all' || !s.chats ? 'all' : list(s.chats, `${f}.chats`), enabled: s.enabled !== false,
    };
  });

  out.memory = { enabled: c.memory?.enabled !== false };
  const off = list(c.globalMcp?.disabled, 'globalMcp.disabled');
  for (const k of off) if (!SERVER_KEY_RE.test(k)) fail('globalMcp.disabled', `"${k}" is not a tool service name`);
  out.globalMcp = { disabled: [...new Set(off)] };
  const md = c.media && typeof c.media === 'object' ? c.media : {};
  const mdef = AGENT_DEFAULTS.media;
  const flag = (k) => (md[k] === undefined ? mdef[k] : !!md[k]);
  const voiceReply = md.voiceReply ?? mdef.voiceReply;
  if (!['never', 'voice', 'always'].includes(voiceReply)) fail('media.voiceReply', 'must be never, voice or always');
  out.media = { photos: flag('photos'), documents: flag('documents'), stickers: flag('stickers'), voiceNotes: flag('voiceNotes'), voiceReply,
    createImages: { organizer: md.createImages?.organizer === undefined ? mdef.createImages.organizer : !!md.createImages.organizer,
      participant: md.createImages?.participant === undefined ? mdef.createImages.participant : !!md.createImages.participant } };
  const to = digits(c.alerts?.to || '');
  if (to && (to.length < 8 || to.length > 15)) fail('alerts.to', 'enter the number with its country code, e.g. +41 79 123 45 67');
  out.alerts = { to };
  Object.assign(out, builtins(c));
  return { config: out, warnings };
}

const COMMAND_RE = /^[^\s]{2,40}$/;
/** Built-in answers (054): quick replies, !help, welcome and FAQ, validated and normalised. */
function builtins(c) {
  if (c.quickReplies != null && !Array.isArray(c.quickReplies)) fail('quickReplies', 'must be a list');
  const qr = c.quickReplies || [];
  if (qr.length > 30) fail('quickReplies', 'at most 30 quick replies');
  const seen = new Set();
  const quickReplies = qr.map((q, i) => {
    const f = `quickReplies[${i + 1}]`;
    const command = str(q?.command, `${f}.command`, { min: 1, max: 40 }).toLowerCase().replace(/[?.,:;]+$/, '');
    if (!COMMAND_RE.test(command)) fail(`${f}.command`, 'must be one word of 2–40 characters, like !rides');
    if (seen.has(command)) fail(`${f}.command`, `"${command}" is used twice`);
    seen.add(command);
    const who = q.who ?? 'everyone';
    if (!QUICK_WHO.includes(who)) fail(`${f}.who`, 'must be everyone or organizers');
    return { command, text: str(q.text, `${f}.text`, { min: 1, max: 2000 }), who };
  });
  const w = c.welcome && typeof c.welcome === 'object' ? c.welcome : {};
  const welcome = { enabled: !!w.enabled, text: str(w.text, 'welcome.text', { max: 1000 }), rules: str(w.rules, 'welcome.rules', { max: 2000 }) };
  const fq = c.faq && typeof c.faq === 'object' ? c.faq : {};
  if (fq.items != null && !Array.isArray(fq.items)) fail('faq.items', 'must be a list');
  if ((fq.items || []).length > 50) fail('faq.items', 'at most 50 questions');
  const strictness = fq.strictness ?? 'normal';
  if (!FAQ_STRICTNESS.includes(strictness)) fail('faq.strictness', 'must be strict or normal');
  const items = (fq.items || []).map((it, i) => {
    const f = `faq.items[${i + 1}]`;
    const questions = list(it?.questions, `${f}.questions`).map((x) => str(x, `${f}.questions`, { max: 200 }));
    const keywords = [...new Set(list(it?.keywords, `${f}.keywords`).map((x) => str(x, `${f}.keywords`, { max: 40 }).toLowerCase()))];
    if (questions.length > 10) fail(`${f}.questions`, 'at most 10 phrasings');
    if (keywords.length > 20) fail(`${f}.keywords`, 'at most 20 keywords');
    if (!questions.length && !keywords.length) fail(`${f}.questions`, 'add a question or keywords');
    return { questions, keywords, answer: str(it.answer, `${f}.answer`, { min: 1, max: 2000 }) };
  });
  return { quickReplies, help: !!c.help, welcome, faq: { items, strictness, wholeGroup: !!fq.wholeGroup } };
}

/**
 * A global tool service (035): a tool service definition plus default tool rules per role (tool-name globs such as
 * "*" or "agenda_*"). The defaults apply in every agent whose role rules have no explicit "<name>:" entries.
 */
export function validateGlobalServer(name, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('config', 'must be an object');
  const entry = validateServer(name, input, name);
  const d = input.defaults || {};
  const defaults = {};
  for (const role of ['organizer', 'participant']) {
    const globs = d[role] === undefined ? (role === 'organizer' ? ['*'] : []) : list(d[role], `defaults.${role}`);
    for (const g of globs) if (!TOOL_GLOB_RE.test(g)) fail(`defaults.${role}`, `"${g}" must be a tool name (globs * ? allowed)`);
    defaults[role] = [...new Set(globs)];
  }
  return { ...entry, defaults };
}

/** Secret names referenced by a config (${NAME}). */
export function referencedSecrets(config) {
  const names = new Set();
  for (const [, k] of JSON.stringify(config.mcpServers || {}).matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) names.add(k);
  return [...names];
}

export function slugify(name) {
  const s = String(name || 'agent').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
  return AGENT_ID_RE.test(s) ? s : `agent-${Date.now().toString(36)}`;
}
