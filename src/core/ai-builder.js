// AI helper for bots (016): draft a new bot, or changes to an existing one, from a plain-language request.
// The model only PROPOSES; the result is validated with the same schema as the editor and shown as a diff — an
// admin applies it (constitution IV/VIII). Group bindings and local tool services are never changed by the helper.
import { chat as modelChat } from './providers/index.js';
import { validateBotConfig, BOT_DEFAULTS } from './schema.js';
import { listTemplates, listPlugins } from './bots.js';
import { organizerConnection } from './tools.js';
import { activity } from './events.js';

const EDITABLE = ['name', 'description', 'prompt', 'triggers', 'respondToMentions', 'dm', 'organizers', 'participants',
  'mcpServers', 'tools', 'confirm', 'schedules', 'memory', 'model', 'timezone', 'historySize', 'maxTokens', 'plugins', 'enabled'];

const TOOL = {
  name: 'propose_bot',
  description: 'Propose the bot configuration changes. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Two or three plain sentences for a non-technical admin: what changes and why.' },
      changes: { type: 'object', description: 'Only the top-level fields that change, with their complete new value (lists and objects in full).' },
      questions: { type: 'array', items: { type: 'string' }, description: 'Optional: what you need to know to do better (max 2).' },
    },
    required: ['summary', 'changes'],
  },
};

const GUIDE = `You configure WhatsApp assistant bots on a self-hosted platform. Bot config fields:
- name, description (one line)
- prompt: the bot's instructions (system prompt). Write it well: role, tone, languages, what to use tools for, what never to do, privacy in groups, brevity for WhatsApp.
- triggers: words that wake the bot in groups, e.g. ["!panduga"] (lowercase, start with ! or @). Mentions (@bot) and replies to the bot also wake it when respondToMentions is true.
- dm: who may message it directly: "none" | "organizers" | "members" (members of its groups) | "anyone".
- organizers / participants: phone numbers, digits with country code. Organizers get organizer tools and confirm changes; everyone else is a participant.
- mcpServers: tool services {key: {type:"remote", url, auth:"oauth"|"token"|"none"}}. Never invent URLs; keep existing ones.
- tools: {participant:[rules], organizer:[rules], deny:[rules]} with rules "server:tool" or globs "server:*", "server:*_list". Least privilege: participants read-only tools; organizers can also prepare changes. Built-in memory tools: "memory:remember", "memory:list_notes", "memory:search_history", "memory:forget" (organizers only).
- confirm: {preview:"server:*_preview", tool:"server:confirm"} when a service uses preview/confirm for changes, else null.
- schedules: [{id, at:"HH:MM", days:"daily"|"mon,wed,…", prompt, enabled}] — the bot posts the result of prompt to its chats.
- memory: {enabled: true|false}; model: "auto" | "provider:auto" | "provider:model"; timezone (IANA); historySize (recent messages in context, 5–200); maxTokens (reply length); plugins (names); enabled.
Rules: change only what the request needs; return complete values for each changed field; keep secrets as \${NAME} references; never add people you were not told about except when the request asks to use group admins; keep instructions in the language the admin writes in unless asked otherwise.`;

async function toolInventory(bot) {
  const out = {};
  for (const key of Object.keys(bot?.mcpServers || {})) {
    try {
      const tools = await Promise.race([organizerConnection(bot, key).listTools(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))]);
      out[key] = tools.map((t) => `${t.name}: ${(t.description || '').slice(0, 120)}`);
    } catch (e) { out[key] = [`(could not list tools: ${e.message})`]; }
  }
  return out;
}

const pick = (o) => Object.fromEntries(EDITABLE.filter((k) => k in o).map((k) => [k, o[k]]));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * draft({ bot: existing bot or null, request, model, people }) →
 * { summary, questions, changes: [{ field, before, after }], proposed: full config, model }
 */
export async function draftBot({ bot = null, request, model = 'auto', people = [], by = '' }) {
  const text = String(request || '').trim();
  if (text.length < 3) throw Object.assign(new Error('Describe what you want first'), { status: 400 });
  const current = bot ? pick(bot) : pick({ ...BOT_DEFAULTS });
  const context = {
    mode: bot ? 'edit' : 'create',
    current,
    toolServices: bot ? await toolInventory(bot) : {},
    groupMembers: people.slice(0, 200),
    templates: listTemplates().map((t) => ({ id: t.id, name: t.name, description: t.description })),
    plugins: listPlugins().map((p) => p.name || p),
  };
  const messages = [{ role: 'user', content: `Context (JSON):\n${JSON.stringify(context, null, 1)}\n\nAdmin's request:\n${text}` }];
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await modelChat({ model, purpose: 'bot', system: GUIDE, messages, tools: [TOOL], maxTokens: 4000, usage: { bot: bot?.id || '', kind: 'ai-helper' } });
    const call = res.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
    let input = call?.input;
    if (!input) { // models without tool use: accept JSON in text
      const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const m = raw.match(/\{[\s\S]*\}/);
      try { input = m ? JSON.parse(m[0]) : null; } catch { input = null; }
    }
    if (!input?.changes || typeof input.changes !== 'object') { lastError = 'The model did not return a proposal'; continue; }
    const changes = pick(input.changes);
    delete changes.chats;
    // Local tool services run code on the server: the helper may not add or change them.
    if (changes.mcpServers) {
      for (const [k, v] of Object.entries(changes.mcpServers)) if (v?.type === 'local' && !same(v, current.mcpServers?.[k])) delete changes.mcpServers[k];
      for (const [k, v] of Object.entries(current.mcpServers || {})) if (v?.type === 'local') changes.mcpServers[k] = v;
    }
    try {
      const { config: proposed, warnings } = validateBotConfig({ ...(bot || BOT_DEFAULTS), ...changes, chats: bot?.chats || [] });
      const diff = EDITABLE.filter((k) => !same(proposed[k], current[k])).map((k) => ({ field: k, before: current[k], after: proposed[k] }));
      activity('config', { bot: bot?.id || '', summary: `AI helper drafted ${diff.length} change(s)${by ? ` for ${by}` : ''} with ${res.model}` });
      return { summary: String(input.summary || ''), questions: (input.questions || []).slice(0, 2), changes: diff, proposed, warnings, model: res.model };
    } catch (e) {
      lastError = `${e.field ? `${e.field}: ` : ''}${e.message}`;
      messages.push({ role: 'assistant', content: res.content }, ...(call ? [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: `Invalid: ${lastError}. Fix it and call propose_bot again.`, is_error: true }] }]
        : [{ role: 'user', content: `Invalid: ${lastError}. Fix it and answer again.` }]));
    }
  }
  throw Object.assign(new Error(`The AI could not produce a valid draft (${lastError}). Try rephrasing or another model.`), { status: 400 });
}
