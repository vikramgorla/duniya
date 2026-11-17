// Find anything (062): loaded when first opened. Module of the panel (063).
// ---------- Find anything (062): / or ⌘K (Ctrl+K), or the search button: jump to a screen, agent, chat, setting or action ----------
import { $, PRIMARY, S, TABS, api, askSignOut, avatar, badgeFor, can, go, h, icon, optimistic, recover, serverBadge, show, time, tryApi } from './core.js';
import { PROVIDER_NAMES } from './names.js';
import { SETTINGS_SECTIONS } from './shared.js';
/** 068: the sections of an agent's page that Find anything lists ([id, title, words, only for normal agents]). */
const AGENT_SECTIONS = [['character', 'Character', 'instructions prompt description name'], ['where', 'Where it answers', 'triggers mention direct dm chats', true],
  ['people', 'People', 'organizers participants roles', true], ['quick', 'Quick replies & FAQ', 'commands help faq', true], ['welcome', 'Welcome', 'new members greet rules', true],
  ['schedules', 'Schedules', 'scheduled posts weekly summary'], ['model', 'Model', 'fallback provider'], ['tools', 'Tools', 'mcp tool services whatsapp actions confirm'],
  ['memory', 'Memory', 'notes shared'], ['media', 'Photos & voice', 'images pictures voice notes'], ['cap', 'Spending cap', 'budget limit cost'],
  ['advanced', 'Advanced', 'timezone history tokens'], ['review', 'Review', 'answers rate thumbs teach feedback quality', true], ['test', 'Test', 'try console']];
