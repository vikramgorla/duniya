// AI helper for agents (016): draft a new agent, or changes to an existing one, from a plain-language request.
// The model only PROPOSES; the result is validated with the same schema as the editor and shown as a diff — an
// admin applies it (constitution IV/VIII). Group bindings and local tool services are never changed by the helper.
import { fail } from './config.js';
import { chat as modelChat } from './providers/index.js';
import { validateAgentConfig, AGENT_DEFAULTS } from './schema.js';
import { listTemplates } from './agents.js';
import { organizerConnection, effectiveServers, serverConnection } from './tools.js';
import { globalServers } from './global-mcp.js';
import { GLOBAL_SCOPE } from './mcp-oauth.js';
import { activity } from './events.js';

const EDITABLE = ['name', 'description', 'prompt', 'triggers', 'respondToMentions', 'dm', 'organizers', 'participants',
  'mcpServers', 'globalMcp', 'tools', 'confirm', 'schedules', 'memory', 'model', 'timezone', 'historySize', 'maxTokens', 'enabled', 'media',
  'quickReplies', 'help', 'welcome', 'faq'];

const TOOL = {
  name: 'propose_agent',
  description: 'Propose the agent configuration changes. Call exactly once.',
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

const GUIDE = `You configure WhatsApp assistant agents on a self-hosted platform. Agent config fields:
- name, description (one line)
- prompt: the agent's instructions (system prompt). Write it well: role, tone, languages, what to use tools for, what never to do, privacy in groups, brevity for WhatsApp.
- triggers: words that wake the agent in groups, e.g. ["!panduga"] (lowercase, start with ! or @). Mentions (@agent) and replies to the agent also wake it when respondToMentions is true.
- dm: who may message it directly: "none" | "organizers" | "members" (members of its groups) | "anyone".
- organizers / participants: phone numbers, digits with country code. Organizers get organizer tools and confirm changes; everyone else is a participant.
- mcpServers: tool services {key: {type:"remote", url, auth:"oauth"|"token"|"none"}}. Never invent URLs; keep existing ones.
- globalMcp: {disabled:[names]} — global tool services (listed under "global" in the tool inventory) are available to every agent unless named here. Their tools follow the same "server:tool" rules; without explicit rules for a global service its defaults apply ("server:-" = none for that role). Prefer a global service over adding a copy to mcpServers.
- tools: {participant:[rules], organizer:[rules], deny:[rules]} with rules "server:tool" or globs "server:*", "server:*_list". Least privilege: participants read-only tools; organizers can also prepare changes. Built-in memory tools: "memory:remember", "memory:list_notes", "memory:search_history", "memory:forget" (organizers only).
- confirm: {preview:"server:*_preview", tool:"server:confirm"} when a service uses preview/confirm for changes, else null.
- schedules: [{id, at:"HH:MM", days:"daily"|"mon,wed,…", prompt, enabled}] — the agent posts the result of prompt to its chats.
- media: {photos, documents, stickers, voiceNotes: true|false, voiceReply: "never"|"voice"|"always", createImages: {organizer: bool, participant: bool}} — photos & voice (look at photos, read PDFs, listen to voice notes, answer with voice notes, who may ask for pictures).
- Built-in answers (no AI, no tokens; prefer them for fixed information people ask again and again):
  quickReplies: [{command:"!rides" (one word), text (placeholders {name} sender, {group}, {date}), who:"everyone"|"organizers"}];
  help: true|false (built-in "!help" lists the commands and triggers);
  welcome: {enabled, text ({name} = new members as @mentions, {group}, {rules}, {date}), rules} — posted once per person when people join;
  faq: {items:[{questions:[phrasings], keywords:[words], answer}], strictness:"strict"|"normal", wholeGroup: true|false}. Never invent facts for answers: use what the admin wrote or leave a clear placeholder like [time].
- memory: {enabled: true|false}; model: "auto" | "provider:auto" | "provider:model"; timezone (IANA); historySize (recent messages in context, 5–200); maxTokens (reply length); enabled.
Teaching from a reviewed answer ("Someone asked … It answered … Better answer …"): when the better answer is fixed information, add or update one faq item (the question as asked plus one or two other phrasings, the better answer as written); otherwise add one short rule to the prompt. Never copy the person's name or phone into the agent.
Rules: change only what the request needs; return complete values for each changed field; keep secrets as \${NAME} references; never add people you were not told about except when the request asks to use group admins; keep instructions in the language the admin writes in unless asked otherwise.`;

async function toolInventory(agent) {
  const out = {};
  const servers = agent ? effectiveServers(agent) : Object.fromEntries(Object.entries(globalServers()).map(([k, v]) => [k, { ...v, global: true }]));
  for (const [key, srv] of Object.entries(servers)) {
    const label = srv.global ? `${key} (global; defaults: organizers ${srv.defaults?.organizer?.join(',') || 'none'}, participants ${srv.defaults?.participant?.join(',') || 'none'})` : key;
    try {
      const conn = agent ? organizerConnection(agent, key) : serverConnection(srv, { scope: GLOBAL_SCOPE, key, role: 'organizer', where: 'Settings → Tool services' });
      const tools = await Promise.race([conn.listTools(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))]);
      out[label] = tools.map((t) => `${t.name}: ${(t.description || '').slice(0, 120)}`);
    } catch (e) { out[label] = [`(could not list tools: ${e.message})`]; }
  }
  return out;
}

const pick = (o) => Object.fromEntries(EDITABLE.filter((k) => k in o).map((k) => [k, o[k]]));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * draft({ agent: existing agent or null, request, model, people }) →
 * { summary, questions, changes: [{ field, before, after }], proposed: full config, model }
 */
export async function draftAgent({ agent = null, request, model = 'auto', people = [], by = '' }) {
  const text = String(request || '').trim();
  if (text.length < 3) throw fail('Describe what you want first');
  const current = agent ? pick(agent) : pick({ ...AGENT_DEFAULTS });
  const context = {
    mode: agent ? 'edit' : 'create',
    current,
    toolServices: await toolInventory(agent),
    groupMembers: people.slice(0, 200),
    templates: listTemplates().map((t) => ({ id: t.id, name: t.name, description: t.description })),
  };
  const messages = [{ role: 'user', content: `Context (JSON):\n${JSON.stringify(context, null, 1)}\n\nAdmin's request:\n${text}` }];
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await modelChat({ model, purpose: 'agent', system: GUIDE, messages, tools: [TOOL], maxTokens: 4000, usage: { agent: agent?.id || '', kind: 'ai-helper' } });
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
      const { config: proposed, warnings } = validateAgentConfig({ ...(agent || AGENT_DEFAULTS), ...changes, chats: agent?.chats || [] });
      const diff = EDITABLE.filter((k) => !same(proposed[k], current[k])).map((k) => ({ field: k, before: current[k], after: proposed[k] }));
      activity('config', { agent: agent?.id || '', summary: `AI helper drafted ${diff.length} change(s)${by ? ` for ${by}` : ''} with ${res.model}` });
      return { summary: String(input.summary || ''), questions: (input.questions || []).slice(0, 2), changes: diff, proposed, warnings, model: res.model };
    } catch (e) {
      lastError = `${e.field ? `${e.field}: ` : ''}${e.message}`;
      messages.push({ role: 'assistant', content: res.content }, ...(call ? [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: `Invalid: ${lastError}. Fix it and call propose_agent again.`, is_error: true }] }]
        : [{ role: 'user', content: `Invalid: ${lastError}. Fix it and answer again.` }]));
    }
  }
  throw fail(`The AI could not produce a valid draft (${lastError}). Try rephrasing or another model.`);
}
