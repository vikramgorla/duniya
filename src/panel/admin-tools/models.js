// @ts-check
// Admin tools for models, tool services, the MCP Registry and secrets (see ../admin-tools.js for how a tool is described and run).
import { fail } from '../../core/config.js';
import { iso, enc, str, bool, int, obj, agentName } from './fields.js';

/** @type {import('../admin-tools.js').AdminTool[]} */
export const MODEL_TOOLS = [
  // ---------- models ----------
  { name: 'list_models', readOnly: true, calls: [['GET', '/api/models']], description: 'Models from the connected providers, and the default and background model. Never shows keys.',
    input: { refresh: bool('Ask the providers again (slower)') },
    run: (a, x) => x.call('GET', `/api/models${a.refresh ? '?refresh=1' : ''}`) },
  { name: 'list_model_accounts', readOnly: true, calls: [['GET', '/api/providers']],
    description: 'Connected model provider accounts (several per provider are possible, e.g. openai and openai-work) with their health: ok, paused (until when and why: usage limit, rate limit, outage…), or reconnect (sign-in expired), and how accounts of one provider are used (order or spread). Agent apps (Claude Code, Codex, GitHub Copilot) also show app: whether the app is downloaded and what it measured on this server (peakMb while answering, startMs, turns); connecting one is done by the owner in the panel (Models). Plan quotas are not read: a used-up limit shows as health paused until the reset the provider reported. Never shows keys.',
    input: {}, run: async (a, x) => (await x.call('GET', '/api/providers')).filter((p) => p.connected || p.error).map((p) => ({ id: p.id, name: p.name, type: p.type, provider: p.group, connected: p.connected, models: p.models, health: p.health, strategy: p.strategy, error: p.error, ...(p.app ? { app: p.app } : {}) })) },
  { name: 'get_model_fallback', readOnly: true, calls: [['GET', '/api/fallback']],
    description: 'Automatic model fallback: whether it is on, the chain of models tried when the chosen one fails with a retryable error (empty = any other connected provider\'s Auto), the strategy per provider for several accounts, and paused accounts. Agents and chats can override it (agent field "fallback": { mode, chain }; set_chat_settings).',
    input: {}, run: (a, x) => x.call('GET', '/api/fallback') },
  { name: 'set_model_fallback', calls: [['PUT', '/api/fallback']],
    description: 'Turn automatic model fallback on or off and/or set the chain (provider:model or provider:auto, in order; empty list = any other connected provider\'s Auto). Fallback only happens for limits, quota, outages, timeouts and expired sign-ins, never for refused requests, and never re-runs tools.',
    input: { enabled: bool('Fallback on (optional)'), chain: { type: 'array', items: { type: 'string' }, description: 'Models in order (optional)' } },
    run: (a, x) => x.call('PUT', '/api/fallback', { enabled: a.enabled, chain: a.chain }) },
  { name: 'set_account_strategy', calls: [['PUT', '/api/fallback/strategy']],
    description: 'How several accounts of one provider are used: "order" (the first account, the others only when it fails) or "spread" (least recently used first). provider = the provider value from list_model_accounts (e.g. openai, chatgpt, copilot, openrouter).',
    input: { provider: str('Provider'), strategy: { type: 'string', enum: ['order', 'spread'], description: 'order or spread' } }, required: ['provider', 'strategy'],
    run: (a, x) => x.call('PUT', '/api/fallback/strategy', { group: a.provider, strategy: a.strategy }) },
  { name: 'retry_model_account', openWorld: true, calls: [['POST', '/api/accounts/x/retry']],
    description: 'Clear the pause of a model account (after fixing its key, quota or sign-in) so it is tried again on the next message.',
    input: { account: str('Account id (see list_model_accounts)') }, required: ['account'],
    run: (a, x) => x.call('POST', `/api/accounts/${enc(a.account)}/retry`, {}) },
  { name: 'test_model_provider', openWorld: true, calls: [['POST', '/api/providers/x/test']],
    description: 'Send a tiny test prompt through one connected account (anthropic, openai, chatgpt, copilot, openrouter, another account id such as openai-work, or an endpoint id) and return the reply and response time. No fallback.',
    input: { provider: str('Account id') }, required: ['provider'],
    run: (a, x) => x.call('POST', `/api/providers/${enc(a.provider)}/test`, {}) },
  { name: 'set_default_models', destructive: true, idempotent: true, calls: [['POST', '/api/models/defaults']], description: 'Set the default model for agents, the background model (summaries) and/or Smart choice: the light and strong models of agents on "smart" ("auto" light = the background model, "auto" strong = the default model) and whether a tiny classifier call may decide when the rules are unsure. Values: "auto" or provider:model.',
    input: { default_model: str('Default model (optional)'), background_model: str('Background model (optional)'), light_model: str('Smart choice: light model (optional)'), strong_model: str('Smart choice: strong model (optional)'),
      smart_classifier: { type: 'boolean', description: 'Smart choice: ask the light model when the rules are unsure (optional)' } },
    run: (a, x) => {
      const b = {};
      if (a.default_model !== undefined) b.defaultModel = a.default_model;
      if (a.background_model !== undefined) b.backgroundModel = a.background_model;
      if (a.light_model !== undefined || a.strong_model !== undefined || a.smart_classifier !== undefined) b.smart = { light: a.light_model, strong: a.strong_model, classifier: a.smart_classifier };
      return x.call('POST', '/api/models/defaults', b);
    } },

  // ---------- global tool services (035) ----------
  { name: 'list_global_tool_services', readOnly: true, calls: [['GET', '/api/tool-services']],
    description: 'Tool services (MCP servers) defined once for all agents: their settings (secret names, never values), default tools per role, and which agents use them, switched them off (opted out) or replace them with their own service of the same name.',
    input: {},
    run: (a, x) => x.call('GET', '/api/tool-services') },
  // 094: how each tool service is used — a service's default for every agent, overridable per agent
  { name: 'get_tool_behaviour', readOnly: true, calls: [['GET', '/api/agents/x/services'], ['GET', '/api/tool-services']],
    description: 'How tool services are used. With agent_id: each service the agent can use, with its own settings ("own", only what differs), the service\'s default and the tools (name, risk from the tool\'s annotations: read | change | destructive, and "media" for a read-only tool whose results are media and can be shared on its own). Without agent_id: the global services\' defaults. Settings: when (asked | useful | proactive | often; for media services proactive and often also share on their own), note, changes (ask | clear | act; empty = the agent\'s "How sure before changing things"), style, perReply, perDay (0 = no limit), where (all | dm), tools ({ tool: read | change | destructive } overrides).',
    input: { agent_id: str('Agent id (optional)') },
    run: async (a, x) => (a.agent_id ? x.call('GET', `/api/agents/${enc(a.agent_id)}/services`)
      : (await x.call('GET', '/api/tool-services')).map((g) => ({ service: g.name, default: g.config.behaviour || {} }))) },
  { name: 'set_tool_behaviour', calls: [['GET', '/api/agents/x'], ['PUT', '/api/agents/x'], ['GET', '/api/tool-services'], ['PUT', '/api/tool-services/x']],
    description: 'Change how a tool service is used: with agent_id for that agent ("inherit" or "" = back to the service\'s default), without for the global service\'s default for every agent. Fields (only those given change): when: asked (only when someone asks for that kind of thing) | useful (the agent decides) | proactive (looks for chances) | often; for a service whose read-only tool returns media (GIFs, stickers, pictures), proactive also shares them on its own on clear moments (celebrations, thanks) and often also on jokes, welcomes and praise; note: a short instruction in the owner\'s words; changes: ask | clear | act (overrides the agent\'s "How sure before changing things" for this service; destructive tools always ask, read-only ones never do); style: words added to every media search (only mood and style words go to the service, never names); per_reply, per_day: most uses (0 = no limit); where: all | dm (results only in direct messages); tools: { "<tool>": "read" | "change" | "destructive" | "auto" } when a service declares a tool wrongly.',
    input: { agent_id: str('Agent id (optional)'), service: str('Tool service name'), when: { type: 'string', enum: ['inherit', 'asked', 'useful', 'proactive', 'often'] }, note: str('Short note (optional)'),
      changes: { type: 'string', enum: ['inherit', 'ask', 'clear', 'act'] }, style: str('Style words (optional)'),
      per_reply: int('Most uses per reply (0 = no limit)', { minimum: 0, maximum: 1000 }), per_day: int('Most uses per day (0 = no limit)', { minimum: 0, maximum: 1000 }),
      where: { type: 'string', enum: ['inherit', 'all', 'dm'] }, tools: obj('Per-tool risk overrides') }, required: ['service'],
    run: async (a, x) => {
      const patch = (cur) => {
        const out = { ...cur, tools: { ...(cur.tools || {}), ...(a.tools || {}) } };
        for (const [k, f] of [['when', 'when'], ['note', 'note'], ['changes', 'changes'], ['style', 'style'], ['per_reply', 'perReply'], ['per_day', 'perDay'], ['where', 'where']]) {
          if (a[k] === undefined) continue;
          if (a[k] === 'inherit' || a[k] === '') delete out[f]; else out[f] = a[k];
        }
        return out;
      };
      if (a.agent_id) {
        const cur = (await x.call('GET', `/api/agents/${enc(a.agent_id)}`)).config?.services || {};
        const r = await x.call('PUT', `/api/agents/${enc(a.agent_id)}`, { services: { ...cur, [a.service]: patch(cur[a.service] || {}) } });
        return { agent: r.id, service: a.service, settings: r.config?.services?.[a.service] || {} };
      }
      const g = (await x.call('GET', '/api/tool-services')).find((s) => s.name === a.service);
      if (!g) throw new Error(`No global tool service named ${a.service}`);
      const r = await x.call('PUT', `/api/tool-services/${enc(a.service)}`, { ...g.config, behaviour: patch(g.config.behaviour || {}) });
      return { service: r.name, default: r.config?.behaviour || {} };
    } },
  { name: 'add_global_tool_service', openWorld: true, risky: true, calls: [['PUT', '/api/tool-services/x']],
    description: 'Add (or replace) a tool service available to every agent. config: remote { url, auth: "none" | "token" | "oauth", tokens: { organizer, participant } as ${SECRET} references, headers } or local { type: "local", package, args, env, allowScripts } (local: owner only). defaults: tool-name globs per role used where an agent has no explicit "<name>:" rules, e.g. { "organizer": ["*"], "participant": ["agenda_*"] } (default: organizers all, participants none). OAuth services still need Connect in the panel (Settings → Tool services). An agent opts out with update_agent { "globalMcp": { "disabled": ["<name>"] } }. Needs confirm_action.',
    input: { name: str('Service name (lowercase letters, digits, _)'), config: obj('Service settings, optionally with "defaults"') }, required: ['name', 'config'],
    preview: async (a, x) => {
      const cur = (await x.call('GET', '/api/tool-services')).find((g) => g.name === a.name);
      const c = a.config || {};
      const what = c.type === 'local' ? `the local package ${c.package} (runs on this server)` : `${c.url || '(no url)'} (${c.auth || (c.tokens ? 'token' : 'no credentials')})`;
      const n = (await x.call('GET', '/api/agents')).filter((g) => !(g.config.globalMcp?.disabled || []).includes(a.name) && !g.config.mcpServers?.[a.name]).length;
      return `${cur ? 'Replace' : 'Add'} the global tool service ${a.name}: ${what}. It becomes available to ${n} agent${n === 1 ? '' : 's'}, with their role rules (or its defaults) deciding which tools each role gets.`;
    },
    run: (a, x) => x.call('PUT', `/api/tool-services/${enc(a.name)}`, a.config || {}) },
  { name: 'remove_global_tool_service', risky: true, calls: [['DELETE', '/api/tool-services/x']], description: 'Remove a global tool service from all agents (and its sign-ins). Needs confirm_action.',
    input: { name: str('Service name') }, required: ['name'],
    preview: async (a, x) => {
      const cur = (await x.call('GET', '/api/tool-services')).find((g) => g.name === a.name);
      if (!cur) throw fail(`No global tool service named ${a.name}`, 404);
      return `Remove the global tool service ${a.name}. ${cur.agents.using.length} agent${cur.agents.using.length === 1 ? '' : 's'} (${cur.agents.using.join(', ') || 'none'}) lose its tools right away; its sign-ins are deleted.`;
    },
    run: (a, x) => x.call('DELETE', `/api/tool-services/${enc(a.name)}`) },

  // ---------- browse the MCP Registry (052) ----------
  { name: 'search_mcp_registry', openWorld: true, readOnly: true, calls: [['GET', '/api/tool-services/registry']],
    description: 'Search the MCP Registry (registry.modelcontextprotocol.io, or the private registry set in Settings → Tool services) for tool services to add. Returns per entry: registry name, title, publisher (verified GitHub account or domain), whether it can run here hosted (remote) or as a local npm package, which keys it needs, trust hints and warnings, source link. Use next_cursor for more. Add one with add_tool_service_from_registry.',
    input: { query: str('Words in the service name, e.g. "notion" or "github"'), limit: int('How many (default 10, max 30)', { minimum: 1, maximum: 30 }), cursor: str('next_cursor from an earlier search (optional)') },
    run: async (a, x) => {
      const q = new URLSearchParams({ q: String(a.query || ''), limit: String(Math.min(Number(a.limit) || 10, 30)) });
      if (a.cursor) q.set('cursor', String(a.cursor));
      const r = await x.call('GET', `/api/tool-services/registry?${q}`);
      return {
        next_cursor: r.nextCursor, registry: r.registry,
        servers: r.items.map((s) => ({ name: s.name, title: s.title, description: s.description, version: s.version, publisher: s.publisher.label,
          hosted: s.can.remote !== null, local_npm: s.can.local !== null, ...(s.can.any ? {} : { not_supported_here: s.can.reason }),
          keys: s.auth.text, trust: s.trust.level, trust_hints: s.trust.hints, warnings: s.trust.warnings, source: s.repository?.url || null })),
      };
    } },
  { name: 'add_tool_service_from_registry', openWorld: true, risky: true, calls: [['POST', '/api/tool-services/registry/add']],
    description: 'Add a tool service from the MCP Registry to one agent or to all agents. kind "remote" (hosted; default when offered) or "local" (npm package run on this server; owner only, refused on small servers unless Small server mode is on). values: non-secret settings by field id (e.g. {"env:WORKSPACE": "acme"}). Keys and tokens are never passed here: store each with set_secret under the secret name the preview shows (or in the panel), then add. Organizers get its tools, participants none; risky tools are listed; a preview/confirm service gets the confirm step. Needs confirm_action.',
    input: { server: str('Registry name, e.g. io.github.owner/server'), target: str('"all" for all agents, or an agent id'), kind: str('remote or local', { enum: ['remote', 'local'] }),
      name: str('Tool service name (lowercase letters, digits, _; default from the registry name)'), values: obj('Non-secret field values by field id'), replace: bool('Replace a tool service with the same name') },
    required: ['server', 'target'],
    preview: async (a, x) => {
      const q = new URLSearchParams({ name: String(a.server) });
      if (a.name) q.set('key', String(a.name));
      const d = await x.call('GET', `/api/tool-services/registry/server?${q}`);
      const kind = a.kind || (d.remote ? 'remote' : 'local');
      const way = kind === 'local' ? d.local : d.remote;
      if (!way) throw fail(kind === 'local' ? `No package of ${a.server} can run here${d.entry.can.reason ? `: ${d.entry.can.reason}` : ''}` : `${a.server} has no hosted address this app can use`);
      if (kind === 'local' && !d.local.allowed) throw fail(d.local.reason, 403);
      const secretGiven = way.fields.filter((f) => f.secret && a.values?.[f.id]);
      if (secretGiven.length) throw fail(`Do not pass keys here: store ${secretGiven.map((f) => f.secretName).join(', ')} with set_secret (or in the panel) first`);
      const missing = way.fields.filter((f) => f.required && !f.stored && !(a.values?.[f.id]) && !f.default);
      if (missing.length) throw fail(`Needs first: ${missing.map((f) => (f.secret ? `secret ${f.secretName} (set_secret)` : `value ${f.id}`)).join(', ')}`);
      const where = a.target === 'all' ? 'all agents' : await agentName(x, a.target);
      const e = d.entry;
      const what = kind === 'local' ? `the local npm package ${e.packages[e.can.local].spec} (runs on this server)` : `the hosted service ${e.remotes[e.can.remote].url}`;
      const warn = e.trust.warnings.length ? ` Warnings: ${e.trust.warnings.join('; ')}.` : '';
      return `Add "${e.title}" (${e.name} ${e.version}, publisher ${e.publisher.label}) as tool service ${a.name || d.key} for ${where}: ${what}. Organizers get its tools, participants none.${warn}`;
    },
    run: async (a, x) => {
      const r = await x.call('POST', '/api/tool-services/registry/add', { server: a.server, target: a.target, kind: a.kind, key: a.name, values: a.values || {}, replace: !!a.replace });
      return { name: r.key, target: r.target, kind: r.kind, warnings: r.warnings, tools: r.discovery, confirm_step: r.confirmGate };
    } },

  // ---------- secrets ----------
  { name: 'list_secrets', readOnly: true, calls: [['GET', '/api/secrets']], description: 'Names of stored secrets (API keys, tokens) and whether each is set. Values are never shown.', input: {},
    run: (a, x) => x.call('GET', '/api/secrets') },
  // 060: values never pass through an AI assistant or a chat: the user enters them on a one-time panel link.
  { name: 'set_secret', noConfirm: true, calls: [['POST', '/api/secret-links']],
    description: 'Set or replace a secret (API key, token) or the API key of a model account WITHOUT seeing its value: returns a one-time link (15 minutes, single use) to a panel page where a signed-in owner or admin pastes the value. Give the link to the user exactly as returned; never ask them to type a key in the chat. Afterwards list_secrets (or list_model_accounts) shows it as set. Give name (UPPER_SNAKE_CASE) or account (an API-key account id from list_model_accounts). To connect a Telegram bot: name TELEGRAM_BOT_TOKEN; Telegram starts by itself once it is saved.',
    input: { name: str('Secret name, UPPER_SNAKE_CASE (or give account)'), account: str('Model account id whose API key to set (optional, instead of name)') },
    run: async (a, x) => {
      if (a.value !== undefined) throw fail('Secret values are never taken here: give only the name and send the user the link');
      const r = await x.call('POST', '/api/secret-links', { name: a.name, account: a.account, notify: String(x.surface || '').startsWith('whatsapp:') });
      return { for: r.for, link: r.link, expires: iso(r.expiresAt), note: 'One use, 15 minutes, panel sign-in (owner or admin) required. The value goes straight to the server.' };
    } },
  { name: 'remove_secret', risky: true, calls: [['PUT', '/api/secrets']], description: 'Remove a stored secret. Needs confirm_action.',
    input: { name: str('Secret name') }, required: ['name'],
    preview: async (a, x) => {
      const cur = (await x.call('GET', '/api/secrets')).find((s) => s.name === a.name);
      if (!cur) throw fail(`No secret named ${a.name}`, 404);
      return `Remove the secret ${a.name}.${cur.usedByAgents ? ' An agent uses it: that agent\'s tool service or model stops working until it is set again.' : ''}`;
    },
    run: (a, x) => x.call('PUT', '/api/secrets', { name: a.name, value: '' }) },

];
