// @ts-check
// Agent configuration: defaults, validation and normalisation (005). Single source of truth for agent shape.
import { GROUP_REPLIES } from './group-replies.js';
import { validPackageSpec } from './mcp-local.js';
import { digits } from './config.js';
import { cleanOverride, REF_RE } from './providers/fallback-config.js';
import { QUICK_WHO, FAQ_STRICTNESS } from './quick.js';
import { AUTONOMY, RISKS } from './autonomy.js';

// 094: how an agent uses each tool service (a service's default in Settings → Tool services, overridable per agent)
export const WHEN = ['asked', 'useful', 'proactive']; // when to use it: only when asked | the agent decides | looks for chances
export const SHARE_MODES = ['off', 'sometimes', 'often']; // share media results on its own
export const WHERE = ['all', 'dm']; // where results may be posted: groups and direct messages | direct messages only
export const SERVICE_DEFAULTS = Object.freeze({ when: 'useful', note: '', changes: '', share: 'off', style: '', perReply: 0, perDay: 0, where: 'all', tools: {} });

export const AGENT_DEFAULTS = Object.freeze({
  name: '',
  description: '',
  enabled: true,
  model: 'auto',
  maxTokens: 1024,
  fallback: { mode: 'inherit', chain: [] }, // 042: inherit | on | off, and an own chain (empty = Models setting)
  // 088: with model "smart": its own light / strong models ('' = Settings → Models → Smart choice)
  modelTiers: { light: '', strong: '' },
  selfCheck: true, // 088: amounts, dates and counts from People and modules are checked before an answer goes out
  lessons: { enabled: true, autoApprove: false }, // 089: lessons from the owner's corrections; saved after the owner's OK
  promises: { track: false, followUp: 'chat' }, // 091: notice promises in its chats; follow up when due: chat | dm | off
  cues: false, // 091: suggest family ties in People from what people say ("my daughter Vedika"); never saved without the owner
  historySize: 30,
  prompt: 'You are a helpful assistant in a WhatsApp group.',
  triggers: [],
  respondToMentions: true,
  groupReplies: 'followups', // 076: wake | followups | auto
  dm: 'members',
  organizers: [], // 079: phone numbers, people (p_…) and lists (l_…)
  participants: [],
  chats: [],
  peopleAccess: 'own', // 079: which people its tools and sender cards may see: off | own (its chats + shared lists) | everyone
  peopleLists: [], // 079: lists (l_…) the owner shares with it
  mcpServers: {},
  tools: { participant: [], organizer: [], deny: [] },
  confirm: null,
  autonomy: 'clear', // 093: how sure before changing things: ask | clear (an organizer's clear request is the approval) | act
  schedules: [],
  memory: { enabled: true },
  globalMcp: { disabled: [] },
  services: {}, // 094: per tool service, what differs from the service's default: when, note, changes, share, style, perReply, perDay, where, tools
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
export const RESERVED_SERVER_KEYS = ['local', 'memory', 'contacts', 'people', 'whatsapp', 'media'];
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
const PERSON_REF_RE = /^[pl]_[a-f0-9]{6,32}$/;
/** 079: role entries — phone numbers (digits), people (p_…) and lists (l_…). */
const roleEntries = (v, field) => [...new Set(list(v, field).map((x) => (PERSON_REF_RE.test(String(x).trim()) ? String(x).trim() : digits(x))))].map((d) => {
  if (!PERSON_REF_RE.test(d) && d.length < 6) fail(field, `"${d}" is not a full phone number with country code, a person or a list`);
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

const TOOL_NAME_RE = /^[\w.-]{1,64}$/;
/**
 * 094: how a tool service is used (see SERVICE_DEFAULTS). `inherit` (an agent's override): "inherit" or a missing field
 * means the service's default; a service keeps only what differs from the defaults.
 */
function behaviour(v, f, inherit) {
  const b = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const out = {};
  const pick = (k, allowed) => {
    const x = b[k];
    if (x === undefined || x === '' || x === null || (inherit && x === 'inherit')) return;
    if (!allowed.includes(x)) fail(`${f}.${k}`, `must be ${[...(inherit ? ['inherit'] : []), ...allowed].join(', ')}`);
    if (inherit || x !== SERVICE_DEFAULTS[k]) out[k] = x;
  };
  pick('when', WHEN); pick('changes', AUTONOMY); pick('share', SHARE_MODES); pick('where', WHERE);
  for (const k of ['note', 'style']) { const t = str(b[k], `${f}.${k}`, { max: k === 'note' ? 200 : 120 }); if (t) out[k] = t; }
  for (const k of ['perReply', 'perDay']) {
    if (b[k] === undefined || b[k] === null || b[k] === '') continue;
    const n = int(b[k], `${f}.${k}`, 0, 1000);
    if (inherit || n) out[k] = n;
  }
  const tools = b.tools && typeof b.tools === 'object' && !Array.isArray(b.tools) ? Object.entries(b.tools) : [];
  if (tools.length > 100) fail(`${f}.tools`, 'at most 100 tools');
  for (const [name, risk] of tools) {
    if (!risk || risk === 'auto') continue;
    if (!TOOL_NAME_RE.test(name)) fail(`${f}.tools`, `"${name}" is not a tool name`);
    if (!RISKS.includes(risk)) fail(`${f}.tools.${name}`, 'must be read, change or destructive');
    (out.tools ||= {})[name] = risk;
  }
  return out;
}
/** A service's own default behaviour, to spread into its config ({} when all defaults). */
const serviceBehaviour = (v, f) => { const bh = behaviour(v, `${f}.behaviour`, false); return Object.keys(bh).length ? { behaviour: bh } : {}; };

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
    return { type, package: spec, args, env: kvMap(srv?.env, `${f}.env`, ENV_NAME_RE, ['PATH', 'HOME']), allowScripts: !!srv?.allowScripts, ...serviceBehaviour(srv?.behaviour, f) };
  }
  const authMode = srv?.auth ?? (t.organizer || t.participant ? 'token' : 'none');
  if (!['oauth', 'token', 'none'].includes(authMode)) fail(`${f}.auth`, 'must be oauth, token or none');
  /** @type {Record<string, any>} */
  const entry = { type, url: urlOrRef(srv?.url, `${f}.url`), auth: authMode, tokens: authMode === 'token' ? t : { organizer: '', participant: '' },
    headers: kvMap(srv?.headers, `${f}.headers`, HEADER_NAME_RE, ['host', 'content-length', 'content-type', 'accept', 'authorization', 'mcp-session-id', 'mcp-protocol-version']),
    ...serviceBehaviour(srv?.behaviour, f) };
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
  if (out.model !== 'auto' && out.model !== 'smart' && !REF_RE.test(out.model)) fail('model', 'must be "auto", "smart" or "account:model"');
  const tiers = c.modelTiers && typeof c.modelTiers === 'object' ? c.modelTiers : {};
  out.modelTiers = {};
  for (const k of ['light', 'strong']) {
    const v = String(tiers[k] || '').trim();
    if (v && v !== 'auto' && !REF_RE.test(v)) fail(`modelTiers.${k}`, 'must be empty, "auto" or "account:model"');
    out.modelTiers[k] = v === 'auto' ? '' : v;
  }
  out.selfCheck = c.selfCheck !== false;
  const ls = c.lessons && typeof c.lessons === 'object' ? c.lessons : {};
  out.lessons = { enabled: ls.enabled !== false, autoApprove: !!ls.autoApprove };
  const pr = c.promises && typeof c.promises === 'object' ? c.promises : {};
  if (pr.followUp !== undefined && !['chat', 'dm', 'off'].includes(pr.followUp)) fail('promises.followUp', 'must be chat, dm or off');
  out.promises = { track: !!pr.track, followUp: pr.followUp || 'chat' };
  out.cues = !!c.cues;
  out.maxTokens = int(c.maxTokens, 'maxTokens', 64, 8192);
  try { out.fallback = cleanOverride(c.fallback, 'fallback'); } catch (e) { fail(e.field || 'fallback', e.message); }
  out.historySize = int(c.historySize, 'historySize', 0, 200);
  out.prompt = str(c.prompt, 'prompt', { min: 1, max: 20000 });
  out.triggers = [...new Set(list(c.triggers, 'triggers').map((t) => t.toLowerCase()))];
  if (out.triggers.some((t) => t.length > 40)) fail('triggers', 'each trigger must be at most 40 characters');
  out.respondToMentions = !!c.respondToMentions;
  out.groupReplies = c.groupReplies ?? 'followups';
  if (!GROUP_REPLIES.includes(out.groupReplies)) fail('groupReplies', 'must be wake, followups or auto');
  if (!['none', 'organizers', 'members', 'anyone'].includes(c.dm)) fail('dm', 'must be none, organizers, members or anyone');
  out.dm = c.dm;
  out.organizers = roleEntries(c.organizers, 'organizers');
  out.participants = roleEntries(c.participants, 'participants');
  if (!['off', 'own', 'everyone'].includes(c.peopleAccess)) fail('peopleAccess', 'must be off, own or everyone');
  out.peopleAccess = c.peopleAccess;
  out.peopleLists = [...new Set(list(c.peopleLists, 'peopleLists'))];
  if (out.peopleLists.some((l) => !/^l_[a-f0-9]{6,32}$/.test(l))) fail('peopleLists', 'must be list ids (l_…)');
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

  out.autonomy = c.autonomy ?? 'clear';
  if (!AUTONOMY.includes(out.autonomy)) fail('autonomy', 'must be ask, clear or act');
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
  const sv = c.services && typeof c.services === 'object' && !Array.isArray(c.services) ? c.services : {};
  if (Object.keys(sv).length > 30) fail('services', 'at most 30 tool services');
  out.services = {};
  for (const [k, v] of Object.entries(sv)) {
    if (!SERVER_KEY_RE.test(k) && !RESERVED_SERVER_KEYS.includes(k)) fail('services', `"${k}" is not a tool service name`);
    const bh = behaviour(v, `services.${k}`, true);
    if (Object.keys(bh).length) out.services[k] = bh;
  }
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
