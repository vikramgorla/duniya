// @ts-check
// Admin MCP tools (017). Each tool runs the same panel route handler in-process (not over HTTP), as the signed-in
// panel user, so role gates, validation and activity logging are exactly the panel's. `calls` names the routes a
// tool uses: the minimum role to see and run the tool is the highest role those routes require.
// Risky tools never run directly: they return a plain-language preview and a confirm code for confirm_action.
import { fail, money } from '../core/config.js';
/** 065: version a is not newer than b ("2.9.0" vs "v2.10.0"). */
const notAfter = (a, b) => { const [x, y] = [a, b].map((v) => String(v).replace(/^v/, '').split('.').map(Number)); const i = x.findIndex((n, k) => n !== y[k]); return i < 0 || x[i] < y[i]; };
const iso = (ts) => (ts ? new Date(ts).toISOString() : null);

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
/** 082: the body of a send preview from admin tool arguments. */
const sendBody = (a) => ({ title: a.title, audience: a.audience, purpose: a.purpose, template: a.template, agent: a.agent, mode: a.mode, group: a.group, noReplyLimit: a.no_reply_limit, survey: a.survey });
const campaignBody = (a) => ({ title: a.title, audience: a.audience, purpose: a.purpose, agent: a.agent, steps: a.steps, stops: a.stops, event: a.event, endDay: a.end_day, noReplyLimit: a.no_reply_limit });
/** 081: an event id from an id or (part of) a name, upcoming first. */
async function eventIdOf(x, ref) {
  const r = String(ref || '').trim().toLowerCase();
  const all = [...await x.call('GET', '/api/module/events'), ...await x.call('GET', '/api/module/events?past=1')];
  const e = all.find((v) => v.id === ref) || all.find((v) => v.name.toLowerCase() === r) || all.find((v) => v.name.toLowerCase().includes(r));
  if (!e) throw fail(`No event matches "${ref}"`, 404);
  return e.id;
}
async function numbers(x) {
  const ch = (await x.call('GET', '/api/status')).channel;
  return ch?.numbers || (ch ? [{ id: 'main', label: 'Main', ...ch }] : []);
}

/**
 * 084: the four MCP tool hints, all explicit booleans (directories such as OpenAI's refuse a tool with one missing),
 * derived from what a tool calls so they cannot drift: read-only tools are neither destructive nor open-world-writing
 * and are idempotent; a write is destructive when it is risky (confirm gate) or overwrites/deletes (PUT, DELETE),
 * idempotent when it only PUTs/DELETEs. `destructive` / `idempotent` on a tool override the derivation (a POST that
 * sets a value); `openWorld` marks tools that reach outside this server (WhatsApp/Telegram, a model, GitHub, apt…).
 * @param {{ readOnly?: boolean, risky?: boolean, destructive?: boolean, idempotent?: boolean, openWorld?: boolean, calls?: string[][] }} t
 */
