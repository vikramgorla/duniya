// @ts-check
// Global tool services (035): Settings → Tool services. Defined once, available to every agent (agents opt out per
// service). Same shape as an agent's tool-service routes (/api/agents/:id/…) so the panel reuses one editor.
// Local services run third-party code on this server: only the owner may add, change, remove or install them.
import { fail } from '../../core/config.js';
import { interpolate } from '../../core/store.js';
import { listAgents, updateAgent } from '../../core/agents.js';
import { listGlobalRows, getGlobalServer, saveGlobalServer, removeGlobalServer } from '../../core/global-mcp.js';
import { probeServer, startSignIn, listConnections, disconnect, deleteServerConnections, OAUTH_ROLES, GLOBAL_SCOPE } from '../../core/mcp-oauth.js';
import { installPackage, installedInfo, localServiceCheck } from '../../core/mcp-local.js';
import { resetMcpPool, mcpConnection } from '../../core/mcp.js';
import { serverConnection, oauthClientOf, describeTools, serviceMedia } from '../../core/tools.js';
import { serviceCredits } from '../../core/credits.js';
import { referencedSecrets } from '../../core/schema.js';
import { getSecret } from '../../core/store.js';
import { isHttps } from '../http.js';
import { registryRoutes } from './mcp-registry.js';

const ownerOnly = (user, ...configs) => {
  if (user?.role !== 'owner' && configs.some((c) => c?.type === 'local')) {
    throw fail('Only the owner can add, change or remove local tool services (they run code on this server)', 403);
  }
};

/** One global service as the panel and the admin tools see it (secret references, never values). */
function globalView(row, agents = listAgents()) {
  const optedOut = agents.filter((a) => (a.globalMcp?.disabled || []).includes(row.name)).map((a) => a.id);
  const replacedBy = agents.filter((a) => a.mcpServers?.[row.name]).map((a) => a.id);
  return {
    name: row.name, config: row.config, credit: serviceCredits()[row.name] || '', createdBy: row.createdBy, updatedAt: row.updatedAt, updatedBy: row.updatedBy,
    needs: referencedSecrets({ mcpServers: { [row.name]: row.config } }).filter((s) => !getSecret(s)),
    agents: { using: agents.filter((a) => !optedOut.includes(a.id) && !replacedBy.includes(a.id)).map((a) => a.id), optedOut, replacedBy },
  };
}

export function toolServiceRoutes(route) {
  registryRoutes(route); // 052: browse the MCP Registry and add from it
  // 2.58.1: credits of media services (the part all their results share): shown in the panel, never in messages
  route('GET', '/api/credits', async () => Object.entries(serviceCredits()).map(([service, credit]) => ({ service, credit })));
  route('GET', '/api/tool-services', async () => { const agents = listAgents(); return listGlobalRows().map((r) => globalView(r, agents)); });
  // 094: per service, the kind of media a read-only tool of it returns ('' = none), so it can be shared on its own;
  // apart from the list, so a slow service never holds up Settings
  route('GET', '/api/tool-services/media', async () => Object.fromEntries(await Promise.all(listGlobalRows().map(async (r) => {
    const conn = serverConnection(r.config, { scope: GLOBAL_SCOPE, key: r.name, role: 'organizer', where: 'Settings → Tool services' });
    // a local service is not started just to show this page
    return [r.name, r.config.type === 'local' && !conn.tools ? '' : await serviceMedia(r.name, conn)];
  }))));

  route('PUT', '/api/tool-services/:name', async (req, res, body, q, p, user) => {
    const before = getGlobalServer(p.name);
    ownerOnly(user, before, body);
    const { config, created } = saveGlobalServer(p.name, body, user.username);
    return [created ? 201 : 200, globalView({ ...listGlobalRows().find((r) => r.name === p.name), config })];
  });

  route('DELETE', '/api/tool-services/:name', async (req, res, body, q, p, user) => {
    const before = getGlobalServer(p.name);
    if (!before) return [404, { error: `No global tool service named ${p.name}` }];
    ownerOnly(user, before);
    removeGlobalServer(p.name, user.username);
    deleteServerConnections(GLOBAL_SCOPE, p.name);
    // Forget the agents' opt-outs, so a later service with the same name starts switched on everywhere.
    for (const a of listAgents()) {
      const off = a.globalMcp?.disabled || [];
      if (off.includes(p.name)) await updateAgent(a.id, { globalMcp: { disabled: off.filter((k) => k !== p.name) } }, user.username);
    }
    return { ok: true };
  });

  route('POST', '/api/tool-services/probe', async (req, res, body) => {
    const url = interpolate(String(body.url || '')).trim();
    if (!url) return [400, { error: 'Enter the tool service URL first' }];
    return probeServer(url);
  });

  route('POST', '/api/tool-services/discover', async (req, res, body) => {
    const saved = body.server ? getGlobalServer(String(body.server)) : null;
    if (saved && (body.auth === 'oauth' || body.type === 'local' || !body.url)) {
      return describeTools(body.server, serverConnection(saved, { scope: GLOBAL_SCOPE, key: body.server, role: 'organizer', where: 'Settings → Tool services' }), { fresh: true });
    }
    if (body.auth === 'oauth' || body.type === 'local') return [400, { error: 'Save the tool service first' }];
    const url = interpolate(String(body.url || ''));
    if (!url) return [400, { error: 'URL is empty (is its secret set?)' }];
    const headers = interpolate(body.headers && typeof body.headers === 'object' ? body.headers : {});
    return describeTools(String(body.server || ''), mcpConnection(url, { token: interpolate(String(body.token || '')), headers }), { fresh: true });
  });

  route('GET', '/api/tool-services/local', async () => listGlobalRows().filter((r) => r.config.type === 'local').map(({ name, config }) => {
    const i = installedInfo(config.package, config.allowScripts);
    return { server: name, package: config.package, blocked: localServiceCheck().reason || null, installed: i ? { name: i.name, version: i.version, at: i.at } : null };
  }));
  route('POST', '/api/tool-services/local/:server/install', async (req, res, body, q, p, user) => {
    const srv = getGlobalServer(p.server);
    if (!srv || srv.type !== 'local') return [404, { error: 'Save this local tool service first' }];
    const i = await installPackage(srv.package, { allowScripts: srv.allowScripts, fresh: !!body.fresh, by: user.username });
    await resetMcpPool();
    return { name: i.name, version: i.version, at: i.at };
  }, { role: 'owner' });

  // OAuth sign-ins of global services: one per service and role, shared by every agent.
  route('GET', '/api/tool-services/connections', async () => listConnections(GLOBAL_SCOPE));
  route('POST', '/api/tool-services/connections/:server/:role', async (req, res, body, q, p, user) => {
    const srv = getGlobalServer(p.server);
    if (!srv) return [404, { error: 'Save the tool service first' }];
    if (srv.auth !== 'oauth') return [400, { error: 'This tool service is not set to Sign in' }];
    if (!OAUTH_ROLES.includes(p.role)) return [400, { error: 'Unknown role' }];
    const url = interpolate(srv.url);
    if (!url) return [400, { error: 'The tool service URL is empty' }];
    const redirectUri = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}/oauth/mcp/callback`;
    return startSignIn({ agentId: GLOBAL_SCOPE, server: p.server, role: p.role, url, redirectUri, by: user.username, client: oauthClientOf(interpolate(srv)) });
  });
  route('DELETE', '/api/tool-services/connections/:server/:role', async (req, res, body, q, p, user) => {
    disconnect(GLOBAL_SCOPE, p.server, p.role, user.username);
    return { ok: true };
  });
}
