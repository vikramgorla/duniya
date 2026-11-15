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

async function botName(x, id) {
  const b = await x.call('GET', `/api/bots/${enc(id)}`);
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
    description: 'Overview of the app: version, uptime, memory, whether bots are paused, WhatsApp connection per number, bots, and how many changes wait for confirmation.',
    input: {},
    run: async (a, x) => {
      const s = await x.call('GET', '/api/status');
      return { you: { username: s.user.username, role: s.user.role }, version: s.version, uptimeSec: s.uptimeSec, memoryMb: s.memoryMb, node: s.node,
        botsPaused: !!s.settings?.paused, whatsapp: (s.channel?.numbers || [s.channel]).map((n) => ({ id: n.id, label: n.label, status: n.status, me: n.me })),
        bots: s.bots, pendingConfirmations: s.pending };
    } },
  { name: 'list_activity', readOnly: true, calls: [['GET', '/api/activity']],
    description: 'Recent activity log entries (newest first): messages, replies, tool calls, confirmations, configuration changes, errors. Filter by bot or chat.',
    input: { bot_id: str('Only this bot (optional)'), chat: str('Only this chat id (optional)'), limit: int('How many (default 50, max 200)', { minimum: 1, maximum: 200 }),
      before_id: int('Only entries older than this id (for paging)'), include_details: bool('Include the detail payload of each entry (bigger)') },
    run: async (a, x) => {
      const q = new URLSearchParams({ limit: String(Math.min(Number(a.limit) || 50, 200)) });
      if (a.bot_id) q.set('bot', a.bot_id);
      if (a.chat) q.set('chat', a.chat);
      if (a.before_id) q.set('before', String(a.before_id));
      return (await x.call('GET', `/api/activity?${q}`)).map((r) => ({ id: r.id, time: iso(r.ts), type: r.type, bot: r.bot || undefined, chat: r.chat || undefined, summary: r.summary, ...(a.include_details && r.detail ? { detail: r.detail } : {}) }));
    } },

  // ---------- bots ----------
  { name: 'list_bots', readOnly: true, calls: [['GET', '/api/bots']], description: 'All bots with their settings (enabled, chats, triggers, model, tool services, schedules).', input: {},
    run: (a, x) => x.call('GET', '/api/bots') },
  { name: 'get_bot', readOnly: true, calls: [['GET', '/api/bots/x']], description: 'One bot with its full configuration.', input: { bot_id: str('Bot id') }, required: ['bot_id'],
    run: (a, x) => x.call('GET', `/api/bots/${enc(a.bot_id)}`) },
  { name: 'list_templates', readOnly: true, calls: [['GET', '/api/templates']], description: 'Bot templates that create_bot can start from.', input: {},
    run: (a, x) => x.call('GET', '/api/templates') },
  { name: 'create_bot', calls: [['POST', '/api/bots']],
    description: 'Create a bot, from a template (see list_templates) and/or a configuration object (same fields as get_bot returns: name, prompt, model, triggers, chats, organizers, tools, schedules, memory, …).',
    input: { id: str('New bot id (lowercase letters, digits, -). Optional: derived from the name'), template: str('Template id (optional)'), config: obj('Configuration fields (optional, override the template)') },
    run: (a, x) => x.call('POST', '/api/bots', { id: a.id, template: a.template, config: a.config || {} }) },
  { name: 'update_bot', calls: [['PUT', '/api/bots/x']],
    description: 'Change fields of a bot (only the fields given change), e.g. { "prompt": "…", "triggers": ["!help"], "model": "auto" }. Returns the bot and any warnings.',
    input: { bot_id: str('Bot id'), changes: obj('Fields to change') }, required: ['bot_id', 'changes'],
    run: (a, x) => x.call('PUT', `/api/bots/${enc(a.bot_id)}`, a.changes || {}) },
  { name: 'get_bot_people', readOnly: true, calls: [['GET', '/api/bots/x/people']],
    description: 'Members of the bot\'s WhatsApp groups (name, number, group admin) with their role for this bot (organizer or participant). To change roles, update_bot with "organizers" (phone numbers).',
    input: { bot_id: str('Bot id') }, required: ['bot_id'],
    run: (a, x) => x.call('GET', `/api/bots/${enc(a.bot_id)}/people`) },
  { name: 'draft_bot_with_ai', calls: [['POST', '/api/ai/bot-draft']],
    description: 'Ask the app\'s AI helper to draft a new bot (no bot_id) or changes to a bot from a plain-language request. Returns a summary, the changed fields (before/after) and the full proposed config. Nothing is saved: apply with create_bot (config = proposed) or update_bot (changes = the changed fields).',
    input: { bot_id: str('Bot to change (omit to draft a new bot)'), request: str('What you want, in plain words'), model: str('Model to use: "auto" (default) or provider:model') }, required: ['request'],
    run: (a, x) => x.call('POST', '/api/ai/bot-draft', { botId: a.bot_id, request: a.request, model: a.model || 'auto' }) },
  { name: 'set_bot_enabled', calls: [['PUT', '/api/bots/x']], description: 'Turn a bot on or off. A disabled bot does not answer anywhere.',
    input: { bot_id: str('Bot id'), enabled: bool('true = on, false = off') }, required: ['bot_id', 'enabled'],
    run: (a, x) => x.call('PUT', `/api/bots/${enc(a.bot_id)}`, { enabled: !!a.enabled }) },
  { name: 'duplicate_bot', calls: [['POST', '/api/bots/x/duplicate']], description: 'Copy a bot (without its chats). The copy is named "<name> (copy)".',
    input: { bot_id: str('Bot to copy'), new_id: str('Id for the copy (optional)') }, required: ['bot_id'],
    run: (a, x) => x.call('POST', `/api/bots/${enc(a.bot_id)}/duplicate`, { id: a.new_id }) },
  { name: 'export_bot', readOnly: true, calls: [['GET', '/api/bots/x/export']], description: 'Export a bot as a JSON document (names of the secrets it needs, never their values).',
    input: { bot_id: str('Bot id') }, required: ['bot_id'],
    run: (a, x) => x.call('GET', `/api/bots/${enc(a.bot_id)}/export`) },
  { name: 'delete_bot', risky: true, calls: [['DELETE', '/api/bots/x']], description: 'Delete a bot. Needs confirm_action.',
    input: { bot_id: str('Bot id') }, required: ['bot_id'],
    preview: async (a, x) => `Delete the bot ${await botName(x, a.bot_id)}. Its chats stop getting replies and its settings are gone (export it first to keep a copy). This cannot be undone.`,
    run: (a, x) => x.call('DELETE', `/api/bots/${enc(a.bot_id)}`) },
  { name: 'run_schedule_now', calls: [['POST', '/api/bots/x/schedules/y/run']], description: 'Run one of a bot\'s scheduled posts now (it posts to the chat as it would on schedule).',
    input: { bot_id: str('Bot id'), schedule_id: str('Schedule id (see get_bot → schedules)') }, required: ['bot_id', 'schedule_id'],
    run: (a, x) => x.call('POST', `/api/bots/${enc(a.bot_id)}/schedules/${enc(a.schedule_id)}/run`) },
  { name: 'test_bot', calls: [['POST', '/api/bots/x/test']],
    description: 'Send a test message to a bot, like the panel\'s test console, and get its reply. Nothing is posted to WhatsApp. "as" picks the sender\'s role (organizer or participant).',
    input: { bot_id: str('Bot id'), text: str('Message text'), as: { type: 'string', enum: ['organizer', 'participant'], description: 'Sender role (default participant)' } }, required: ['bot_id', 'text'],
    run: (a, x) => x.call('POST', `/api/bots/${enc(a.bot_id)}/test`, { text: a.text, role: ROLE_TEXT[a.as] || 'participant' }) },

  // ---------- chats & memory ----------
  { name: 'list_chats', readOnly: true, calls: [['GET', '/api/chats']], description: 'WhatsApp groups and 1:1 chats the numbers know, with their bot, model and logging settings.', input: {},
    run: (a, x) => x.call('GET', '/api/chats') },
  { name: 'assign_chat', calls: [['POST', '/api/chats/bind']], description: 'Choose which bot answers in a chat. Empty bot_id removes the bot from the chat.',
    input: { chat: str('Chat id (see list_chats)'), bot_id: str('Bot id, or empty to unassign') }, required: ['chat'],
    run: (a, x) => x.call('POST', '/api/chats/bind', { chat: a.chat, bot: a.bot_id || null }) },
  { name: 'set_chat_settings', calls: [['PUT', '/api/chats/x/prefs']],
    description: 'Per-chat model and activity logging. model: inherit | auto | provider:auto | provider:model. logging: inherit | off | minimal | normal | verbose.',
    input: { chat: str('Chat id'), model: str('Model (optional)'), logging: { type: 'string', enum: ['inherit', 'off', 'minimal', 'normal', 'verbose'], description: 'Logging level (optional)' } }, required: ['chat'],
    run: (a, x) => x.call('PUT', `/api/chats/${enc(a.chat)}/prefs`, { model: a.model, logging: a.logging }) },
  { name: 'list_chat_messages', readOnly: true, calls: [['GET', '/api/chats/x/messages']],
    description: 'Messages stored for a chat (newest first), optionally filtered by text. Admins and owners only; each look is recorded in the activity log.',
    input: { chat: str('Chat id'), search: str('Only messages containing this text (optional)'), limit: int('How many (default 30, max 200)', { minimum: 1, maximum: 200 }), before_id: int('Only older than this message id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/messages?limit=${Math.min(Number(a.limit) || 30, 200)}${a.before_id ? `&before=${a.before_id}` : ''}${a.search ? `&q=${enc(a.search)}` : ''}`) },
  { name: 'get_usage', readOnly: true, calls: [['GET', '/api/usage']],
    description: 'Tokens and estimated cost of model calls, grouped by bot, chat, provider, model, kind (reply, summary, scheduled, ai-helper, test) or day. period: 1d, 7d, 30d (default), 90d, all. Costs only where a price is set or published; ChatGPT plan / Copilot calls are "included".',
    input: { group_by: str('bot | chat | provider | model | kind | day'), period: str('1d | 7d | 30d | 90d | all'), bot_id: str('Only this bot (optional)'), chat: str('Only this chat (optional)') },
    run: (a, x) => x.call('GET', `/api/usage?groupBy=${enc(a.group_by || 'bot')}&period=${enc(a.period || '30d')}${a.bot_id ? `&bot=${enc(a.bot_id)}` : ''}${a.chat ? `&chat=${enc(a.chat)}` : ''}`) },
  { name: 'set_model_price', calls: [['PUT', '/api/usage/prices']],
    description: 'Set the price of a model in USD per million tokens (input and output) so usage shows costs. Empty values remove the price.',
    input: { model: str('provider:model'), input_per_million: { type: 'number' }, output_per_million: { type: 'number' } }, required: ['model'],
    run: (a, x) => x.call('PUT', '/api/usage/prices', { model: a.model, input: a.input_per_million, output: a.output_per_million }) },
  { name: 'list_contacts', readOnly: true, calls: [['GET', '/api/contacts']], description: 'Contacts (WhatsApp names synced from the phone + own entries). Shared ones can be looked up by participants through agents.',
    input: { query: str('Name, note or number to filter by (optional)'), shared_only: { type: 'boolean' } },
    run: (a, x) => x.call('GET', `/api/contacts?q=${enc(a.query || '')}${a.shared_only ? '&shared=1' : ''}`) },
  { name: 'save_contact', calls: [['PUT', '/api/contacts/x']], description: 'Add or change a contact: phone with country code, name, note, shared (participants may look it up).',
    input: { phone: str('Phone with country code'), name: str('Name'), note: str('Short note (optional)'), shared: { type: 'boolean' } }, required: ['phone'],
    run: (a, x) => x.call('PUT', `/api/contacts/${enc(a.phone)}`, { name: a.name, note: a.note, shared: a.shared }) },
  { name: 'remove_contact', calls: [['DELETE', '/api/contacts/x']], description: 'Remove an own contact (a WhatsApp-synced name stays, unshared).',
    input: { phone: str('Phone with country code') }, required: ['phone'],
    run: (a, x) => x.call('DELETE', `/api/contacts/${enc(a.phone)}`) },
  { name: 'get_agent_memory', readOnly: true, calls: [['GET', '/api/bots/x/memory']], description: 'Notes a bot shares across all its chats (shared memory). Delete one with delete_note.',
    input: { bot_id: str('Bot id') }, required: ['bot_id'],
    run: (a, x) => x.call('GET', `/api/bots/${enc(a.bot_id)}/memory`) },
  { name: 'get_chat_memory', readOnly: true, calls: [['GET', '/api/chats/x/memory']], description: 'What a bot remembers about a chat: running summary, notes and message counts.',
    input: { chat: str('Chat id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/memory`) },
  { name: 'rebuild_chat_summary', calls: [['POST', '/api/chats/x/memory/summarize']], description: 'Rebuild the running summary of a chat now.',
    input: { chat: str('Chat id') }, required: ['chat'],
    run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/memory/summarize`) },
  { name: 'erase_chat_memory', risky: true, calls: [['DELETE', '/api/chats/x/memory']], description: 'Erase everything the bots remember about a chat (history, summary, notes). Needs confirm_action.',
    input: { chat: str('Chat id') }, required: ['chat'],
    preview: async (a, x) => `Erase the memory of chat ${await chatName(x, a.chat)}: stored messages, summary and notes. The bot forgets the conversation. This cannot be undone.`,
    run: (a, x) => x.call('DELETE', `/api/chats/${enc(a.chat)}/memory`) },

  // ---------- WhatsApp groups (026) ----------
  { name: 'get_group_info', readOnly: true, calls: [['GET', '/api/chats/x/whatsapp']],
    description: 'A WhatsApp group\'s name, description, settings (only admins send, only admins edit info, join approval) and members with admin badges.',
    input: { chat: str('Group chat id (see list_chats)') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp`) },
  { name: 'get_group_invite_link', readOnly: true, calls: [['GET', '/api/chats/x/whatsapp/invite']],
    description: 'The invite link of a WhatsApp group (the bot\'s number must be a group admin). Each look is recorded.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp/invite`) },
  { name: 'reset_group_invite_link', risky: true, calls: [['POST', '/api/chats/x/whatsapp/invite/revoke']],
    description: 'Reset a WhatsApp group\'s invite link (the old link stops working). Needs confirm_action.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    preview: async (a, x) => `Reset the invite link of ${await chatName(x, a.chat)}. Anyone holding the old link can no longer join with it; share the new link instead.`,
    run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/whatsapp/invite/revoke`) },
  { name: 'update_group', calls: [['PUT', '/api/chats/x/whatsapp']],
    description: 'Change a WhatsApp group: name, description, only_admins_send, only_admins_edit_info, join_approval. Give only what changes. The bot\'s number must be a group admin.',
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
  { name: 'set_default_models', calls: [['POST', '/api/models/defaults']], description: 'Set the default model for bots and/or the background model (summaries). Values: "auto" or provider:model.',
    input: { default_model: str('Default model (optional)'), background_model: str('Background model (optional)') },
    run: (a, x) => {
      const b = {};
      if (a.default_model !== undefined) b.defaultModel = a.default_model;
      if (a.background_model !== undefined) b.backgroundModel = a.background_model;
      return x.call('POST', '/api/models/defaults', b);
    } },

  // ---------- secrets ----------
  { name: 'list_secrets', readOnly: true, calls: [['GET', '/api/secrets']], description: 'Names of stored secrets (API keys, tokens) and whether each is set. Values are never shown.', input: {},
    run: (a, x) => x.call('GET', '/api/secrets') },
  { name: 'set_secret', risky: true, calls: [['PUT', '/api/secrets']],
    description: 'Store a secret value (encrypted on the server, never shown again). Needs confirm_action. Prefer entering keys in the panel: values given here pass through the AI assistant.',
    input: { name: str('UPPER_SNAKE_CASE name'), value: str('The value') }, required: ['name', 'value'],
    preview: async (a, x) => {
      if (!a.value) throw Object.assign(new Error('value is empty; use remove_secret to remove a secret'), { status: 400 });
      const cur = (await x.call('GET', '/api/secrets')).find((s) => s.name === a.name);
      return `${cur?.set ? 'Replace' : 'Set'} the secret ${a.name}${cur?.usedByBots ? ' (used by a bot)' : ''}. Bots using it pick up the new value right away.`;
    },
    run: (a, x) => x.call('PUT', '/api/secrets', { name: a.name, value: a.value }) },
  { name: 'remove_secret', risky: true, calls: [['PUT', '/api/secrets']], description: 'Remove a stored secret. Needs confirm_action.',
    input: { name: str('Secret name') }, required: ['name'],
    preview: async (a, x) => {
      const cur = (await x.call('GET', '/api/secrets')).find((s) => s.name === a.name);
      if (!cur) throw Object.assign(new Error(`No secret named ${a.name}`), { status: 404 });
      return `Remove the secret ${a.name}.${cur.usedByBots ? ' A bot uses it: that bot\'s tool service or model stops working until it is set again.' : ''}`;
    },
    run: (a, x) => x.call('PUT', '/api/secrets', { name: a.name, value: '' }) },

  // ---------- pending confirmations ----------
  { name: 'list_pending_confirmations', readOnly: true, calls: [['GET', '/api/pending']], description: 'Changes that bots prepared and that wait for a human to confirm in WhatsApp or the panel.', input: {},
    run: async (a, x) => (await x.call('GET', '/api/pending')).map((p) => ({ ...p, expires: iso(p.expires) })) },
  { name: 'cancel_pending_confirmation', calls: [['DELETE', '/api/pending/x']], description: 'Cancel a waiting change so it can no longer be confirmed.',
    input: { code: str('Its code (see list_pending_confirmations)') }, required: ['code'],
    run: (a, x) => x.call('DELETE', `/api/pending/${enc(a.code)}`) },

  // ---------- settings ----------
  { name: 'set_bots_paused', calls: [['POST', '/api/settings']], description: 'Pause (true) or resume (false) all bots at once.',
    input: { paused: bool('true = pause all bots') }, required: ['paused'],
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
      return `Update from ${st.current} to ${st.target || st.latest}. The app restarts: bots are offline for 1–2 minutes.`;
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
      const effect = { reboot: 'The whole server restarts: bots and the panel are offline for a few minutes.', 'os-update': 'Takes a few minutes; services may restart.',
        'restart-web': 'The panel and AI-assistant access are unreachable for a few seconds.', 'restart-tunnel': 'The panel and AI-assistant access are unreachable for a few seconds.' }[a.action] || '';
      return `${label}. ${effect}`.trim();
    },
    run: (a, x) => x.call('POST', '/api/system/ops', { action: a.action }) },
  { name: 'restart_app', risky: true, calls: [['POST', '/api/system/restart']], description: 'Restart the app. Needs confirm_action.', input: {},
    preview: async () => 'Restart the app. Bots are offline for about a minute and this connection drops briefly.',
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
    preview: async (a) => `Restore backup ${a.file} from ${a.source}. Everything now on the server (bots, chats, memory, settings, users) is replaced by the backup, then the app restarts (bots offline 1–2 minutes).`,
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
    run: async (a, x) => (await numbers(x)).map((n) => ({ id: n.id, label: n.label, status: n.status, me: n.me, dmBot: n.dmBot || '' })) },
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