export function toolHints(t) {
  const writes = (t.calls || []).map(([m]) => m).filter((m) => m !== 'GET');
  const readOnlyHint = !!t.readOnly;
  return {
    readOnlyHint,
    destructiveHint: !readOnlyHint && (t.destructive ?? (!!t.risky || writes.some((m) => m === 'PUT' || m === 'DELETE'))),
    idempotentHint: readOnlyHint || (t.idempotent ?? writes.every((m) => m === 'PUT' || m === 'DELETE')),
    openWorldHint: !!t.openWorld,
  };
}
/** A tool's human-readable title from its name: list_agents → "List agents". */
export const toolTitle = (name) => name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** @type {Array<{name, description, input, required?, calls, risky?, readOnly?, destructive?, idempotent?, openWorld?, noConfirm?, run, preview?}>} noConfirm: the owner assistant runs it without a confirm code (logged). */
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
      return (await x.call('GET', `/api/activity?${q}`)).map((r) => ({ id: r.id, time: iso(r.ts), type: r.type, agent: r.agent || undefined, chat: r.chat || undefined, chatName: r.chatName || undefined, summary: r.summary, ...(a.include_details && r.detail ? { detail: r.detail } : {}) }));
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
    description: 'Change fields of an agent (only the fields given change), e.g. { "prompt": "…", "triggers": ["silku", "!help"], "model": "auto" } or { "groupReplies": "followups" | "wake" | "auto" } (in groups: when woken and replies right after it speaks, only when woken, or whenever a message is for it) or { "fallback": { "mode": "off" } } (model fallback: inherit | on | off, optional "chain") or { "model": "smart", "modelTiers": { "light": "", "strong": "" } } (Auto: light for simple, strong when needed; empty tiers = Settings → Models) or { "promises": { "track": true, "followUp": "chat" | "dm" | "off" } } (notice promises in its chats and remind when due) or { "cues": true } (suggest family ties in People from what people say) or { "lessons": { "enabled": true, "autoApprove": false } } (learn lessons from the owner\'s corrections; save them without asking) or { "selfCheck": false } (stop checking amounts, dates and counts against People and modules before sending) or { "peopleAccess": "own" | "everyone" | "off", "peopleLists": ["l_…"] } (which people its People tools and sender cards may see: its own chats plus shared lists, everyone in People, or nobody) or { "organizers": [phone, "p_…" person, "l_…" list] } (roles follow a person on every app). Returns the agent and any warnings. For owner-assistant, how it is reached and its permissions are fixed in code (chats, triggers, people, confirm, quick answers are ignored); alerts: { to: "+41…" } sets where owner alerts go (owner only).',
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

  // ---------- chats & memory ----------
  { name: 'list_silences', readOnly: true, calls: [['GET', '/api/silences']],
    description: 'Why agents stayed silent, per chat, agent and reason (chat off, not mentioned, no agent, agent off, paused, direct messages off, sender not allowed, rate limit, model error, empty answer, budget cap), with a count, last time and a sample sender. Never message text. Most frequent first.',
    input: { chat: str('Only this chat id (optional)'), agent_id: str('Only this agent (optional)'), reason: str('Only this reason key (optional)'), days: int('Look back this many days (default 7)', { minimum: 1, maximum: 400 }) },
    run: async (a, x) => {
      const q = new URLSearchParams({ days: String(a.days || 7) });
      if (a.chat) q.set('chat', a.chat);
      if (a.agent_id) q.set('agent', a.agent_id);
      if (a.reason) q.set('reason', a.reason);
      return (await x.call('GET', `/api/silences?${q}`)).silences.map((r) => ({ chat: r.chat, chatName: r.chatName, agent: r.agent || undefined, reason: r.reason, label: r.label, explain: r.explain, count: r.count, last: iso(r.lastTs), sampleSender: r.sampleSender || undefined }));
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
  { name: 'load_chat_history', openWorld: true, noConfirm: true, calls: [['POST', '/api/chats/x/history'], ['GET', '/api/chats/x/history']],
    description: 'Load recent messages of a chat that is on from the linked phone ("Load recent messages" on the Chats page): asks WhatsApp for up to `count` messages from before the oldest stored one (default the setting, max 200), so the agent has earlier context and a summary. The phone must be online; the answer comes within about a minute. Unanswered loads retry automatically (backoff, sooner when the phone comes online; retryAt in the status), so calling again is optional. Call with status_only to see the status (state loading, loaded, no_response, no_anchor or failed; loaded = how many were stored). At most once per 30 s per chat. Only adds messages; nothing is sent to the chat.',
    input: { chat: str('Chat id (see list_chats); the chat must be on'), count: int('How many messages (optional, 1–200)', { minimum: 1, maximum: 200 }), status_only: bool('Only show the status of the last load (optional)') }, required: ['chat'],
    run: async (a, x) => (a.status_only ? x.call('GET', `/api/chats/${enc(a.chat)}/history`) : x.call('POST', `/api/chats/${enc(a.chat)}/history`, { count: a.count })) },
  { name: 'set_history_on_switch_on', destructive: true, idempotent: true, calls: [['POST', '/api/settings']],
    description: 'How many earlier messages are loaded from the phone when a chat is switched on (0 = none, max 200, default 50).',
    input: { count: int('Messages (0–200)', { minimum: 0, maximum: 200 }) }, required: ['count'],
    run: async (a, x) => ({ historyLoadCount: (await x.call('POST', '/api/settings', { historyLoadCount: a.count })).historyLoadCount }) },
  // ---------- prepared direct chats (049, #92) ----------
  { name: 'prepare_direct_chat', openWorld: true, calls: [['POST', '/api/direct-chats'], ['POST', '/api/chats/x/intro/preview'], ['POST', '/api/chats/x/intro']],
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
  { name: 'send_chat_intro', openWorld: true, risky: true, calls: [['POST', '/api/chats/x/intro/preview'], ['POST', '/api/chats/x/intro']],
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
  // ---------- sending pace (080) ----------
  { name: 'get_sending_pace', readOnly: true, calls: [['GET', '/api/pace']],
    description: 'Sending pace: the preset (careful, normal, faster or custom), whether read receipts are on, the ranges (gaps between messages in seconds, typing speed in characters per second with jitter %, read-receipt delay in seconds, new 1:1 chats a day, sending hours in the owner time zone, a longer pause every N messages), today\'s new chats on the first number and how long a list of 100 would take.',
    input: {}, run: (a, x) => x.call('GET', '/api/pace') },
  { name: 'set_sending_pace', calls: [['PUT', '/api/pace']],
    description: 'Change the sending pace. Give a preset (careful, normal, faster), or custom ranges (switches to custom): gap_min/gap_max (s, 5–3600), cps (2–20), jitter (0–60 %), read_min/read_max (s, 0–600), daily_new (1–500), hours_from/hours_to ("09:00"), pause_every (0 = off, up to 200 messages), pause_minutes (1–120). read_receipts switches read receipts on or off. Give only what changes.',
    input: { preset: str('careful, normal, faster or custom (optional)', { enum: ['careful', 'normal', 'faster', 'custom'] }), read_receipts: bool('Mark messages in chats that are on as read (optional)'),
      gap_min: int('Shortest gap between messages, seconds'), gap_max: int('Longest gap, seconds'), cps: { type: 'number', description: 'Typing speed, characters per second' }, jitter: int('Typing jitter, %'),
      read_min: int('Shortest read delay, seconds'), read_max: int('Longest read delay, seconds'), daily_new: int('New 1:1 chats a day'), hours_from: str('Sending hours start, HH:MM'), hours_to: str('Sending hours end, HH:MM'),
      pause_every: int('A longer pause every N messages (0 = never)'), pause_minutes: int('Length of the longer pause, minutes') },
    run: (a, x) => {
      const keys = { gap_min: 'gapMin', gap_max: 'gapMax', cps: 'cps', jitter: 'jitter', read_min: 'readMin', read_max: 'readMax', daily_new: 'dailyNew', hours_from: 'hoursFrom', hours_to: 'hoursTo', pause_every: 'pauseEvery', pause_minutes: 'pauseMinutes' };
      const custom = Object.fromEntries(Object.entries(keys).filter(([k]) => a[k] !== undefined).map(([k, v]) => [v, a[k]]));
      return x.call('PUT', '/api/pace', { preset: a.preset, readReceipts: a.read_receipts, ...(Object.keys(custom).length ? { custom } : {}) });
    } },
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
    description: 'Tokens and estimated cost of model calls, grouped by agent, chat, provider, model, feature or day. period: 1d, 7d, 30d (default), 90d, all. Costs only where a price is set or published; ChatGPT plan / Copilot calls are "included". The answer always carries `features`: the cost per feature (agent answers light / strong, judged group messages, self-check, lessons, promises, catch-ups, summaries, voice and pictures, sending, surveys, AI helper, owner assistant …) with a label and one line each, the most expensive first.',
    input: { group_by: str('agent | chat | provider | model | feature | day'), period: str('1d | 7d | 30d | 90d | all'), agent_id: str('Only this agent (optional)'), chat: str('Only this chat (optional)') },
    run: async (a, x) => {
      const q = `period=${enc(a.period || '30d')}${a.agent_id ? `&agent=${enc(a.agent_id)}` : ''}${a.chat ? `&chat=${enc(a.chat)}` : ''}`;
      const [r, f] = await Promise.all([x.call('GET', `/api/usage?groupBy=${enc(a.group_by || 'agent')}&${q}`), x.call('GET', `/api/usage?groupBy=feature&${q}`)]);
      return { ...r, features: f.rows.sort((m, n) => (n.cost || 0) - (m.cost || 0) || n.input + n.output - (m.input + m.output)) }; // 092
    } },
  { name: 'get_smart_model_savings', readOnly: true, calls: [['GET', '/api/usage/smart']],
    description: 'Agents on Smart model choice ("smart": a light model for simple messages, a strong one when needed): answers per tier, the most common reasons, cost per answer now and if the strong model had answered all, and what it saved (only answers with known prices). period: 1d, 7d, 30d (default), 90d, all.',
    input: { period: str('1d | 7d | 30d | 90d | all'), agent_id: str('Only this agent (optional)') },
    run: (a, x) => x.call('GET', `/api/usage/smart?period=${enc(a.period || '30d')}${a.agent_id ? `&agent=${enc(a.agent_id)}` : ''}`) },
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
  // 090: morning brief, suggested next steps, group catch-up
  { name: 'get_morning_brief', readOnly: true, calls: [['GET', '/api/owner-assistant/brief'], ['GET', '/api/owner-assistant/brief/preview']],
    description: 'The morning brief: its settings (on/off, time, sections; sendsAt = the time it goes out inside the sending hours) and the text it would send now ("" = nothing to report, no message), with the open suggested steps.',
    input: {},
    run: async (a, x) => ({ settings: await x.call('GET', '/api/owner-assistant/brief'), preview: await x.call('GET', '/api/owner-assistant/brief/preview') }) },
  { name: 'set_morning_brief', calls: [['PUT', '/api/owner-assistant/brief']],
    description: 'Change the morning brief: enabled, at (HH:MM, the owner assistant\'s time zone; outside the sending hours it waits for their start), sections (payments, questions, commitments, birthdays, stuck, people).',
    input: { enabled: bool('On or off'), at: str('Time, HH:MM'), sections: { type: 'array', items: { type: 'string', enum: ['payments', 'questions', 'commitments', 'birthdays', 'stuck', 'people'] } } },
    run: (a, x) => x.call('PUT', '/api/owner-assistant/brief', a) },
  { name: 'list_suggested_steps', readOnly: true, calls: [['GET', '/api/suggestions']],
    description: 'Next steps the server suggests from the data (Overview → Suggested): people who have not paid → send reminders (send_to_people), a paused send → resume, an update → install. Each with its key, title and action.',
    input: {}, run: (a, x) => x.call('GET', '/api/suggestions') },
  { name: 'approve_suggested_step', risky: true, calls: [['POST', '/api/suggestions/x/approve']],
    description: 'Approve a suggested step (its key from list_suggested_steps): reminders open a draft send (nothing is sent until it is started), a paused send is resumed, an update opens Updates. Needs confirm_action.',
    input: { suggestion: str('The suggestion\'s key') }, required: ['suggestion'],
    preview: async (a, x) => `Approve: ${(await x.call('GET', '/api/suggestions')).find((s) => s.key === a.suggestion)?.title || a.suggestion}`,
    run: (a, x) => x.call('POST', `/api/suggestions/${enc(a.suggestion)}/approve`, {}) },
  { name: 'dismiss_suggested_step', calls: [['POST', '/api/suggestions/x/dismiss']],
    description: 'Dismiss a suggested step (its key from list_suggested_steps); it does not come back for the same thing.',
    input: { suggestion: str('The suggestion\'s key') }, required: ['suggestion'], run: (a, x) => x.call('POST', `/api/suggestions/${enc(a.suggestion)}/dismiss`, {}) },
  { name: 'catch_up_chat', readOnly: true, calls: [['POST', '/api/chats/x/catch-up']],
    description: 'What you missed in a group that is on: decisions, open questions and things addressed to you since you last wrote there (or the last 24 hours), with the message ids. One small background model call.',
    input: { chat: str('Chat id') }, required: ['chat'], run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/catch-up`, {}) },
  // 091: commitments, people's preferences, suggested family ties
  { name: 'list_commitments', readOnly: true, calls: [['GET', '/api/commitments']],
    description: 'Promises people made in chats that are on (agents with "Track promises"), as on People → Promises: id, who (person), what, due date, overdue, status, the chat (chatName) and the message (msg), the agent (agentName), whether a reminder went out. Filter by agent_id, person (id) or chat; status open (default: overdue first, then by due date), overdue, done, dropped or all.',
    input: { agent_id: str('Agent id (optional)'), person: str('Person id (optional)'), chat: str('Chat id (optional)'), status: { type: 'string', enum: ['open', 'overdue', 'done', 'dropped', 'all'] } },
    run: (a, x) => x.call('GET', `/api/commitments?status=${enc(a.status || 'open')}${a.agent_id ? `&agent=${enc(a.agent_id)}` : ''}${a.person ? `&person=${enc(a.person)}` : ''}${a.chat ? `&chat=${enc(a.chat)}` : ''}`) },
  { name: 'update_commitment', calls: [['PUT', '/api/commitments/1']],
    description: 'Correct a promise (id from list_commitments): mark it done, reopen it (open), drop it, change what or the due date (YYYY-MM-DD or empty). Reopening or a new due date lets the agent\'s gentle reminder go out again when it is due.',
    input: { commitment_id: { type: 'integer' }, status: { type: 'string', enum: ['open', 'done', 'dropped'] }, what: str('What was promised (optional)'), due: str('Due date (optional)') }, required: ['commitment_id'],
    run: (a, x) => x.call('PUT', `/api/commitments/${Number(a.commitment_id)}`, { ...(a.status ? { status: a.status } : {}), ...(a.what !== undefined ? { what: a.what } : {}), ...(a.due !== undefined ? { due: a.due } : {}) }) },
  { name: 'delete_commitment', risky: true, calls: [['DELETE', '/api/commitments/1']],
    description: 'Delete a promise (id from list_commitments) for good, e.g. one noticed by mistake. To keep it but stop reminders, use update_commitment with status dropped. Needs confirm_action.',
    input: { commitment_id: { type: 'integer' } }, required: ['commitment_id'],
    preview: async (a, x) => { const c = (await x.call('GET', '/api/commitments?status=all')).find((r) => r.id === Number(a.commitment_id)); return c ? `Delete the promise "${c.who ? `${c.who}: ` : ''}${c.what}"${c.chatName ? ` (${c.chatName})` : ''}. This cannot be undone.` : `Delete promise ${a.commitment_id} (not found).`; },
    run: (a, x) => x.call('DELETE', `/api/commitments/${Number(a.commitment_id)}`) },
  { name: 'get_person_preferences', readOnly: true, calls: [['GET', '/api/people/x/prefs']],
    description: 'A person\'s preferences learned from their messages (or set by the owner): language, usual hours (owner\'s time zone), preferred app; auto says which are automatic.',
    input: { person: str('Person id, number or name') }, required: ['person'], run: (a, x) => x.call('GET', `/api/people/${enc(a.person)}/prefs`) },
  { name: 'set_person_preferences', calls: [['PUT', '/api/people/x/prefs']],
    description: 'Set a person\'s preferences: language (en, fr, de, es, it, pt, nl or auto), hours_from / hours_to (whole hours, or hours_from "auto"), app (whatsapp, telegram or auto). Agents answer in the language; sends go in their hours and on their app.',
    input: { person: str('Person id, number or name'), language: str('Language code or auto'), hours_from: { type: ['integer', 'string'] }, hours_to: { type: 'integer' }, app: str('whatsapp, telegram or auto') }, required: ['person'],
    run: (a, x) => x.call('PUT', `/api/people/${enc(a.person)}/prefs`, { ...(a.language !== undefined ? { language: a.language } : {}), ...(a.hours_from !== undefined ? { hoursFrom: a.hours_from, hoursTo: a.hours_to } : {}), ...(a.app !== undefined ? { app: a.app } : {}) }) },
  { name: 'list_tie_suggestions', readOnly: true, calls: [['GET', '/api/people-suggestions']],
    description: 'Family ties heard in conversations ("my daughter Vedika") for agents with relationship cues on, waiting for the owner: who, the word, the name.',
    input: {}, run: (a, x) => x.call('GET', '/api/people-suggestions') },
  { name: 'decide_tie_suggestion', calls: [['POST', '/api/people-suggestions/x']],
    description: 'Accept a suggested family tie (the tie is added; the other person is found by exact name or added) or reject it (never suggested again). suggestion = its key from list_tie_suggestions.',
    input: { suggestion: str('The suggestion\'s key'), accept: bool('true to add the tie, false to reject') }, required: ['suggestion', 'accept'],
    run: (a, x) => x.call('POST', `/api/people-suggestions/${enc(a.suggestion)}`, { accept: !!a.accept }) },
  // ---------- People (078, PRM core): people, households, lists ----------
  { name: 'list_people', readOnly: true, calls: [['GET', '/api/people']],
    description: 'People: everyone who wrote in or is a member of a chat that is on, every contact synced from the owner\'s phone, and whom the owner added (also kids without a phone). Each has id, name (own name > phone contact > business > profile name), nickname, phone, source (chat, phone, owner), apps (whatsapp, telegram), lastContact. Search by name, nickname, number, tag or note; filter by tag, list id, household id, app ("none" = no app) or source. Hidden people only with hidden: true.',
    input: { query: str('Search text (optional)'), tag: str('Only people with this tag (optional)'), list: str('Only members of this list id (optional)'), household: str('Only members of this household id (optional)'),
      app: str('whatsapp, telegram or none (optional)'), source: { type: 'string', enum: ['chat', 'phone', 'owner'], description: 'Where they came from (optional)' },
      hidden: bool('Only the hidden people (optional)'), offset: int('Skip this many (paging; 100 per call)') },
    run: (a, x) => x.call('GET', `/api/people?${new URLSearchParams({ q: a.query || '', tag: a.tag || '', list: a.list || '', household: a.household || '', app: a.app || '', source: a.source || '', hidden: a.hidden ? '1' : '', offset: String(Number(a.offset) || 0) })}`) },
  { name: 'get_person', readOnly: true, calls: [['GET', '/api/people/x']],
    description: 'One person, as on their page: name, nickname, phone, birthday, apps, ties to other people as read from their side ("Child of Ravi"), households with their role (adult or kid), who reaches them when they have no app, notes and timeline, tags, lists, their direct chat and the groups they are in, consents (privacy notice seen, updates, marketing: yes/no with source and date; unknown = no), the agents that can see them, hidden, merges that can be undone and merge suggestions. Use it for "who is X\'s kid?" or "which household is Y in?". By person id or phone.',
    input: { person: str('Person id (p_…) or phone with country code') }, required: ['person'],
    run: (a, x) => x.call('GET', `/api/people/${enc(a.person)}`) },
  { name: 'add_person', calls: [['POST', '/api/people']], description: 'Add a person to People: name, optional nickname, phone with country code, birthday (2015-04-23 or --04-23), shared (participants may look them up through agents). A kid without a phone is fine.',
    input: { name: str('Name'), nickname: str('optional'), phone: str('optional'), birthday: str('optional'), shared: bool('optional') }, required: ['name'],
    run: (a, x) => x.call('POST', '/api/people', { name: a.name, nickname: a.nickname, phone: a.phone, birthday: a.birthday, shared: a.shared }) },
  { name: 'update_person', calls: [['PUT', '/api/people/x']], description: 'Change a person\'s name (empty: back to the name from their apps), nickname, phone, birthday or shared.',
    input: { person: str('Person id or phone'), name: str('optional'), nickname: str('optional'), phone: str('optional'), birthday: str('optional'), shared: bool('optional') }, required: ['person'],
    run: (a, x) => x.call('PUT', `/api/people/${enc(a.person)}`, { name: a.name, nickname: a.nickname, phone: a.phone, birthday: a.birthday, shared: a.shared }) },
  { name: 'add_person_note', calls: [['POST', '/api/people/x/notes']], description: 'Add a note to a person\'s timeline (marked as written by an agent). Never copy message text into it.',
    input: { person: str('Person id or phone'), text: str('The note', { maxLength: 1000 }) }, required: ['person', 'text'],
    run: (a, x) => x.call('POST', `/api/people/${enc(a.person)}/notes`, { text: a.text, by: 'agent' }) },
  { name: 'set_person_tie', calls: [['POST', '/api/people/x/ties']], description: 'Tie two people: person is <kind> other. Kinds: parent (other is their child; the other side reads "Child of"), partner, sibling, works_with, custom (with label and inverse, e.g. "Godparent of" / "Godchild of").',
    input: { person: str('Person id or phone'), other: str('The other person\'s id or phone'), kind: { type: 'string', enum: ['parent', 'partner', 'sibling', 'works_with', 'custom'] }, label: str('custom only'), inverse: str('custom only') },
    required: ['person', 'other', 'kind'],
    run: (a, x) => x.call('POST', `/api/people/${enc(a.person)}/ties`, { other: a.other, kind: a.kind, label: a.label, inverse: a.inverse }) },
  { name: 'remove_person_tie', calls: [['DELETE', '/api/people/x/ties/x']], description: 'Remove a tie (ids are in get_person ties).',
    input: { person: str('Person id or phone'), tie_id: str('Tie id') }, required: ['person', 'tie_id'],
    run: (a, x) => x.call('DELETE', `/api/people/${enc(a.person)}/ties/${enc(a.tie_id)}`) },
  { name: 'set_person_tags', calls: [['PUT', '/api/people/x/tags']], description: 'Replace a person\'s tags (free words, e.g. ["badminton", "neighbour"]).',
    input: { person: str('Person id or phone'), tags: { type: 'array', items: { type: 'string' } } }, required: ['person', 'tags'],
    run: (a, x) => x.call('PUT', `/api/people/${enc(a.person)}/tags`, { tags: a.tags }) },
  { name: 'merge_people', risky: true, calls: [['GET', '/api/people/x'], ['POST', '/api/people/x/merge']],
    description: 'Owner only: merge other into person (the same human): apps, notes, ties, households, tags and lists move to person. Undo possible for 30 days (undo_merge). Needs confirm_action.',
    input: { person: str('The person to keep (id or phone)'), other: str('The person merged into them (id)') }, required: ['person', 'other'],
    preview: async (a, x) => {
      const [k, o] = await Promise.all([x.call('GET', `/api/people/${enc(a.person)}`), x.call('GET', `/api/people/${enc(a.other)}`)]);
      if (k.notInPeople || o.notInPeople) throw fail('Both must be in People', 404);
      return `Merge "${o.name}" into "${k.name}": their apps (${o.apps.join(', ') || 'none'}), notes, ties, households, tags and lists move to "${k.name}". Undo is possible for 30 days.`;
    },
    run: async (a, x) => { const k = await x.call('GET', `/api/people/${enc(a.person)}`); return x.call('POST', `/api/people/${enc(k.id)}/merge`, { other: a.other }); } },
  { name: 'undo_merge', risky: true, calls: [['POST', '/api/people/merges/x/undo']], description: 'Owner only: undo a merge (merge ids are in get_person merges; up to 30 days). Needs confirm_action.',
    input: { merge_id: str('Merge id (m_…)') }, required: ['merge_id'],
    preview: async (a) => `Undo the merge ${a.merge_id}: the merged person comes back with the apps, notes, ties, households, tags and lists they brought.`,
    run: (a, x) => x.call('POST', `/api/people/merges/${enc(a.merge_id)}/undo`) },
  { name: 'export_person', readOnly: true, calls: [['GET', '/api/people/x/export']], description: 'Owner only: everything stored about one person as JSON (their page, names, notes, ties, households, tags, lists and their stored messages).',
    input: { person: str('Person id or phone') }, required: ['person'],
    run: (a, x) => x.call('GET', `/api/people/${enc(a.person)}/export`) },
  { name: 'set_person_hidden', calls: [['PUT', '/api/people/x/hidden']], description: 'Hide a person (hidden: true) or show them again (false). Hidden people leave People lists, search, agent tools and sender cards; their data stays and the phone\'s contact sync does not bring them back. The panel\'s way to "remove" someone.',
    input: { person: str('Person id or phone'), hidden: bool('true = hide, false = show again') }, required: ['person', 'hidden'],
    run: (a, x) => x.call('PUT', `/api/people/${enc(a.person)}/hidden`, { hidden: !!a.hidden }) },
  { name: 'set_person_consent', calls: [['PUT', '/api/people/x/consents']], description: 'Record a person\'s consent for a purpose: privacy_notice (saw the privacy notice), updates (may receive updates), marketing (may receive marketing); answer yes or no. Recorded with who set it and when. Unknown counts as no.',
    input: { person: str('Person id or phone'), purpose: { type: 'string', enum: ['privacy_notice', 'updates', 'marketing'] }, answer: { type: 'string', enum: ['yes', 'no'] } }, required: ['person', 'purpose', 'answer'],
    run: (a, x) => x.call('PUT', `/api/people/${enc(a.person)}/consents`, { purpose: a.purpose, value: a.answer }) },
  { name: 'erase_person', risky: true, calls: [['GET', '/api/people/x'], ['DELETE', '/api/people/x']],
    description: 'Owner only, for privacy requests (the panel only hides people): erase one person — their stored messages in every chat, their direct chat\'s memory, notes, ties, household memberships, tags, list entries, consents, apps, and their event registrations, duties, orders and payments. Cannot be undone. Needs confirm_action.',
    input: { person: str('Person id or phone') }, required: ['person'],
    preview: async (a, x) => {
      const p = await x.call('GET', `/api/people/${enc(a.person)}`);
      if (p.notInPeople) throw fail('Not in People', 404);
      return `Erase "${p.name}" from Duniya: their stored messages in every chat, their direct chat's memory (${p.direct.length}), ${p.timeline.length} notes and events, ${p.ties.length} ties, ${p.households.length} household memberships, tags and lists. This cannot be undone. If they write again in a chat that is on (or WhatsApp syncs their number from your phone again), they come back as a new person. To keep them out without deleting, use set_person_hidden.`;
    },
    run: (a, x) => x.call('DELETE', `/api/people/${enc(a.person)}`) },
  // ---------- modules (081): Events, Orders and payments ----------
  { name: 'list_modules', readOnly: true, calls: [['GET', '/api/modules']],
    description: 'Modules (Settings → Modules): Events and Orders and payments, each on or off with its memory use, and the owner\'s payment methods when Orders is on.',
    input: {}, run: (a, x) => x.call('GET', '/api/modules') },
  { name: 'set_module_enabled', risky: true, calls: [['PUT', '/api/modules/x']],
    description: 'Switch a module on or off (module: events, orders, sending = Lists and sending, or surveys). Off removes its agent tools and pages and keeps its data. Needs confirm_action.',
    input: { module: str('events, orders, sending or surveys', { enum: ['events', 'orders', 'sending', 'surveys'] }), on: bool('true = on') }, required: ['module', 'on'],
    preview: async (a) => `Switch ${{ orders: 'Orders and payments', sending: 'Lists and sending', surveys: 'Surveys' }[a.module] || 'Events'} ${a.on ? 'on: agents get its tools' : 'off: its agent tools and pages go; its data is kept'}.`,
    run: (a, x) => x.call('PUT', `/api/modules/${enc(a.module)}`, { on: !!a.on }) },
  { name: 'list_events', readOnly: true, calls: [['GET', '/api/module/events']],
    description: 'Events (Events module): upcoming ones (or past: true), each with dates, place, capacity, deadline, currency, prices, how registration works and counts: registrations, adults, kids, people, waiting list, pending, places left.',
    input: { past: bool('Past events instead of upcoming ones') }, run: (a, x) => x.call('GET', `/api/module/events${a.past ? '?past=1' : ''}`) },
  { name: 'get_event', readOnly: true, calls: [['GET', '/api/module/events'], ['GET', '/api/module/events/x']],
    description: 'One event by name or id: the event, counts (registrations, adults, kids, people, waiting list, pending, places left), every registration (who, adults, kids, notes, status, attended), duties with who took them, and payments when Orders is on. Answers "how many kids registered?".',
    input: { event: str('Event name (or part of it) or id') }, required: ['event'],
    run: async (a, x) => x.call('GET', `/api/module/events/${enc(await eventIdOf(x, a.event))}`) },
  { name: 'save_event', calls: [['POST', '/api/module/events'], ['PUT', '/api/module/events/x']],
    description: 'Create an event (no id) or change one (id; give only what changes): name, starts / ends (2027-01-14 or 2027-01-14T18:00), place, capacity (people, 0 = no limit), deadline, currency (one per event, default CHF), per (household or person), confirm (auto or organizer), prices { adult, kid, freeUnder (age) } in the event currency, payBy.',
    input: { id: str('Event id to change (optional)'), name: str('Name'), starts: str('Start date'), ends: str('End date'), place: str('Place'), capacity: int('People, 0 = no limit'), deadline: str('Registration deadline'),
      currency: str('Three letters, e.g. CHF'), per: str('household or person', { enum: ['household', 'person'] }), confirm: str('auto or organizer', { enum: ['auto', 'organizer'] }), prices: obj('{ adult, kid, freeUnder }'), payBy: str('Pay by (date)') },
    run: (a, x) => { const { id, ...body } = a; return id ? x.call('PUT', `/api/module/events/${enc(id)}`, body) : x.call('POST', '/api/module/events', body); } },
  { name: 'delete_event', risky: true, calls: [['GET', '/api/module/events/x'], ['DELETE', '/api/module/events/x']],
    description: 'Delete an event with its registrations and duties (their orders are cancelled when nothing was paid). Needs confirm_action.',
    input: { event: str('Event id') }, required: ['event'],
    preview: async (a, x) => { const e = await x.call('GET', `/api/module/events/${enc(a.event)}`); return `Delete the event "${e.event.name}" (${e.event.starts}) with ${e.counts.registrations + e.counts.waiting + e.counts.pending} registrations and ${e.duties.length} duties. This cannot be undone.`; },
    run: (a, x) => x.call('DELETE', `/api/module/events/${enc(a.event)}`) },
  { name: 'register_for_event', calls: [['GET', '/api/module/events'], ['POST', '/api/module/events/x/registrations']],
    description: 'Register a person or a household for an event (as an organizer: deadline and organizer confirmation do not apply). Household: adults and kids default to its members. Full → waiting list.',
    input: { event: str('Event name or id'), person: str('Person id (or give household)'), household: str('Household id'), adults: int('Adults'), kids: int('Kids'), notes: str('e.g. vegetarian') }, required: ['event'],
    run: async (a, x) => x.call('POST', `/api/module/events/${enc(await eventIdOf(x, a.event))}/registrations`, { person: a.person, household: a.household, adults: a.adults, kids: a.kids, notes: a.notes }) },
  { name: 'update_registration', calls: [['PUT', '/api/module/registrations/x']],
    description: 'Change a registration (id from get_event): status registered (confirms a pending one; full → waiting list), waiting or cancelled (a place opens for the waiting list), attended, adults, kids, notes.',
    input: { registration: str('Registration id'), status: str('registered, waiting or cancelled', { enum: ['registered', 'waiting', 'cancelled'] }), attended: bool('Came to the event'), adults: int('Adults'), kids: int('Kids'), notes: str('Notes') }, required: ['registration'],
    run: (a, x) => { const { registration, ...body } = a; return x.call('PUT', `/api/module/registrations/${enc(registration)}`, body); } },
  { name: 'save_event_duty', calls: [['GET', '/api/module/events'], ['POST', '/api/module/events/x/duties'], ['PUT', '/api/module/duties/x/people/x']],
    description: 'Add a duty to an event (task, at, needed = how many people), or give an existing duty (duty id from get_event) to a person (person id).',
    input: { event: str('Event name or id'), task: str('Task, e.g. Set up chairs'), at: str('When, e.g. 09:00'), needed: int('How many people'), duty: str('Duty id (to give it to a person)'), person: str('Person id') }, required: ['event'],
    run: async (a, x) => (a.duty && a.person ? x.call('PUT', `/api/module/duties/${enc(a.duty)}/people/${enc(a.person)}`, { on: true })
      : x.call('POST', `/api/module/events/${enc(await eventIdOf(x, a.event))}/duties`, { task: a.task, at: a.at, needed: a.needed })) },
  { name: 'list_orders', readOnly: true, calls: [['GET', '/api/module/events'], ['GET', '/api/orders']],
    description: 'Orders (Orders module) by status: open (not fully paid — "who hasn\'t paid?"), overdue, paid, refunded, cancelled or all; optionally of one event (name or id). Each with who, what for, total, paid, left, due; plus totals per event (total, collected, open) and the payment methods. Amounts are in cents.',
    input: { status: str('open, overdue, paid, refunded, cancelled or all', { enum: ['open', 'overdue', 'paid', 'refunded', 'cancelled', 'all'] }), event: str('Event name or id (optional)') },
    run: async (a, x) => x.call('GET', `/api/orders?status=${enc(a.status || 'open')}${a.event ? `&event=${enc(await eventIdOf(x, a.event))}` : ''}`) },
  { name: 'get_order', readOnly: true, calls: [['GET', '/api/orders/x']], description: 'One order: lines, payments (method, date), total, paid, left, status. Amounts in cents.',
    input: { order: str('Order id') }, required: ['order'], run: (a, x) => x.call('GET', `/api/orders/${enc(a.order)}`) },
  { name: 'create_order', calls: [['POST', '/api/orders']],
    description: 'An order by hand for a person or a household (optionally for an event, then in its currency): lines [{ item, qty, price (e.g. 12.50) }], due date, note.',
    input: { person: str('Person id'), household: str('Household id'), event: str('Event id (optional)'), title: str('What for'), lines: { type: 'array', items: { type: 'object', additionalProperties: true } }, due: str('Due date'), note: str('Note') }, required: ['lines'],
    run: (a, x) => x.call('POST', '/api/orders', a) },
  { name: 'record_payment', risky: true, calls: [['GET', '/api/orders/x'], ['POST', '/api/orders/x/payments']],
    description: 'Record a payment for an order (amount, default: what is left; method from the owner\'s payment methods; date), or a refund (refund: true; default: all that was paid). Duniya records payments; it never takes money. Needs confirm_action.',
    input: { order: str('Order id'), amount: { type: 'number', description: 'Amount, e.g. 25 or 12.50' }, method: str('Payment method'), at: str('Date (default today)'), refund: bool('Money given back') }, required: ['order'],
    preview: async (a, x) => { const o = await x.call('GET', `/api/orders/${enc(a.order)}`); return `Record a ${a.refund ? 'refund' : 'payment'} of ${money(a.amount != null ? Math.round(a.amount * 100) : a.refund ? o.paid : o.left, o.currency)} for ${o.who} (${o.title})${a.method ? `, ${a.method}` : ''}.`; },
    run: (a, x) => x.call('POST', `/api/orders/${enc(a.order)}/payments`, { amount: a.amount, method: a.method, at: a.at, refund: !!a.refund }) },
  { name: 'set_payment_methods', calls: [['PUT', '/api/orders/methods']],
    description: 'Replace the owner\'s list of payment methods (e.g. ["Cash", "Bank transfer", "TWINT"]). Payments use one of these.',
    input: { methods: { type: 'array', items: { type: 'string' } } }, required: ['methods'], run: (a, x) => x.call('PUT', '/api/orders/methods', { methods: a.methods }) },
  // ---------- Lists and sending (082) ----------
  { name: 'list_sends', readOnly: true, calls: [['GET', '/api/sending']],
    description: 'Messages sent to lists (Lists and sending module): the newest runs with title, audience, purpose, state (running, paused with the reason, stopped, done), what it waits for (sending hours, daily limit, offline) and counts (sent, replied, said stop, skipped, waiting, failed); and the saved audiences.',
    input: {}, run: (a, x) => x.call('GET', '/api/sending') },
  { name: 'get_send', readOnly: true, calls: [['GET', '/api/sending/runs/x']], description: 'One run: its settings and counts, and each recipient (name, app, status, why skipped or failed, the text they got, when they replied).',
    input: { run: str('Run id'), status: str('Only recipients in this status (waiting, sent, replied, stop, skipped, failed)') }, required: ['run'],
    run: (a, x) => x.call('GET', `/api/sending/runs/${enc(a.run)}${a.status ? `?status=${enc(a.status)}` : ''}`) },
  { name: 'send_to_people', openWorld: true, risky: true, calls: [['POST', '/api/sending/preview'], ['POST', '/api/sending/runs/x/start']],
    description: 'Send a message to people, one at a time at a person\'s pace (Lists and sending module). audience: { kind: list (list id) | tag (tag) | household (household id) | event (event id: its registered people, one message per household) | orders (event id optional: people with an open order) | people (person ids) }. purpose: updates or marketing (only people who said yes get it). template: the message; each person gets their own wording; placeholders {first_name}, {name}, {household}, events {event} {date} {place} {people}, orders {amount} {due} {ways_to_pay}. agent: who replies (default the first agent). Or mode: group with group (a group chat id that is on) to post once. Needs confirm_action: show the preview (who, how many, channel, duration, skipped and why, a sample).',
    input: { audience: obj('Who'), purpose: str('updates or marketing', { enum: ['updates', 'marketing'] }), template: str('The message'), title: str('A short title'), agent: str('Agent id'),
      mode: str('direct (default) or group', { enum: ['direct', 'group'] }), group: str('Group chat id (mode group)'), no_reply_limit: int('Pause after this many people in a row did not answer (default 20, 0 = never)'),
      survey: str('Survey id (Surveys module): each person can answer it in chat or by their own {survey_link}') }, required: ['purpose', 'template'],
    preview: async (a, x) => (await x.call('POST', '/api/sending/preview', sendBody(a))).line,
    run: async (a, x) => { const p = await x.call('POST', '/api/sending/preview', sendBody(a)); return { run: await x.call('POST', `/api/sending/runs/${enc(p.run.id)}/start`), skipped: p.skipped.length }; } },
  { name: 'start_campaign', openWorld: true, risky: true, calls: [['POST', '/api/sending/campaigns/preview'], ['POST', '/api/sending/campaigns/x/start']],
    description: 'A campaign (Lists and sending): a sequence of messages to one audience (as in send_to_people). steps: [{ kind: "message", template, survey? } | { kind: "wait", days }], starting with a message. stops: { replied, registered, paid, answered } — follow-ups skip people who replied (or said stop), registered for the event, paid for it (no open order), finished the survey. event: event id for registered / paid (default: the audience\'s). end_day: YYYY-MM-DD. Confirmed once for all steps; each message step goes out at the sending pace. Needs confirm_action.',
    input: { title: str('Title'), audience: obj('Who (as in send_to_people)'), purpose: str('updates or marketing', { enum: ['updates', 'marketing'] }), agent: str('Agent id'), steps: { type: 'array', items: { type: 'object', additionalProperties: true } },
      stops: obj('{ replied, registered, paid, answered }: true/false'), event: str('Event id'), end_day: str('Last day'), no_reply_limit: int('Pause a step after this many in a row did not answer (default 0)') }, required: ['audience', 'purpose', 'steps'],
    preview: async (a, x) => (await x.call('POST', '/api/sending/campaigns/preview', campaignBody(a))).line,
    run: async (a, x) => { const p = await x.call('POST', '/api/sending/campaigns/preview', campaignBody(a)); return x.call('POST', `/api/sending/campaigns/${enc(p.campaign.id)}/start`); } },
  { name: 'get_campaign', readOnly: true, calls: [['GET', '/api/sending/campaigns/x']], description: 'One campaign: its steps, each with its run (state, sent, replied, skipped, waiting), the current step, the stop rules and the end day.',
    input: { campaign: str('Campaign id') }, required: ['campaign'], run: (a, x) => x.call('GET', `/api/sending/campaigns/${enc(a.campaign)}`) },
  { name: 'control_campaign', openWorld: true, calls: [['PUT', '/api/sending/campaigns/x']], description: 'Pause, resume or stop a campaign (and the run of its current step).',
    input: { campaign: str('Campaign id'), action: str('pause, resume or stop', { enum: ['pause', 'resume', 'stop'] }) }, required: ['campaign', 'action'],
    run: (a, x) => x.call('PUT', `/api/sending/campaigns/${enc(a.campaign)}`, { action: a.action }) },
  // ---------- Surveys (083) ----------
  { name: 'list_surveys', readOnly: true, calls: [['GET', '/api/surveys']], description: 'Surveys (Surveys module): title, questions, open or closed, how many were asked, started and finished.',
    input: {}, run: (a, x) => x.call('GET', '/api/surveys') },
  { name: 'get_survey_results', readOnly: true, calls: [['GET', '/api/surveys/x']],
    description: 'What people answered ("what did people answer?"): per question the counts per choice, the average / min / max / sum of numbers, the latest short texts; and each person\'s answers, whether they finished and how (chat or link).',
    input: { survey: str('Survey id') }, required: ['survey'], run: (a, x) => x.call('GET', `/api/surveys/${enc(a.survey)}`) },
  { name: 'save_survey', calls: [['POST', '/api/surveys'], ['PUT', '/api/surveys/x']],
    description: 'Create or change a survey: title, intro, questions [{ text, kind: single | multi | text | number, options (for single and multi), required (default true) }], status open or closed. Once people answered, questions can be reworded but not added, removed or changed in kind. Send it with send_to_people (survey).',
    input: { id: str('Survey id (to change one)'), title: str('Title'), intro: str('A short intro'), questions: { type: 'array', items: { type: 'object', additionalProperties: true } }, status: str('open or closed', { enum: ['open', 'closed'] }) },
    run: (a, x) => { const { id, ...body } = a; return id ? x.call('PUT', `/api/surveys/${enc(id)}`, body) : x.call('POST', '/api/surveys', body); } },
  { name: 'delete_survey', risky: true, calls: [['GET', '/api/surveys/x'], ['DELETE', '/api/surveys/x']], description: 'Delete a survey with all its answers. Needs confirm_action.',
    input: { survey: str('Survey id') }, required: ['survey'],
    preview: async (a, x) => { const r = await x.call('GET', `/api/surveys/${enc(a.survey)}`); return `Delete the survey "${r.survey.title}" and the answers of ${r.counts.started} people. This cannot be undone.`; },
    run: (a, x) => x.call('DELETE', `/api/surveys/${enc(a.survey)}`) },
  { name: 'control_send', openWorld: true, calls: [['PUT', '/api/sending/runs/x']], description: 'Pause, resume or stop a run of messages to a list.',
    input: { run: str('Run id'), action: str('pause, resume or stop', { enum: ['pause', 'resume', 'stop'] }) }, required: ['run', 'action'],
    run: (a, x) => x.call('PUT', `/api/sending/runs/${enc(a.run)}`, { action: a.action }) },
  { name: 'save_send_audience', calls: [['POST', '/api/sending/filters']], description: 'Save an audience under a name to send to it again (e.g. "Families with an open order for Diwali").',
    input: { name: str('Name'), audience: obj('As in send_to_people') }, required: ['name', 'audience'], run: (a, x) => x.call('POST', '/api/sending/filters', { name: a.name, audience: a.audience }) },
  { name: 'set_payment_reminders', openWorld: true, risky: true, calls: [['GET', '/api/order-reminders'], ['PUT', '/api/order-reminders/x']],
    description: 'Automatic payment reminders for an event (Orders with Lists and sending): on, days before the due date (0–30), the agent that sends, the message (default: a friendly reminder with the amount, due date and ways to pay). People who agreed to updates get them by themselves. Needs confirm_action.',
    input: { event: str('Event id'), on: bool('true = on'), days: int('Days before the due date'), agent: str('Agent id'), template: str('Message') }, required: ['event', 'on'],
    preview: async (a, x) => `${a.on ? `Send payment reminders automatically ${a.days ?? 3} days before the due date of event ${a.event}, to everyone with an open order who agreed to updates. Message: "${a.template || (await x.call('GET', `/api/order-reminders?event=${enc(a.event)}`)).template}"` : `Stop automatic payment reminders for event ${a.event}.`}`,
    run: (a, x) => x.call('PUT', `/api/order-reminders/${enc(a.event)}`, { on: !!a.on, days: a.days, agent: a.agent, template: a.template }) },
  { name: 'list_households', readOnly: true, calls: [['GET', '/api/households']], description: 'Households (e.g. "Chary family") with address and how many adults and kids.', input: {},
    run: (a, x) => x.call('GET', '/api/households') },
  { name: 'get_household', readOnly: true, calls: [['GET', '/api/households/x']], description: 'One household with its members (person id, name, role adult or kid, reachable = has an app).',
    input: { household_id: str('Household id (h_…)') }, required: ['household_id'],
    run: (a, x) => x.call('GET', `/api/households/${enc(a.household_id)}`) },
  { name: 'save_household', calls: [['POST', '/api/households'], ['PUT', '/api/households/x']], description: 'Create a household (no household_id) or rename it / change its address.',
    input: { household_id: str('Household id to change (optional)'), name: str('Name, e.g. "Chary family"'), address: str('optional') },
    run: (a, x) => (a.household_id ? x.call('PUT', `/api/households/${enc(a.household_id)}`, { name: a.name, address: a.address }) : x.call('POST', '/api/households', { name: a.name, address: a.address })) },
  { name: 'set_household_member', calls: [['PUT', '/api/households/x/members/x'], ['DELETE', '/api/households/x/members/x']], description: 'Put a person in a household as adult or kid, or take them out (remove: true). A kid without an app is reached through the household\'s adults.',
    input: { household_id: str('Household id'), person: str('Person id or phone'), role: { type: 'string', enum: ['adult', 'kid'] }, remove: bool('Take them out (optional)') }, required: ['household_id', 'person'],
    run: (a, x) => x.call(a.remove ? 'DELETE' : 'PUT', `/api/households/${enc(a.household_id)}/members/${enc(a.person)}`, a.remove ? undefined : { role: a.role || 'adult' }) },
  { name: 'list_people_lists', readOnly: true, calls: [['GET', '/api/lists']], description: 'Named lists of people (e.g. "Badminton Tuesdays") with their size. Members: list_people with list.', input: {},
    run: (a, x) => x.call('GET', '/api/lists') },
  { name: 'save_people_list', calls: [['POST', '/api/lists'], ['PUT', '/api/lists/x']], description: 'Create a named list of people (no list_id) or rename one.',
    input: { list_id: str('List id to rename (optional)'), name: str('Name') }, required: ['name'],
    run: (a, x) => (a.list_id ? x.call('PUT', `/api/lists/${enc(a.list_id)}`, { name: a.name }) : x.call('POST', '/api/lists', { name: a.name })) },
  { name: 'set_list_member', calls: [['PUT', '/api/lists/x/members/x'], ['DELETE', '/api/lists/x/members/x']], description: 'Add a person to a list, or take them off (remove: true).',
    input: { list_id: str('List id'), person: str('Person id or phone'), remove: bool('Take them off (optional)') }, required: ['list_id', 'person'],
    run: (a, x) => x.call(a.remove ? 'DELETE' : 'PUT', `/api/lists/${enc(a.list_id)}/members/${enc(a.person)}`) },
  { name: 'people_names_status', readOnly: true, calls: [['GET', '/api/people/summary']], description: 'How many people, households and lists there are, the tags in use, how many names WhatsApp synced from the phone (address book, business, profile), people shown only by a hidden number, when names were last refreshed, and whether agents may use phone contact names.',
    input: {}, run: (a, x) => x.call('GET', '/api/people/summary') },
  { name: 'set_contact_names_for_agents', risky: true, calls: [['GET', '/api/people/summary'], ['PUT', '/api/people/agent-names']],
    description: 'Owner only: whether agents may use the names from the owner\'s phone contacts (on by default, because WhatsApp profile names are often incomplete). Off: agents see business or profile names. Needs confirm_action.',
    input: { enabled: bool('true = agents may use phone contact names') }, required: ['enabled'],
    preview: async (a, x) => {
      const cur = await x.call('GET', '/api/people/summary');
      return `${a.enabled ? 'Let agents use' : 'Stop agents using'} the names from your phone contacts (now ${cur.namesForAgents === false ? 'off' : 'on'}).${a.enabled ? ' A private label you saved for someone can then appear in agent replies.' : ' Agents then see business or profile names.'}`;
    },
    run: (a, x) => x.call('PUT', '/api/people/agent-names', { enabled: !!a.enabled }) },
  { name: 'refresh_contact_names', openWorld: true, calls: [['POST', '/api/people/refresh-names']], description: 'Optional: ask WhatsApp for address-book names now (the server also does this by itself after connecting and daily). Changes nothing in WhatsApp.',
    input: {}, run: (a, x) => x.call('POST', '/api/people/refresh-names') },
  { name: 'get_agent_memory', readOnly: true, calls: [['GET', '/api/agents/x/memory']], description: 'Notes an agent shares across all its chats (shared memory). Delete one with delete_note.',
    input: { agent_id: str('Agent id') }, required: ['agent_id'],
    run: (a, x) => x.call('GET', `/api/agents/${enc(a.agent_id)}/memory`) },
  { name: 'get_chat_memory', readOnly: true, calls: [['GET', '/api/chats/x/memory']], description: 'What an agent remembers about a chat: running summary, notes and message counts.',
    input: { chat: str('Chat id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/memory`) },
  { name: 'rebuild_chat_summary', openWorld: true, calls: [['POST', '/api/chats/x/memory/summarize']], description: 'Rebuild the running summary of a chat now.',
    input: { chat: str('Chat id') }, required: ['chat'],
    run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/memory/summarize`) },
  { name: 'delete_chat_message', risky: true, calls: [['DELETE', '/api/chats/x/messages/1']], description: 'Delete one stored message of a chat (id from list_chat_messages); the agent forgets it (the chat summary is rebuilt). WhatsApp is unchanged. Messages deleted for everyone in WhatsApp are removed automatically. Needs confirm_action.',
    input: { chat: str('Chat id'), message_id: { type: 'integer', description: 'Message id' } }, required: ['chat', 'message_id'],
    preview: async (a, x) => `Delete stored message ${a.message_id} in ${await chatName(x, a.chat)}. The agent forgets it; the chat summary is rebuilt.`,
    run: (a, x) => x.call('DELETE', `/api/chats/${enc(a.chat)}/messages/${Number(a.message_id)}`) },
  { name: 'edit_chat_message', risky: true, openWorld: true, calls: [['PUT', '/api/chats/x/messages/1'], ['POST', '/api/chats/x/messages/1/correction']],
    description: 'Edit a message an agent sent (id from list_chat_messages) in the chat itself: everyone sees the new text, marked edited. WhatsApp allows this for 15 minutes after sending (Telegram 48 hours); later, set correction=true to send the text as a new message that quotes the original. Needs confirm_action.',
    input: { chat: str('Chat id'), message_id: { type: 'integer', description: 'Message id' }, text: str('The new text (or the correction)'), correction: { type: 'boolean', description: 'Send a new message that quotes the original instead of editing it' } }, required: ['chat', 'message_id', 'text'],
    preview: async (a, x) => `${a.correction ? 'Send a correction to' : 'Edit'} message ${a.message_id} in ${await chatName(x, a.chat)}: “${String(a.text).slice(0, 300)}”. Everyone in the chat sees it.`,
    run: (a, x) => (a.correction ? x.call('POST', `/api/chats/${enc(a.chat)}/messages/${Number(a.message_id)}/correction`, { text: a.text })
      : x.call('PUT', `/api/chats/${enc(a.chat)}/messages/${Number(a.message_id)}`, { text: a.text })) },
  { name: 'erase_chat_memory', risky: true, calls: [['DELETE', '/api/chats/x/memory']], description: 'Erase everything the agents remember about a chat (history, summary, notes). Needs confirm_action.',
    input: { chat: str('Chat id') }, required: ['chat'],
    preview: async (a, x) => `Erase the memory of chat ${await chatName(x, a.chat)}: stored messages, summary and notes. The agent forgets the conversation. This cannot be undone.`,
    run: (a, x) => x.call('DELETE', `/api/chats/${enc(a.chat)}/memory`) },

  // ---------- WhatsApp groups (026) ----------
  { name: 'get_group_info', openWorld: true, readOnly: true, calls: [['GET', '/api/chats/x/whatsapp']],
    description: 'A WhatsApp group\'s name, description, settings (only admins send, only admins edit info, join approval) and members with admin badges.',
    input: { chat: str('Group chat id (see list_chats)') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp`) },
  { name: 'get_group_invite_link', openWorld: true, readOnly: true, calls: [['GET', '/api/chats/x/whatsapp/invite']],
    description: 'The invite link of a WhatsApp group (the agent\'s number must be a group admin). Each look is recorded.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp/invite`) },
  { name: 'reset_group_invite_link', openWorld: true, risky: true, calls: [['POST', '/api/chats/x/whatsapp/invite/revoke']],
    description: 'Reset a WhatsApp group\'s invite link (the old link stops working). Needs confirm_action.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    preview: async (a, x) => `Reset the invite link of ${await chatName(x, a.chat)}. Anyone holding the old link can no longer join with it; share the new link instead.`,
    run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/whatsapp/invite/revoke`) },
  { name: 'update_group', openWorld: true, calls: [['PUT', '/api/chats/x/whatsapp']],
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

  // ---------- pending confirmations ----------
  { name: 'list_pending_confirmations', readOnly: true, calls: [['GET', '/api/pending']], description: 'Changes that agents prepared and that wait for a human to confirm in WhatsApp or the panel.', input: {},
    run: async (a, x) => (await x.call('GET', '/api/pending')).map((p) => ({ ...p, expires: iso(p.expires) })) },
  { name: 'cancel_pending_confirmation', calls: [['DELETE', '/api/pending/x']], description: 'Cancel a waiting change so it can no longer be confirmed.',
    input: { code: str('Its code (see list_pending_confirmations)') }, required: ['code'],
    run: (a, x) => x.call('DELETE', `/api/pending/${enc(a.code)}`) },

  // ---------- settings ----------
  { name: 'set_agents_paused', destructive: true, idempotent: true, calls: [['POST', '/api/settings']], description: 'Pause (true) or resume (false) all agents at once.',
    input: { paused: bool('true = pause all agents') }, required: ['paused'],
    run: async (a, x) => ({ paused: !!(await x.call('POST', '/api/settings', { paused: !!a.paused })).paused }) },
  { name: 'set_small_server_mode', risky: true, calls: [['GET', '/api/server/small-mode'], ['PUT', '/api/server/small-mode']],
    description: 'Small server mode (owner only): on a small server (under 2 GB or 1 CPU) allow heavier features anyway: on-server speech, local tool services and agent apps (Claude Code, Codex, GitHub Copilot) — one voice note / at most 2 services / one agent app at a time, started only when memory allows and stopped when it is tight. Slower and may be refused at busy moments. Needs confirm_action.',
    input: { enabled: bool('true = allow heavier features on this small server') }, required: ['enabled'],
    preview: async (a, x) => {
      const cur = await x.call('GET', '/api/server/small-mode');
      const size = `${cur.server.size} server, ${cur.server.effectiveMb} MB, ${cur.server.cpus} CPU`;
      return a.enabled ? `Switch Small server mode on (${size}; now ${cur.enabled ? 'on' : 'off'}). Allows: ${cur.covers.join('; ')}. Slower; heavier work waits or is refused when memory is tight.`
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
  { name: 'check_for_updates', idempotent: true, openWorld: true, calls: [['POST', '/api/updates/check']], description: 'Check GitHub for a newer version now.', input: {},
    run: (a, x) => x.call('POST', '/api/updates/check') },
  { name: 'set_update_source', openWorld: true, risky: true, calls: [['GET', '/api/updates'], ['PUT', '/api/updates/source']],
    description: 'Change where updates come from: another GitHub repository (owner/name or https://github.com/owner/name), e.g. a fork, or back to the project (source.project in get_update_status). Its releases are read first; nothing changes if that fails. The root maintenance helper keeps its own source (sudo duniya source on the server changes both). Needs confirm_action.',
    input: { repo: str('owner/name or https://github.com/owner/name') }, required: ['repo'],
    preview: async (a, x) => {
      const cur = (await x.call('GET', '/api/updates')).source;
      if (!cur) throw fail('Docker install: the image comes from the registry, not a git source');
      return `Switch updates from ${cur.repo || cur.url || 'the current source'} to ${String(a.repo).trim()}: future updates install that repository's releases`;
    },
    run: (a, x) => x.call('PUT', '/api/updates/source', { repo: a.repo }) },
  { name: 'apply_update', openWorld: true, risky: true, calls: [['POST', '/api/updates/apply']],
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
  { name: 'list_os_updates', openWorld: true, readOnly: true, calls: [['GET', '/api/system/os-updates']], description: 'Operating-system package updates, grouped: install (will install now; count = how many), phased (Ubuntu is rolling them out gradually: they install automatically within days, or now with run_maintenance os-update-all) and held (kept back, with the reason in why).',
    input: { refresh: bool('Check again now (slower)') },
    run: (a, x) => x.call('GET', `/api/system/os-updates${a.refresh ? '?refresh=1' : ''}`) },
  { name: 'get_maintenance_status', readOnly: true, calls: [['GET', '/api/system/ops']], description: 'Available server maintenance actions, the state of the last one, result.text (summary of the last OS update), reboot (whether a restart is needed to finish updates, and for which packages) and the maintenance helper: helperVersion, helperBundled (the one this release ships), helperOutdated, helperSelfUpdate (it can update itself with run_maintenance update-helper; otherwise sudo duniya update once or a reinstall).', input: {},
    run: (a, x) => x.call('GET', '/api/system/ops') },
  { name: 'run_maintenance', openWorld: true, risky: true, calls: [['POST', '/api/system/ops']],
    description: 'Run a server maintenance action: os-update (install OS updates; Ubuntu\'s gradual roll-outs wait), os-update-all (also the updates Ubuntu is still rolling out gradually), os-cleanup, restart-web, restart-tunnel, reboot (also finishes updates that need a restart) or update-helper (the root maintenance helper fetches the copy of this app\'s release from the repository it was installed from and installs it; get_maintenance_status shows helperOutdated / helperSelfUpdate). Needs confirm_action.',
    input: { action: { type: 'string', enum: ['os-update', 'os-update-all', 'os-cleanup', 'restart-web', 'restart-tunnel', 'reboot', 'update-helper'], description: 'Action' } }, required: ['action'],
    preview: async (a, x) => {
      const ops = await x.call('GET', '/api/system/ops');
      const label = ops.actions?.[a.action];
      if (!label) throw fail('Unknown action');
      const effect = { reboot: 'The whole server restarts: agents and the panel are offline for a few minutes.', 'os-update': 'Takes a few minutes; services may restart.',
        'os-update-all': 'Takes a few minutes; services may restart. Also installs updates Ubuntu is still rolling out gradually (normally they come within days).',
        'update-helper': `The root helper downloads its own files of this app's release (helper ${ops.helperVersion} → ${ops.helperBundled}) from the repository it was installed from and installs them; agents keep running.`,
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
  { name: 'run_backup', openWorld: true, calls: [['POST', '/api/backups/run']], description: 'Make an encrypted backup now and send it to the configured places.', input: {},
    run: (a, x) => x.call('POST', '/api/backups/run') },
  { name: 'restore_backup', openWorld: true, risky: true, calls: [['POST', '/api/backups/restore']],
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

  // ---------- channels (075, 077) and WhatsApp numbers ----------
  { name: 'list_channels', readOnly: true, calls: [['GET', '/api/channels']],
    description: 'The chat channels of this server (WhatsApp, Telegram) with their state (on, off, not set up), accounts connected, memory used and, for Telegram, the bot (@username, whether it sees every group message, its add-to-group link). Telegram is set up with set_secret name TELEGRAM_BOT_TOKEN (the user pastes the token from @BotFather on the one-time link).', input: {},
    run: (a, x) => x.call('GET', '/api/channels') },
  { name: 'set_channel_enabled', openWorld: true, calls: [['PUT', '/api/channels/x']], risky: (a) => a.enabled === false,
    description: 'Switch a channel on or off. Off closes its connections and frees its memory: agents stop answering there until it is on again (stays linked). Switching off needs confirm_action.',
    input: { channel: str('Channel id: "whatsapp" or "telegram" (see list_channels)'), enabled: { type: 'boolean' } }, required: ['channel', 'enabled'],
    preview: async (a) => `Switch ${a.channel} off: its connections close and agents stop answering on it until it is switched on again. Nothing is unlinked.`,
    run: (a, x) => x.call('PUT', `/api/channels/${enc(a.channel)}`, { enabled: !!a.enabled }) },
  { name: 'set_telegram_dm_agent', calls: [['PUT', '/api/channels/telegram/settings']],
    description: 'Choose the agent that answers direct messages to the Telegram bot (empty: the default agent for direct messages).',
    input: { agent: str('Agent id (see list_agents), or empty for the default') },
    run: (a, x) => x.call('PUT', '/api/channels/telegram/settings', { dmAgent: a.agent || '' }) },
  { name: 'list_whatsapp_numbers', readOnly: true, calls: [['GET', '/api/status']], description: 'WhatsApp numbers and their connection state. Linking a number (QR code / pairing) is done in the panel.', input: {},
    run: async (a, x) => (await numbers(x)).map((n) => ({ id: n.id, label: n.label, status: n.status, me: n.me, dmAgent: n.dmAgent || '' })) },
  { name: 'add_whatsapp_number', openWorld: true, calls: [['POST', '/api/whatsapp/numbers']],
    description: 'Add another WhatsApp number. Afterwards, open the panel (Settings → WhatsApp) on a computer to link it with the phone (QR code).',
    input: { label: str('Name shown in the panel, e.g. "Carpool phone"'), id: str('Short id (optional, lowercase letters, digits, -)') }, required: ['label'],
    run: async (a, x) => ({ ...(await x.call('POST', '/api/whatsapp/numbers', { id: a.id, label: a.label })), next: 'Open the panel → Settings → WhatsApp to link this number with its phone.' }) },
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
  { name: 'install_speech_engine', openWorld: true, calls: [['POST', '/api/media/local/x/install']],
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
];

