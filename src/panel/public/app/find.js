// Find anything (062): loaded when first opened. Module of the panel (063).
// ---------- Find anything (062): / or ⌘K (Ctrl+K), or the search button: jump to a screen, agent, chat, setting or action ----------
import { $, S, TABS, api, can, h, icon, optimistic, show, tryApi } from './core.js';
import { renderLogin } from './login.js';
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
  for (const p of [['openrouter', 'OpenRouter'], ['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI'], ['chatgpt', 'ChatGPT plan'], ['copilot', 'GitHub Copilot']]) items.push({ kind: 'Model', label: p[1], words: 'provider key connect', go: `#models/${p[0]}`, icon: 'models' });
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
  act('Sign out', 'logout', async () => { await api('POST', '/api/logout').catch(() => {}); S.user = null; renderLogin(); });
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
  const list = h('ul', { class: 'pal-list', role: 'listbox' });
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
