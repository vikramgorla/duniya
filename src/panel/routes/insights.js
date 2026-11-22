// @ts-check
// Panel routes that explain the app to its owner: why agents stayed silent (#34), the first-run checklist (#36) and
// the tools a role gets in the test console (#37).
import { db } from '../../core/db.js';
import { withChatNames } from '../../core/chat-names.js';
import { listSilences, clearSilences, SILENCE_REASONS } from '../../core/silences.js';
import { listAgents, getAgent, isBuiltin, OWNER_AGENT_ID } from '../../core/agents.js';
import { enabledChats } from '../../core/chat-prefs.js';
import { getSetting, updateSettings } from '../../core/store.js';
import { status as providerStatus } from '../../core/providers/index.js';
import { toolsFor } from '../../core/tools.js';
import { activity } from '../../core/events.js';
import '../../core/usage.js'; // the usage table

const SERVICE_NAME = { memory: 'Memory', contacts: 'Contacts', whatsapp: 'WhatsApp actions', local: 'Built-in' };

/** Getting started (#36, 062): live state of the five setup steps, in the order a new owner does them. The built-in
 *  owner assistant does not count as "an agent". `agent` is the one the inline steps use (switch a chat on, test). */
const STEP_IDS = ['whatsapp', 'provider', 'agent', 'chat', 'reply'];
async function checklist(channel) {
  const providers = await providerStatus().catch(() => []);
  const ch = await channel.status().catch(() => ({}));
  const numbers = ch?.numbers || (ch?.status ? [ch] : []);
  const agents = listAgents().filter((a) => !isBuiltin(a));
  const on = new Set(enabledChats());
  const replied = !!db.prepare("SELECT 1 FROM messages WHERE from_agent = 1 AND agent != ? LIMIT 1").get(OWNER_AGENT_ID)
    || !!db.prepare("SELECT 1 FROM usage WHERE kind IN ('reply', 'test') AND agent != ? LIMIT 1").get(OWNER_AGENT_ID);
  const pick = agents.find((a) => a.chats.some((c) => on.has(c))) || agents.at(-1);
  const first = pick?.id || '';
  const skipped = new Set(getSetting('checklistSkipped', null) || []);
  const steps = [
    // 086: Telegram alone is a start too (a bot connected counts)
    { id: 'whatsapp', title: 'Link WhatsApp (or Telegram)', done: numbers.some((n) => n.status === 'open') || (ch?.channels || []).some((c) => c.id !== 'whatsapp' && c.connected > 0), href: '#settings/whatsapp',
      hint: 'Scan the QR code with the phone of the number your agents will use (best a spare one), like WhatsApp on a computer.' },
    { id: 'provider', title: 'Connect an AI model', done: providers.some((p) => p.connected), href: '#models',
      hint: 'Agents need a model to think with. The quickest free start: a free OpenRouter key, pasted here.' },
    { id: 'agent', title: 'Create your first agent', done: agents.length > 0, href: '#agents', hint: 'Pick a template or describe it in your own words; you can change everything later.' },
    { id: 'chat', title: 'Switch a chat on', done: agents.some((a) => a.chats.some((c) => on.has(c))), href: '#chats',
      hint: 'Every chat starts Off, so agents stay silent. Choose the group your agent should answer in.' },
    { id: 'reply', title: 'Send a test message', done: replied, href: first ? `#agents/${encodeURIComponent(first)}/test` : '#agents',
      hint: 'Ask your agent something here, or write to it in the chat you switched on.' },
  ].map((s) => ({ ...s, skipped: !s.done && skipped.has(s.id) }));
  const done = steps.filter((s) => s.done || s.skipped).length;
  return { steps, done, total: steps.length, complete: done === steps.length, dismissed: !!getSetting('checklistDismissed', false),
    agent: pick ? { id: pick.id, name: pick.name, trigger: pick.triggers?.[0] || '' } : null };
}

export function insightRoutes(route, { channel }) {
  // ---------- why agents stayed silent (#34) ----------
  route('GET', '/api/silences', async (req, res, body, q) => {
    const rows = listSilences({ chat: q.get('chat') || '', agent: q.get('agent') || '', reason: q.get('reason') || '', days: q.get('days') || 7, limit: q.get('limit') || 200 });
    // 073: names from the one chat-name resolver, never ids
    const agentNames = new Map(listAgents().map((a) => [a.id, a.name]));
    return { reasons: SILENCE_REASONS, silences: withChatNames(rows).map((r) => ({ ...r, agentName: agentNames.get(r.agent) || '' })) };
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
    if ('dismissed' in body) updateSettings({ checklistDismissed: !!body.dismissed });
    if (body.skip !== undefined || body.unskip !== undefined) { // 062: a step can be skipped (and brought back)
      const id = String(body.skip ?? body.unskip);
      if (!STEP_IDS.includes(id)) return [400, { error: 'Unknown step', field: 'skip' }];
      const cur = new Set(getSetting('checklistSkipped', null) || []);
      if (body.skip !== undefined) cur.add(id); else cur.delete(id);
      updateSettings({ checklistSkipped: [...cur] });
    }
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
