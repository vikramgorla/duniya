// Admin MCP tools (017). Each tool runs the same panel route handler in-process (not over HTTP), as the signed-in
// panel user, so role gates, validation and activity logging are exactly the panel's. `calls` names the routes a
// tool uses: the minimum role to see and run the tool is the highest role those routes require.
// Risky tools never run directly: they return a plain-language preview and a confirm code for confirm_action.

const enc = encodeURIComponent;
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const obj = (description) => ({ type: 'object', description, additionalProperties: true });
const ROLE_TEXT = { organizer: 'organizer', participant: 'participant' };

/** Remove bulky or sensitive-looking fields from route output (QR images are for the panel only). */
export function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !['qrDataUrl', 'qr'].includes(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}
const iso = (ts) => (ts ? new Date(ts).toISOString() : null);

async function agentName(x, id) {
  const b = await x.call('GET', `/api/agents/${enc(id)}`);
  return `"${b.name}" (${b.id})`;
}
async function chatName(x, chat) {
  const c = (await x.call('GET', '/api/chats')).find((r) => r.id === chat);
  return c ? `"${c.name}"` : `"${chat}"`;
}
async function numbers(x) {
  const ch = (await x.call('GET', '/api/status')).channel;
  return ch?.numbers || (ch ? [{ id: 'main', label: 'Main', ...ch }] : []);
}

