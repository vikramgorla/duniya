// Activity screen and the feed line every live entry uses (Overview, Activity). Module of the panel (063).
// ---------- activity ----------
import { $, S, api, avatar, emptyState, h, time } from './core.js';
// 064: what each entry is, in plain words (the internal type stays in the details), and its colour.
const EVENTS = {
  'message.in': ['Message', 'info'], 'message.out': ['Reply', 'ok'], 'tool.call': ['Tool'], 'tool.error': ['Tool failed', 'bad'], error: ['Error', 'bad'],
  'confirm.created': ['Needs confirm', 'warn'], 'confirm.applied': ['Confirmed', 'ok'], 'confirm.cancelled': ['Cancelled', 'warn'],
  'channel.status': ['WhatsApp', 'info'], 'whatsapp.action': ['WhatsApp'], 'whatsapp.vote': ['Poll vote'], 'whatsapp.reaction': ['Reaction'],
  'schedule.run': ['Scheduled post', 'info'], 'agent.updated': ['Agent changed'], 'agent.created': ['Agent created', 'ok'], 'agent.deleted': ['Agent deleted', 'warn'],
  config: ['Settings'], system: ['System'], silence: ['Stayed quiet'], 'memory.summary': ['Summary', 'info'], 'memory.history': ['Earlier messages'],
  'memory.note.added': ['Note added', 'ok'], 'memory.note.removed': ['Note removed', 'warn'], 'memory.erased': ['Memory erased', 'bad'],
  'model.usage': ['Model'], 'model.provider': ['Model'], 'model.fallback': ['Fallback model', 'warn'], 'media.voice': ['Voice note'], 'media.image': ['Photo'],
  'backup.done': ['Backup', 'ok'], 'backup.restore': ['Restore', 'warn'], 'backup.settings': ['Backups'], 'mcp.call': ['Tool service', 'info'], 'mcp.register': ['Tool service'],
  'owner.question': ['Ask', 'info'], 'owner.action': ['Owner assistant'], 'owner.tool': ['Owner assistant'], 'owner.link': ['Owner assistant'],
};
/** Chat names for the feed (064): chat ids are never shown when the chat list knows the name. */
export async function loadChatNames() {
  const chats = await api('GET', '/api/chats').catch(() => null);
  if (chats) S.chatNames = new Map(chats.map((c) => [c.id, c.name || (c.phone ? `+${c.phone}` : '')]));
}
export function feedItem(a) {
  const [label, cls = ''] = EVENTS[a.type] || [a.type];
  const agentName = a.agent ? S.status?.agents?.find((b) => b.id === a.agent)?.name || a.agent : '';
  const chatName = a.chat ? S.chatNames?.get(a.chat) || `chat …${a.chat.split('@')[0].slice(-4)}` : '';
  const detail = h('pre', { class: 'hide' }, JSON.stringify({ type: a.type, ...(a.detail ? { detail: a.detail } : {}) }, null, 2));
  const li = h('li', { tabindex: '0', 'aria-expanded': 'false', onclick: () => li.setAttribute('aria-expanded', String(!detail.classList.toggle('hide'))),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); } } },
    agentName ? avatar(agentName, a.agent, 's') : null,
    h('div', { class: 'meta' }, h('span', { class: `pill ${cls}` }, label), agentName ? h('b', {}, agentName) : null,
      chatName ? h('span', { title: chatName }, `in ${chatName}`) : null, h('time', { datetime: new Date(a.ts).toISOString() }, time(a.ts))),
    h('div', { class: 'sum' }, a.summary), detail);
  if (a.id) li.dataset.id = a.id;
  return li;
}
export async function renderActivity() {
  const [agents] = await Promise.all([api('GET', '/api/agents'), loadChatNames()]);
  const sel = h('select', { style: 'max-width:220px', 'aria-label': 'Show activity of', onchange: async (e) => { S.feedAgent = e.target.value; await load(); } },
    h('option', { value: '' }, 'All agents'), agents.map((b) => h('option', { value: b.id, selected: S.feedAgent === b.id }, b.name)));
  const list = h('ul', { class: 'feed', id: 'feed' });
  const more = h('button', { class: 'btn', onclick: async () => { const last = list.lastChild?.dataset?.id; (await api('GET', `/api/activity?limit=200&agent=${encodeURIComponent(S.feedAgent)}&before=${last || 0}`)).forEach((r) => list.append(feedItem(r))); } }, 'Load older');
  const empty = h('div', {});
  $('#main').replaceChildren(h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('h2', {}, 'Live activity'), sel),
    h('p', { class: 'small muted' }, 'Messages, tool calls, confirmations, models used and errors — newest first. Tap an entry for details.'), list, empty, h('div', { style: 'margin-top:10px' }, more)));
  async function load() {
    const rows = await api('GET', `/api/activity?limit=200&agent=${encodeURIComponent(S.feedAgent)}`);
    list.replaceChildren(...rows.map(feedItem)); more.classList.toggle('hide', rows.length < 200);
    empty.replaceChildren(rows.length ? '' : emptyState('activity', 'Nothing happened yet', 'Messages your agents read and send, tool calls and changes show up here as they happen.'));
  }
  await load();
}
