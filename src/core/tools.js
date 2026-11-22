// @ts-check
import { interpolate } from './store.js';
import { matchesAny } from './config.js';
import { mcpConnection } from './mcp.js';
import { localServiceCheck } from './mcp-local.js';
import { activity } from './events.js';
import { isConnected, runtimeProvider, GLOBAL_SCOPE } from './mcp-oauth.js';
import { globalServers } from './global-mcp.js';
import { memoryTools, memoryEnabled, MEMORY_DEFAULT_ALLOW } from './memory.js';
import { peopleTools, peopleRules } from './people-tools.js';
import { peopleScope } from './people-access.js';
import { chatToolsFor, chatToolRules, chatChannel } from './chat-tools.js';
import { capsOf } from '../channels/index.js';
import { mediaTools, imageToolAllowed } from './media-ai.js';
import { liveModules, moduleRules } from '../modules/index.js';
import { promiseTools } from './commitments.js';
import { changeTools, riskOf } from './autonomy.js';
import { behaviourOf } from './tool-behaviour.js';
import { mediaTool, shareToolDef } from './sharing.js';


const exposedName = (server, tool) => `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

/** A pre-registered OAuth app (client id / secret) for services without automatic registration. */
export const oauthClientOf = (srv) => (srv.oauthClient?.id ? { id: srv.oauthClient.id, secret: srv.oauthClient.secret || '' } : null);

/**
 * The tool services an agent uses: its own, plus every global one (035) it has not switched off. An own service with
 * the same name as a global one replaces it for this agent. Global entries carry `global: true`.
 */
export function effectiveServers(agent) {
  const own = agent.mcpServers || {};
  const off = new Set(agent.globalMcp?.disabled || []);
  const out = {};
  for (const [key, srv] of Object.entries(globalServers())) if (!own[key] && !off.has(key)) out[key] = { ...srv, global: true };
  return Object.assign(out, own);
}

const notStarted = new Set();
function notStartedOnce(scope, key, reason) {
  const id = `${scope}:${key}`;
  if (notStarted.has(id)) return;
  notStarted.add(id);
  activity('system', { summary: `Local tool service ${key} not started: ${reason}` });
}

/** Connection to a tool service (of the agent, or a global one) for a role. */
export function serverConnection(srvRaw, { scope, key, role, where }) {
  const srv = interpolate(srvRaw);
  if (srv?.type === 'local') {
    // 055: a local service configured before (or restored onto) a small server stays in the config but is not
    // started; the agent answers without its tools and the panel shows why.
    const small = localServiceCheck();
    if (!small.ok) { notStartedOnce(scope, key, small.reason); throw Object.assign(new Error(`Local tool service "${key}" is not started: ${small.reason}`), { code: small.code }); }
    // One process per service (per agent, or one shared by all agents for a global service); roles are separated
    // by the per-role tool lists.
    return mcpConnection(`local:${scope}:${key}`, { local: { spec: srv.package, allowScripts: !!srv.allowScripts, args: srv.args || [], env: srv.env || {} } });
  }
  if (!srv?.url) throw new Error(`MCP server "${key}" has no url (set its secret in the panel)`);
  const headers = srv.headers || {};
  if (srv.auth === 'oauth') {
    // Participants use their own sign-in when connected, otherwise the organizer's (tools still limited per role).
    const who = role === 'participant' && isConnected(scope, key, 'participant', srv.url) ? 'participant' : 'organizer';
    if (!isConnected(scope, key, who, srv.url)) {
      throw new Error(`Tool service "${key}" is not signed in. An admin needs to click Connect in the panel (${where}).`);
    }
    return mcpConnection(srv.url, { identity: `oauth:${scope}:${key}:${who}`, headers, authProvider: runtimeProvider(scope, key, who, srv.url, oauthClientOf(srv)) });
  }
  const tokens = srv.tokens || {};
  // Participants use their own token when configured, otherwise the organizer/default token;
  // the per-role allowlist is enforced either way.
  const token = (role === 'participant' && tokens.participant) || tokens.organizer || '';
  return mcpConnection(srv.url, { token, headers });
}

function connectionFor(agent, serverKey, role) {
  const srv = effectiveServers(agent)[serverKey];
  if (!srv) throw new Error(`Unknown tool service "${serverKey}"`);
  return srv.global
    ? serverConnection(srv, { scope: GLOBAL_SCOPE, key: serverKey, role, where: 'Settings → Tool services' })
    : serverConnection(srv, { scope: agent.id, key: serverKey, role, where: `Agents → ${agent.name || agent.id}` });
}

/** The allow rules of a role for one service: for a global service without explicit "<key>:" rules, its defaults. */
function serverAllow(srv, key, allow, role) {
  if (!srv?.global) return allow;
  const explicit = allow.filter((r) => r.startsWith(`${key}:`));
  return explicit.length ? explicit : (srv.defaults?.[role] || []).map((g) => `${key}:${g}`);
}

/** 094: a service's tools within 5 s (a slow or unreachable service does not hold up a panel page). */
async function listWithin(conn) {
  let timer;
  const slow = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('The tool service did not answer in time')), 5000); });
  try { return await Promise.race([conn.listTools(), slow]); } finally { clearTimeout(timer); }
}
/** 094: a service's tools as the panel shows them: name, description, risk from its annotations, shareable media. */
export async function describeTools(key, conn) {
  const tools = await listWithin(conn);
  const media = mediaTool(key, tools);
  return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 300), risk: riskOf(t.annotations || {}), annotated: !!t.annotations, ...(media?.tool === t.name ? { media: media.kind } : {}) }));
}
/** 094: the media kind a service can share on its own ('' when none, or when it cannot be reached). */
export const serviceMedia = (key, conn) => describeTools(key, conn).then((tools) => tools.find((t) => t.media)?.media || '', () => '');
/** 094: an agent's services with its own settings, the service's default and the tools (its Tools page). */
export async function agentServices(agent) {
  return Promise.all(Object.entries(effectiveServers(agent)).map(async ([key, srv]) => {
    const tools = await describeTools(key, connectionFor(agent, key, 'organizer')).catch(() => null);
    return { service: key, global: !!srv.global, own: agent.services?.[key] || {}, default: srv.behaviour || {}, tools, media: tools?.find((t) => t.media)?.media || '' };
  }));
}

/** Organizer-level connection (used to apply confirmed changes). */
export const organizerConnection = (agent, serverKey) => connectionFor(agent, serverKey, 'organizer');

/**
 * Build the tool list for an agent + role, in a chat (075: chat tools only as far as the chat's channel can do them;
 * no chat = the test console). `owner` (079): the sender is the owner (People tools with owner-level access). Returns { defs: [Anthropic tool defs], run: (name, input, ctx) => {isError, text}, meta: Map, services: [{ key, behaviour }], sharing: [services that share media on their own] }
 */
export async function toolsFor(agent, role, { chat = '', owner = false } = {}) {
  const allow = agent.tools[role] || [];
  const deny = [...(agent.tools.deny || [])];
  if (agent.confirm?.tool) deny.push(agent.confirm.tool); // confirming is never the model's job
  const defs = [];
  const meta = new Map();
  const services = []; // 094: { key, behaviour } of each service it may use
  const sharing = []; // 094: services whose media results it shares on its own

  for (const [serverKey, srv] of Object.entries(effectiveServers(agent))) {
    const sAllow = serverAllow(srv, serverKey, allow, role);
    if (!sAllow.some((r) => r.startsWith(`${serverKey}:`))) continue; // nothing of it allowed for this role
    let conn;
    let tools;
    try {
      conn = connectionFor(agent, serverKey, role);
      tools = await conn.listTools();
    } catch (e) {
      meta.set('__errors', [...(meta.get('__errors') || []), e.message]);
      continue;
    }
    const pair = changeTools(agent, serverKey, tools.map((t) => t.name)); // 093: preview → confirm tools of this service
    const b = behaviourOf(agent, serverKey, srv); // 094: when, changes, sharing, limits of this service for the agent
    services.push({ key: serverKey, behaviour: b });
    const mine = tools.filter((t) => matchesAny(`${serverKey}:${t.name}`, sAllow) && !matchesAny(`${serverKey}:${t.name}`, deny));
    const mt = b.share === 'off' ? null : mediaTool(serverKey, mine);
    if (mt) sharing.push({ key: serverKey, ...mt, share: b.share, style: b.style, behaviour: b, conn });
    for (const t of mine) {
      const fq = `${serverKey}:${t.name}`;
      const name = exposedName(serverKey, t.name);
      defs.push({
        name,
        description: (t.description || '').slice(0, 1000),
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      });
      meta.set(name, { kind: 'mcp', server: serverKey, tool: t.name, fq, conn, global: !!srv.global, annotations: t.annotations || {}, behaviour: b, override: b.tools[t.name] || '',
        change: t.name === pair.confirm ? 'confirm' : pair.preview(t.name) ? 'preview' : '', confirmTool: pair.confirm, undo: pair.undo ? `${serverKey}:${pair.undo}` : '' });
    }
  }

  // Built-in tools of one kind for this role: allowed by `allowRules` (null = no allow list) and never on the deny list.
  const addLocal = (kind, tools, allowRules) => {
    for (const t of tools) {
      const fq = `${kind}:${t.name}`;
      if (!t.roles.includes(role) || (allowRules && !matchesAny(fq, allowRules)) || matchesAny(fq, deny)) continue;
      const name = exposedName(kind, t.name);
      defs.push({ name, description: t.description, input_schema: t.input_schema });
      const b = behaviourOf(agent, kind, null); // Duniya's own tools: the same risk path (their annotations, the agent's changes)
      meta.set(name, { kind: 'local', fq, tool: t, annotations: t.annotations || {}, behaviour: b, override: b.tools[t.name] || '' });
    }
  };

  if (memoryEnabled(agent)) addLocal('memory', memoryTools, [...allow, ...(MEMORY_DEFAULT_ALLOW[role] || [])]);

  // People (079): the role's people: rules (or the defaults) when the agent's People access is on, or the sender is the owner.
  if (peopleScope(agent, { owner })) addLocal('people', peopleTools, peopleRules(agent, role));

  // Modules (081): each module that is on, by the role's "<module>:" rules (organizers all, participants the defaults)
  for (const m of liveModules()) addLocal(m.id, m.tools, moduleRules(agent, role, m));

  // Promises (092): agents that track promises; organizers see and change those of its chats, participants their own (decided in the tools)
  if (agent.promises?.track) addLocal('promises', promiseTools, null);

  // Chat actions (026, 075 by capability): role defaults unless the role has explicit whatsapp: rules; organizer-only
  // tools never reach participants (t.roles), and the deny list always wins.
  if (chatChannel()) addLocal('whatsapp', chatToolsFor(chat), chatToolRules(agent, role));

  // Photos & voice (043): create_image only when a connected provider can make pictures and the agent allows it for
  // this role (organizers on, participants off by default); the deny list always wins.
  if (chatChannel() && (!capsOf(chat) || capsOf(chat).media) && await imageToolAllowed(agent, role).catch(() => false)) addLocal('media', mediaTools, null);

  // Share on its own (094): one call picks the mood; code searches the service and posts after the text (chats that take media)
  if (sharing.length && chatChannel() && (!capsOf(chat) || capsOf(chat).media)) addLocal('whatsapp', [shareToolDef(sharing)], null);

  async function run(name, input, ctx) {
    const m = meta.get(name);
    if (!m || m.kind === undefined) return { isError: true, text: 'Not allowed for this user.' };
    if (m.kind === 'mcp') return m.conn.call(m.tool, input);
    try {
      const out = await m.tool.run(input || {}, ctx);
      return { isError: false, text: typeof out === 'string' ? out : JSON.stringify(out) };
    } catch (e) {
      return { isError: true, text: `Tool error: ${e.message}` };
    }
  }

  return { defs, run, meta, services, sharing };
}