/** @type {Array<{name, description, input, required?, calls, risky?, readOnly?, run, preview?}>} */
export const TOOLS = [
  // ---------- overview & activity ----------
  { name: 'get_overview', readOnly: true, calls: [['GET', '/api/status']],
    description: 'Overview of the app: version, uptime, memory, whether agents are paused, WhatsApp connection per number, agents, and how many changes wait for confirmation.',
    input: {},
    run: async (a, x) => {
      const s = await x.call('GET', '/api/status');
      return { you: { username: s.user.username, role: s.user.role }, version: s.version, uptimeSec: s.uptimeSec, memoryMb: s.memoryMb, node: s.node,
        agentsPaused: !!s.settings?.paused, whatsapp: (s.channel?.numbers || [s.channel]).map((n) => ({ id: n.id, label: n.label, status: n.status, me: n.me })),
        agents: s.agents, pendingConfirmations: s.pending };
    } },
  { name: 'list_activity', readOnly: true, calls: [['GET', '/api/activity']],
    description: 'Recent activity log entries (newest first): messages, replies, tool calls, confirmations, configuration changes, errors. Filter by agent or chat.',
    input: { agent_id: str('Only this agent (optional)'), chat: str('Only this chat id (optional)'), limit: int('How many (default 50, max 200)', { minimum: 1, maximum: 200 }),
      before_id: int('Only entries older than this id (for paging)'), include_details: bool('Include the detail payload of each entry (bigger)') },
    run: async (a, x) => {
      const q = new URLSearchParams({ limit: String(Math.min(Number(a.limit) || 50, 200)) });
      if (a.agent_id) q.set('agent', a.agent_id);
      if (a.chat) q.set('chat', a.chat);
      if (a.before_id) q.set('before', String(a.before_id));
      return (await x.call('GET', `/api/activity?${q}`)).map((r) => ({ id: r.id, time: iso(r.ts), type: r.type, agent: r.agent || undefined, chat: r.chat || undefined, summary: r.summary, ...(a.include_details && r.detail ? { detail: r.detail } : {}) }));
    } },

  // ---------- agents ----------
  { name: 'list_agents', readOnly: true, calls: [['GET', '/api/agents']], description: 'All agents with their settings (enabled, chats, triggers, model, tool services, schedules).', input: {},
    run: (a, x) => x.call('GET', '/api/agents') },
  { name: 'get_agent', readOnly: true, calls: [['GET', '/api/agents/x']], description: 'One agent with its full configuration.', input: { agent_id: str('Agent id') }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}`) },
  { name: 'list_templates', readOnly: true, calls: [['GET', '/api/templates']], description: 'Agent templates that create_agent can start from.', input: {},
    run: (a, x) => x.call('GET', '/api/templates') },
  { name: 'create_agent', calls: [['POST', '/api/agents']],
    description: 'Create an agent, from a template (see list_templates) and/or a configuration object (same fields as get_agent returns: name, prompt, model, triggers, chats, organizers, tools, schedules, memory, …).',
    input: { id: str('New agent id (lowercase letters, digits, -). Optional: derived from the name'), template: str('Template id (optional)'), config: obj('Configuration fields (optional, override the template)') },
    run: (a, x) => x.call('POST', '/api/agents', { id: a.id, template: a.template, config: a.config || {} }) },
  { name: 'update_agent', calls: [['PUT', '/api/agents/x']],
    description: 'Change fields of an agent (only the fields given change), e.g. { "prompt": "…", "triggers": ["!help"], "model": "auto" }. Returns the agent and any warnings.',
    input: { agent_id: str('Agent id'), changes: obj('Fields to change') }, required: ['agent_id', 'changes'],
    run: (a, x) => x.call('PUT', `/api/agents/${enc(a.agent_id)}`, a.changes || {}) },
  { name: 'get_agent_people', readOnly: true, calls: [['GET', '/api/agents/x/people']],
    description: 'Members of the agent\'s WhatsApp groups (name, number, group admin) with their role for this agent (organizer or participant). To change roles, update_agent with "organizers" (phone numbers).',
    input: { agent_id: str('Agent id') }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/people`) },
  { name: 'draft_agent_with_ai', calls: [['POST', '/api/ai/agent-draft']],
    description: 'Ask the app\'s AI helper to draft a new agent (no agent_id) or changes to an agent from a plain-language request. Returns a summary, the changed fields (before/after) and the full proposed config. Nothing is saved: apply with create_agent (config = proposed) or update_agent (changes = the changed fields).',
    input: { agent_id: str('Agent to change (omit to draft a new agent)'), request: str('What you want, in plain words'), model: str('Model to use: "auto" (default) or provider:model') }, required: ['request'],
    run: (a, x) => x.call('POST', '/api/ai/agent-draft', { agentId: a.agent_id, request: a.request, model: a.model || 'auto' }) },
  { name: 'set_agent_enabled', calls: [['PUT', '/api/agents/x']], description: 'Turn an agent on or off. A disabled agent does not answer anywhere.',
    input: { agent_id: str('Agent id'), enabled: bool('true = on, false = off') }, required: ['agent_id', 'enabled'],
    run: (a, x) => x.call('PUT', `/api/agents/${enc(a.agent_id)}`, { enabled: !!a.enabled }) },
  { name: 'duplicate_agent', calls: [['POST', '/api/agents/x/duplicate']], description: 'Copy an agent (without its chats). The copy is named "<name> (copy)".',
    input: { agent_id: str('Agent to copy'), new_id: str('Id for the copy (optional)') }, required: ['agent_id'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/duplicate`, { id: a.new_id }) },
  { name: 'export_agent', readOnly: true, calls: [['GET', '/api/agents/x/export']], description: 'Export an agent as a JSON document (names of the secrets it needs, never their values).',
    input: { agent_id: str('Agent id') }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/export`) },
  { name: 'delete_agent', risky: true, calls: [['DELETE', '/api/agents/x']], description: 'Delete an agent. Needs confirm_action.',
    input: { agent_id: str('Agent id') }, required: ['agent_id'],
    preview: async (a, x) => `Delete the agent ${await agentName(x, a.agent_id)}. Its chats stop getting replies and its settings are gone (export it first to keep a copy). This cannot be undone.`,
    run: (a, x) => x.call('DELETE', `/api/agents/${enc(a.agent_id)}`) },
  { name: 'run_schedule_now', calls: [['POST', '/api/agents/x/schedules/y/run']], description: 'Run one of an agent\'s scheduled posts now (it posts to the chat as it would on schedule).',
    input: { agent_id: str('Agent id'), schedule_id: str('Schedule id (see get_agent → schedules)') }, required: ['agent_id', 'schedule_id'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/schedules/${enc(a.schedule_id)}/run`) },
  { name: 'test_agent', calls: [['POST', '/api/agents/x/test']],
    description: 'Send a test message to an agent, like the panel\'s test console, and get its reply. Nothing is posted to WhatsApp. "as" picks the sender\'s role (organizer or participant).',
    input: { agent_id: str('Agent id'), text: str('Message text'), as: { type: 'string', enum: ['organizer', 'participant'], description: 'Sender role (default participant)' },
      chat: str('Test as if in this chat of the agent (its memory, group or direct, model); omit for a new direct chat') }, required: ['agent_id', 'text'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/test`, { text: a.text, role: ROLE_TEXT[a.as] || 'participant', chat: a.chat || 'new' }) },
  { name: 'list_agent_tools', readOnly: true, calls: [['GET', '/api/agents/x/test-tools']],
    description: 'The tools an agent can use for a role (organizer or participant), grouped by tool service — what the test console shows under "Test as…".',
    input: { agent_id: str('Agent id'), as: { type: 'string', enum: ['organizer', 'participant'], description: 'Role (default participant)' } }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/test-tools?role=${ROLE_TEXT[a.as] || 'participant'}`) },

  // ---------- chats & memory ----------
  { name: 'list_silences', readOnly: true, calls: [['GET', '/api/silences']],
    description: 'Why agents stayed silent, per chat, agent and reason (chat off, not mentioned, no agent, agent off, paused, direct messages off, sender not allowed, rate limit, model error, empty answer, budget cap), with a count, last time and a sample sender. Never message text. Most frequent first.',
    input: { chat: str('Only this chat id (optional)'), agent_id: str('Only this agent (optional)'), reason: str('Only this reason key (optional)'), days: int('Look back this many days (default 7)', { minimum: 1, maximum: 400 }) },
    run: async (a, x) => {
      const q = new URLSearchParams({ days: String(a.days || 7) });
      if (a.chat) q.set('chat', a.chat);
      if (a.agent_id) q.set('agent', a.agent_id);
      if (a.reason) q.set('reason', a.reason);
      return (await x.call('GET', `/api/silences?${q}`)).silences.map((r) => ({ chat: r.chat, agent: r.agent || undefined, reason: r.reason, label: r.label, explain: r.explain, count: r.count, last: iso(r.lastTs), sampleSender: r.sampleSender || undefined }));
    } },
  { name: 'list_chats', readOnly: true, calls: [['GET', '/api/chats']], description: 'WhatsApp groups and 1:1 chats the numbers know, with their agent, model and logging settings.', input: {},
    run: (a, x) => x.call('GET', '/api/chats') },
  { name: 'assign_chat', calls: [['POST', '/api/chats/bind']], description: 'Choose which agent answers in a chat. Empty agent_id removes the agent from the chat.',
    input: { chat: str('Chat id (see list_chats)'), agent_id: str('Agent id, or empty to unassign') }, required: ['chat'],
    run: (a, x) => x.call('POST', '/api/chats/bind', { chat: a.chat, agent: a.agent_id || null }) },
  { name: 'set_chat_settings', calls: [['PUT', '/api/chats/x/prefs']],
    description: 'Per-chat model and activity logging. model: inherit | auto | provider:auto | provider:model. logging: inherit | off | minimal | normal | verbose.',
    input: { chat: str('Chat id'), model: str('Model (optional)'), logging: { type: 'string', enum: ['inherit', 'off', 'minimal', 'normal', 'verbose'], description: 'Logging level (optional)' } }, required: ['chat'],
    run: (a, x) => x.call('PUT', `/api/chats/${enc(a.chat)}/prefs`, { model: a.model, logging: a.logging }) },
  { name: 'list_chat_messages', readOnly: true, calls: [['GET', '/api/chats/x/messages']],
    description: 'Messages stored for a chat (newest first), optionally filtered by text. Admins and owners only; each look is recorded in the activity log.',
    input: { chat: str('Chat id'), search: str('Only messages containing this text (optional)'), limit: int('How many (default 30, max 200)', { minimum: 1, maximum: 200 }), before_id: int('Only older than this message id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/messages?limit=${Math.min(Number(a.limit) || 30, 200)}${a.before_id ? `&before=${a.before_id}` : ''}${a.search ? `&q=${enc(a.search)}` : ''}`) },
  { name: 'get_usage', readOnly: true, calls: [['GET', '/api/usage']],
    description: 'Tokens and estimated cost of model calls, grouped by agent, chat, provider, model, kind (reply, summary, scheduled, ai-helper, test) or day. period: 1d, 7d, 30d (default), 90d, all. Costs only where a price is set or published; ChatGPT plan / Copilot calls are "included".',
    input: { group_by: str('agent | chat | provider | model | kind | day'), period: str('1d | 7d | 30d | 90d | all'), agent_id: str('Only this agent (optional)'), chat: str('Only this chat (optional)') },
    run: (a, x) => x.call('GET', `/api/usage?groupBy=${enc(a.group_by || 'agent')}&period=${enc(a.period || '30d')}${a.agent_id ? `&agent=${enc(a.agent_id)}` : ''}${a.chat ? `&chat=${enc(a.chat)}` : ''}`) },
  { name: 'set_model_price', calls: [['PUT', '/api/usage/prices']],
    description: 'Set the price of a model in USD per million tokens (input and output) so usage shows costs. Empty values remove the price.',
    input: { model: str('provider:model'), input_per_million: { type: 'number' }, output_per_million: { type: 'number' } }, required: ['model'],
    run: (a, x) => x.call('PUT', '/api/usage/prices', { model: a.model, input: a.input_per_million, output: a.output_per_million }) },
  // ---------- spending caps (040) and owner alerts (041) ----------
  { name: 'get_spending_caps', readOnly: true, calls: [['GET', '/api/budget']],
    description: 'Monthly spending caps per agent and per chat with this month\'s spend (USD where prices are known, tokens otherwise), how full each cap is and its state: ok, warning (80%+), quiet (100%: the agent stays quiet there) or fallback (100%: a cheaper model is used).',
    input: {},
    run: (a, x) => x.call('GET', '/api/budget') },
  { name: 'set_spending_cap', calls: [['PUT', '/api/budget/agent/x']],
    description: 'Set a monthly cap for an agent or a chat: cost_usd (needs model prices) and/or tokens (works without prices). At 80% the owner gets a WhatsApp alert; at 100% the agent stays quiet in that scope, or uses fallback_model if given. Leave both cost_usd and tokens empty to remove the cap.',
    input: { scope: { type: 'string', enum: ['agent', 'chat'], description: 'agent or chat' }, id: str('Agent id or chat id'), cost_usd: { type: 'number', description: 'Monthly cost cap in USD (optional)' },
      tokens: int('Monthly token cap (optional, at least 1000)'), fallback_model: str('Cheaper model (provider:model) to use at 100% instead of staying quiet (optional)') }, required: ['scope', 'id'],
    run: (a, x) => x.call('PUT', `/api/budget/${enc(a.scope)}/${enc(a.id)}`, { cost: a.cost_usd ?? null, tokens: a.tokens ?? null, fallback: a.fallback_model || '' }) },
  { name: 'get_owner_alerts', readOnly: true, calls: [['GET', '/api/alerts']],
    description: 'Where owner alerts go on WhatsApp (alertsTo) and the weekly summary settings (day, time, whether it is active).',
    input: {},
    run: (a, x) => x.call('GET', '/api/alerts') },
  { name: 'set_owner_alerts', calls: [['PUT', '/api/alerts']],
    description: 'Owner only. Set the WhatsApp number owner alerts and the weekly summary go to (with country code; empty = none), and the weekly summary: enabled, day (mon…sun), at (HH:MM, server time).',
    input: { alerts_to: str('Phone number with country code (optional)'), weekly_enabled: bool('Weekly summary on or off (optional)'), weekly_day: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, weekly_at: str('HH:MM (optional)') },
    run: (a, x) => {
      const weekly = {};
      if (a.weekly_enabled !== undefined) weekly.enabled = a.weekly_enabled;
      if (a.weekly_day) weekly.day = a.weekly_day;
      if (a.weekly_at) weekly.at = a.weekly_at;
      return x.call('PUT', '/api/alerts', { ...(a.alerts_to !== undefined ? { alertsTo: a.alerts_to } : {}), ...(Object.keys(weekly).length ? { weekly } : {}) });
    } },
  { name: 'preview_weekly_summary', readOnly: true, calls: [['GET', '/api/alerts/weekly/preview']],
    description: 'The weekly summary text as it would be sent now (counts and costs only, no message contents).',
    input: {},
    run: async (a, x) => (await x.call('GET', '/api/alerts/weekly/preview')).text },
  { name: 'send_weekly_summary', calls: [['POST', '/api/alerts/weekly/send']],
    description: 'Owner only. Send the weekly summary to the owner\'s WhatsApp now.',
    input: {},
    run: (a, x) => x.call('POST', '/api/alerts/weekly/send') },
  { name: 'list_contacts', readOnly: true, calls: [['GET', '/api/contacts']], description: 'Contacts (WhatsApp names synced from the phone + own entries). Shared ones can be looked up by participants through agents.',
    input: { query: str('Name, note or number to filter by (optional)'), shared_only: { type: 'boolean' } },
    run: (a, x) => x.call('GET', `/api/contacts?q=${enc(a.query || '')}${a.shared_only ? '&shared=1' : ''}`) },
  { name: 'save_contact', calls: [['PUT', '/api/contacts/x']], description: 'Add or change a contact: phone with country code, name, note, shared (participants may look it up).',
    input: { phone: str('Phone with country code'), name: str('Name'), note: str('Short note (optional)'), shared: { type: 'boolean' } }, required: ['phone'],
    run: (a, x) => x.call('PUT', `/api/contacts/${enc(a.phone)}`, { name: a.name, note: a.note, shared: a.shared }) },
  { name: 'remove_contact', calls: [['DELETE', '/api/contacts/x']], description: 'Remove an own contact (a WhatsApp-synced name stays, unshared).',
    input: { phone: str('Phone with country code') }, required: ['phone'],
    run: (a, x) => x.call('DELETE', `/api/contacts/${enc(a.phone)}`) },
  { name: 'get_agent_memory', readOnly: true, calls: [['GET', '/api/agents/x/memory']], description: 'Notes an agent shares across all its chats (shared memory). Delete one with delete_note.',
    input: { agent_id: str('Agent id') }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/memory`) },
  { name: 'get_chat_memory', readOnly: true, calls: [['GET', '/api/chats/x/memory']], description: 'What an agent remembers about a chat: running summary, notes and message counts.',
    input: { chat: str('Chat id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/memory`) },
  { name: 'rebuild_chat_summary', calls: [['POST', '/api/chats/x/memory/summarize']], description: 'Rebuild the running summary of a chat now.',
    input: { chat: str('Chat id') }, required: ['chat'],
    run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/memory/summarize`) },
  { name: 'erase_chat_memory', risky: true, calls: [['DELETE', '/api/chats/x/memory']], description: 'Erase everything the agents remember about a chat (history, summary, notes). Needs confirm_action.',
    input: { chat: str('Chat id') }, required: ['chat'],
    preview: async (a, x) => `Erase the memory of chat ${await chatName(x, a.chat)}: stored messages, summary and notes. The agent forgets the conversation. This cannot be undone.`,
    run: (a, x) => x.call('DELETE', `/api/chats/${enc(a.chat)}/memory`) },

  // ---------- WhatsApp groups (026) ----------
  { name: 'get_group_info', readOnly: true, calls: [['GET', '/api/chats/x/whatsapp']],
    description: 'A WhatsApp group\'s name, description, settings (only admins send, only admins edit info, join approval) and members with admin badges.',
    input: { chat: str('Group chat id (see list_chats)') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp`) },
  { name: 'get_group_invite_link', readOnly: true, calls: [['GET', '/api/chats/x/whatsapp/invite']],
    description: 'The invite link of a WhatsApp group (the agent\'s number must be a group admin). Each look is recorded.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp/invite`) },
  { name: 'reset_group_invite_link', risky: true, calls: [['POST', '/api/chats/x/whatsapp/invite/revoke']],
    description: 'Reset a WhatsApp group\'s invite link (the old link stops working). Needs confirm_action.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    preview: async (a, x) => `Reset the invite link of ${await chatName(x, a.chat)}. Anyone holding the old link can no longer join with it; share the new link instead.`,
    run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/whatsapp/invite/revoke`) },
  { name: 'update_group', calls: [['PUT', '/api/chats/x/whatsapp']],
    description: 'Change a WhatsApp group: name, description, only_admins_send, only_admins_edit_info, join_approval. Give only what changes. The agent\'s number must be a group admin.',
    input: { chat: str('Group chat id'), name: str('New group name (optional)'), description: str('New description (optional, empty clears)'),
      only_admins_send: bool('Only admins can send messages (optional)'), only_admins_edit_info: bool('Only admins can edit name/picture/description (optional)'),
      join_approval: bool('Admins approve new members (optional)') }, required: ['chat'],
    run: (a, x) => x.call('PUT', `/api/chats/${enc(a.chat)}/whatsapp`, { subject: a.name, description: a.description, announcement: a.only_admins_send, locked: a.only_admins_edit_info, joinApproval: a.join_approval }) },

  // ---------- models ----------
  { name: 'list_models', readOnly: true, calls: [['GET', '/api/models']], description: 'Models from the connected providers, and the default and background model. Never shows keys.',
    input: { refresh: bool('Ask the providers again (slower)') },
    run: (a, x) => x.call('GET', `/api/models${a.refresh ? '?refresh=1' : ''}`) },
  { name: 'test_model_provider', calls: [['POST', '/api/providers/x/test']],
    description: 'Send a tiny test prompt through a connected provider (anthropic, openai, chatgpt, copilot, openrouter or another endpoint id) and return the reply and response time.',
    input: { provider: str('Provider id') }, required: ['provider'],
    run: (a, x) => x.call('POST', `/api/providers/${enc(a.provider)}/test`, {}) },
  { name: 'set_default_models', calls: [['POST', '/api/models/defaults']], description: 'Set the default model for agents and/or the background model (summaries). Values: "auto" or provider:model.',
    input: { default_model: str('Default model (optional)'), background_model: str('Background model (optional)') },
    run: (a, x) => {
      const b = {};
      if (a.default_model !== undefined) b.defaultModel = a.default_model;
      if (a.background_model !== undefined) b.backgroundModel = a.background_model;
      return x.call('POST', '/api/models/defaults', b);
    } },

  // ---------- global tool services (035) ----------
  { name: 'list_global_tool_services', readOnly: true, calls: [['GET', '/api/tool-services']],
    description: 'Tool services (MCP servers) defined once for all agents: their settings (secret names, never values), default tools per role, and which agents use them, switched them off (opted out) or replace them with their own service of the same name.',
    input: {},
    run: (a, x) => x.call('GET', '/api/tool-services') },
  { name: 'add_global_tool_service', risky: true, calls: [['PUT', '/api/tool-services/x']],
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
      if (!cur) throw Object.assign(new Error(`No global tool service named ${a.name}`), { status: 404 });
      return `Remove the global tool service ${a.name}. ${cur.agents.using.length} agent${cur.agents.using.length === 1 ? '' : 's'} (${cur.agents.using.join(', ') || 'none'}) lose its tools right away; its sign-ins are deleted.`;
    },
    run: (a, x) => x.call('DELETE', `/api/tool-services/${enc(a.name)}`) },

  // ---------- secrets ----------
  { name: 'list_secrets', readOnly: true, calls: [['GET', '/api/secrets']], description: 'Names of stored secrets (API keys, tokens) and whether each is set. Values are never shown.', input: {},
    run: (a, x) => x.call('GET', '/api/secrets') },
  { name: 'set_secret', risky: true, calls: [['PUT', '/api/secrets']],
    description: 'Store a secret value (encrypted on the server, never shown again). Needs confirm_action. Prefer entering keys in the panel: values given here pass through the AI assistant.',
    input: { name: str('UPPER_SNAKE_CASE name'), value: str('The value') }, required: ['name', 'value'],
    preview: async (a, x) => {
      if (!a.value) throw Object.assign(new Error('value is empty; use remove_secret to remove a secret'), { status: 400 });
      const cur = (await x.call('GET', '/api/secrets')).find((s) => s.name === a.name);
      return `${cur?.set ? 'Replace' : 'Set'} the secret ${a.name}${cur?.usedByAgents ? ' (used by an agent)' : ''}. Agents using it pick up the new value right away.`;
    },
    run: (a, x) => x.call('PUT', '/api/secrets', { name: a.name, value: a.value }) },
  { name: 'remove_secret', risky: true, calls: [['PUT', '/api/secrets']], description: 'Remove a stored secret. Needs confirm_action.',
    input: { name: str('Secret name') }, required: ['name'],
    preview: async (a, x) => {
      const cur = (await x.call('GET', '/api/secrets')).find((s) => s.name === a.name);
      if (!cur) throw Object.assign(new Error(`No secret named ${a.name}`), { status: 404 });
      return `Remove the secret ${a.name}.${cur.usedByAgents ? ' An agent uses it: that agent\'s tool service or model stops working until it is set again.' : ''}`;
    },
    run: (a, x) => x.call('PUT', '/api/secrets', { name: a.name, value: '' }) },

  // ---------- pending confirmations ----------
  { name: 'list_pending_confirmations', readOnly: true, calls: [['GET', '/api/pending']], description: 'Changes that agents prepared and that wait for a human to confirm in WhatsApp or the panel.', input: {},
    run: async (a, x) => (await x.call('GET', '/api/pending')).map((p) => ({ ...p, expires: iso(p.expires) })) },
  { name: 'cancel_pending_confirmation', calls: [['DELETE', '/api/pending/x']], description: 'Cancel a waiting change so it can no longer be confirmed.',
    input: { code: str('Its code (see list_pending_confirmations)') }, required: ['code'],
    run: (a, x) => x.call('DELETE', `/api/pending/${enc(a.code)}`) },

  // ---------- settings ----------
  { name: 'set_agents_paused', calls: [['POST', '/api/settings']], description: 'Pause (true) or resume (false) all agents at once.',
    input: { paused: bool('true = pause all agents') }, required: ['paused'],
    run: async (a, x) => ({ paused: !!(await x.call('POST', '/api/settings', { paused: !!a.paused })).paused }) },
  { name: 'get_logging_settings', readOnly: true, calls: [['GET', '/api/logging']], description: 'What the activity log records: level, categories, retention.', input: {},
    run: (a, x) => x.call('GET', '/api/logging') },
  { name: 'set_logging_settings', calls: [['PUT', '/api/logging']],
    description: 'Change what the activity log records. level: minimal | normal | verbose; categories: { name: true/false } (see get_logging_settings); retention_days; max_entries.',
    input: { level: { type: 'string', enum: ['minimal', 'normal', 'verbose'], description: 'Level (optional)' }, categories: obj('Category switches (optional)'),
      retention_days: int('Keep for days (1–365, optional)'), max_entries: int('At most entries (500–100000, optional)') },
    run: (a, x) => x.call('PUT', '/api/logging', { level: a.level, categories: a.categories, retentionDays: a.retention_days, maxEntries: a.max_entries }) },

  // ---------- updates ----------
  { name: 'get_update_status', readOnly: true, calls: [['GET', '/api/updates']], description: 'Running version, last update check, whether an update is available or running.', input: {},
    run: (a, x) => x.call('GET', '/api/updates') },
  { name: 'check_for_updates', calls: [['POST', '/api/updates/check']], description: 'Check GitHub for a newer version now.', input: {},
    run: (a, x) => x.call('POST', '/api/updates/check') },
  { name: 'apply_update', risky: true, calls: [['POST', '/api/updates/apply']], description: 'Install the available update and restart. Needs confirm_action.', input: {},
    preview: async (a, x) => {
      const st = await x.call('POST', '/api/updates/check');
      if (!st.available) throw Object.assign(new Error(`Already up to date (${st.current || 'current version'})`), { status: 400 });
      return `Update from ${st.current} to ${st.target || st.latest}. The app restarts: agents are offline for 1–2 minutes.`;
    },
    run: (a, x) => x.call('POST', '/api/updates/apply') },

  // ---------- server ----------
  { name: 'get_server_metrics', readOnly: true, calls: [['GET', '/api/system']], description: 'Server CPU, memory, disk, load and uptime right now.', input: {},
    run: (a, x) => x.call('GET', '/api/system') },
  { name: 'list_os_updates', readOnly: true, calls: [['GET', '/api/system/os-updates']], description: 'Operating-system packages that can be updated.',
    input: { refresh: bool('Check again now (slower)') },
    run: (a, x) => x.call('GET', `/api/system/os-updates${a.refresh ? '?refresh=1' : ''}`) },
  { name: 'get_maintenance_status', readOnly: true, calls: [['GET', '/api/system/ops']], description: 'Available server maintenance actions and the state of the last one.', input: {},
    run: (a, x) => x.call('GET', '/api/system/ops') },
  { name: 'run_maintenance', risky: true, calls: [['POST', '/api/system/ops']],
    description: 'Run a server maintenance action: os-update, os-cleanup, restart-web, restart-tunnel or reboot. Needs confirm_action.',
    input: { action: { type: 'string', enum: ['os-update', 'os-cleanup', 'restart-web', 'restart-tunnel', 'reboot'], description: 'Action' } }, required: ['action'],
    preview: async (a, x) => {
      const ops = await x.call('GET', '/api/system/ops');
      const label = ops.actions?.[a.action];
      if (!label) throw Object.assign(new Error('Unknown action'), { status: 400 });
      const effect = { reboot: 'The whole server restarts: agents and the panel are offline for a few minutes.', 'os-update': 'Takes a few minutes; services may restart.',
        'restart-web': 'The panel and AI-assistant access are unreachable for a few seconds.', 'restart-tunnel': 'The panel and AI-assistant access are unreachable for a few seconds.' }[a.action] || '';
      return `${label}. ${effect}`.trim();
    },
    run: (a, x) => x.call('POST', '/api/system/ops', { action: a.action }) },
  { name: 'restart_app', risky: true, calls: [['POST', '/api/system/restart']], description: 'Restart the app. Needs confirm_action.', input: {},
    preview: async () => 'Restart the app. Agents are offline for about a minute and this connection drops briefly.',
    run: (a, x) => x.call('POST', '/api/system/restart') },

  // ---------- backups ----------
  { name: 'get_backup_status', readOnly: true, calls: [['GET', '/api/backups']], description: 'Backup settings, where backups go, and the last backup.', input: {},
    run: (a, x) => x.call('GET', '/api/backups') },
  { name: 'list_backups', readOnly: true, calls: [['GET', '/api/backups/list']], description: 'Backups available in one place: local (default), github or s3.',
    input: { source: { type: 'string', enum: ['local', 'github', 's3'], description: 'Where (default local)' } },
    run: (a, x) => x.call('GET', `/api/backups/list?source=${enc(a.source || 'local')}`) },
  { name: 'run_backup', calls: [['POST', '/api/backups/run']], description: 'Make an encrypted backup now and send it to the configured places.', input: {},
    run: (a, x) => x.call('POST', '/api/backups/run') },
  { name: 'restore_backup', risky: true, calls: [['POST', '/api/backups/restore']],
    description: 'Restore a backup (replaces all current data) and restart. Needs the backup passphrase and confirm_action.',
    input: { source: { type: 'string', enum: ['local', 'github', 's3'], description: 'Where the backup is' }, file: str('Backup file name (see list_backups)'), passphrase: str('Backup passphrase') },
    required: ['source', 'file', 'passphrase'],
    preview: async (a) => `Restore backup ${a.file} from ${a.source}. Everything now on the server (agents, chats, memory, settings, users) is replaced by the backup, then the app restarts (agents offline 1–2 minutes).`,
    run: (a, x) => x.call('POST', '/api/backups/restore', { source: a.source, file: a.file, passphrase: a.passphrase }) },

  // ---------- users ----------
  { name: 'list_users', readOnly: true, calls: [['GET', '/api/users']], description: 'Panel users and their roles (owner, admin, viewer).', input: {},
    run: (a, x) => x.call('GET', '/api/users') },
  { name: 'add_user', calls: [['POST', '/api/users']], description: 'Add a panel user. role: owner | admin | viewer. Password: 12+ characters (they can change it).',
    input: { username: str('Username'), role: { type: 'string', enum: ['owner', 'admin', 'viewer'], description: 'Role' }, password: str('Initial password'), email: str('Email (optional)') },
    required: ['username', 'role', 'password'],
    run: (a, x) => x.call('POST', '/api/users', { username: a.username, role: a.role, password: a.password, email: a.email }) },
  { name: 'update_user', calls: [['PUT', '/api/users/x']], description: 'Change a user\'s role, or disable/enable their account.',
    input: { user_id: int('User id (see list_users)'), role: { type: 'string', enum: ['owner', 'admin', 'viewer'], description: 'New role (optional)' }, disabled: bool('Disable (true) or enable (false) (optional)') },
    required: ['user_id'],
    run: (a, x) => x.call('PUT', `/api/users/${enc(a.user_id)}`, { role: a.role, disabled: a.disabled }) },
  { name: 'remove_user', risky: true, calls: [['DELETE', '/api/users/x']], description: 'Remove a panel user. Needs confirm_action.',
    input: { user_id: int('User id') }, required: ['user_id'],
    preview: async (a, x) => {
      const u = (await x.call('GET', '/api/users')).find((r) => r.id === Number(a.user_id));
      if (!u) throw Object.assign(new Error('User not found'), { status: 404 });
      return `Remove the ${u.role} "${u.username}". They are signed out everywhere and their AI-assistant connections stop working.`;
    },
    run: (a, x) => x.call('DELETE', `/api/users/${enc(a.user_id)}`) },

  // ---------- WhatsApp numbers ----------
  { name: 'list_whatsapp_numbers', readOnly: true, calls: [['GET', '/api/status']], description: 'WhatsApp numbers and their connection state. Linking a number (QR code / pairing) is done in the panel.', input: {},
    run: async (a, x) => (await numbers(x)).map((n) => ({ id: n.id, label: n.label, status: n.status, me: n.me, dmAgent: n.dmAgent || '' })) },
  { name: 'add_whatsapp_number', calls: [['POST', '/api/whatsapp/numbers']],
    description: 'Add another WhatsApp number. Afterwards, open the panel (Overview) on a computer to link it with the phone (QR code).',
    input: { label: str('Name shown in the panel, e.g. "Carpool phone"'), id: str('Short id (optional, lowercase letters, digits, -)') }, required: ['label'],
    run: async (a, x) => ({ ...(await x.call('POST', '/api/whatsapp/numbers', { id: a.id, label: a.label })), next: 'Open the panel → Overview to link this number with its phone.' }) },
  { name: 'remove_whatsapp_number', risky: true, calls: [['DELETE', '/api/whatsapp/numbers/x']], description: 'Remove an extra WhatsApp number. Needs confirm_action.',
    input: { number_id: str('Number id (see list_whatsapp_numbers)') }, required: ['number_id'],
    preview: async (a, x) => {
      const n = (await numbers(x)).find((r) => r.id === a.number_id);
      if (!n) throw Object.assign(new Error('Unknown number'), { status: 404 });
      return `Remove the WhatsApp number "${n.label}" (${n.id}). It is unlinked from this app and its chats stop getting replies.`;
    },
    run: (a, x) => x.call('DELETE', `/api/whatsapp/numbers/${enc(a.number_id)}`) },
];
