// Activity screen and the feed line every live entry uses (Overview, Activity). Module of the panel (063).
// ---------- activity ----------
import { $, S, TYPE_CLASS, api, h, time } from './core.js';
export function feedItem(a) {
  const detail = h('pre', { class: 'hide' }, a.detail ? JSON.stringify(a.detail, null, 2) : '(no details)');
  const li = h('li', { onclick: () => detail.classList.toggle('hide') },
    h('div', { class: 'meta' }, h('span', { class: `pill ${TYPE_CLASS[a.type] ?? ''}` }, a.type), a.agent ? h('span', {}, a.agent) : null,
      a.chat ? h('span', { title: a.chat }, a.chat.split('@')[0].slice(-8)) : null, h('span', { style: 'margin-left:auto' }, time(a.ts))),
    h('div', { class: 'sum' }, a.summary), detail);
  if (a.id) li.dataset.id = a.id;
  return li;
}
export async function renderActivity() {
  const agents = await api('GET', '/api/agents');
  const sel = h('select', { style: 'max-width:220px', onchange: async (e) => { S.feedAgent = e.target.value; await load(); } },
    h('option', { value: '' }, 'All agents'), agents.map((b) => h('option', { value: b.id, selected: S.feedAgent === b.id }, b.name)));
  const list = h('ul', { class: 'feed', id: 'feed' });
  const more = h('button', { class: 'btn', onclick: async () => { const last = list.lastChild?.dataset?.id; (await api('GET', `/api/activity?limit=200&agent=${encodeURIComponent(S.feedAgent)}&before=${last || 0}`)).forEach((r) => list.append(feedItem(r))); } }, 'Load older');
  $('#main').replaceChildren(h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('h2', {}, 'Live activity'), sel),
    h('p', { class: 'small muted' }, 'Messages, tool calls, confirmations, models used and errors — newest first. Tap an entry for details.'), list, h('div', { style: 'margin-top:10px' }, more)));
  async function load() { list.replaceChildren(...(await api('GET', `/api/activity?limit=200&agent=${encodeURIComponent(S.feedAgent)}`)).map(feedItem)); }
  await load();
}

