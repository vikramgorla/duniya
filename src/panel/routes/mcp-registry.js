// Browse tool services (052, issue #99): search the MCP Registry and add an entry as a tool service of one agent or of
// all agents (035) in one step. Same rules as adding by hand: local packages are owner-only (they run code on this
// server) and refused on small servers unless Small server mode is on (055); secret values are stored as secrets and never returned; tools are listed
// right after adding with the role defaults (organizers on, participants off) and risky tools flagged.
import { setSecret, getSecret, interpolate } from '../../core/store.js';
import { getAgent, updateAgent } from '../../core/agents.js';
import { getGlobalServer, saveGlobalServer } from '../../core/global-mcp.js';
import { probeServer, GLOBAL_SCOPE } from '../../core/mcp-oauth.js';
import { serverConnection } from '../../core/tools.js';
import { activity } from '../../core/events.js';
import {
  searchRegistry, getRegistryServer, registrySettings, saveRegistrySettings, addFields, buildConfig, suggestKey, validKey,
  localRegistryCheck, isRisky, confirmGateFor,
} from '../../core/mcp-registry.js';

const DISCOVER_MS = 15000;
const withTimeout = (p, ms, what) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} took too long`)), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
};
const err = (status, error, extra = {}) => [status, { error, ...extra }];

/** Tools with the defaults a new service gets: organizers on, participants off; risky ones flagged. */
export const toolDefaults = (tools) => tools.map((t) => ({
  name: t.name, description: String(t.description || '').slice(0, 300), risky: isRisky(t), organizer: true, participant: false,
}));

export function registryRoutes(route) {
  route('GET', '/api/tool-services/registry/settings', async () => registrySettings());
  route('PUT', '/api/tool-services/registry/settings', async (req, res, body, q, p, user) => {
    const s = saveRegistrySettings({ enabled: body.enabled, baseUrl: body.baseUrl });
    activity('config', { summary: `MCP Registry browsing ${s.enabled ? 'on' : 'off'} (${s.official ? 'official registry' : s.baseUrl}) by ${user.username}` });
    return s;
  }, { role: 'owner' });

  route('GET', '/api/tool-services/registry', async (req, res, body, q) => searchRegistry({ q: q.get('q') || '', limit: q.get('limit') || 20, cursor: q.get('cursor') || '' }), { role: 'admin' });

  // One entry with what the Add form needs: both ways to run it, their fields, a suggested name, and what this user
  // and this server allow.
  route('GET', '/api/tool-services/registry/server', async (req, res, body, q, p, user) => {
    const entry = await getRegistryServer(q.get('name'), q.get('version') || 'latest');
    const key = validKey(q.get('key') || '') ? q.get('key') : suggestKey(entry.name);
    const local = localRegistryCheck();
    const fields = (kind) => addFields(entry, kind, key).map((f) => ({ ...f, stored: !!(f.secretName && getSecret(f.secretName)) }));
    return {
      entry, key,
      remote: entry.can.remote === null ? null : { fields: fields('remote') },
      local: entry.can.local === null ? null : {
        fields: fields('local'), allowed: user.role === 'owner' && local.ok,
        reason: user.role !== 'owner' ? 'Only the owner can add local tool services (they run code on this server)' : local.reason || '',
      },
    };
  }, { role: 'admin' });

  route('POST', '/api/tool-services/registry/add', async (req, res, body, q, p, user) => {
    const entry = await getRegistryServer(body.server, body.version || 'latest');
    if (!entry.can.any) return err(400, `${entry.title} cannot run here: ${entry.can.reason}`, { code: 'unsupported' });
    const kind = body.kind || (entry.can.remote !== null ? 'remote' : 'local');
    if (kind === 'local') {
      if (user.role !== 'owner') return err(403, 'Only the owner can add local tool services (they run code on this server)');
      const c = localRegistryCheck();
      if (!c.ok) return err(400, c.reason, { code: 'small_server' });
    }
    const key = String(body.key || suggestKey(entry.name)).trim();
    if (!validKey(key)) return err(400, 'Name must be lowercase letters, digits or _ (and not a built-in name)', { field: 'key' });
    const target = String(body.target || '').trim();
    const agent = target === 'all' ? null : getAgent(target);
    if (target !== 'all' && !agent) return err(404, 'Choose an agent, or "all agents"', { field: 'target' });
    const exists = agent ? !!agent.mcpServers?.[key] : !!getGlobalServer(key);
    if (exists && !body.replace) return err(409, `A tool service named ${key} already exists ${agent ? `in ${agent.name}` : 'for all agents'}; choose another name or replace it`, { field: 'key', code: 'exists' });

    const built = buildConfig(entry, kind, key, body.values || {});
    if (built.missing.length) return err(400, `Fill in: ${built.missing.join(', ')}`, { missing: built.missing });
    const warnings = [...built.warnings];
    for (const s of built.secrets) setSecret(s.name, s.value);
    const config = built.config;

    // Hosted service without a declared key: ask the service itself (OAuth discovery, 009).
    if (config.type === 'remote' && config.auth === 'none' && !Object.keys(config.headers).length) {
      try {
        const pr = await probeServer(interpolate(config.url));
        if (pr.auth === 'oauth') config.auth = 'oauth';
        else if (pr.auth === 'token') warnings.push('The service asks for a key it does not describe in the registry: add a token in the tool service editor');
      } catch (e) { warnings.push(`Could not check the service yet (${e.message}); it was added without sign-in`); }
    }

    let gate = null;
    if (agent) {
      const tools = { ...agent.tools };
      if (!tools.organizer.some((r) => r.startsWith(`${key}:`))) tools.organizer = [...tools.organizer, `${key}:*`];
      await updateAgent(agent.id, { mcpServers: { ...agent.mcpServers, [key]: config }, tools }, user.username);
    } else {
      saveGlobalServer(key, { ...config, defaults: { organizer: ['*'], participant: [] } }, user.username);
    }
    activity('config', { summary: `Tool service ${key} added from the MCP Registry (${entry.name}@${entry.version}, ${kind === 'local' ? 'local package' : 'hosted'}) to ${agent ? agent.name : 'all agents'} by ${user.username}` });

    // List its tools now (hosted, no sign-in needed); OAuth needs Connect first, local packages an install first.
    let discovery;
    if (config.auth === 'oauth') discovery = { status: 'sign_in', note: 'Click Connect to sign in; then its tools are listed' };
    else if (config.type === 'local') discovery = { status: 'install', note: 'Install the package to list its tools' };
    else {
      try {
        const saved = agent ? getAgent(agent.id).mcpServers[key] : getGlobalServer(key);
        const conn = serverConnection(saved, { scope: agent ? agent.id : GLOBAL_SCOPE, key, role: 'organizer', where: agent ? `Agents → ${agent.name}` : 'Settings → Tool services' });
        const tools = await withTimeout(conn.listTools(), DISCOVER_MS, 'Listing its tools');
        discovery = { status: 'ok', tools: toolDefaults(tools) };
        gate = confirmGateFor(key, tools);
        if (gate && agent) {
          const fresh = getAgent(agent.id);
          if (!fresh.confirm) { await updateAgent(agent.id, { confirm: { ...gate, idField: 'confirm_id', ttlMinutes: 9 } }, user.username); gate = { ...gate, applied: true }; } else gate = { ...gate, applied: false, note: 'This agent already confirms changes through another service' };
        } else if (gate) gate = { ...gate, applied: false, note: 'Set the confirm step in each agent that should use it' };
      } catch (e) { discovery = { status: 'error', error: e.message }; }
    }
    return [201, {
      key, kind, target: agent ? agent.id : 'all', registry: { name: entry.name, version: entry.version },
      config: agent ? getAgent(agent.id).mcpServers[key] : getGlobalServer(key), secretsStored: built.secrets.map((s) => s.name),
      warnings, discovery, confirmGate: gate,
    }];
  });
}
