// @ts-check
// Agent registry (005): agents are database records; templates are JSON files.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEMPLATES_DIR, fail } from './config.js';
import { inRole } from './people-access.js';
import { validateAgentConfig, referencedSecrets, slugify, AGENT_ID_RE, ValidationError } from './schema.js';
import {
  listAgentRows, getAgentRow, saveAgentRow, deleteAgentRow, getSecret,
} from './store.js';
import { activity } from './events.js';
import { deleteAgentConnections } from './mcp-oauth.js';
import { globalServers } from './global-mcp.js';
import { guardLocalSmall } from './mcp-local.js';

// ---------- the built-in owner assistant (059) ----------
// The owner assistant is an agent record with a reserved id, always present and not deletable. The owner edits its
// character, model, tools, photos & voice and schedules in the normal agent editor; how it is reached (the linked
// users' own chats and the Ask box), its permissions and its confirm gate are code (owner-assistant.js), so the
// fields below are fixed whatever is saved.
export const OWNER_AGENT_ID = 'owner-assistant';
export const isBuiltin = (a) => (typeof a === 'string' ? a : a?.id) === OWNER_AGENT_ID;
const OWNER_FIXED = Object.freeze({ enabled: true, chats: [], triggers: [], respondToMentions: false, dm: 'none', organizers: [], participants: [], confirm: null,
  quickReplies: [], help: false, welcome: { enabled: false, text: '', rules: '' }, faq: { items: [], strictness: 'normal', wholeGroup: false } });
const ownerConfig = (config) => validateAgentConfig({ ...config, ...structuredClone(OWNER_FIXED) });
/** Every other agent: no alert number and no weekly-summary schedule (those belong to the owner assistant). */
const agentConfig = (config) => validateAgentConfig({ ...config, alerts: { to: '' },
  ...(Array.isArray(config?.schedules) ? { schedules: config.schedules.filter((x) => (x?.kind ?? 'prompt') === 'prompt') } : {}) });
function ensureOwnerAgent() {
  if (getAgentRow(OWNER_AGENT_ID)) return;
  saveAgentRow(OWNER_AGENT_ID, ownerConfig({ name: 'Owner assistant', description: 'Built-in: answers linked panel users in their own WhatsApp chat and in the Ask box.',
    prompt: 'Be brief, friendly and practical.', maxTokens: 1500, historySize: 10,
    // 041 → 059: the weekly summary is a schedule of the owner assistant (counts and costs only, weekly.js)
    schedules: [{ id: 'weekly-summary', kind: 'weekly-summary', at: '09:00', days: 'mon', enabled: true }] }).config, 'system');
}
const builtinError = (what) => fail(`The owner assistant is built in: it ${what}`);

let agents = new Map();
function toRuntime(row) {
  return { ...row.config, id: row.id, updatedAt: row.updatedAt };
}

// ---------- registry ----------
// 094 (one-time, remove in the next release): agents whose instructions ask for GIFs and that use the "gifs" tool
// service send them on their own ("often"), now a setting on their Tools page instead of prompt text.
function gifsFromPrompts() {
  const global = !!globalServers().gifs;
  for (const row of listAgentRows()) {
    const c = row.config;
    if (row.id === OWNER_AGENT_ID || c.reactions !== undefined || !/\bgifs?\b/i.test(c.prompt || '')) continue;
    if (!c.mcpServers?.gifs && !(global && !(c.globalMcp?.disabled || []).includes('gifs'))) continue;
    saveAgentRow(row.id, { ...c, reactions: { gifs: { mode: 'often', style: '' } } }, 'system');
    activity('config', { agent: row.id, summary: `${c.name || row.id} now sends GIFs on its own (often), as its instructions ask: Tools → gifs` });
  }
}

export async function loadAgents() {
  ensureOwnerAgent();
  gifsFromPrompts();
  const next = new Map();
  for (const row of listAgentRows()) next.set(row.id, toRuntime(row));
  agents = next;
  return [...agents.values()];
}
async function refresh(id) {
  const row = getAgentRow(id);
  if (row) agents.set(id, toRuntime(row)); else agents.delete(id);
  return agents.get(id);
}

export const listAgents = () => [...agents.values()];
export const getAgent = (id) => agents.get(id);
export const agentForChat = (chat) => listAgents().find((b) => b.chats.includes(chat));
/** Organizer or participant: saved organizers are numbers, people and lists (079: a role follows the person on any app). */
export const roleIn = (agent, phone, person = '') => (inRole(agent.organizers, { phone, person }) ? 'organizer' : 'participant');

function releaseChats(chats, exceptId, by) {
  for (const other of listAgents()) {
    if (other.id === exceptId) continue;
    const kept = other.chats.filter((c) => !chats.includes(c));
    if (kept.length !== other.chats.length) {
      const row = getAgentRow(other.id);
      saveAgentRow(other.id, { ...row.config, chats: kept }, by);
      other.chats = kept;
    }
  }
}

