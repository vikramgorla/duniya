// Agent registry (005): agents are database records; templates are JSON files; plugins are optional code.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGINS_DIR, TEMPLATES_DIR, digits } from './config.js';
import { validateAgentConfig, referencedSecrets, slugify, AGENT_ID_RE, ValidationError } from './schema.js';
import {
  listAgentRows, getAgentRow, saveAgentRow, deleteAgentRow, getSecret,
} from './store.js';
import { activity } from './events.js';
import { deleteAgentConnections } from './mcp-oauth.js';
import { globalServers } from './global-mcp.js';

let agents = new Map();
const pluginCache = new Map();

// ---------- plugins ----------
async function loadPlugin(name) {
  if (pluginCache.has(name)) return pluginCache.get(name);
  const file = resolve(PLUGINS_DIR, name, 'index.js');
  let mod = null;
  if (existsSync(file)) {
    try { mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default || null; } catch (e) {
      activity('error', { summary: `Plugin "${name}" failed to load: ${e.message}` });
    }
  }
  pluginCache.set(name, mod);
  return mod;
}

export function listPlugins() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(PLUGINS_DIR, d.name, 'index.js')))
    .map((d) => ({ name: d.name, tools: (pluginCache.get(d.name)?.tools || []).map((t) => t.name) }));
}

async function hooksFor(config, id) {
  const hooks = { tools: [], onMessage: null, role: null, missing: [] };
  const handlers = [];
  const roles = [];
  for (const name of config.plugins || []) {
    const p = await loadPlugin(name);
    if (!p) { hooks.missing.push(name); continue; }
    for (const t of p.tools || []) hooks.tools.push({ ...t, plugin: name });
    if (p.onMessage) handlers.push(p.onMessage);
    if (p.role) roles.push(p.role);
    try { await p.init?.({ agent: { id, ...config } }); } catch (e) { activity('error', { agent: id, summary: `Plugin ${name} init: ${e.message}` }); }
  }
  if (handlers.length) {
    hooks.onMessage = async (ctx) => {
      for (const h of handlers) { const r = await h(ctx); if (typeof r === 'string' && r) return r; }
      return undefined;
    };
  }
  if (roles.length) {
    hooks.role = async (msg, agent) => {
      for (const r of roles) { const v = await r(msg, agent); if (v) return v; }
      return undefined;
    };
  }
  if (hooks.missing.length) activity('error', { agent: id, summary: `Missing plugin(s): ${hooks.missing.join(', ')}` });
  return hooks;
}

async function toRuntime(row) {
  return { ...row.config, id: row.id, updatedAt: row.updatedAt, hooks: await hooksFor(row.config, row.id) };
}

// ---------- registry ----------
export async function loadAgents() {
  const next = new Map();
  for (const row of listAgentRows()) next.set(row.id, await toRuntime(row));
  agents = next;
  return [...agents.values()];
}
async function refresh(id) {
  const row = getAgentRow(id);
  if (row) agents.set(id, await toRuntime(row)); else agents.delete(id);
  return agents.get(id);
}

export const listAgents = () => [...agents.values()];
export const getAgent = (id) => agents.get(id);
export const agentForChat = (chat) => listAgents().find((b) => b.chats.includes(chat));
export const roleIn = (agent, phone) => (phone && agent.organizers.includes(digits(phone)) ? 'organizer' : 'participant');

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

export async function createAgent({ id, config, by = '' }) {
  const { config: clean, warnings } = validateAgentConfig(config);
  let agentId = id ? String(id).toLowerCase() : slugify(clean.name);
  if (!AGENT_ID_RE.test(agentId)) throw new ValidationError('id', 'must be 2–41 lowercase letters, digits or -');
  if (getAgentRow(agentId)) {
    if (id) throw Object.assign(new Error(`An agent with id "${agentId}" already exists`), { status: 409 });
    let n = 2; while (getAgentRow(`${agentId}-${n}`)) n++;
    agentId = `${agentId}-${n}`;
  }
  if (clean.chats.length) releaseChats(clean.chats, agentId, by);
  saveAgentRow(agentId, clean, by);
  activity('agent.created', { agent: agentId, summary: `Created "${clean.name}"${by ? ` by ${by}` : ''}`, detail: { warnings } });
  return { agent: await refresh(agentId), warnings };
}

export async function updateAgent(id, patch, by = '') {
  const row = getAgentRow(id);
  if (!row) throw Object.assign(new Error(`Unknown agent ${id}`), { status: 404 });
  const { config: clean, warnings } = validateAgentConfig({ ...row.config, ...patch });
  if (patch.chats) releaseChats(clean.chats, id, by);
  saveAgentRow(id, clean, by);
  if (patch.plugins) for (const p of clean.plugins) pluginCache.delete(p);
  activity('agent.updated', { agent: id, summary: `Updated ${Object.keys(patch).join(', ')}${by ? ` by ${by}` : ''}`, detail: { warnings } });
  return { agent: await refresh(id), warnings };
}

export function deleteAgent(id, by = '') {
  if (!deleteAgentRow(id)) throw Object.assign(new Error(`Unknown agent ${id}`), { status: 404 });
  agents.delete(id);
  deleteAgentConnections(id);
  activity('agent.deleted', { agent: id, summary: `Deleted${by ? ` by ${by}` : ''}` });
}

export async function bindChat(chat, agentId, by = '') {
  for (const b of listAgents()) {
    if (b.chats.includes(chat) && b.id !== agentId) await updateAgent(b.id, { chats: b.chats.filter((c) => c !== chat) }, by);
  }
  if (agentId) {
    const b = getAgent(agentId);
    if (!b) throw Object.assign(new Error(`Unknown agent ${agentId}`), { status: 404 });
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
  if (!existsSync(file)) throw Object.assign(new Error(`Unknown template ${id}`), { status: 404 });
  return readJsonFile(file, {});
}

export function exportAgent(id) {
  const row = getAgentRow(id);
  if (!row) throw Object.assign(new Error(`Unknown agent ${id}`), { status: 404 });
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
  delete config.hooks; delete config.id; delete config.updatedAt;
  const needs = referencedSecrets(agent).filter((s) => !getSecret(s));
  return {
    id: agent.id, name: agent.name, description: agent.description, enabled: agent.enabled, config, needs,
    updatedAt: agent.updatedAt,
    localTools: (agent.hooks?.tools || []).map((t) => t.name),
    missingPlugins: agent.hooks?.missing || [],
    // Global tool services (035): on = used by this agent; replaced = the agent has its own service with that name.
    globalTools: Object.entries(globalServers()).map(([name, g]) => ({
      name, type: g.type, on: !(agent.globalMcp?.disabled || []).includes(name) && !agent.mcpServers?.[name], replaced: !!agent.mcpServers?.[name], defaults: g.defaults,
    })),
  };
}
