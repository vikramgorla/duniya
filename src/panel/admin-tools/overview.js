// @ts-check
// Admin tools for the overview and Activity (see ../admin-tools.js for how a tool is described and run).
import { iso, str, bool, int } from './fields.js';

/** @type {import('../admin-tools.js').AdminTool[]} */
export const OVERVIEW_TOOLS = [
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
    description: 'Recent activity log entries (newest first): messages, replies, tool calls, confirmations, configuration changes, errors. Filter by agent, chat or type (e.g. "change.auto": changes agents made without an extra confirmation because an organizer clearly asked).',
    input: { agent_id: str('Only this agent (optional)'), chat: str('Only this chat id (optional)'), type: str('Only this type, e.g. change.auto, confirm.created, tool.error (optional)'), limit: int('How many (default 50, max 200)', { minimum: 1, maximum: 200 }),
      before_id: int('Only entries older than this id (for paging)'), include_details: bool('Include the detail payload of each entry (bigger)') },
    run: async (a, x) => {
      const q = new URLSearchParams({ limit: String(Math.min(Number(a.limit) || 50, 200)) });
      if (a.agent_id) q.set('agent', a.agent_id);
      if (a.chat) q.set('chat', a.chat);
      if (a.type) q.set('type', a.type);
      if (a.before_id) q.set('before', String(a.before_id));
      return (await x.call('GET', `/api/activity?${q}`)).map((r) => ({ id: r.id, time: iso(r.ts), type: r.type, agent: r.agent || undefined, chat: r.chat || undefined, chatName: r.chatName || undefined, summary: r.summary, ...(a.include_details && r.detail ? { detail: r.detail } : {}) }));
    } },

];