/** @param {{ id?: string, config: object, by?: string }} o  id: from the name when left out */
export async function createAgent({ id, config, by = '' }) {
  const { config: clean, warnings } = agentConfig(config);
  guardLocalSmall({}, clean.mcpServers); // 055: no new local tool services on small servers (every path ends here)
  let agentId = id ? String(id).toLowerCase() : slugify(clean.name);
  if (!AGENT_ID_RE.test(agentId)) throw new ValidationError('id', 'must be 2–41 lowercase letters, digits or -');
  if (getAgentRow(agentId)) {
    if (id) throw fail(`An agent with id "${agentId}" already exists`, 409);
    let n = 2; while (getAgentRow(`${agentId}-${n}`)) n++;
    agentId = `${agentId}-${n}`;
  }
  if (clean.chats.length) releaseChats(clean.chats, agentId, by);
  saveAgentRow(agentId, clean, by);
  activity('agent.created', { agent: agentId, summary: `Created "${clean.name}"${by ? ` by ${by}` : ''}`, detail: { warnings } });
  return { agent: await refresh(agentId), warnings };
}

// #109: the panel sends the whole agent, so name only the fields whose value changed (old → new when both are short).
const SHORT = 60;
const shortText = (v) => {
  if (v === undefined || v === null || v === '') return '(none)';
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.length ? v.join(', ') : '(none)';
  return typeof v === 'object' ? null : String(v);
};
export function changeSummary(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!changed.length) return 'Saved without changes';
  return `Updated ${changed.map((k) => {
    const a = shortText(before[k]); const b = shortText(after[k]);
    return a !== null && b !== null && a.length <= SHORT && b.length <= SHORT ? `${k}: ${a} → ${b}` : k;
  }).join('; ')}`;
}

export async function updateAgent(id, patch, by = '') {
  const row = getAgentRow(id);
  if (!row) throw fail(`Unknown agent ${id}`, 404);
  const { config: clean, warnings } = (isBuiltin(id) ? ownerConfig : agentConfig)({ ...row.config, ...patch });
  guardLocalSmall(row.config.mcpServers, clean.mcpServers);
  if (patch.chats) releaseChats(clean.chats, id, by);
  saveAgentRow(id, clean, by);
  activity('agent.updated', { agent: id, summary: `${changeSummary(row.config, clean)}${by ? ` by ${by}` : ''}`, detail: { warnings } });
  return { agent: await refresh(id), warnings };
}

export function deleteAgent(id, by = '') {
  if (isBuiltin(id)) throw builtinError('cannot be deleted');
  if (!deleteAgentRow(id)) throw fail(`Unknown agent ${id}`, 404);
  agents.delete(id);
  deleteAgentConnections(id);
  activity('agent.deleted', { agent: id, summary: `Deleted${by ? ` by ${by}` : ''}` });
}

export async function bindChat(chat, agentId, by = '') {
  for (const b of listAgents()) {
    if (b.chats.includes(chat) && b.id !== agentId) await updateAgent(b.id, { chats: b.chats.filter((c) => c !== chat) }, by);
  }
  if (agentId) {
    if (isBuiltin(agentId)) throw builtinError('answers its linked users in their own chats, not in assigned chats');
    const b = getAgent(agentId);
    if (!b) throw fail(`Unknown agent ${agentId}`, 404);
    if (!b.chats.includes(chat)) await updateAgent(agentId, { chats: [...b.chats, chat] }, by);
  }
}

// ---------- templates, export/import ----------
function readJsonFile(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function listTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const t = readJsonFile(resolve(TEMPLATES_DIR, f), {});
    return { id: f.replace(/\.json$/, ''), name: t.name || f, description: t.description || '' };
  }).sort((a, b) => (a.id === 'blank' ? -1 : b.id === 'blank' ? 1 : a.name.localeCompare(b.name)));
}
export function templateConfig(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new ValidationError('template', 'invalid');
  const file = resolve(TEMPLATES_DIR, `${id}.json`);
  if (!existsSync(file)) throw fail(`Unknown template ${id}`, 404);
  return readJsonFile(file, {});
}

export function exportAgent(id) {
  const row = getAgentRow(id);
  if (!row) throw fail(`Unknown agent ${id}`, 404);
  const { chats, organizers, participants, ...config } = row.config;
  return { format: 'duniya-agent', version: 1, id, exportedAt: new Date().toISOString(), config, secrets: referencedSecrets(row.config) };
}

export async function importAgent(doc, by = '') {
  if (!doc || doc.format !== 'duniya-agent' || !doc.config) throw new ValidationError('file', 'not an agent export (format duniya-agent)');
  const config = { ...doc.config, chats: [], organizers: [], participants: [] };
  return createAgent({ config, by });
}

export function agentView(agent) {
  const config = { ...agent };
  delete config.id; delete config.updatedAt;
  const needs = referencedSecrets(agent).filter((s) => !getSecret(s));
  return {
    id: agent.id, name: agent.name, description: agent.description, enabled: agent.enabled, config, needs, ...(isBuiltin(agent) ? { builtin: true } : {}),
    updatedAt: agent.updatedAt,
    // Global tool services (035): on = used by this agent; replaced = the agent has its own service with that name.
    globalTools: Object.entries(globalServers()).map(([name, g]) => ({
      name, type: g.type, on: !(agent.globalMcp?.disabled || []).includes(name) && !agent.mcpServers?.[name], replaced: !!agent.mcpServers?.[name], defaults: g.defaults,
    })),
  };
}
