// @ts-check
// Admin MCP tools (017). Each tool runs the same panel route handler in-process (not over HTTP), as the signed-in
// panel user, so role gates, validation and activity logging are exactly the panel's. `calls` names the routes a
// tool uses: the minimum role to see and run the tool is the highest role those routes require.
// Risky tools never run directly: they return a plain-language preview and a confirm code for confirm_action.
/** 065: version a is not newer than b ("2.9.0" vs "v2.10.0"). */
const notAfter = (a, b) => { const [x, y] = [a, b].map((v) => String(v).replace(/^v/, '').split('.').map(Number)); const i = x.findIndex((n, k) => n !== y[k]); return i < 0 || x[i] < y[i]; };
const iso = (ts) => (ts ? new Date(ts).toISOString() : null); // no imports: tests and the admin MCP load this catalog statically

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

/** @type {Array<{name, description, input, required?, calls, risky?, readOnly?, noConfirm?, run, preview?}>} noConfirm: the owner assistant runs it without a confirm code (logged). */
export const TOOLS = [
  // ---------- overview & activity ----------
  { name: 'get_overview', readOnly: true, calls: [['GET', '/api/status'], ['GET', '/api/checklist']],
    description: 'Overview of the app: version, uptime, memory, whether agents are paused, WhatsApp connection per number, agents, how many changes wait for confirmation, and the Getting started steps still open (link WhatsApp, connect a model, create an agent, switch a chat on, send a test).',
    input: {},
    run: async (a, x) => {
      const [s, c] = await Promise.all([x.call('GET', '/api/status'), x.call('GET', '/api/checklist').catch(() => null)]);
      return { you: { username: s.user.username, role: s.user.role }, version: s.version, uptimeSec: s.uptimeSec, memoryMb: s.memoryMb, node: s.node,
        agentsPaused: !!s.settings?.paused, whatsapp: (s.channel?.numbers || [s.channel]).map((n) => ({ id: n.id, label: n.label, status: n.status, me: n.me })),
        agents: s.agents, pendingConfirmations: s.pending,
        gettingStarted: c && !c.complete ? { done: c.done, total: c.total, open: c.steps.filter((st) => !st.done && !st.skipped).map((st) => ({ step: st.id, title: st.title, hint: st.hint })) } : 'done' };
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
  { name: 'list_agents', readOnly: true, calls: [['GET', '/api/agents']], description: 'All agents with their settings (enabled, chats, triggers, model, tool services, schedules). The built-in owner assistant (id owner-assistant, builtin: true) is listed too: its character, model, tools, photos & voice, schedules (incl. the weekly summary) and alerts number are edited with update_agent; it cannot be deleted or assigned to chats.', input: {},
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
    description: 'Change fields of an agent (only the fields given change), e.g. { "prompt": "…", "triggers": ["!help"], "model": "auto" } or { "fallback": { "mode": "off" } } (model fallback: inherit | on | off, optional "chain"). Returns the agent and any warnings. For owner-assistant, how it is reached and its permissions are fixed in code (chats, triggers, people, confirm, quick answers are ignored); alerts: { to: "+41…" } sets where owner alerts go (owner only).',
    input: { agent_id: str('Agent id'), changes: obj('Fields to change') }, required: ['agent_id', 'changes'],
    run: (a, x) => x.call('PUT', `/api/agents/${enc(a.agent_id)}`, a.changes || {}) },
  // 054: built-in answers without AI (quick replies, !help, welcome, FAQ).
  { name: 'set_agent_quick_answers', calls: [['GET', '/api/agents/x'], ['PUT', '/api/agents/x']],
    description: 'Built-in answers of an agent — no AI, no tokens (panel: agent editor → "Quick replies, welcome & FAQ"). Only the parts given change; each part replaces the whole list. quick_replies: [{ command: "!rides" (one word, matched as the whole message or its first word, any case), text: answer with {name} (sender), {group}, {date}, who: "everyone" | "organizers" }]. help: true = "!help" lists the commands and triggers. welcome: { enabled, text with {name} (the new members as @mentions), {group}, {rules}, {date}, rules } — posted once per person when people join a group that is on. faq: { items: [{ questions: [phrasings], keywords: [words], answer }], strictness: "strict" | "normal", whole_group: true = answer matching questions in the whole group, not only messages that wake the agent }. Unmatched messages go to the model, which gets the FAQ as short reference context.',
    input: { agent_id: str('Agent id'), quick_replies: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'The quick replies (optional)' }, help: bool('Built-in !help (optional)'),
      welcome: obj('Welcome settings (optional)'), faq: obj('FAQ settings (optional)') }, required: ['agent_id'],
    run: async (a, x) => {
      const cur = (await x.call('GET', `/api/agents/${enc(a.agent_id)}`)).config;
      const changes = {};
      if (a.quick_replies !== undefined) changes.quickReplies = a.quick_replies;
      if (a.help !== undefined) changes.help = !!a.help;
      if (a.welcome !== undefined) changes.welcome = { ...cur.welcome, ...a.welcome };
      if (a.faq !== undefined) {
        const { whole_group: wg, ...rest } = a.faq || {};
        changes.faq = { ...cur.faq, ...rest, ...(wg !== undefined ? { wholeGroup: !!wg } : {}) };
      }
      return x.call('PUT', `/api/agents/${enc(a.agent_id)}`, changes);
    } },
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
  { name: 'run_schedule_now', calls: [['POST', '/api/agents/x/schedules/y/run']], description: 'Run one of an agent\'s scheduled posts now (it posts to the chat as it would on schedule). For owner-assistant the result goes to every linked owner and admin in their own chat (weekly-summary = the weekly summary).',
    input: { agent_id: str('Agent id'), schedule_id: str('Schedule id (see get_agent → schedules)') }, required: ['agent_id', 'schedule_id'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/schedules/${enc(a.schedule_id)}/run`) },
  { name: 'test_agent', calls: [['POST', '/api/agents/x/test']],
    description: 'Send a test message to an agent, like the panel\'s test console, and get its reply. Nothing is posted to WhatsApp. "as" picks the sender\'s role (organizer or participant). "path" says what answered: quick (quick reply or !help), faq or model.',
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
  { name: 'list_chats', readOnly: true, calls: [['GET', '/api/chats']], description: 'WhatsApp groups and 1:1 chats the numbers know, with their agent, model and logging settings. Settings at their default (off, model/logging/welcome "inherit", not private) are left out.', input: {},
    run: (a, x) => x.call('GET', '/api/chats') },
  { name: 'assign_chat', calls: [['POST', '/api/chats/bind']], description: 'Choose which agent answers in a chat. Empty agent_id removes the agent from the chat. A chat that is off stays off unless switch_on is true (as in the panel, where choosing an agent switches the chat on).',
    input: { chat: str('Chat id (see list_chats)'), agent_id: str('Agent id, or empty to unassign'), switch_on: bool('Also switch the chat on if it is off (posts the privacy notice once in groups)') }, required: ['chat'],
    run: (a, x) => x.call('POST', '/api/chats/bind', { chat: a.chat, agent: a.agent_id || null, enable: !!a.switch_on }) },
  { name: 'set_chat_settings', calls: [['PUT', '/api/chats/x/prefs'], ['GET', '/api/chats']],
    description: 'Per-chat model, model fallback and activity logging (the panel\'s Chats page: Model, Fallback…, Logging). model: inherit | auto | provider:auto | provider:model. fallback_mode: inherit | on | off (use other models when this one fails with a limit, outage or expired sign-in); fallback_chain: models to try in order (empty list = the agent\'s or the Models setting). Giving only one of fallback_mode / fallback_chain keeps the other as it is. logging: inherit | off | minimal | normal | verbose. welcome: inherit | on | off — "Welcome new members" in this group (inherit = the agent\'s setting).',
    input: { chat: str('Chat id'), model: str('Model (optional)'), logging: { type: 'string', enum: ['inherit', 'off', 'minimal', 'normal', 'verbose'], description: 'Logging level (optional)' },
      fallback_mode: { type: 'string', enum: ['inherit', 'on', 'off'], description: 'Model fallback for this chat (optional)' }, fallback_chain: { type: 'array', items: { type: 'string' }, description: 'provider:model or provider:auto, in order (optional)' },
      welcome: { type: 'string', enum: ['inherit', 'on', 'off'], description: 'Welcome new members in this group (optional)' } }, required: ['chat'],
    run: async (a, x) => {
      let fallback;
      if (a.fallback_mode !== undefined || a.fallback_chain !== undefined) { // #65: a partial change keeps the rest, as in the panel editor
        const cur = a.fallback_mode === undefined || a.fallback_chain === undefined
          ? ((await x.call('GET', '/api/chats')) || []).find((c) => c.id === a.chat)?.fallback || { mode: 'inherit', chain: [] } : {};
        fallback = { mode: a.fallback_mode ?? cur.mode ?? 'inherit', chain: a.fallback_chain ?? cur.chain ?? [] };
      }
      return x.call('PUT', `/api/chats/${enc(a.chat)}/prefs`, { model: a.model, logging: a.logging, ...(fallback ? { fallback } : {}), ...(a.welcome ? { welcome: a.welcome } : {}) });
    } },
  // #91: chats that are off store nothing, so a chat switched on starts empty; these load earlier messages from the phone.
  { name: 'load_chat_history', noConfirm: true, calls: [['POST', '/api/chats/x/history'], ['GET', '/api/chats/x/history']],
    description: 'Load recent messages of a chat that is on from the linked phone ("Load recent messages" on the Chats page): asks WhatsApp for up to `count` messages from before the oldest stored one (default the setting, max 200), so the agent has earlier context and a summary. The phone must be online; the answer comes within about a minute. Unanswered loads retry automatically (backoff, sooner when the phone comes online; retryAt in the status), so calling again is optional. Call with status_only to see the status (state loading, loaded, no_response, no_anchor or failed; loaded = how many were stored). At most once per 30 s per chat. Only adds messages; nothing is sent to the chat.',
    input: { chat: str('Chat id (see list_chats); the chat must be on'), count: int('How many messages (optional, 1–200)', { minimum: 1, maximum: 200 }), status_only: bool('Only show the status of the last load (optional)') }, required: ['chat'],
    run: async (a, x) => (a.status_only ? x.call('GET', `/api/chats/${enc(a.chat)}/history`) : x.call('POST', `/api/chats/${enc(a.chat)}/history`, { count: a.count })) },
  { name: 'set_history_on_switch_on', calls: [['POST', '/api/settings']],
    description: 'How many earlier messages are loaded from the phone when a chat is switched on (0 = none, max 200, default 50).',
    input: { count: int('Messages (0–200)', { minimum: 0, maximum: 200 }) }, required: ['count'],
    run: async (a, x) => ({ historyLoadCount: (await x.call('POST', '/api/settings', { historyLoadCount: a.count })).historyLoadCount }) },
  // ---------- prepared direct chats (049, #92) ----------
  { name: 'prepare_direct_chat', calls: [['POST', '/api/direct-chats'], ['POST', '/api/chats/x/intro/preview'], ['POST', '/api/chats/x/intro']],
    risky: (a) => !!a.send_intro, // sending a message to the person needs confirm_action
    description: 'Set up a direct (1:1) chat with a person BEFORE they have written: assign an agent, switch the chat on or off, mark it private to members, and optionally set model, logging and a monthly spending cap. Use the person\'s phone number with country code (find it with list_contacts). Their first message then goes to this agent with these settings, whichever form WhatsApp uses. The chat is switched on when an agent is given, unless enabled is false. Nothing is sent to the person unless send_intro is true: then the agent also sends a short first message (or intro_text), which needs confirm_action.',
    input: { phone: str('Phone number with country code, e.g. +41 79 123 45 67'), number: str('Which of your WhatsApp numbers (id, default "main"; see get_overview)'), agent_id: str('Agent to answer this person (optional)'),
      enabled: bool('Chat on (default: on when an agent is given)'), private: bool('Private to members: hidden from the owner assistant and the Ask box (optional)'),
      model: str('Model for this chat: inherit | auto | provider:model (optional)'), logging: { type: 'string', enum: ['inherit', 'off', 'minimal', 'normal', 'verbose'], description: 'Logging level (optional)' },
      cap_cost_usd: { type: 'number', description: 'Monthly cost cap for this chat in USD (optional)' }, cap_tokens: int('Monthly token cap for this chat (optional, at least 1000)'),
      send_intro: bool('Also let the agent send a first message now (needs confirm_action)'), intro_text: str('Text of that first message (optional)') }, required: ['phone'],
    preview: async (a) => `Set up a direct chat with ${a.phone}${a.number && a.number !== 'main' ? ` on number ${a.number}` : ''}${a.agent_id ? `, answered by agent ${a.agent_id}` : ''}${a.enabled === false ? ', switched off' : a.agent_id || a.enabled ? ', switched on' : ''}${a.private ? ', private to members' : ''}. ${a.send_intro ? `Then ${a.agent_id || 'its agent'} sends them: "${a.intro_text || 'a short intro'}".` : 'Nothing is sent to them.'}`,
    run: async (a, x) => {
      const chat = await x.call('POST', '/api/direct-chats', { phone: a.phone, number: a.number, agent: a.agent_id, enabled: a.enabled, private: a.private, model: a.model, logging: a.logging,
        ...(a.cap_cost_usd != null || a.cap_tokens != null ? { cap: { cost: a.cap_cost_usd ?? null, tokens: a.cap_tokens ?? null } } : {}) });
      if (!a.send_intro) return chat;
      const p = await x.call('POST', `/api/chats/${enc(chat.chat)}/intro/preview`, { text: a.intro_text });
      return { ...chat, intro: await x.call('POST', `/api/chats/${enc(chat.chat)}/intro`, { token: p.token }) };
    } },
  { name: 'send_chat_intro', risky: true, calls: [['POST', '/api/chats/x/intro/preview'], ['POST', '/api/chats/x/intro']],
    description: 'Let the chat\'s agent send a first message (greeting / intro) to a direct chat, e.g. one set up with prepare_direct_chat. The chat must be on with an enabled agent. Without text a short intro by the agent is used. Needs confirm_action; the preview shows the exact text.',
    input: { chat: str('Direct chat id (see list_chats or prepare_direct_chat)'), text: str('Intro text (optional)') }, required: ['chat'],
    preview: async (a, x) => {
      const p = await x.call('POST', `/api/chats/${enc(a.chat)}/intro/preview`, { text: a.text });
      return `Send this message from ${p.agentName} to ${p.to} on WhatsApp: "${p.text}"${p.notice ? ' (with the privacy line, first time)' : ''}`;
    },
    run: async (a, x) => {
      const p = await x.call('POST', `/api/chats/${enc(a.chat)}/intro/preview`, { text: a.text });
      return x.call('POST', `/api/chats/${enc(a.chat)}/intro`, { token: p.token });
    } },
  // ---------- owner assistant and privacy (044) ----------
  { name: 'get_owner_assistant', readOnly: true, calls: [['GET', '/api/owner-assistant']],
    description: 'The built-in owner assistant: whether your WhatsApp number is linked (status none, code, pending or linked, and the number), and for owners every linked panel user. Linking itself is done in the panel (Settings → Owner assistant). Its character, model, tools, photos & voice and schedules are the built-in agent owner-assistant: use get_agent / update_agent.',
    input: {}, run: (a, x) => x.call('GET', '/api/owner-assistant') },
  { name: 'set_chat_private', calls: [['PUT', '/api/chats/x/prefs']],
    description: 'Mark a chat "private to members" (true) or not (false). Private chats keep working with their agent but are hidden from the owner assistant\'s cross-chat tools and the Ask box.',
    input: { chat: str('Chat id'), private: bool('true = private to members') }, required: ['chat', 'private'],
    run: (a, x) => x.call('PUT', `/api/chats/${enc(a.chat)}/prefs`, { private: !!a.private }) },
  { name: 'get_privacy_notice', readOnly: true, calls: [['GET', '/api/privacy-notice']],
    description: 'Privacy notice settings: whether a notice is posted once when a group chat is switched on, its text, and whether direct messages see the DM text once in the agent\'s first reply.',
    input: {}, run: (a, x) => x.call('GET', '/api/privacy-notice') },
  { name: 'set_privacy_notice', calls: [['PUT', '/api/privacy-notice']],
    description: 'Change the privacy notice: enabled (post in groups when switched on), text (group notice), dm_first_reply (show dm_text once per person in direct messages), dm_text. Give only what changes; empty text restores the default.',
    input: { enabled: bool('Post the notice in groups (optional)'), text: str('Group notice text (optional)'), dm_first_reply: bool('Show the DM notice once (optional)'), dm_text: str('Direct-message notice text (optional)') },
    run: (a, x) => x.call('PUT', '/api/privacy-notice', { enabled: a.enabled, text: a.text, dmFirstReply: a.dm_first_reply, dmText: a.dm_text }) },
  { name: 'set_chat_privacy_notice', calls: [['PUT', '/api/chats/x/prefs']],
    description: 'Opt a group out of the privacy notice (off = true) or back in (off = false). The change is recorded in the activity log.',
    input: { chat: str('Chat id'), off: bool('true = never post the notice in this chat') }, required: ['chat', 'off'],
    run: (a, x) => x.call('PUT', `/api/chats/${enc(a.chat)}/prefs`, { noticeOff: !!a.off }) },
  { name: 'list_chat_messages', readOnly: true, calls: [['GET', '/api/chats/x/messages']],
    description: 'Messages stored for a chat (newest first), optionally filtered by text. An agent\'s answer says which agent gave it and its rating (1 good, -1 wrong, 0 not rated; rate it with rate_agent_answer). Admins and owners only; each look is recorded in the activity log.',
    input: { chat: str('Chat id'), search: str('Only messages containing this text (optional)'), limit: int('How many (default 30, max 200)', { minimum: 1, maximum: 200 }), before_id: int('Only older than this message id'),
      around_id: int('The messages around this message id (an answer from list_agent_answers or the activity log)') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/messages?limit=${Math.min(Number(a.limit) || 30, 200)}${a.before_id ? `&before=${a.before_id}` : ''}${a.around_id ? `&around=${a.around_id}` : ''}${a.search ? `&q=${enc(a.search)}` : ''}`) },
  { name: 'search_messages', readOnly: true, calls: [['GET', '/api/search/messages']],
    description: 'Search stored messages across every chat that is on and not private to members (owner only): all words must appear, word beginnings match ("ride" finds "rides"). Newest first, 30 at a time; each search is recorded in the activity log.',
    input: { query: str('Words to look for (at least 2 characters)'), before_id: int('Only older than this message id (next page)') }, required: ['query'],
    run: (a, x) => x.call('GET', `/api/search/messages?q=${enc(a.query)}${a.before_id ? `&before=${a.before_id}` : ''}`) },
  { name: 'list_agent_answers', readOnly: true, calls: [['GET', '/api/agents/x/review']],
    description: 'An agent\'s recent answers with the message that asked for them and their 👍/👎 rating, plus this week\'s counts (Review on the agent page). only: down (rated 👎) or unrated. Private chats are left out; each look is recorded.',
    input: { agent_id: str('Agent id'), only: str('down | unrated (optional)'), before_id: int('Only older than this answer id') }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/review?only=${enc(a.only || '')}${a.before_id ? `&before=${a.before_id}` : ''}`) },
  { name: 'rate_agent_answer', calls: [['PUT', '/api/agents/x/review/1']],
    description: 'Rate one answer of an agent: 1 = good, -1 = wrong or unhelpful, 0 = clear. To fix a wrong answer, draft a change with draft_agent_with_ai (e.g. a FAQ entry) and apply it with update_agent.',
    input: { agent_id: str('Agent id'), answer_id: int('Answer id from list_agent_answers'), rating: int('1, -1 or 0', { minimum: -1, maximum: 1 }) }, required: ['agent_id', 'answer_id', 'rating'],
    run: (a, x) => x.call('PUT', `/api/agents/${enc(a.agent_id)}/review/${Number(a.answer_id)}`, { rating: a.rating }) },
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
  { name: 'preview_weekly_summary', readOnly: true, calls: [['GET', '/api/owner-assistant/weekly-preview']],
    description: 'The weekly summary text as it would be sent now (counts and costs only, no message contents). It is the owner assistant\'s schedule "weekly-summary": change its day, time or on/off with update_agent on owner-assistant, and send it now with run_schedule_now (agent owner-assistant, schedule weekly-summary).',
    input: {},
    run: async (a, x) => (await x.call('GET', '/api/owner-assistant/weekly-preview')).text },
  { name: 'list_contacts', readOnly: true, calls: [['GET', '/api/contacts']], description: 'Contacts (WhatsApp names synced from the phone + own entries). Each has bookName (the phone\'s address book), businessName, profileName (chosen by the person) and ownName; name is the one shown (own > address book > business > profile > number). Shared ones can be looked up by participants through agents.',
    input: { query: str('Name, note or number to filter by (optional)'), shared_only: { type: 'boolean' }, offset: { type: 'number', description: 'Skip this many (paging; 500 per call)' } },
    run: (a, x) => x.call('GET', `/api/contacts?q=${enc(a.query || '')}${a.shared_only ? '&shared=1' : ''}${a.offset ? `&offset=${Number(a.offset) || 0}` : ''}`) },
  { name: 'contact_names_status', readOnly: true, calls: [['GET', '/api/contacts/summary']], description: 'How many contact names of each kind are known (address book, business, profile, own), how many people WhatsApp shows only by a hidden number, and when names were last refreshed. Names refresh by themselves after WhatsApp connects and daily.',
    input: {}, run: (a, x) => x.call('GET', '/api/contacts/summary') },
  { name: 'set_contact_names_for_agents', risky: true, calls: [['GET', '/api/contacts/summary'], ['PUT', '/api/contacts/agent-names']],
    description: 'Owner only: whether agents may use the names from the owner\'s phone contacts (on by default, because WhatsApp profile names are often incomplete). Off: agents see business or profile names. Needs confirm_action.',
    input: { enabled: bool('true = agents may use phone contact names') }, required: ['enabled'],
    preview: async (a, x) => {
      const cur = await x.call('GET', '/api/contacts/summary');
      return `${a.enabled ? 'Let agents use' : 'Stop agents using'} the names from your phone contacts (now ${cur.namesForAgents === false ? 'off' : 'on'}).${a.enabled ? ' A private label you saved for someone can then appear in agent replies.' : ' Agents then see business or profile names.'}`;
    },
    run: (a, x) => x.call('PUT', '/api/contacts/agent-names', { enabled: !!a.enabled }) },
  { name: 'refresh_contact_names', calls: [['POST', '/api/contacts/refresh']], description: 'Optional: ask WhatsApp for address-book names now (the server also does this by itself after connecting and daily). Changes nothing in WhatsApp.',
    input: {}, run: (a, x) => x.call('POST', '/api/contacts/refresh') },
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
  { name: 'list_model_accounts', readOnly: true, calls: [['GET', '/api/providers']],
    description: 'Connected model provider accounts (several per provider are possible, e.g. openai and openai-work) with their health: ok, paused (until when and why: usage limit, rate limit, outage…), or reconnect (sign-in expired), and how accounts of one provider are used (order or spread). Plan quotas are not read: a used-up limit shows as health paused until the reset the provider reported. Never shows keys.',
    input: {}, run: async (a, x) => (await x.call('GET', '/api/providers')).filter((p) => p.connected || p.error).map((p) => ({ id: p.id, name: p.name, type: p.type, provider: p.group, connected: p.connected, models: p.models, health: p.health, strategy: p.strategy, error: p.error })) },
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
  { name: 'retry_model_account', calls: [['POST', '/api/accounts/x/retry']],
    description: 'Clear the pause of a model account (after fixing its key, quota or sign-in) so it is tried again on the next message.',
    input: { account: str('Account id (see list_model_accounts)') }, required: ['account'],
    run: (a, x) => x.call('POST', `/api/accounts/${enc(a.account)}/retry`, {}) },
  { name: 'test_model_provider', calls: [['POST', '/api/providers/x/test']],
    description: 'Send a tiny test prompt through one connected account (anthropic, openai, chatgpt, copilot, openrouter, another account id such as openai-work, or an endpoint id) and return the reply and response time. No fallback.',
    input: { provider: str('Account id') }, required: ['provider'],
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
      if (!cur) throw fail(`No global tool service named ${a.name}`, 404);
      return `Remove the global tool service ${a.name}. ${cur.agents.using.length} agent${cur.agents.using.length === 1 ? '' : 's'} (${cur.agents.using.join(', ') || 'none'}) lose its tools right away; its sign-ins are deleted.`;
    },
    run: (a, x) => x.call('DELETE', `/api/tool-services/${enc(a.name)}`) },

  // ---------- browse the MCP Registry (052) ----------
  { name: 'search_mcp_registry', readOnly: true, calls: [['GET', '/api/tool-services/registry']],
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
  { name: 'add_tool_service_from_registry', risky: true, calls: [['POST', '/api/tool-services/registry/add']],
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
    description: 'Set or replace a secret (API key, token) or the API key of a model account WITHOUT seeing its value: returns a one-time link (15 minutes, single use) to a panel page where a signed-in owner or admin pastes the value. Give the link to the user exactly as returned; never ask them to type a key in the chat. Afterwards list_secrets (or list_model_accounts) shows it as set. Give name (UPPER_SNAKE_CASE) or account (an API-key account id from list_model_accounts).',
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
  { name: 'set_small_server_mode', risky: true, calls: [['GET', '/api/server/small-mode'], ['PUT', '/api/server/small-mode']],
    description: 'Small server mode (owner only): on a small server (under 2 GB or 1 CPU) allow heavier features anyway: on-server speech and local tool services, each one at a time / at most 2, started only when memory allows and stopped when it is tight. Slower and may be refused at busy moments. Does not cover GitHub Copilot sign-in (needs 2 GB). Needs confirm_action.',
    input: { enabled: bool('true = allow heavier features on this small server') }, required: ['enabled'],
    preview: async (a, x) => {
      const cur = await x.call('GET', '/api/server/small-mode');
      const size = `${cur.server.size} server, ${cur.server.effectiveMb} MB, ${cur.server.cpus} CPU`;
      return a.enabled ? `Switch Small server mode on (${size}; now ${cur.enabled ? 'on' : 'off'}). Allows: ${cur.covers.join('; ')}. Slower; heavier work waits or is refused when memory is tight. Not covered: ${cur.notCovered.join('; ')}.`
        : `Switch Small server mode off (${size}; now ${cur.enabled ? 'on' : 'off'}). On a small server, on-server speech stops being used and local tool services stop starting (they stay saved).`;
    },
    run: (a, x) => x.call('PUT', '/api/server/small-mode', { enabled: !!a.enabled }) },
  { name: 'get_logging_settings', readOnly: true, calls: [['GET', '/api/logging']], description: 'What the activity log records: level, categories, retention.', input: {},
    run: (a, x) => x.call('GET', '/api/logging') },
  { name: 'set_logging_settings', calls: [['PUT', '/api/logging']],
    description: 'Change what the activity log records. level: minimal | normal | verbose; categories: { name: true/false } (see get_logging_settings); retention_days; max_entries.',
    input: { level: { type: 'string', enum: ['minimal', 'normal', 'verbose'], description: 'Level (optional)' }, categories: obj('Category switches (optional)'),
      retention_days: int('Keep for days (1–365, optional)'), max_entries: int('At most entries (500–100000, optional)') },
    run: (a, x) => x.call('PUT', '/api/logging', { level: a.level, categories: a.categories, retentionDays: a.retention_days, maxEntries: a.max_entries }) },

  // ---------- updates ----------
  { name: 'get_update_status', readOnly: true, calls: [['GET', '/api/updates']],
    description: 'Running version, last update check, whether an update is available or running. status.notes: every release between the running version and the target, newest first (version, title, summary, breaking, actions, changes: [{ type new | improved | fixed | removed, text }]); tell the owner the key changes before updating. When a breaking release is waiting: breaking, steps (title, summary, actions the owner must take), safeTarget (newest release that needs no decision) and decision.', input: {},
    run: (a, x) => x.call('GET', '/api/updates') },
  { name: 'get_release_notes', readOnly: true, calls: [['GET', '/api/releases']],
    description: 'Release notes of the installed version and the ones before it (what is new, improved, fixed or removed per version, newest first). Optional from (exclusive) and to (inclusive), e.g. from v2.24.0 to v2.26.0 for "what changed in the last update".',
    input: { from: str('Versions after this one (optional, e.g. v2.24.0)'), to: str('Up to this version (optional)') },
    run: (a, x) => x.call('GET', `/api/releases?${new URLSearchParams({ from: a.from || '', to: a.to || '' })}`) },
  { name: 'check_for_updates', calls: [['POST', '/api/updates/check']], description: 'Check GitHub for a newer version now.', input: {},
    run: (a, x) => x.call('POST', '/api/updates/check') },
  { name: 'apply_update', risky: true, calls: [['POST', '/api/updates/apply']],
    description: 'Install an update and restart; a local backup is made first when a backup passphrase is set. By default installs the newest release that needs no decision. breaking: true also crosses a breaking release (show its steps to the owner first). Needs confirm_action.',
    input: { breaking: bool('Also install a breaking release (owner decision)'), backup: bool('Make a backup first (default true)') },
    preview: async (a, x) => {
      const st = await x.call('POST', '/api/updates/check');
      if (!st.available) throw fail(`Already up to date (${st.current || 'current version'})`);
      const target = st.breaking && !a.breaking ? st.safeTarget : st.target || st.latest;
      if (!target) throw fail(`Version v${st.decisionVersion} is a breaking release: call again with breaking: true after the owner read its steps`, 409);
      const steps = a.breaking && st.breaking ? ` BREAKING: ${st.steps.map((s) => `v${s.version} ${s.title}${s.actions.length ? ` (you must: ${s.actions.join(' ')})` : ''}`).join('; ')}.` : '';
      const notes = (st.notes || []).filter((n) => notAfter(n.version, target));
      const what = notes.length ? ` What changes: ${notes.slice(0, 5).map((n) => `v${n.version} ${n.title}`).join('; ')}${notes.length > 5 ? `; and ${notes.length - 5} earlier releases` : ''}.` : '';
      return `Update from ${st.current} to ${target}.${what}${steps}${a.backup === false ? ' No backup first.' : ''} The app restarts: agents are offline for 1–2 minutes.`;
    },
    run: (a, x) => x.call('POST', '/api/updates/apply', { breaking: a.breaking === true, backup: a.backup !== false }) },
  { name: 'snooze_update_decision', calls: [['POST', '/api/updates/decision']],
    description: 'A breaking release waits for the owner: snooze the reminder for 7 days (action snooze) or dismiss it until a newer breaking release (action dismiss).',
    input: { action: { type: 'string', enum: ['snooze', 'dismiss'], description: 'snooze or dismiss' } }, required: ['action'],
    run: (a, x) => x.call('POST', '/api/updates/decision', { action: a.action }) },

  // ---------- server ----------
  { name: 'get_server_metrics', readOnly: true, calls: [['GET', '/api/system']], description: 'Server CPU, memory, disk, load and uptime right now, and where it is hosted (hosting.provider: oci, gcp, docker, server or unknown) so you can point to the matching hosting guide in docs/deploy/.', input: {},
    run: (a, x) => x.call('GET', '/api/system') },
  { name: 'get_server_health', readOnly: true, calls: [['GET', '/api/server/health']], description: 'Server → Health: database size (bytes, reusable bytes), rows and the oldest kept date of stored messages, activity and usage detail, how long each is kept (retention), the last automatic clean-up (rows removed), free disk (level ok | low | full; at full, stored messages and backups pause), the photos & voice queue and whether the server clock looks steady. Old data is pruned automatically every hour.', input: {},
    run: (a, x) => x.call('GET', '/api/server/health') },
  { name: 'set_retention', risky: true, calls: [['GET', '/api/server/health'], ['PUT', '/api/server/retention']],
    description: 'Owner only: how long data is kept. messages_days (7–3650) and messages_per_chat (200–50000) for stored chat messages, usage_days (30–3650) for model-call detail. Shorter values delete older data on the next clean-up (within the hour); summaries, notes and contacts are never pruned. Activity retention is set with set_logging_settings. Needs confirm_action.',
    input: { messages_days: { type: 'number' }, messages_per_chat: { type: 'number' }, usage_days: { type: 'number' } },
    preview: async (a, x) => {
      const r = (await x.call('GET', '/api/server/health')).retention;
      const parts = [['messages_days', 'messagesDays', 'stored messages kept', 'days'], ['messages_per_chat', 'messagesPerChat', 'stored messages per chat', ''], ['usage_days', 'usageDays', 'usage detail kept', 'days']]
        .filter(([k]) => a[k] !== undefined).map(([k, f, what, unit]) => `${what}: ${r[f]} → ${a[k]}${unit ? ` ${unit}` : ''}${Number(a[k]) < r[f] ? ' (older data is deleted on the next clean-up)' : ''}`);
      return parts.length ? `Change ${parts.join('; ')}.` : 'Nothing to change.';
    },
    run: (a, x) => x.call('PUT', '/api/server/retention', { messagesDays: a.messages_days, messagesPerChat: a.messages_per_chat, usageDays: a.usage_days }) },
  { name: 'list_os_updates', readOnly: true, calls: [['GET', '/api/system/os-updates']], description: 'Operating-system package updates, grouped: install (will install now; count = how many), phased (Ubuntu is rolling them out gradually: they install automatically within days, or now with run_maintenance os-update-all) and held (kept back, with the reason in why).',
    input: { refresh: bool('Check again now (slower)') },
    run: (a, x) => x.call('GET', `/api/system/os-updates${a.refresh ? '?refresh=1' : ''}`) },
  { name: 'get_maintenance_status', readOnly: true, calls: [['GET', '/api/system/ops']], description: 'Available server maintenance actions, the state of the last one, result.text (summary of the last OS update), reboot (whether a restart is needed to finish updates, and for which packages) and the maintenance helper: helperVersion, helperBundled (the one this release ships), helperOutdated, helperSelfUpdate (it can update itself with run_maintenance update-helper; otherwise sudo duniya update once or a reinstall).', input: {},
    run: (a, x) => x.call('GET', '/api/system/ops') },
  { name: 'run_maintenance', risky: true, calls: [['POST', '/api/system/ops']],
    description: 'Run a server maintenance action: os-update (install OS updates; Ubuntu\'s gradual roll-outs wait), os-update-all (also the updates Ubuntu is still rolling out gradually), os-cleanup, restart-web, restart-tunnel, reboot (also finishes updates that need a restart) or update-helper (the root maintenance helper fetches the copy of this app\'s release from the official repository and installs it; get_maintenance_status shows helperOutdated / helperSelfUpdate). Needs confirm_action.',
    input: { action: { type: 'string', enum: ['os-update', 'os-update-all', 'os-cleanup', 'restart-web', 'restart-tunnel', 'reboot', 'update-helper'], description: 'Action' } }, required: ['action'],
    preview: async (a, x) => {
      const ops = await x.call('GET', '/api/system/ops');
      const label = ops.actions?.[a.action];
      if (!label) throw fail('Unknown action');
      const effect = { reboot: 'The whole server restarts: agents and the panel are offline for a few minutes.', 'os-update': 'Takes a few minutes; services may restart.',
        'os-update-all': 'Takes a few minutes; services may restart. Also installs updates Ubuntu is still rolling out gradually (normally they come within days).',
        'update-helper': `The root helper downloads its own files of this app's release (helper ${ops.helperVersion} → ${ops.helperBundled}) from the official repository and installs them; agents keep running.`,
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
    description: 'Restore a backup (replaces all current data) and restart. Uses the backup passphrase stored on this server (never ask for one); a backup made elsewhere or with another passphrase cannot be restored here: the error gives the panel link to restore it there. Needs confirm_action.',
    input: { source: { type: 'string', enum: ['local', 'github', 's3'], description: 'Where the backup is' }, file: str('Backup file name (see list_backups)') },
    required: ['source', 'file'],
    preview: async (a, x) => {
      const b = await x.call('POST', '/api/backups/restore', { source: a.source, file: a.file, check: true }); // opens it, restores nothing
      return `Restore backup ${a.file} from ${a.source} (made ${iso(b.createdAt) || 'at an unknown time'}). Everything now on the server (agents, chats, memory, settings, users) is replaced by the backup, then the app restarts (agents offline 1–2 minutes).`;
    },
    run: (a, x) => x.call('POST', '/api/backups/restore', { source: a.source, file: a.file }) },

  // ---------- users ----------
  { name: 'list_users', readOnly: true, calls: [['GET', '/api/users']], description: 'Panel users and their roles (owner, admin, viewer).', input: {},
    run: (a, x) => x.call('GET', '/api/users') },
  { name: 'add_user', calls: [['POST', '/api/users']],
    description: 'Add a panel user (role owner | admin | viewer) who sets their own password: returns a one-time sign-up link (48 hours, single use) to forward to that person only. Whoever opens it chooses the password, so never post it in a group. A new link: send_signup_link.',
    input: { username: str('Username (2–40 letters, digits, . _ -)'), role: { type: 'string', enum: ['owner', 'admin', 'viewer'], description: 'Role' }, email: str('Email (optional)') },
    required: ['username', 'role'],
    run: async (a, x) => {
      const u = await x.call('POST', '/api/users', { username: a.username, role: a.role, email: a.email });
      return { username: u.username, role: u.role, link: u.signup.link, expires: iso(u.signup.expiresAt), note: 'Forward the link to them only: they set their own password (one use, 48 hours).' };
    } },
  { name: 'send_signup_link', risky: true, calls: [['GET', '/api/users'], ['POST', '/api/users/x/signup-link']],
    description: 'A new one-time link (48 hours, single use) where a user sets their own password: for a new user whose link expired, or a forgotten password. Earlier links of that user stop working. Needs confirm_action.',
    input: { user_id: int('User id (see list_users)') }, required: ['user_id'],
    preview: async (a, x) => {
      const u = (await x.call('GET', '/api/users')).find((r) => r.id === Number(a.user_id));
      if (!u) throw fail('User not found', 404);
      return `Make a one-time link where the ${u.role} "${u.username}" sets ${u.hasPassword ? 'a new' : 'their'} password (48 hours).${u.hasPassword ? ' Their current password keeps working until the link is used.' : ''} Whoever opens it can choose the password: send it to them only.`;
    },
    run: async (a, x) => {
      const r = await x.call('POST', `/api/users/${enc(a.user_id)}/signup-link`);
      return { username: r.username, link: r.link, expires: iso(r.expiresAt) };
    } },
  { name: 'update_user', calls: [['PUT', '/api/users/x']], description: 'Change a user\'s role, or disable/enable their account.',
    input: { user_id: int('User id (see list_users)'), role: { type: 'string', enum: ['owner', 'admin', 'viewer'], description: 'New role (optional)' }, disabled: bool('Disable (true) or enable (false) (optional)') },
    required: ['user_id'],
    run: (a, x) => x.call('PUT', `/api/users/${enc(a.user_id)}`, { role: a.role, disabled: a.disabled }) },
  { name: 'remove_user', risky: true, calls: [['DELETE', '/api/users/x']], description: 'Remove a panel user. Needs confirm_action.',
    input: { user_id: int('User id') }, required: ['user_id'],
    preview: async (a, x) => {
      const u = (await x.call('GET', '/api/users')).find((r) => r.id === Number(a.user_id));
      if (!u) throw fail('User not found', 404);
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
      if (!n) throw fail('Unknown number', 404);
      return `Remove the WhatsApp number "${n.label}" (${n.id}). It is unlinked from this app and its chats stop getting replies.`;
    },
    run: (a, x) => x.call('DELETE', `/api/whatsapp/numbers/${enc(a.number_id)}`) },
  // ---------- photos & voice (043) ----------
  { name: 'get_photos_and_voice', readOnly: true, calls: [['GET', '/api/media']],
    description: 'What the connected providers can do beyond text (sees images / hears voice notes / creates images / speaks), with how to enable what is missing; the on-server speech engines; the server size (small servers refuse on-server engines) and the media queue.',
    input: {},
    run: async (a, x) => { const r = await x.call('GET', '/api/media'); return { summary: r.summary, providers: r.providers, settings: r.settings, onServer: r.local, server: r.server, localAllowed: r.localAllowed, queue: r.queue }; } },
  { name: 'set_photos_and_voice_settings', calls: [['PUT', '/api/media/settings']],
    description: 'Server-wide photo & voice settings: vision_fallback (provider:model used when an agent\'s model cannot see photos; empty = none), image_model (provider:model for pictures; empty = automatic), voice (OpenAI voice for spoken replies), max_voice_seconds (longest voice note to transcribe), image_price (USD per picture for image_model, for usage and caps), local_listen / local_speak (owner only: use the on-server engines; refused on servers under 2 GB of memory).',
    input: { vision_fallback: str('provider:model or empty (optional)'), image_model: str('provider:model or empty (optional)'), voice: str('alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar (optional)'),
      max_voice_seconds: int('10–1800 (optional)', { minimum: 10, maximum: 1800 }), image_price: { type: 'number', description: 'USD per picture for image_model (optional)' },
      local_listen: bool('Use the on-server listening engine (optional)'), local_speak: bool('Use the on-server speaking engine (optional)') },
    run: async (a, x) => {
      const body = {};
      if (a.vision_fallback !== undefined) body.visionFallback = a.vision_fallback;
      if (a.image_model !== undefined) body.imageModel = a.image_model;
      if (a.voice) body.voice = a.voice;
      if (a.max_voice_seconds) body.maxVoiceSeconds = a.max_voice_seconds;
      if (a.image_price !== undefined) {
        const cur = await x.call('GET', '/api/media');
        const ref = a.image_model || cur.settings.imageModel;
        if (!ref) throw fail('Give image_model with image_price');
        body.imagePrices = { ...cur.settings.imagePrices, [ref]: a.image_price };
      }
      if (a.local_listen !== undefined || a.local_speak !== undefined) body.local = { ...(a.local_listen !== undefined ? { listen: a.local_listen } : {}), ...(a.local_speak !== undefined ? { speak: a.local_speak } : {}) };
      const r = await x.call('PUT', '/api/media/settings', body);
      return { settings: r.settings, summary: r.summary };
    } },
  { name: 'install_speech_engine', calls: [['POST', '/api/media/local/x/install']],
    description: 'Owner only. Download an on-server speech engine (stt = listening, Whisper tiny ~115 MB; tts = speaking, Piper voice ~65 MB) into the data folder. Needs a server with 2 GB+ of memory. Runs in the background; check get_photos_and_voice for progress.',
    input: { engine: { type: 'string', enum: ['stt', 'tts'], description: 'stt (listening) or tts (speaking)' } }, required: ['engine'],
    run: (a, x) => x.call('POST', `/api/media/local/${enc(a.engine)}/install`) },
  { name: 'set_agent_photos_and_voice', calls: [['PUT', '/api/agents/x']],
    description: 'An agent\'s "Photos & voice" switches: photos (look at photos), documents (read PDFs), stickers, voice_notes (listen to voice notes), voice_reply (never | voice = when they sent a voice note | always), organizers_create_images, participants_create_images.',
    input: { agent_id: str('Agent id'), photos: bool('optional'), documents: bool('optional'), stickers: bool('optional'), voice_notes: bool('optional'),
      voice_reply: { type: 'string', enum: ['never', 'voice', 'always'] }, organizers_create_images: bool('optional'), participants_create_images: bool('optional') }, required: ['agent_id'],
    run: async (a, x) => {
      const cur = (await x.call('GET', `/api/agents/${enc(a.agent_id)}`)).config?.media || {};
      const media = { ...cur, createImages: { ...(cur.createImages || {}) } };
      for (const [k, f] of [['photos', 'photos'], ['documents', 'documents'], ['stickers', 'stickers'], ['voice_notes', 'voiceNotes'], ['voice_reply', 'voiceReply']]) if (a[k] !== undefined) media[f] = a[k];
      if (a.organizers_create_images !== undefined) media.createImages.organizer = a.organizers_create_images;
      if (a.participants_create_images !== undefined) media.createImages.participant = a.participants_create_images;
      const r = await x.call('PUT', `/api/agents/${enc(a.agent_id)}`, { media });
      return { agent: r.id, media: r.config?.media };
    } },
];import { fail } from '../core/config.js';

