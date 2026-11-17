// Pending confirmations screen. Module of the panel (063).
// ---------- pending ----------
import { $, S, api, avatar, emptyState, h, toast, tryApi } from './core.js';
import { loadChatNames } from './activity.js';
import { toolPhrase } from './names.js';
import { plural } from './shared.js';
/** 072: one row per change: the agent's avatar · what it would do · who asked, in which chat (a link), and when it
 *  expires · Apply / Cancel. Names as everywhere else, never ids. */
export async function renderPending() {
  const [rows] = await Promise.all([api('GET', '/api/pending'), S.chatNames ? null : loadChatNames()]);
  const agentName = (id) => S.status?.agents?.find((b) => b.id === id)?.name || id;
  const done = async (r) => { if (r) { toast(r.result || 'Cancelled'); renderPending(); } };
  $('#main').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Pending confirmations'),
    h('p', { class: 'small muted' }, 'Changes an organizer asked for, waiting for “confirm CODE” in the chat. You can apply or cancel them here too.'),
    rows.length ? h('ul', { class: 'pend' }, rows.map((p) => h('li', {},
      avatar(agentName(p.agent), p.agent, 's'),
      h('div', { class: 'pend-main' },
        h('b', {}, p.summary),
        h('div', { class: 'small muted' }, [agentName(p.agent), toolPhrase(p.tool)].join(' · '), p.chat ? [' · ', h('a', { href: `#chats/${encodeURIComponent(p.chat)}/messages` }, S.chatNames?.get(p.chat) || 'the chat')] : null,
          ` · code ${p.code} · expires in ${plural(Math.max(0, Math.round((p.expires - Date.now()) / 60000)), 'minute')}`)),
      h('div', { class: 'row nowrap pend-act' },
        h('button', { class: 'btn small primary mut', type: 'button', onclick: async () => done(await tryApi(() => api('POST', `/api/pending/${p.code}/apply`))) }, 'Apply'),
        h('button', { class: 'btn small mut', type: 'button', onclick: async () => done(await tryApi(() => api('DELETE', `/api/pending/${p.code}`))) }, 'Cancel')))))
      : emptyState('pending', 'Nothing waiting', 'When an organizer asks an agent for a change that needs a confirm, it waits here.')));
}
