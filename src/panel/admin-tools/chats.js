// @ts-check
// Admin tools for chats and their memory, prepared direct chats, the owner assistant, sending pace, spending caps and alerts (see ../admin-tools.js for how a tool is described and run).
import { iso, enc, str, bool, int } from './fields.js';

/** @type {import('../admin-tools.js').AdminTool[]} */
export const CHAT_TOOLS = [
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
    input: { phone: str('Phone number with country code, e.g. +41 79 123 45 67'), number: str('Which of your WhatsApp numbers (id, default "main"; see list_whatsapp_numbers)'), agent_id: str('Agent to answer this person (optional)'),
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
];