/** 070: the words of a search, as the server matches them (word beginnings, any order). */
export const searchWords = (q) => (String(q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
/**
 * Text with the searched words marked (<mark>, built from text nodes: message text is never HTML). `around`: show
 * about that many characters around the first hit, with … at cut ends.
 */
export function highlight(text, words, around = 0) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  // the words are letters and digits only (searchWords), so they need no escaping
  const re = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${words.join('|')})[\\p{L}\\p{N}]*`, 'giu') : null;
  if (around && t.length > around) {
    const at = re ? Math.max(0, t.search(re) - Math.round(around / 3)) : 0;
    t = `${at ? '…' : ''}${t.slice(at, at + around)}${at + around < t.length ? '…' : ''}`;
  }
  if (!re) return [t];
  const out = []; let last = 0;
  for (const m of t.matchAll(re)) { out.push(t.slice(last, m.index), h('mark', {}, m[0])); last = m.index + m[0].length; }
  out.push(t.slice(last));
  return out;
}
/** Everything the Find box can open. Agents and chats come from the status and the cached chat list. */
async function paletteItems() {
  const items = TABS().map(([id, label]) => ({ kind: 'Screen', label, go: `#${id}`, icon: id }));
  const agents = await api('GET', '/api/agents').catch(() => []);
  for (const a of agents) {
    items.push({ kind: 'Agent', label: a.name, hint: a.builtin ? 'built in' : a.description || '', go: `#agents/${encodeURIComponent(a.id)}`, icon: 'agents' });
    // 068: each section of its page ("Tools · Car pooling")
    for (const [sid, title, words, only] of AGENT_SECTIONS) if (!(only && a.builtin)) items.push({ kind: 'Agent', label: `${title} · ${a.name}`, words, go: `#agents/${encodeURIComponent(a.id)}/${sid}`, icon: 'agents' });
  }
  const names = new Map(agents.map((a) => [a.id, a.name]));
  for (const c of await api('GET', '/api/chats').catch(() => [])) {
    const label = c.name || (c.phone ? `+${c.phone}` : c.id); const kind = c.isGroup ? 'Group' : 'Person';
    items.push({ kind, label, hint: c.enabled ? `on · ${names.get(c.agent) || 'no agent'}` : 'off', go: `#chats/${encodeURIComponent(c.id)}`, icon: 'chats' });
    // 072: its sections ("Messages · Book club")
    for (const [sid, title, words] of [['messages', 'Messages', 'history said rate thumbs'], ['memory', 'Memory', 'summary notes remember']]) {
      if (sid === 'memory' || can('admin')) items.push({ kind, label: `${title} · ${label}`, words, go: `#chats/${encodeURIComponent(c.id)}/${sid}`, icon: 'chats' });
    }
  }
  for (const [id, title, words] of SETTINGS_SECTIONS) items.push({ kind: 'Setting', label: title, words, go: `#settings/${id}`, icon: 'settings' });
  for (const p of ['openrouter', 'anthropic', 'openai', 'chatgpt', 'copilot'].map((id) => [id, PROVIDER_NAMES[id]])) items.push({ kind: 'Model', label: p[1], words: 'provider key connect', go: `#models/${p[0]}`, icon: 'models' });
  const admin = can('admin');
  const act = (label, words, run) => items.push({ kind: 'Action', label, words, run });
  if (admin) {
    act(S.status?.settings?.paused ? 'Resume all agents' : 'Pause all agents', 'stop silence', () => optimistic(() => { S.status.settings.paused = !S.status.settings.paused; }, () => api('POST', '/api/settings', { paused: S.status.settings.paused }), S.status.settings.paused ? 'Paused' : 'Resumed'));
    act('New agent', 'create template ai draft import', () => { location.hash = 'agents/new'; });
    act('Add a direct chat', 'person phone dm', () => { location.hash = 'chats/add'; });
    if (S.checklist?.dismissed && !S.checklist.complete) act('Show Getting started', 'checklist setup first run', () => tryApi(async () => { S.checklist = await api('PUT', '/api/checklist', { dismissed: false }); location.hash = 'overview'; show('overview'); }));
  }
  if (can('owner')) act('Back up now', 'backup download', () => { location.hash = 'backups'; });
  act('Why agents stayed quiet', 'silent silence not answering', () => { location.hash = 'overview/quiet'; });
  act('Sign out', 'logout', askSignOut);
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
  const input = h('input', { type: 'search', placeholder: can('owner') ? 'Find anything, or search messages' : 'Find an agent, chat, setting or action', 'aria-label': 'Find anything', autocomplete: 'off', spellcheck: 'false' });
  const list = h('ul', { class: 'pal-list', role: 'listbox', 'aria-label': 'Results' });
  const dlg = h('dialog', { class: 'dlg palette', id: 'palette', 'aria-label': 'Find anything' }, input, list,
    h('div', { class: 'small muted pal-help desk-only' }, '↑ ↓ to move · Enter to open · Esc to close'));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // a tap on the backdrop closes it
  dlg.showModal(); input.focus();
  const items = await paletteItems();
  let hits = []; let sel = 0;
  let found = null; // 070: Search messages results ({ q, items, more, last }) while they are shown
  const open = (it) => { if (it.stay) return it.run(); dlg.close(); if (it.run) it.run(); else if (location.hash === it.go) { show(it.go.slice(1).split('/')[0]); } else location.hash = it.go.slice(1); };
  /** 070: stored messages across the chats that are on (owner); a hit opens the chat's messages with the search. */
  const searchMessages = async (q, older = false) => {
    if (!older) { found = { q, items: [], more: false, last: 0, busy: true }; draw(); }
    const r = await api('GET', `/api/search/messages?q=${encodeURIComponent(q)}${older ? `&before=${found.last}` : ''}`).catch((e) => ({ error: e.message, results: [] }));
    if (found?.q !== q) return; // typed on meanwhile
    const words = searchWords(q);
    found.items = [...found.items.filter((it) => !it.older), ...r.results.map((m) => ({ kind: 'Message', icon: 'chats',
      node: [h('b', {}, m.chatName), h('small', { class: 'muted' }, ` · ${m.fromAgent ? 'Agent' : m.name || 'someone'} · ${time(m.ts)}`), h('span', { class: 'pal-snip' }, highlight(m.text, words, 140))],
      run: () => { S.msgSearch = { chat: m.chat, q }; const to = `chats/${encodeURIComponent(m.chat)}/messages`; if (location.hash === `#${to}`) show('chats'); else location.hash = to; } }))];
    if (r.more) found.items.push({ kind: 'More', icon: 'search', label: 'Show older matches', stay: true, older: true, run: () => searchMessages(q, true) });
    Object.assign(found, { more: r.more, last: r.results.at(-1)?.id || found.last, busy: false, error: r.error, chats: r.chats });
    draw();
  };
  const draw = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const q = input.value.trim();
    const msgAction = can('owner') && q.length >= 2 ? [{ kind: 'Messages', icon: 'search', label: `Search messages for “${q}”`, stay: true, run: () => searchMessages(q) }] : [];
    hits = found ? found.items : [...(words.length ? items.map((it) => [paletteScore(it, words), it]).filter(([sc]) => sc !== null).sort((a, b) => a[0] - b[0]).map(([, it]) => it) : [...items.filter((it) => it.kind === 'Action'), ...items.filter((it) => it.kind === 'Screen')]).slice(0, 14), ...msgAction];
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    const empty = found ? (found.busy ? h('li', { class: 'muted small', role: 'status' }, h('span', { class: 'spinner' }), ' Searching stored messages…')
      : h('li', { class: 'muted small' }, found.error || (found.chats ? `No stored message in the ${found.chats} chats that are on matches “${found.q}”.` : 'No chat is on yet, so no messages are stored.')))
      : h('li', { class: 'muted small' }, 'Nothing found. Try a group, an agent or a word like “backup”.');
    list.replaceChildren(...hits.map((it, i) => h('li', { role: 'option', 'aria-selected': String(i === sel), class: `${i === sel ? 'on' : ''}${it.node ? ' pal-msg' : ''}`, onclick: () => open(it), onmousemove: () => { if (sel !== i) { sel = i; draw(); } } },
      icon(it.icon || 'search'), h('span', { class: 'pal-label', style: it.node ? 'white-space:normal' : null }, it.node || [it.label, it.hint ? h('small', { class: 'muted' }, ` · ${it.hint}`) : null]), it.node ? null : h('span', { class: 'pill' }, it.kind))),
    hits.length ? null : empty);
  };
  input.oninput = () => { sel = 0; found = null; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length); draw(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); open(hits[sel]); }
  };
  draw();
}
/** More (064, 068): the screens that are not in the phone tab bar as compact rows, Find anything, Refresh as a small
 *  icon, and the account row (Sign out behind it, with a question: it was easy to tap by mistake). */
