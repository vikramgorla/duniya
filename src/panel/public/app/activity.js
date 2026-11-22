// Activity screen and the feed rows every live entry uses (Overview, Activity). Module of the panel (063).
// ---------- activity ----------
import { $, S, api, avatar, emptyState, h, icon } from './core.js';
import { toolPhrase } from './names.js';
// 064: what each entry is, in plain words (the internal type stays in the details), its tone and (066) its icon.
const EVENTS = {
  'message.in': ['Message', 'info', 'chats'], 'message.out': ['Reply', 'ok', 'chats'], 'tool.call': ['Tool', '', 'settings'], 'tool.error': ['Tool failed', 'bad', 'settings'], error: ['Error', 'bad', 'shield'],
  'confirm.created': ['Needs confirm', 'warn', 'pending'], 'confirm.applied': ['Confirmed', 'ok', 'pending'], 'confirm.cancelled': ['Cancelled', 'warn', 'pending'],
  'change.auto': ['Changed without asking', 'info', 'pending'],
  'channel.status': ['WhatsApp', 'info', 'chats'], 'whatsapp.action': ['WhatsApp', '', 'chats'], 'whatsapp.vote': ['Poll vote', '', 'chats'], 'whatsapp.reaction': ['Reaction', '', 'chats'],
  'schedule.run': ['Scheduled post', 'info', 'activity'], 'agent.updated': ['Agent changed', '', 'agents'], 'agent.created': ['Agent created', 'ok', 'agents'], 'agent.deleted': ['Agent deleted', 'warn', 'agents'],
  config: ['Settings', '', 'settings'], system: ['System', '', 'server'], silence: ['Stayed quiet', '', 'chats'], 'memory.summary': ['Summary', 'info', 'chats'], 'memory.history': ['Earlier messages', '', 'chats'],
  'memory.note.added': ['Note added', 'ok', 'chats'], 'memory.note.removed': ['Note removed', 'warn', 'chats'], 'memory.erased': ['Memory erased', 'bad', 'chats'],
  'model.usage': ['Model', '', 'models'], 'model.provider': ['Model', '', 'models'], 'model.fallback': ['Fallback model', 'warn', 'models'], 'media.voice': ['Voice note', '', 'chats'], 'media.image': ['Photo', '', 'image'],
  'backup.done': ['Backup', 'ok', 'backups'], 'backup.restore': ['Restore', 'warn', 'backups'], 'backup.settings': ['Backups', '', 'backups'], 'mcp.call': ['Tool service', 'info', 'settings'], 'mcp.register': ['Tool service', '', 'settings'],
  'owner.question': ['Ask', 'info', 'search'], 'owner.action': ['Owner assistant', '', 'agents'], 'owner.tool': ['Owner assistant', '', 'agents'], 'owner.link': ['Owner assistant', '', 'agents'],
};
// 066: the summary without the words the type marker already says ("Stayed quiet: chat is off" → "Chat is off").
function subjectOf(summary, label) {
  const s = String(summary || '');
  const m = s.match(/^([^:\n]{1,40}):\s+/);
  if (!m || !m[1].toLowerCase().startsWith(label.toLowerCase())) return plainTool(s) || label;
  const rest = plainTool(s.slice(m[0].length));
  return rest ? rest[0].toUpperCase() + rest.slice(1) : label;
}
// #136: entries written before 2.27 start with a raw tool name ("chat_recap", "check_for_updates · admin via Claude");
// 073: also an MCP tool ("transport:connections — …" → "Connections (transport) — …")
const plainTool = (s) => s.replace(/^(?:[a-z][\w-]*:[a-z][\w-]*|[a-z][a-z0-9]*_[a-z0-9_]+)(?=$|\s)/i, (t) => toolPhrase(t.toLowerCase()));
const dayKey = (ts) => new Date(ts).toDateString();
/** "Today", "Yesterday" or "Mon 16 Nov". */
function dayLabel(ts) {
  const d = new Date(ts); const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === new Date(today.getTime() - 86400000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) });
}
const dayHead = (ts) => h('li', { class: 'fday', 'data-day': dayKey(ts) }, h('h3', {}, dayLabel(ts)));
/** One entry: marker (agent avatar or type icon) · bold subject · muted type, agent and chat · time on the right. Open,
 *  it shows where to go (072: the chat, the answer in its messages, the agent), a reply's 👍 / 👎 row and the details. */
