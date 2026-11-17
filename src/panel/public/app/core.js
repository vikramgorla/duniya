// Panel core: the DOM helper, api() and its cache, shared state, the shell (tabs, router, live stream). Module of the panel (063).
// ---------- DOM helper: untrusted text only ever goes through textContent ----------
import { feedItem } from './activity.js';
import { renderLogin, renderSecretLink } from './login.js';
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (s) => document.querySelector(s);
/** Small line icons for the tabs (24×24, stroke = currentColor). */
const ICONS = {
  overview: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z',
  activity: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  agents: 'M8 8V6.5a4 4 0 0 1 8 0V8M5 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM9.5 14h.01M14.5 14h.01',
  chats: 'M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9zM9 9.5h6M9 12.5h4',
  models: 'M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  usage: 'M5 19V10M10 19V5M15 19v-7M20 19v-4M3 19.5h18',
  contacts: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19a5.5 5.5 0 0 1 11 0M16 7.5h5M16 11h5M17.5 14.5H21',
  server: 'M5 5h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM5 13h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM8 8h.01M8 16h.01',
  backups: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9zM12 11v5M9.5 13.5 12 11l2.5 2.5',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  pending: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4.5l3 2',
  secrets: 'M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h2.5v-2h2v-2h2l.9-.9A5.5 5.5 0 0 1 14.5 4zM15.5 8.5h.01',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.9 1.1L15 20.5h-4l-.3-2a7 7 0 0 1-1.9-1.1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7 7 0 0 1 1.9-1.1L11 3.5h4l.3 2a7 7 0 0 1 1.9 1.1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z',
};
export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] || ''); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.7'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p); return svg;
}
/** Brand mark: a friendly robot in a solid green chat bubble (rounded square, tail at lower right). Fixed colours in
 * both themes. Same geometry as docs/site/img/logo.svg; see DESIGN.md (Mark, Trademark). */
