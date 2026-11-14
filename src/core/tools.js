import { interpolate } from './store.js';
import { mcpConnection } from './mcp.js';
import { isConnected, runtimeProvider } from './mcp-oauth.js';
import { memoryTools, memoryEnabled, MEMORY_DEFAULT_ALLOW } from './memory.js';

/** "panduga:*_preview" style globs. */
export function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}
export const matchesAny = (name, patterns = []) => patterns.some((p) => globToRegex(p).test(name));

const exposedName = (server, tool) => `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

function connectionFor(bot, serverKey, role) {
  const srv = interpolate(bot.mcpServers[serverKey]);
  if (!srv?.url) throw new Error(`MCP server "${serverKey}" has no url (set its secret in the panel)`);
  if (srv.auth === 'oauth') {
    // Participants use their own sign-in when connected, otherwise the organizer's (tools still limited per role).
    const who = role === 'participant' && isConnected(bot.id, serverKey, 'participant', srv.url) ? 'participant' : 'organizer';
    if (!isConnected(bot.id, serverKey, who, srv.url)) {
      throw new Error(`Tool service "${serverKey}" is not signed in. An admin needs to click Connect in the panel (Bots → ${bot.name || bot.id}).`);
    }
    return mcpConnection(srv.url, { identity: `oauth:${bot.id}:${serverKey}:${who}`, authProvider: runtimeProvider(bot.id, serverKey, who, srv.url) });
  }
  const tokens = srv.tokens || {};
  // Participants use their own token when configured, otherwise the organizer/default token;
  // the per-role allowlist below is enforced either way.
  const token = (role === 'participant' && tokens.participant) || tokens.organizer || srv.token || '';
  return mcpConnection(srv.url, token);
}

/** Organizer-level connection (used to apply confirmed changes). */
export const organizerConnection = (bot, serverKey) => connectionFor(bot, serverKey, 'organizer');

/**
 * Build the tool list for a bot + role.
 * Returns { defs: [Anthropic tool defs], run: (name, input, ctx) => {isError, text}, meta: Map }
 */
export async function toolsFor(bot, role) {
  const allow = bot.tools[role] || [];
  const deny = [...(bot.tools.deny || [])];
  if (bot.confirm?.tool) deny.push(bot.confirm.tool); // confirming is never the model's job
  const defs = [];
  const meta = new Map();

  for (const serverKey of Object.keys(bot.mcpServers || {})) {
    let conn;
    let tools = [];
    try {
      conn = connectionFor(bot, serverKey, role);
      tools = await conn.listTools();
    } catch (e) {
      meta.set('__errors', [...(meta.get('__errors') || []), e.message]);
      continue;
    }
    for (const t of tools) {
      const fq = `${serverKey}:${t.name}`;
      if (!matchesAny(fq, allow) || matchesAny(fq, deny)) continue;
      const name = exposedName(serverKey, t.name);
      defs.push({
        name,
        description: (t.description || '').slice(0, 1000),
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      });
      meta.set(name, { kind: 'mcp', server: serverKey, tool: t.name, fq, conn });
    }
  }

  for (const t of bot.hooks?.tools || []) {
    const fq = `local:${t.name}`;
    const roles = t.roles || ['organizer', 'participant'];
    if (!roles.includes(role) || matchesAny(fq, deny)) continue;
    const name = exposedName('local', t.name);
    defs.push({ name, description: t.description || '', input_schema: t.input_schema || { type: 'object', properties: {} } });
    meta.set(name, { kind: 'local', fq, tool: t });
  }

  if (memoryEnabled(bot)) {
    const memAllow = [...allow, ...(MEMORY_DEFAULT_ALLOW[role] || [])];
    for (const t of memoryTools) {
      const fq = `memory:${t.name}`;
      if (!t.roles.includes(role) || !matchesAny(fq, memAllow) || matchesAny(fq, deny)) continue;
      const name = exposedName('memory', t.name);
      defs.push({ name, description: t.description, input_schema: t.input_schema });
      meta.set(name, { kind: 'local', fq, tool: t });
    }
  }

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

  return { defs, run, meta };
}
