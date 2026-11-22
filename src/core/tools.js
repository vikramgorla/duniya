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
import { changeTools } from './autonomy.js';
import { reactionTool, reactionSettings, reactionToolDef } from './reactions.js';


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

/** 094: the reaction search tool of a service ({ tool, kind, … } or null); `conn()` gives its connection. Never throws. */
export async function detectReaction(srv, conn) {
  if (srv?.reactions?.media === 'off') return null;
  let timer;
  try {
    const slow = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 5000); });
    return reactionTool(await Promise.race([conn().listTools(), slow]), srv?.reactions?.media);
  } catch { return null; } finally { clearTimeout(timer); }
}
/** 094: an agent's reaction media services with its own choice and the service's default (its Tools page). */
export async function reactionServicesOf(agent) {
  const out = [];
  for (const [key, srv] of Object.entries(effectiveServers(agent))) {
    const rt = await detectReaction(srv, () => connectionFor(agent, key, 'organizer'));
    if (rt) out.push({ service: key, global: !!srv.global, kind: rt.kind, tool: rt.tool, own: { mode: 'inherit', style: '', ...(agent.reactions?.[key] || {}) },
      default: { mode: srv.reactions?.mode || 'off', style: srv.reactions?.style || '' } });
  }
  return out;
}

/** Organizer-level connection (used to apply confirmed changes). */
export const organizerConnection = (agent, serverKey) => connectionFor(agent, serverKey, 'organizer');

/**
 * Build the tool list for an agent + role, in a chat (075: chat tools only as far as the chat's channel can do them;
 * no chat = the test console). `owner` (079): the sender is the owner (People tools with owner-level access). Returns { defs: [Anthropic tool defs], run: (name, input, ctx) => {isError, text}, meta: Map, reactions: [reaction media services on for it] }
 */
export async function toolsFor(agent, role, { chat = '', owner = false } = {}) {
  const allow = agent.tools[role] || [];
  const deny = [...(agent.tools.deny || [])];
  if (agent.confirm?.tool) deny.push(agent.confirm.tool); // confirming is never the model's job
  const defs = [];
  const meta = new Map();

  const reactions = []; // 094: reaction media services this agent uses on its own (send_reaction, every role)
  for (const [serverKey, srv] of Object.entries(effectiveServers(agent))) {
    const sAllow = serverAllow(srv, serverKey, allow, role);
    const rs = reactionSettings(agent, serverKey, srv);
    const forRole = sAllow.some((r) => r.startsWith(`${serverKey}:`));
    if (!forRole && rs.mode === 'off') continue; // nothing of it allowed for this role
    let conn;
    let tools;
    try {
      conn = connectionFor(agent, serverKey, forRole ? role : 'organizer');
      tools = await conn.listTools();
    } catch (e) {
      meta.set('__errors', [...(meta.get('__errors') || []), e.message]);
      continue;
    }
    const rt = rs.mode === 'off' ? null : reactionTool(tools, srv.reactions?.media);
    if (rt) reactions.push({ key: serverKey, ...rt, ...rs, conn });
    if (!forRole) continue;
    const pair = changeTools(agent, serverKey, tools.map((t) => t.name)); // 093: preview → confirm tools of this service
    for (const t of tools) {
      const fq = `${serverKey}:${t.name}`;
      if (!matchesAny(fq, sAllow) || matchesAny(fq, deny)) continue;
      const name = exposedName(serverKey, t.name);
      defs.push({
        name,
        description: (t.description || '').slice(0, 1000),
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      });
      meta.set(name, { kind: 'mcp', server: serverKey, tool: t.name, fq, conn, global: !!srv.global, annotations: t.annotations || {},
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
      meta.set(name, { kind: 'local', fq, tool: t });
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

  // Reactions (094): one call picks the mood; code searches the service and sends after the text (chats that take media)
  if (reactions.length && chatChannel() && (!capsOf(chat) || capsOf(chat).media)) addLocal('whatsapp', [reactionToolDef(reactions)], null);

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

  return { defs, run, meta, reactions };
}