export function logo() {
  const ns = 'http://www.w3.org/2000/svg'; const el = (t, a) => { const e = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
  const ink = '#101216'; const green = '#4d9b00';
  const svg = el('svg', { viewBox: '0 0 64 64', class: 'logo', 'aria-hidden': 'true' });
  svg.append(
    el('path', { d: 'M23 5H41A17 17 0 0 1 58 22V44L59.5 59.5L44 55H23A17 17 0 0 1 6 38V22A17 17 0 0 1 23 5Z', fill: green, stroke: green, 'stroke-width': 4, 'stroke-linejoin': 'round' }),
    el('rect', { x: 11.8, y: 28.3, width: 9, height: 13.4, rx: 4, fill: ink }), el('rect', { x: 43.2, y: 28.3, width: 9, height: 13.4, rx: 4, fill: ink }),
    el('circle', { cx: 32, cy: 12.6, r: 2.8, fill: ink }), el('path', { d: 'M32 14.8v6.7', stroke: ink, 'stroke-width': 2.7, 'stroke-linecap': 'round' }),
    el('rect', { x: 18, y: 21.5, width: 28, height: 27, rx: 13, fill: '#fff', stroke: ink, 'stroke-width': 2.7 }),
    el('rect', { x: 20.8, y: 29.4, width: 22.4, height: 12.3, rx: 6.15, fill: ink }),
    el('path', { d: 'M23.6 37.2a2.9 2.9 0 0 1 5.8 0M34.6 37.2a2.9 2.9 0 0 1 5.8 0', fill: 'none', stroke: '#c6f432', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  return svg;
}
export function toast(msg) {
  let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' }, msg); box.append(t); setTimeout(() => t.remove(), 3500);
}
// Screen data cache (058): switching screens reuses what was just loaded. Any change made here and anything the live
// stream reports (activity, a changed status) drops it; entries also expire after 60 s. Only lists that screens load
// on open are cached, never live views (status, system, activity, updates).
const CACHED = /^\/api\/(agents|templates|chats|providers|budget|media|backups|pending|secrets|logging|assistants|owner-assistant|privacy-notice|contacts|usage|silences|session)(\/|\?|$)/;
const apiCache = new Map(); // path -> { at, p }
export const dropCache = () => apiCache.clear();
export async function api(method, path, body) {
  if (method === 'GET' && CACHED.test(path)) {
    const c = apiCache.get(path);
    if (c && Date.now() - c.at < 60000) return structuredClone(await c.p);
    const p = fetchJson(method, path);
    apiCache.set(path, { at: Date.now(), p });
    p.catch(() => apiCache.delete(path));
    return structuredClone(await p);
  }
  if (method !== 'GET') dropCache();
  return fetchJson(method, path, body);
}
async function fetchJson(method, path, body) {
  const opts = { method, headers: {} };
  if (method !== 'GET') { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body ?? {}); }
  const res = await fetch(path, opts);
  if (res.status === 401 && !['/api/login', '/api/setup'].includes(path)) { renderLogin(); throw new Error('Please sign in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { field: data.field, data, status: res.status });
  return data;
}
/** POST answered with newline-delimited JSON events (#66 Ask box). onEvent gets 'step' / 'delta' / 'restarted' / 'text'; returns the 'done' event. */
export async function apiStream(path, body, onEvent) {
  dropCache();
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(body ?? {}) });
  if (res.status === 401) { renderLogin(); throw new Error('Please sign in'); }
  if (!res.ok) { const data = await res.json().catch(() => ({})); throw Object.assign(new Error(data.error || res.statusText), { status: res.status }); }
  let done = null; let buf = '';
  const take = (line) => {
    if (!line.trim()) return;
    let e; try { e = JSON.parse(line); } catch { return; }
    if (e.type === 'error') throw Object.assign(new Error(e.error), { status: e.status });
    if (e.type === 'done') done = e; else if (e.type !== 'ping') onEvent(e);
  };
  const feed = (chunk) => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); } };
  if (res.body?.getReader) {
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { value, done: end } = await reader.read(); if (end) break; feed(dec.decode(value, { stream: true })); }
    feed(`${dec.decode()}\n`);
  } else feed(`${await res.text()}\n`); // no readable body: everything at the end
  if (!done) throw new Error('The answer was cut off. Please ask again.');
  return done;
}
export const tryApi = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message); return undefined; } };
/** A simple switch (058): the screen shows the new state at once; the server's answer (and the live status) confirms it,
 * a refusal puts the real state back. */
