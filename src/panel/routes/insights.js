// Panel routes that explain the app to its owner: why agents stayed silent (#34), the first-run checklist (#36) and
// the tools a role gets in the test console (#37).
import { db } from '../../core/db.js';
import { listSilences, clearSilences, SILENCE_REASONS } from '../../core/silences.js';
import { listAgents, getAgent } from '../../core/agents.js';
import { enabledChats, seenChats } from '../../core/chat-prefs.js';
import { getSettings, updateSettings } from '../../core/store.js';
import { status as providerStatus } from '../../core/providers/index.js';
import { toolsFor } from '../../core/tools.js';
import { activity } from '../../core/events.js';
import '../../core/usage.js'; // the usage table

const SERVICE_NAME = { memory: 'Memory', contacts: 'Contacts', whatsapp: 'WhatsApp actions', local: 'Built-in' };

/** First-run checklist (#36): live state of the five setup steps. */
export async function checklist(channel) {
  const providers = await providerStatus().catch(() => []);
  const ch = await channel.status().catch(() => ({}));
  const numbers = ch?.numbers || (ch?.status ? [ch] : []);
  const agents = listAgents();
  const replied = !!db.prepare('SELECT 1 FROM messages WHERE from_agent = 1 LIMIT 1').get()
    || !!db.prepare("SELECT 1 FROM usage WHERE kind IN ('reply', 'test') LIMIT 1").get();
  const first = agents[0]?.id || '';
  const steps = [
    { id: 'provider', title: 'Connect an AI model provider', done: providers.some((p) => p.connected), href: '#models',
      hint: 'Agents need a model to think with. A Claude or OpenAI key, a ChatGPT plan or GitHub Copilot all work.' },
    { id: 'whatsapp', title: 'Link a WhatsApp number', done: numbers.some((n) => n.status === 'open'), href: '#overview/whatsapp',
      hint: 'Scan the QR code with the phone of the number your agents use (WhatsApp → Linked devices).' },
    { id: 'agent', title: 'Create an agent', done: agents.length > 0, href: '#agents', hint: 'Start from a template; you can change everything later.' },
    { id: 'chat', title: 'Switch a chat on', done: enabledChats().length > 0, href: '#chats', hint: 'Every chat starts Off. Switch on the groups and people your agent should answer.' },
    { id: 'reply', title: 'Get a first reply', done: replied, href: first ? `#agents/${encodeURIComponent(first)}/test` : '#agents',
      hint: 'Ask your agent something in the test console, or message it in a chat that is on.' },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length, dismissed: !!getSettings().checklistDismissed };
}

export function insightRoutes(route, { channel }) {
  // ---------- why agents stayed silent (#34) ----------
  route('GET', '/api/silences', async (req, res, body, q) => {
    const rows = listSilences({ chat: q.get('chat') || '', agent: q.get('agent') || '', reason: q.get('reason') || '', days: q.get('days') || 7, limit: q.get('limit') || 200 });
    // Names as the owner sees them (never ids alone): people from the chats seen, groups from WhatsApp.
    const seen = new Map(seenChats().map((c) => [c.id, c.name || (c.phone ? `+${c.phone}` : '')]));
    const names = new Map();
    for (const r of rows) {
      if (names.has(r.chat)) continue;
      names.set(r.chat, seen.get(r.chat) || (r.chat.endsWith('@g.us') ? await channel.chatName?.(r.chat).catch(() => '') : '') || '');
    }
    const agentNames = new Map(listAgents().map((a) => [a.id, a.name]));
    return { reasons: SILENCE_REASONS, silences: rows.map((r) => ({ ...r, chatName: names.get(r.chat) || '', agentName: agentNames.get(r.agent) || '' })) };
  });
  route('DELETE', '/api/silences', async (req, res, body, q, p, user) => {
    const f = { chat: q.get('chat') || '', agent: q.get('agent') || '', reason: q.get('reason') || '' };
    if (f.reason && !SILENCE_REASONS[f.reason]) return [400, { error: 'Unknown reason', field: 'reason' }];
    const removed = clearSilences(f);
    if (removed) activity('config', { chat: f.chat, agent: f.agent, summary: `Cleared ${removed} silence record(s)${f.reason ? ` (${SILENCE_REASONS[f.reason].label})` : ''} (${user.username})` });
    return { removed };
  });

  // ---------- first-run checklist (#36) ----------
  route('GET', '/api/checklist', async () => checklist(channel));
  route('PUT', '/api/checklist', async (req, res, body) => {
    updateSettings({ checklistDismissed: !!body.dismissed });
    return checklist(channel);
  });

  // ---------- test console: the tools a role gets (#37) ----------
  route('GET', '/api/agents/:id/test-tools', async (req, res, body, q, p) => {
    const agent = getAgent(p.id);
    if (!agent) return [404, { error: 'Not found' }];
    const role = q.get('role') === 'organizer' ? 'organizer' : 'participant';
    const { defs, meta } = await toolsFor(agent, role);
    const groups = new Map();
    for (const d of defs) {
      const m = meta.get(d.name) || {};
      const [server, ...rest] = String(m.fq || d.name).split(':');
      const key = m.kind === 'mcp' ? server : server || 'local';
      if (!groups.has(key)) groups.set(key, { service: key, name: SERVICE_NAME[key] || key, global: !!m.global, tools: [] });
      groups.get(key).tools.push({ name: rest.join(':') || d.name, description: String(d.description || '').split('\n')[0].slice(0, 160) });
    }
    return { role, count: defs.length, services: [...groups.values()], errors: meta.get('__errors') || [] };
  });
}