function feedItem(a) {
  const [label, tone = '', ic = 'activity'] = EVENTS[a.type] || [a.type];
  const agentName = a.agent ? S.status?.agents?.find((b) => b.id === a.agent)?.name || (a.agent === 'owner-assistant' ? 'Owner assistant' : a.agent) : '';
  const chatName = a.chat ? a.chatName || 'a chat' : ''; // 073: the server names every entry's chat (never its id)
  const open = h('div', { class: 'fopen hide', onclick: (e) => e.stopPropagation() });
  const fill = async () => open.replaceChildren(...(await import('./answers.js')).entryOpen(a, chatName, agentName));
  const li = h('li', { class: `fitem ${tone}`, tabindex: '0', 'aria-expanded': 'false', 'data-day': dayKey(a.ts),
    onclick: () => { const show = open.classList.toggle('hide') === false; li.setAttribute('aria-expanded', String(show)); if (show && !open.firstChild) fill(); },
    onkeydown: (e) => { if (e.target === li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); li.click(); } } },
    agentName ? avatar(agentName, a.agent, 's') : h('span', { class: 'fmark', 'aria-hidden': 'true' }, icon(ic)),
    h('div', { class: 'fsub' }, subjectOf(a.summary, label)),
    h('time', { datetime: new Date(a.ts).toISOString(), title: new Date(a.ts).toLocaleString() }, new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
    h('div', { class: 'fmeta' }, h('span', { class: 'ftype' }, label), agentName ? h('span', {}, agentName) : null, chatName ? h('span', { title: chatName }, chatName) : null),
    open);
  if (a.id) li.dataset.id = a.id;
  return li;
}
/** 066: entries grouped under day headings; `rows` newest first. Appends to a list (Load older continues its last day). */
function appendFeed(list, rows) {
  let day = [...list.querySelectorAll('.fday')].at(-1)?.dataset.day;
  for (const a of rows) {
    if (dayKey(a.ts) !== day) { day = dayKey(a.ts); list.append(dayHead(a.ts)); }
    list.append(feedItem(a));
  }
  return list;
}
/** A feed list (Overview's recent activity, the Activity screen). */
export const feedList = (id, rows) => appendFeed(h('ul', { class: 'feed', id }), rows);
/** A live entry on top of a list; `max` keeps at most that many entries (Overview). */
export function feedPrepend(list, a, max = 0) {
  const top = list.firstElementChild;
  const item = feedItem(a);
  if (top?.dataset.day === dayKey(a.ts) && top.classList.contains('fday')) top.after(item);
  else list.prepend(dayHead(a.ts), item);
  if (max) {
    [...list.querySelectorAll('.fitem')].slice(max).forEach((x) => x.remove());
    list.querySelectorAll('.fday').forEach((d) => { if (!d.nextElementSibling?.classList.contains('fitem')) d.remove(); });
  }
}
/** 072: #activity/chat=<id> shows one chat's activity (the chat page's *Activity* row); ✕ shows everything again. */
const chatFilter = () => decodeURIComponent((/^#activity\/chat=(.+)$/.exec(location.hash) || [])[1] || '');
// 093: #activity/type=change.auto shows one kind of entry (e.g. every change made without asking)
const typeFilter = () => { const t = (/^#activity\/type=([\w.]+)$/.exec(location.hash) || [])[1] || ''; return EVENTS[t] ? t : ''; };
export async function renderActivity() {
  const agents = await api('GET', '/api/agents');
  S.feedChat = chatFilter(); S.feedType = typeFilter();
  const q = () => `/api/activity?limit=200&agent=${encodeURIComponent(S.feedAgent)}&chat=${encodeURIComponent(S.feedChat)}&type=${encodeURIComponent(S.feedType)}`;
  const sel = h('select', { class: 'compact', 'aria-label': 'Show activity of', onchange: async (e) => { S.feedAgent = e.target.value; await load(); } },
    h('option', { value: '' }, 'All agents'), agents.map((b) => h('option', { value: b.id, selected: S.feedAgent === b.id }, b.name)));
  const list = h('ul', { class: 'feed', id: 'feed' });
  const more = h('button', { class: 'btn', onclick: async () => { const last = [...list.querySelectorAll('.fitem')].at(-1)?.dataset.id; appendFeed(list, await api('GET', `${q()}&before=${last || 0}`)); } }, 'Load older');
  const empty = h('div', {});
  const nameEl = h('a', { class: 'pill raw', href: `#chats/${encodeURIComponent(S.feedChat)}` }, 'this chat');
  const chip = S.feedChat ? h('div', { class: 'row fchat' }, nameEl,
    h('a', { class: 'btn small ghost', href: '#activity', 'aria-label': 'Show all chats' }, '✕ All chats'))
    : S.feedType ? h('div', { class: 'row fchat' }, h('span', { class: 'pill raw' }, EVENTS[S.feedType][0]), h('a', { class: 'btn small ghost', href: '#activity', 'aria-label': 'Show everything' }, '✕ Everything')) : null;
  $('#main').replaceChildren(h('div', { class: 'card' }, h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, 'Activity'), sel), chip,
    h('p', { class: 'small muted', style: 'margin:4px 0 6px' }, 'Live, newest first. Tap an entry for links and details.'), list, empty, h('div', { style: 'margin-top:10px' }, more)));
  async function load() {
    const rows = await api('GET', q());
    const name = rows.find((r) => r.chatName)?.chatName || 'this chat'; nameEl.textContent = name;
    list.replaceChildren(); appendFeed(list, rows); more.classList.toggle('hide', rows.length < 200);
    empty.replaceChildren(rows.length ? '' : S.feedChat ? emptyState('activity', `Nothing recorded in ${name}`, 'Messages, answers and changes in this chat show up here.')
      : S.feedType ? emptyState('activity', `Nothing yet: ${EVENTS[S.feedType][0].toLowerCase()}`, 'Entries of this kind show up here as they happen.')
      : emptyState('activity', 'Nothing happened yet', 'Messages your agents read and send, tool calls and changes show up here as they happen.'));
  }
  await load();
}