export const optimistic = async (apply, call, okMsg) => {
  apply(); applyStatus(S.status);
  if (await tryApi(call, okMsg) === undefined) refreshStatus();
};
/** 057: a member tag (WhatsApp's per-group label) as a small pill; text only. */
export const tagPill = (t) => (t ? h('span', { class: 'pill', style: 'margin-left:6px', title: 'Member tag in this WhatsApp group' }, t) : null);
/** 057: a person's name line — the server's resolver decides the name; a hidden number is never shown as digits. */
export const whoLabel = (m) => m.label || m.name || (m.phone ? `+${m.phone}` : 'Unknown (hidden number)');
export const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
export const time = (ts) => (ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const TYPE_CLASS = { 'message.in': 'info', 'message.out': 'ok', 'tool.call': '', 'tool.error': 'bad', error: 'bad', 'confirm.created': 'warn', 'confirm.applied': 'ok', 'confirm.cancelled': 'warn', 'channel.status': 'info', 'schedule.run': 'info', 'agent.updated': '', 'agent.created': 'ok', 'agent.deleted': 'warn', system: '', 'memory.summary': 'info', 'memory.history': '', 'memory.note.added': 'ok', 'memory.note.removed': 'warn', 'memory.erased': 'bad', 'model.usage': '', 'backup.done': 'ok', 'backup.restore': 'warn', 'backup.settings': '', 'mcp.call': 'info', 'mcp.register': '' };
export function toggle(checked, onchange, disabled) { return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked, disabled: disabled || !can('admin'), onchange: (e) => onchange(e.target.checked) }), h('span')); }
// replaceChildren/append would print null/false as text; drop them everywhere.
for (const fn of ['replaceChildren', 'append']) {
  const orig = Element.prototype[fn];
  Element.prototype[fn] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };
}
export const field = (label, el, hint) => h('div', {}, h('label', {}, label), el, hint ? h('div', { class: 'small muted', style: 'margin-top:3px' }, hint) : null);
export const lines = (arr) => (arr || []).join('\n');
export const splitLines = (s) => String(s || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch {} ta.remove();
  }
}
export const copyBtn = (text, label = 'Copy') => h('button', { class: 'btn small', type: 'button', onclick: async (e) => { await copyText(typeof text === 'function' ? text() : text); const b = e.currentTarget; b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = label), 1600); } }, label);
export const copyRow = (value) => h('div', { class: 'copyrow' }, h('code', {}, value), copyBtn(value));
export const extLink = (href, label, cls = 'btn small') => h('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label, ' ↗');
/** Google "G" mark for the Sign in with Google button. */
export function gLogo() {
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('aria-hidden', 'true');
  for (const [fill, d] of [['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z']]) {
    const p = document.createElementNS(ns, 'path'); p.setAttribute('fill', fill); p.setAttribute('d', d); svg.append(p);
  }
  return svg;
}
/** Upload a file as a raw stream (the panel's upload routes), with progress. Resolves with the JSON answer. */
export function uploadFile(url, file, headers, onProgress) {
  dropCache();
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.setRequestHeader('x-duniya-upload', '1');
    x.setRequestHeader('x-file-name', file.name.replace(/[^\w.@ -]/g, ''));
    for (const [k, v] of Object.entries(headers || {})) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(j) : reject(new Error(j.error || `Upload failed (${x.status})`)); };
    x.onerror = () => reject(new Error('Upload failed — check the connection and try again'));
    x.send(file);
  });
}
/** After a restore: wait for the server to come back, then reload. */
export async function waitForRestart(statusEl) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() - t0 < 180000) {
    try { const r = await fetch('/api/session', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (!j.needsSetup) { location.hash = ''; location.reload(); return; } } } catch {}
    if (statusEl) statusEl.textContent = ` Restoring and restarting… ${Math.round((Date.now() - t0) / 1000)} s`;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (statusEl) statusEl.textContent = ' The server has not come back after 3 minutes. Check the Server page or the server log.';
}
export const meterEl = () => { const i = h('i', { style: 'width:0%' }); const m = h('div', { class: 'meter' }, i); m.set = (f) => (i.style.width = `${Math.round(f * 100)}%`); return m; };

// ---------- state ----------
// Shared screen state. models: the /api/models answer (null = load again); overviewBusy: someone types on Overview, so a
// status push does not redraw it; dmPrefill (049): Contacts → "Set up chat" opens Chats → "Add a direct chat" with it.
export const S = { tab: 'overview', user: null, status: null, feed: [], feedAgent: '', es: null, editing: null, models: null, overviewBusy: false, dmPrefill: null };
const RANK = { viewer: 1, admin: 2, owner: 3 };
export const can = (role) => S.user && RANK[S.user.role] >= RANK[role];
// 062: everyday screens first; Pending only while something waits; Secrets live in Settings.
export const TABS = () => [['overview', 'Overview'], ['chats', 'Chats'], ['agents', 'Agents'], ['activity', 'Activity'], ['usage', 'Usage'], ['models', 'Models'], ['contacts', 'Contacts'],
  S.status?.pending ? ['pending', 'Pending'] : null, ['server', 'Server'], can('owner') && ['backups', 'Backups'], ['settings', 'Settings']].filter(Boolean);
/** Old addresses that moved (062): #secrets is a section of Settings now. */
const MOVED = { secrets: 'settings/secrets' };

