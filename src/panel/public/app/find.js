// Find anything (062): loaded when first opened. Module of the panel (063).
// ---------- Find anything (062): / or ⌘K (Ctrl+K), or the search button: jump to a screen, agent, chat, setting or action ----------
import { $, PRIMARY, S, TABS, api, badgeFor, can, go, h, icon, optimistic, serverBadge, show, signOut, tryApi } from './core.js';
import { PROVIDER_NAMES } from './names.js';
import { SETTINGS_SECTIONS } from './shared.js';
/** Everything the Find box can open. Agents and chats come from the status and the cached chat list. */
async function paletteItems() {
  const items = TABS().map(([id, label]) => ({ kind: 'Screen', label, go: `#${id}`, icon: id }));
  const agents = await api('GET', '/api/agents').catch(() => []);
  for (const a of agents) {
    items.push({ kind: 'Agent', label: a.name, hint: a.builtin ? 'built in' : a.description || '', go: `#agents/${encodeURIComponent(a.id)}`, icon: 'agents' });
    if (!a.builtin) items.push({ kind: 'Test', label: `Test ${a.name}`, go: `#agents/${encodeURIComponent(a.id)}/test`, icon: 'agents' });
  }
  const names = new Map(agents.map((a) => [a.id, a.name]));
  for (const c of await api('GET', '/api/chats').catch(() => [])) {
    items.push({ kind: c.isGroup ? 'Group' : 'Person', label: c.name || (c.phone ? `+${c.phone}` : c.id), hint: c.enabled ? `on · ${names.get(c.agent) || 'no agent'}` : 'off', go: `#chats/${encodeURIComponent(c.id)}`, icon: 'chats' });
  }
  for (const [id, title, words] of SETTINGS_SECTIONS) items.push({ kind: 'Setting', label: title, words, go: `#settings/${id}`, icon: 'settings' });
  for (const p of ['openrouter', 'anthropic', 'openai', 'chatgpt', 'copilot'].map((id) => [id, PROVIDER_NAMES[id]])) items.push({ kind: 'Model', label: p[1], words: 'provider key connect', go: `#models/${p[0]}`, icon: 'models' });
  const admin = can('admin');
  const act = (label, words, run) => items.push({ kind: 'Action', label, words, run });
  if (admin) {
    act(S.status?.settings?.paused ? 'Resume all agents' : 'Pause all agents', 'stop silence', () => optimistic(() => { S.status.settings.paused = !S.status.settings.paused; }, () => api('POST', '/api/settings', { paused: S.status.settings.paused }), S.status.settings.paused ? 'Paused' : 'Resumed'));
    act('New agent', 'create template ai draft', () => { location.hash = 'agents'; });
    act('Add a direct chat', 'person phone dm', () => { S.dmPrefill = {}; location.hash = 'chats'; });
    if (S.checklist?.dismissed && !S.checklist.complete) act('Show Getting started', 'checklist setup first run', () => tryApi(async () => { S.checklist = await api('PUT', '/api/checklist', { dismissed: false }); location.hash = 'overview'; show('overview'); }));
  }
  if (can('owner')) act('Back up now', 'backup download', () => { location.hash = 'backups'; });
  act('Why agents stayed quiet', 'silent silence not answering', () => { location.hash = 'overview/quiet'; });
  act('Sign out', 'logout', signOut);
  return items;
}
/** Lower score is better; null when a word does not match. Word starts in the name count most, then anywhere else. */
function paletteScore(it, words) {
  const toks = (x) => String(x || '').toLowerCase().split(/[^\p{L}\p{N}!@#.+]+/u).filter(Boolean);
  const name = toks(it.label); const rest = toks(`${it.kind} ${it.hint || ''} ${it.words || ''}`);
  let score = 0;
  for (const w of words) {
    if (name.some((t) => t.startsWith(w))) continue;
    if (rest.some((t) => t.startsWith(w))) score += 2;
    else if (it.label.toLowerCase().includes(w)) score += 3;
    else return null;
  }
  return score + (it.kind === 'Screen' ? 0 : 0.5);
}
export async function openPalette() {
  if ($('#palette')) return;
  const input = h('input', { type: 'search', placeholder: 'Find an agent, chat, setting or action', 'aria-label': 'Find anything', autocomplete: 'off', spellcheck: 'false' });
  const list = h('ul', { class: 'pal-list', role: 'listbox', 'aria-label': 'Results' });
  const dlg = h('dialog', { class: 'dlg palette', id: 'palette', 'aria-label': 'Find anything' }, input, list,
    h('div', { class: 'small muted pal-help desk-only' }, '↑ ↓ to move · Enter to open · Esc to close'));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // a tap on the backdrop closes it
  dlg.showModal(); input.focus();
  const items = await paletteItems();
  let hits = []; let sel = 0;
  const open = (it) => { dlg.close(); if (it.run) it.run(); else if (location.hash === it.go) { show(it.go.slice(1).split('/')[0]); } else location.hash = it.go.slice(1); };
  const draw = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    hits = (words.length ? items.map((it) => [paletteScore(it, words), it]).filter(([sc]) => sc !== null).sort((a, b) => a[0] - b[0]).map(([, it]) => it) : [...items.filter((it) => it.kind === 'Action'), ...items.filter((it) => it.kind === 'Screen')]).slice(0, 14);
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    list.replaceChildren(...hits.map((it, i) => h('li', { role: 'option', 'aria-selected': String(i === sel), class: i === sel ? 'on' : '', onclick: () => open(it), onmousemove: () => { if (sel !== i) { sel = i; draw(); } } },
      icon(it.icon || 'search'), h('span', { class: 'pal-label' }, it.label, it.hint ? h('small', { class: 'muted' }, ` · ${it.hint}`) : null), h('span', { class: 'pill' }, it.kind))),
    hits.length ? null : h('li', { class: 'muted small' }, 'Nothing found. Try a group, an agent or a word like “backup”.'));
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length); draw(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); open(hits[sel]); }
  };
  draw();
}
/** More (064): the screens that are not in the phone tab bar, Find anything and Sign out, in a bottom sheet. */
export function openMore() {
  const close = () => dlg.close();
  const dlg = h('dialog', { class: 'dlg more', 'aria-label': 'More screens', autofocus: true, tabindex: '-1', onclose: () => dlg.remove(), onclick: (e) => { if (e.target === dlg) close(); } },
    h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, 'More'), h('button', { class: 'btn small', onclick: close }, 'Close')),
    // 066: a compact search row (it rendered a giant icon); the sheet itself takes focus, so touch shows no ring on Close
    h('button', { class: 'btn more-find', style: 'margin-top:12px', onclick: () => { close(); openPalette(); } }, icon('search'), 'Find anything'),
    h('div', { class: 'more-list' }, TABS().filter(([id]) => !PRIMARY.includes(id)).map(([id, label]) =>
      h('button', { class: id === S.tab ? 'on' : '', 'aria-current': id === S.tab ? 'page' : null, onclick: () => { close(); go(id); } }, icon(id), label, badgeFor(id)))),
    h('div', { class: 'more-foot' }, h('span', { class: 'small muted' }, `Signed in as ${S.user.username} · ${S.user.role}`), h('button', { class: 'btn small', onclick: signOut }, 'Sign out')));
  document.body.append(dlg); dlg.showModal();
  serverBadge(S.status?.osUpdates);
}
