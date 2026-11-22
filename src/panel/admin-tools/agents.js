// @ts-check
// Admin tools for agents (see ../admin-tools.js for how a tool is described and run).
import { enc, str, bool, obj, ROLE_TEXT, agentName } from './fields.js';

/** @type {import('../admin-tools.js').AdminTool[]} */
export const AGENT_TOOLS = [
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
    description: 'Change fields of an agent (only the fields given change), e.g. { "prompt": "…", "triggers": ["silku", "!help"], "model": "auto" } or { "groupReplies": "followups" | "wake" | "auto" } (in groups: when woken and replies right after it speaks, only when woken, or whenever a message is for it) or { "fallback": { "mode": "off" } } (model fallback: inherit | on | off, optional "chain") or { "model": "smart", "modelTiers": { "light": "", "strong": "" } } (Auto: light for simple, strong when needed; empty tiers = Settings → Models) or { "promises": { "track": true, "followUp": "chat" | "dm" | "off" } } (notice promises in its chats and remind when due) or { "cues": true } (suggest family ties in People from what people say) or { "lessons": { "enabled": true, "autoApprove": false } } (learn lessons from the owner\'s corrections; save them without asking) or { "autonomy": "ask" | "clear" | "act" } (how sure before changing things: ask = show the preview and wait for a yes; clear = default, an organizer\'s clear request is the approval, tools that declare themselves destructive still ask; act = also reasonable inferred changes; a tool service can differ: set_tool_behaviour) or { "selfCheck": false } (stop checking amounts, dates and counts against People and modules before sending) or { "peopleAccess": "own" | "everyone" | "off", "peopleLists": ["l_…"] } (which people its People tools and sender cards may see: its own chats plus shared lists, everyone in People, or nobody) or { "organizers": [phone, "p_…" person, "l_…" list] } (roles follow a person on every app). Returns the agent and any warnings. For owner-assistant, how it is reached and its permissions are fixed in code (chats, triggers, people, confirm, quick answers are ignored); alerts: { to: "+41…" } sets where owner alerts go (owner only).',
    input: { agent_id: str('Agent id'), changes: obj('Fields to change') }, required: ['agent_id', 'changes'],
    run: (a, x) => x.call('PUT', `/api/agents/${enc(a.agent_id)}`, a.changes || {}) },
  // 089: lessons from the owner's corrections
  { name: 'list_lessons', readOnly: true, calls: [['GET', '/api/agents/x/lessons']],
    description: 'An agent\'s lessons: the ones waiting for approval (proposed from a 👎 on an answer, the owner\'s corrections in a chat, or feedback on when it joins in) and the saved ones, each with its kind (answer | join = when to join in), scope (chat id or "" for all its chats) and source; plus join-in feedback counts per chat and the switches.',
    input: { agent_id: str('Agent id') }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/lessons`) },
  { name: 'add_lesson', calls: [['POST', '/api/agents/x/lessons']],
    description: 'Add a lesson to an agent (saved at once): a short rule it follows, e.g. "Chary drives on Saturdays, not Rao". kind: answer (default) or join (when to join in a group by itself); chat: one chat id, or empty for all its chats.',
    input: { agent_id: str('Agent id'), text: str('The lesson (one sentence)'), kind: { type: 'string', enum: ['answer', 'join'] }, chat: str('Only in this chat (optional)') }, required: ['agent_id', 'text'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/lessons`, { text: a.text, kind: a.kind || 'answer', chat: a.chat || '' }) },
  { name: 'edit_lesson', calls: [['PUT', '/api/agents/x/lessons/1']],
    description: 'Approve, reword or re-scope a lesson (id from list_lessons): status "active" approves a proposed one; text; chat ("" = all its chats).',
    input: { agent_id: str('Agent id'), lesson_id: { type: 'integer' }, status: { type: 'string', enum: ['active', 'proposed'] }, text: str('New wording (optional)'), chat: str('Scope: a chat id or "" (optional)') }, required: ['agent_id', 'lesson_id'],
    run: (a, x) => x.call('PUT', `/api/agents/${enc(a.agent_id)}/lessons/${Number(a.lesson_id)}`, { ...(a.status ? { status: a.status } : {}), ...(a.text !== undefined ? { text: a.text } : {}), ...(a.chat !== undefined ? { chat: a.chat } : {}) }) },
  { name: 'delete_lesson', destructive: true, calls: [['DELETE', '/api/agents/x/lessons/1']],
    description: 'Delete (or dismiss a proposed) lesson of an agent (id from list_lessons).',
    input: { agent_id: str('Agent id'), lesson_id: { type: 'integer' } }, required: ['agent_id', 'lesson_id'],
    run: (a, x) => x.call('DELETE', `/api/agents/${enc(a.agent_id)}/lessons/${Number(a.lesson_id)}`) },
  { name: 'join_in_feedback', calls: [['POST', '/api/agents/x/join-feedback']],
    description: 'Feedback on when an agent joins a group conversation by itself (follow-ups or "whenever needed"): kind "needless" with message_id = an answer it gave by itself (it did not need to answer), "missed" with chat = a group where it stayed out but should have answered (the last message there), or "good". needless / missed propose a join-in lesson.',
    input: { agent_id: str('Agent id'), kind: { type: 'string', enum: ['needless', 'missed', 'good'] }, message_id: { type: 'integer', description: 'The answer (needless, good)' }, chat: str('The group (missed)') }, required: ['agent_id', 'kind'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/join-feedback`, { kind: a.kind, msg: a.message_id, chat: a.chat || '' }) },
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
  { name: 'draft_agent_with_ai', openWorld: true, calls: [['POST', '/api/ai/agent-draft']],
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
  { name: 'run_schedule_now', openWorld: true, calls: [['POST', '/api/agents/x/schedules/y/run']], description: 'Run one of an agent\'s scheduled posts now (it posts to the chat as it would on schedule). For owner-assistant the result goes to every linked owner and admin in their own chat (weekly-summary = the weekly summary).',
    input: { agent_id: str('Agent id'), schedule_id: str('Schedule id (see get_agent → schedules)') }, required: ['agent_id', 'schedule_id'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/schedules/${enc(a.schedule_id)}/run`) },
  { name: 'test_agent', openWorld: true, calls: [['POST', '/api/agents/x/test']],
    description: 'Send a test message to an agent, like the panel\'s test console, and get its reply. Nothing is posted to WhatsApp. "as" picks the sender\'s role (organizer or participant). "path" says what answered: quick (quick reply or !help), faq or model.',
    input: { agent_id: str('Agent id'), text: str('Message text'), as: { type: 'string', enum: ['organizer', 'participant'], description: 'Sender role (default participant)' },
      chat: str('Test as if in this chat of the agent (its memory, group or direct, model); omit for a new direct chat') }, required: ['agent_id', 'text'],
    run: (a, x) => x.call('POST', `/api/agents/${enc(a.agent_id)}/test`, { text: a.text, role: ROLE_TEXT[a.as] || 'participant', chat: a.chat || 'new' }) },
  { name: 'list_agent_tools', readOnly: true, calls: [['GET', '/api/agents/x/test-tools']],
    description: 'The tools an agent can use for a role (organizer or participant), grouped by tool service — what the test console shows under "Test as…".',
    input: { agent_id: str('Agent id'), as: { type: 'string', enum: ['organizer', 'participant'], description: 'Role (default participant)' } }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/test-tools?role=${ROLE_TEXT[a.as] || 'participant'}`) },

];