// ---------- shell ----------
let statusTimer = null; // slow fallback poll, only while the live stream is down
/** The signed-in shell. `status`: the status that came with the session (login.js), if any. */
export async function boot(status = null) {
  const app = $('#app'); app.replaceChildren();
  document.body.classList.toggle('readonly', !can('admin'));
  const nav = h('nav', { onwheel: (e) => { // a mouse wheel scrolls the tab bar sideways when it does not fit
    if (nav.scrollWidth > nav.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { nav.scrollLeft += e.deltaY; e.preventDefault(); }
  } });
  app.append(
    h('header', {}, h('div', { class: 'bar' }, h('div', { class: 'brand' }, logo(), 'Duniya', h('span', { class: 'dot', id: 'wa-dot', title: 'WhatsApp' }), h('small', { id: 'brand-sub' }, 'agents')),
      h('div', { style: 'flex:1' }), h('button', { class: 'btn small search-btn', title: 'Find anything (/ or ⌘K)', 'aria-label': 'Find anything', onclick: openFind }, icon('search'), h('span', { class: 'desk-only' }, 'Find'), h('kbd', { class: 'desk-only' }, '/')),
      h('span', { class: 'small muted', title: `${S.user.username} · ${S.user.role}` }, S.user.username, h('span', { class: 'who-role' }, ` · ${S.user.role}`)),
      h('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/logout').catch(() => {}); S.user = null; renderLogin(); } }, 'Sign out')), nav),
    h('main', { id: 'main' }));
  S.tab = ''; // the first status draws no screen; show() below draws the one in the address (063)
  connectEvents();
  if (status) applyStatus(status); else await refreshStatus();
  drawNav();
  const link = /^#secret=([a-f0-9]{64})$/.exec(location.hash || sessionStorage.getItem('duniya.link') || '');
  sessionStorage.removeItem('duniya.link');
  if (link && can('admin')) return renderSecretLink(link[1]);
  show((location.hash.slice(1) || 'overview').split('/')[0]);
}
/** Status on demand (first paint, after a change made here); the live stream pushes it otherwise (058). */
export async function refreshStatus() {
  try { applyStatus(await api('GET', '/api/status')); } catch { /* signed out or offline: the stream retries */ }
}
/** The tab bar; drawn again only when the set of tabs changes (Pending comes and goes). */
function drawNav() {
  const nav = $('header nav'); if (!nav) return;
  const tabs = TABS(); const sig = tabs.map(([id]) => id).join();
  if (nav.dataset.sig === sig) return;
  nav.dataset.sig = sig;
  nav.replaceChildren(...tabs.map(([id, label]) => h('button', { 'data-tab': id, onclick: () => (location.hash === `#${id}` ? show(id) : (location.hash = id)) }, icon(id), label,
    id === 'server' ? h('span', { class: 'nbadge', id: 'server-badge' }) : id === 'pending' ? h('span', { class: 'nbadge' }, String(S.status?.pending || '')) : null)));
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  serverBadge(S.status?.osUpdates);
}
function applyStatus(next) {
  const pendingWas = S.status?.pending;
  S.status = next;
  if (pendingWas !== next.pending && $('header nav')) { $('header nav').dataset.sig = ''; drawNav(); }
  const st = S.status.channel.status;
  const dot = $('#wa-dot'); if (dot) dot.className = `dot ${st === 'open' ? 'ok' : ['qr', 'reconnecting', 'starting'].includes(st) ? 'warn' : 'bad'}`;
  const sub = $('#brand-sub'); if (sub) sub.textContent = S.status.settings.paused ? 'paused' : `${S.status.agents.filter((b) => b.enabled).length} agents live`;
  serverBadge(S.status.osUpdates);
  if (S.tab === 'overview') import('./overview.js').then((m) => m.renderOverview(true));
}
// #96: the Server tab counts only OS updates that will install now (not gradual roll-outs or held packages); "!" when
// a restart is needed to finish updates.
export function serverBadge(o) {
  const b = $('#server-badge'); if (!b) return;
  b.textContent = !o ? '' : o.count ? String(o.count) : o.restart ? '!' : '';
  b.title = !o ? '' : [o.count ? `${o.count} OS update${o.count > 1 ? 's' : ''} to install` : '', o.restart ? 'Restart needed to finish updates' : ''].filter(Boolean).join(' · ');
}
/** Each screen is its own module, loaded on its first visit (063); the browser keeps it for the next one. */
const SCREENS = {
  overview: () => import('./overview.js').then((m) => m.renderOverview()),
  chats: () => import('./chats.js').then((m) => m.renderChats()),
  agents: () => import('./agents.js').then((m) => m.renderAgents()),
  activity: () => import('./activity.js').then((m) => m.renderActivity()),
  usage: () => import('./usage.js').then((m) => m.renderUsage()),
  models: () => import('./models.js').then((m) => m.renderModels()),
  contacts: () => import('./contacts.js').then((m) => m.renderContacts()),
  pending: () => import('./pending.js').then((m) => m.renderPending()),
  server: () => import('./server.js').then((m) => m.renderServer()),
  backups: () => import('./backups.js').then((m) => m.renderBackups()),
  settings: () => import('./settings.js').then((m) => m.renderSettings()),
};
/** Find anything (062), loaded when first opened. */
export const openFind = () => import('./find.js').then((m) => m.openPalette()).catch((e) => toast(e.message));
export function show(tab) {
  if (Object.hasOwn(MOVED, tab)) { history.replaceState(null, '', `#${MOVED[tab]}`); tab = MOVED[tab].split('/')[0]; }
  if (!TABS().some(([id]) => id === tab) && !(tab === 'pending' && can('viewer'))) tab = 'overview';
  S.tab = tab;
  if (location.hash.slice(1).split('/')[0] !== tab) history.replaceState(null, '', `#${tab}`);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  // Phones: the tab bar scrolls sideways; keep the current tab in view.
  const onBtn = document.querySelector('nav button.on'); const navEl = onBtn?.parentElement;
  if (navEl) {
    const b = onBtn.getBoundingClientRect(); const n = navEl.getBoundingClientRect();
    if (b.left < n.left || b.right > n.right) navEl.scrollTo({ left: navEl.scrollLeft + (b.left - n.left) - (n.width - b.width) / 2, behavior: 'smooth' });
  }
  const seq = (S.renderSeq = (S.renderSeq || 0) + 1);
  const main = $('#main');
  const slow = setTimeout(() => { if (S.renderSeq === seq) main?.classList.add('loading'); }, 120);
  const r = Object.hasOwn(SCREENS, tab) ? SCREENS[tab] : null;
  Promise.resolve(r?.()).catch((e) => toast(e.message)).finally(() => {
    clearTimeout(slow);
    if (S.renderSeq === seq) { main?.classList.remove('loading'); S.renderDone = seq; jumpToSub(); return; }
    // A slower, older tab finished after a newer one and drew over it: draw the current tab again.
    if ((S.renderDone || 0) > seq && S.tab) show(S.tab);
  });
}
/** 062: #tab/<section> scrolls to the element marked data-jump="<section>" (a settings card, a provider, a chat). */
export function jumpToSub() {
  const sub = decodeURIComponent(location.hash.split('/')[1] || '');
  const el = sub && document.querySelector(`[data-jump="${CSS.escape(sub)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800);
}
// Live stream (058): activity entries and the status (no polling). While it is down, a slow poll keeps the status
// fresh; EventSource reconnects by itself.
export function connectEvents() {
  S.es?.close();
  S.es = new EventSource('/api/events');
  const slowPoll = (on) => { clearInterval(statusTimer); statusTimer = on ? setInterval(refreshStatus, 30000) : null; };
  S.es.onopen = () => { if (statusTimer) refreshStatus(); slowPoll(false); }; // back after an outage: catch up once
  S.es.onerror = () => { if (!statusTimer) slowPoll(true); };
  S.es.addEventListener('status', (e) => {
    const next = JSON.parse(e.data);
    const { uptimeSec, memoryMb, ...rest } = next;
    const sig = JSON.stringify(rest);
    if (sig !== S.statusSig) { if (S.statusSig) dropCache(); S.statusSig = sig; }
    applyStatus(next);
  });
  S.es.onmessage = (e) => {
    const a = JSON.parse(e.data);
    dropCache();
    S.feed.unshift(a); S.feed.length = Math.min(S.feed.length, 500);
    if (S.tab === 'activity' && (!S.feedAgent || a.agent === S.feedAgent)) $('#feed')?.prepend(feedItem(a));
    if (S.tab === 'overview') { const r = $('#recent'); if (r) { r.prepend(feedItem(a)); while (r.children.length > 8) r.lastChild.remove(); } }
  };
}

