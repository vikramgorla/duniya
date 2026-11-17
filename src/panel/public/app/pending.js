// Pending confirmations screen. Module of the panel (063).
// ---------- pending ----------
import { $, api, h, toast, tryApi } from './core.js';
export async function renderPending() {
  const rows = await api('GET', '/api/pending');
  $('#main').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Pending confirmations'),
    h('p', { class: 'small muted' }, 'Changes an organizer asked for, waiting for “confirm CODE”. You can apply or cancel them here too.'),
    rows.length ? h('table', { class: 'stack' }, h('tbody', {}, rows.map((p) => h('tr', {},
      h('td', { 'data-label': '' }, h('b', {}, p.code), h('div', { class: 'small muted' }, `${p.agent} · ${p.tool} · expires in ${Math.max(0, Math.round((p.expires - Date.now()) / 60000))} min`), h('pre', {}, p.summary)),
      h('td', { style: 'white-space:nowrap', 'data-label': '' }, h('button', { class: 'btn primary mut', onclick: async () => { const r = await tryApi(() => api('POST', `/api/pending/${p.code}/apply`)); if (r) toast(r.result); renderPending(); } }, 'Apply'), ' ',
        h('button', { class: 'btn mut', onclick: () => tryApi(async () => { await api('DELETE', `/api/pending/${p.code}`); renderPending(); }) }, 'Cancel')))))) : h('p', { class: 'muted' }, 'Nothing pending.')));
}