export function openMore() {
  const close = () => dlg.close();
  const dlg = h('dialog', { class: 'dlg more', 'aria-label': 'More screens', tabindex: '-1', onclose: () => dlg.remove(), onclick: (e) => { if (e.target === dlg) close(); } },
    h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0;flex:1' }, 'More'),
      h('button', { class: 'btn small icon quiet', 'aria-label': 'Refresh', title: 'Refresh', onclick: () => { close(); recover(true); } }, icon('refresh')),
      h('button', { class: 'btn small', onclick: close }, 'Close')),
    // 066: a compact search row; the sheet itself takes focus, so touch shows no ring on Close
    h('button', { class: 'btn more-find', onclick: () => { close(); openPalette(); } }, icon('search'), 'Find anything'),
    h('div', { class: 'more-list' }, TABS().filter(([id]) => !PRIMARY.includes(id)).map(([id, label]) =>
      h('button', { class: id === S.tab ? 'on' : '', 'aria-current': id === S.tab ? 'page' : null, onclick: () => { close(); go(id); } }, icon(id), label, badgeFor(id)))),
    h('button', { class: 'more-account', onclick: () => { close(); askSignOut(); } }, avatar(S.user.username, S.user.username, 's'),
      h('span', {}, h('b', {}, S.user.username), h('span', { class: 'small muted' }, ` · ${S.user.role}`)), h('span', { class: 'small muted' }, 'Sign out…')));
  document.body.append(dlg); dlg.showModal(); dlg.focus(); // 066: the sheet, not Close, takes focus (no ring on touch)
  serverBadge(S.status?.osUpdates);
}
