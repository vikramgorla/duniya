// Panel core: the DOM helper, api() and its cache, shared state, the shell (tabs, router, live stream). Module of the panel (063).
// ---------- DOM helper: untrusted text only ever goes through textContent ----------
import { feedPrepend } from './activity.js';
import { renderLogin, renderSecretLink } from './login.js';
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'indeterminate') el.indeterminate = true;
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
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM5 15V5a1 1 0 0 1 1-1h10',
  done: 'M5 12.5l4.5 4.5L19 7.5',
  overview: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z',
  activity: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  agents: 'M8 8V6.5a4 4 0 0 1 8 0V8M5 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM9.5 14h.01M14.5 14h.01',
  chats: 'M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9zM9 9.5h6M9 12.5h4',
  models: 'M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  usage: 'M5 19V10M10 19V5M15 19v-7M20 19v-4M3 19.5h18',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19a5.5 5.5 0 0 1 11 0M16 7.5h5M16 11h5M17.5 14.5H21',
  server: 'M5 5h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM5 13h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM8 8h.01M8 16h.01',
  backups: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9zM12 11v5M9.5 13.5 12 11l2.5 2.5',
  back: 'M15 5l-7 7 7 7',
  shield: 'M12 3.5l7 2.5v5.5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6zM9 12l2 2 4-4',
  image: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 16l5-5 4 4 2-2 5 5M15.5 9h.01',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM12 15v2',
  globe: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z',
  more: 'M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM19 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  send: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  refresh: 'M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5', // 068: More → Refresh
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  pending: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4.5l3 2',
  secrets: 'M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h2.5v-2h2v-2h2l.9-.9A5.5 5.5 0 0 1 14.5 4zM15.5 8.5h.01',
  notes: 'M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5zM14 3.5V8h4M9.5 12h5M9.5 15.5h5', // 065: release notes
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
/** A toast (064). opts.bad: an error (looks different, announced at once); opts.undo: a function, shows an Undo button. */
export function toast(msg, { bad = false, undo = null } = {}) {
  let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: bad ? 'alert' : null }, h('span', {}, msg),
    undo ? h('button', { type: 'button', onclick: () => { t.remove(); undo(); } }, 'Undo') : null);
  box.append(t); setTimeout(() => t.remove(), undo ? 6000 : bad ? 5000 : 3500);
}
/**
 * The panel's own confirmation (064), instead of the browser's confirm(): a centred dialog on wide screens, a bottom
 * sheet on phones. `title` asks the question, `text` says what will happen (a string, "\n\n" separates paragraphs),
 * `ok` names the action ("Delete agent", never "OK"), `danger` marks something destructive or disruptive (red button,
 * Cancel has the focus so Enter does not confirm it by accident), `body` is extra content (fields, release notes,
 * package lists), `typed` asks to type that word first. Esc, Cancel and a tap outside cancel. Resolves true or false.
 * @param {{ title: string, text?: string, ok?: string, danger?: boolean, body?: any, typed?: string, cancel?: string }} o
 */
/** ok: null shows no action button (a dialog to read, with only `cancel`, e.g. "Close"); wide: room for a long details
 *  area such as release notes (065). */
export function ask({ title, text = '', ok = 'Continue', danger = false, body = null, typed = '', cancel = 'Cancel', wide = false }) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const id = `ask${Date.now().toString(36)}`;
    const typedIn = typed ? h('input', { autocomplete: 'off', spellcheck: 'false', 'aria-label': `Type ${typed} to confirm`, oninput: () => { yes.disabled = typedIn.value.trim() !== typed; } }) : null;
    const yes = ok == null ? null : h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, value: 'yes', disabled: !!typed }, ok);
    const no = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close('no') }, cancel);
    const dlg = h('dialog', { class: `dlg ask${danger ? ' danger' : ''}${wide ? ' wide' : ''}`, role: danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-t`, 'aria-describedby': text ? `${id}-d` : null,
      onclick: (e) => { if (e.target === dlg) dlg.close('no'); } },
    h('form', { method: 'dialog' },
      h('h2', { id: `${id}-t` }, title),
      text ? h('div', { id: `${id}-d`, class: 'ask-text' }, String(text).split(/\n\n+/).map((p) => h('p', {}, p))) : null,
      body ? h('div', { class: 'ask-body' }, body) : null,
      typed ? h('div', {}, h('label', {}, 'Type ', h('b', {}, typed), ' to confirm'), typedIn) : null,
      h('div', { class: 'ask-actions' }, no, yes)));
    dlg.addEventListener('close', () => { dlg.remove(); if (back instanceof HTMLElement && back.isConnected) back.focus(); resolve(dlg.returnValue === 'yes'); });
    document.body.append(dlg); dlg.showModal();
    // 066: on touch screens the dialog itself takes focus (a ring on a button nobody touched looks like a bug); keyboards get Cancel/OK
    if (!typedIn && matchMedia('(pointer: coarse)').matches) { dlg.tabIndex = -1; dlg.focus(); } else (typedIn || (danger || !yes ? no : yes)).focus();
  });
}
/** A ⋯ menu (064): secondary actions of a row behind one button instead of a row of buttons. `label` names it for
 * screen readers ("Actions for Home"); `items` are buttons. A click anywhere or Esc closes it. */
export function menu(label, ...items) {
  const d = h('details', { class: 'menu' }, h('summary', { class: 'btn small icon', 'aria-label': label, title: label }, icon('more')),
    h('div', { class: 'menu-pop', onclick: () => { d.open = false; } }, items));
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d.open) { d.open = false; d.querySelector('summary').focus(); } });
  return d;
}
document.addEventListener('click', (e) => { for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false; });
// 073: focus rings only while the keyboard is in use (styles.css `.kbd`): Tab, arrows, Esc — or Enter / Space outside
// a text field — turn them on; any tap or click turns them off. Typing in a field (phone keyboards too) changes nothing.
const NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End', 'PageUp', 'PageDown']);
addEventListener('keydown', (e) => {
  if (NAV_KEYS.has(e.key) || ((e.key === 'Enter' || e.key === ' ') && !e.target?.closest?.('input, textarea, select, [contenteditable]'))) document.documentElement.classList.add('kbd');
}, true);
addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd'), true);
/** Agent (or chat) avatar (064): initials on one of the five "people" colours, the same colour for the same id. */
export function avatar(name, id = name, size = '') {
  const words = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  let n = 0; for (const ch of String(id)) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return h('span', { class: `av c${(n % 5) + 1}${size ? ` ${size}` : ''}`, 'aria-hidden': 'true' }, initials);
}
// Tiny inline illustrations for empty states (64 × 48 grid, stroke = currentColor).
const ART = {
  chats: 'M8 12h30a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H20l-8 6v-6H8a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6zM30 26h26a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-2v5l-7-5H30a6 6 0 0 1-6-6',
  agents: 'M20 14V9a12 12 0 0 1 24 0v5M12 20a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v16a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8zM25 28h.1M39 28h.1M27 36c3 2 7 2 10 0',
  activity: 'M2 30h12l6-16 10 28 8-20 5 8h19',
  list: 'M10 8h44a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4zM16 18h32M16 26h24M16 34h14',
};
/** An empty state that teaches (DESIGN.md): a tiny illustration, what is missing, what to do (optional action). */
export function emptyState(art, title, text, action) {
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 52'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ART[art] || ART.list);
  for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
  const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', '54'); dot.setAttribute('cy', '8'); dot.setAttribute('r', '4'); dot.setAttribute('fill', 'var(--signal)');
  svg.append(p, dot);
  return h('div', { class: 'empty' }, svg, h('b', {}, title), text ? h('p', {}, text) : null, action || null);
}
/** Placeholder cards while a screen loads for the first time (064). */
const skeleton = (cards = 2) => h('div', { class: 'skel', 'aria-hidden': 'true' },
  Array.from({ length: cards }, () => h('div', { class: 'card' }, h('i', { class: 'h' }), h('i', {}), h('i', { class: 's' }), h('i', { class: 'xs' }))));
// Screen data cache (058): switching screens reuses what was just loaded. Any change made here and anything the live
// stream reports (activity, a changed status) drops it; entries also expire after 60 s. Only lists that screens load
// on open are cached, never live views (status, system, activity, updates).
const CACHED = /^\/api\/(agents|templates|chats|providers|budget|media|backups|pending|secrets|logging|assistants|owner-assistant|privacy-notice|people|households|lists|usage|silences|session)(\/|\?|$)/;
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
// 066: every request has a deadline and can be dropped. A phone that suspends the installed app can leave a request
// (or its socket) hanging forever: without a deadline the screen waited on it for good, and a pending cached promise
// kept every later visit waiting too. Requests in flight are dropped when the app comes back after a while (recover()).
const inflight = new Set();
/** Wait for `p` at most `ms`; then fail with a plain message (`kind` tells Retry what to do). */
const deadline = (p, ms, kind = 'data') => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error('The server did not answer in time.'), { kind })), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
async function fetchJson(method, path, body) {
  const ctl = new AbortController(); inflight.add(ctl);
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), method === 'GET' ? S.loadTimeout : 60000);
  const opts = { method, headers: {}, signal: ctl.signal };
  if (method !== 'GET') { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body ?? {}); }
  let res;
  try { res = await fetch(path, opts); } catch (e) {
    throw ctl.signal.aborted ? Object.assign(new Error('The server did not answer in time. Check the connection and try again.'), { kind: 'data' }) : e;
  } finally { clearTimeout(timer); inflight.delete(ctl); }
  if (res.status === 401 && !['/api/login', '/api/setup'].includes(path)) { renderLogin(); throw new Error('Please sign in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { field: data.field, data, status: res.status });
  return data;
}
/** POST answered with newline-delimited JSON events (#66 Ask box). onEvent gets 'step' / 'delta' / 'restarted' / 'text'; returns the 'done' event. */
export async function apiStream(path, body, onEvent, signal = undefined) {
  dropCache();
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(body ?? {}), signal });
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
/** A save the server refused (064): the error toast, and when the server names the field (`e.field`) and `fields[field]`
 * is on screen, that field is marked invalid with the reason under it, scrolled to and focused. */
export function fieldError(e, fields = {}) {
  toast(e.field ? `${e.field}: ${e.message.replace(/^[^:]+: /, '')}` : e.message, { bad: true });
  const el = e.field && fields[e.field];
  if (!(el instanceof HTMLElement)) return false;
  const msg = h('div', { class: 'field-error', id: `err-${e.field}` }, e.message.replace(/^[^:]+: /, ''));
  el.nextElementSibling?.classList.contains('field-error') && el.nextElementSibling.remove();
  el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', msg.id); el.after(msg);
  el.addEventListener('input', () => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); msg.remove(); }, { once: true });
  el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true });
  return false;
}
export const tryApi = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, { bad: true }); return undefined; } };
/** A simple switch (058): the screen shows the new state at once; the server's answer (and the live status) confirms it,
 * a refusal puts the real state back. */
export const optimistic = async (apply, call, okMsg, undo) => {
  apply(); applyStatus(S.status);
  try { await call(); if (okMsg) toast(okMsg, { undo }); } catch (e) { toast(e.message, { bad: true }); refreshStatus(); }
};
/** 057: a member tag (WhatsApp's per-group label) as a small pill; text only. */
export const tagPill = (t) => (t ? h('span', { class: 'pill raw', style: 'margin-left:6px', title: 'Member tag in this WhatsApp group' }, t) : null);
/** 057: a person's name line — the server's resolver decides the name; a hidden number is never shown as digits. */
export const whoLabel = (m) => m.label || m.name || (m.phone ? `+${m.phone}` : 'Unknown (hidden number)');
export const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
export const time = (ts) => (ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** A switch (role=switch). `label`: its name for screen readers when no visible label wraps it (064). */
export function toggle(checked, onchange, disabled, label) {
  return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label || null, disabled: disabled || !can('admin'), onchange: (e) => onchange(e.target.checked) }), h('span', { 'aria-hidden': 'true' }));
}
// replaceChildren/append would print null/false as text; drop them everywhere.
for (const fn of ['replaceChildren', 'append']) {
  const orig = Element.prototype[fn];
  Element.prototype[fn] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };
}
let fieldSeq = 0;
/** A labelled form field: the label names its input, select or textarea (064), and the hint describes it. */
export function field(label, el, hint) {
  const id = `fld${++fieldSeq}`;
  const target = el instanceof HTMLElement ? (el.matches('input, select, textarea') ? el : el.querySelector('input, select, textarea')) : null;
  const lab = h('label', {}, label);
  if (target && !target.getAttribute('aria-label')) { target.id ||= id; lab.htmlFor = target.id; }
  const tip = hint ? h('div', { class: 'small muted', id: `${id}-hint`, style: 'margin-top:3px' }, hint) : null;
  if (tip && target) target.setAttribute('aria-describedby', tip.id);
  return h('div', {}, lab, el, tip);
}
export const lines = (arr) => (arr || []).join('\n');
export const splitLines = (s) => String(s || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch {} ta.remove();
  }
}
/** Copy button; `quiet: true` is a small icon-only button (answers in Ask), with its label for screen readers. */
export const copyBtn = (text, label = 'Copy', { quiet = false } = {}) => {
  const face = (ok) => (quiet ? [icon(ok ? 'done' : 'copy')] : [ok ? 'Copied ✓' : label]);
  const b = h('button', { class: quiet ? 'btn ghost icon quiet' : 'btn small', type: 'button', title: label, 'aria-label': label, onclick: async () => {
    await copyText(typeof text === 'function' ? text() : text);
    b.replaceChildren(...face(true)); b.setAttribute('aria-label', 'Copied'); setTimeout(() => { b.replaceChildren(...face(false)); b.setAttribute('aria-label', label); }, 1600);
  } }, ...face(false));
  return b;
};
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
// status push does not redraw it; dmPrefill (049): a person's page → "Set up a direct chat" opens Chats → "Add a direct chat" with it.
export const S = { loadTimeout: 15000, tab: 'overview', user: null, status: null, feed: [], feedAgent: '', feedChat: '', es: null, editing: null, models: null, overviewBusy: false, dmPrefill: null };
const RANK = { viewer: 1, admin: 2, owner: 3 };
export const can = (role) => S.user && RANK[S.user.role] >= RANK[role];
// 062: everyday screens first; Pending only while something waits; Secrets live in Settings.
export const TABS = () => [['overview', 'Overview'], ['chats', 'Chats'], ['agents', 'Agents'], ['activity', 'Activity'], ['usage', 'Usage'], ['models', 'Models'], can('admin') && ['people', 'People'],
  S.status?.pending ? ['pending', 'Pending'] : null, ['server', 'Server'], can('owner') && ['backups', 'Backups'], ['settings', 'Settings']].filter(Boolean);
/** Old addresses that moved (062): #secrets is a section of Settings now. */
const MOVED = { secrets: 'settings/secrets', contacts: 'people' }; // 078: Contacts moved into People

// ---------- shell ----------
let statusTimer = null; // slow fallback poll, only while the live stream is down
/** The four everyday screens in the phone tab bar (064); every other screen is under More. */
export const PRIMARY = ['overview', 'chats', 'agents', 'activity'];
const signOut = async () => { await api('POST', '/api/logout').catch(() => {}); S.user = null; renderLogin(); };
/** 068: signing out asks first (it sat next to Refresh and was easy to tap by mistake). */
export const askSignOut = async () => { if (await ask({ title: 'Sign out?', text: `You are signed in as ${S.user?.username} (${S.user?.role}). To come back you sign in again.`, ok: 'Sign out' })) signOut(); };
/** The signed-in shell. `status`: the status that came with the session (login.js), if any. */
export async function boot(status = null) {
  const app = $('#app'); app.replaceChildren();
  document.body.classList.toggle('readonly', !can('admin'));
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Screens', onwheel: (e) => { // a mouse wheel scrolls the tab bar sideways when it does not fit
    if (nav.scrollWidth > nav.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { nav.scrollLeft += e.deltaY; e.preventDefault(); }
  } });
  app.append(
    h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); $('#main')?.focus(); } }, 'Skip to content'),
    h('header', {}, h('h1', { class: 'sr-only', id: 'screen-title' }, 'Duniya'), h('div', { class: 'bar' }, h('div', { class: 'brand' }, logo(), 'Duniya', h('span', { class: 'dot', id: 'wa-dot', role: 'img', 'aria-label': 'WhatsApp' }), h('small', { id: 'brand-sub' }, 'agents')),
      h('div', { class: 'grow' }), h('button', { class: 'btn small search-btn', title: 'Find anything (/ or ⌘K)', 'aria-label': 'Find anything', 'aria-keyshortcuts': '/ Control+K Meta+K', onclick: openFind }, icon('search'), h('span', { class: 'desk-only' }, 'Find'), h('kbd', { class: 'desk-only', 'aria-hidden': 'true' }, '/')),
      h('span', { class: 'who desk-nav', title: `${S.user.username} · ${S.user.role}` }, S.user.username, ` · ${S.user.role}`),
      h('button', { class: 'btn small desk-nav', onclick: askSignOut }, 'Sign out')), nav),
    h('main', { id: 'main', tabindex: '-1', 'aria-labelledby': 'screen-title' }),
    h('nav', { class: 'tabbar', 'aria-label': 'Screens' }));
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
export const go = (id) => (location.hash === `#${id}` ? show(id) : (location.hash = id));
const LABEL = Object.fromEntries([['more', 'More']]);
export const badgeFor = (id) => (id === 'server' ? h('span', { class: 'nbadge server-badge' }) : id === 'pending' ? h('span', { class: 'nbadge' }, String(S.status?.pending || '')) : null);
/** The tab bars (top on wide screens, bottom on phones); drawn again only when the set of tabs changes (Pending comes and goes). */
function drawNav() {
  const nav = $('header nav'); if (!nav) return;
  const tabs = TABS(); const sig = tabs.map(([id]) => id).join();
  if (nav.dataset.sig === sig) return;
  nav.dataset.sig = sig;
  for (const [id, label] of tabs) LABEL[id] = label;
  nav.replaceChildren(...tabs.map(([id, label]) => h('button', { 'data-tab': id, onclick: () => go(id) }, icon(id), label, badgeFor(id))));
  $('nav.tabbar')?.replaceChildren(...PRIMARY.map((id) => h('button', { 'data-tab': id, onclick: () => go(id) }, icon(id), LABEL[id])),
    h('button', { 'data-tab': 'more', 'aria-haspopup': 'dialog', onclick: () => sheet((m) => m.openMore()) }, icon('more'), 'More', h('span', { class: 'nbadge' }, S.status?.pending ? String(S.status.pending) : '')));
  markTabs();
  serverBadge(S.status?.osUpdates);
}
/** Current screen in both tab bars: `on` + aria-current; More is current for a screen that lives under it. */
function markTabs() {
  for (const b of document.querySelectorAll('nav button[data-tab]')) {
    const on = b.dataset.tab === S.tab || (b.dataset.tab === 'more' && !!S.tab && !PRIMARY.includes(S.tab));
    b.classList.toggle('on', on);
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}
function applyStatus(next) {
  const pendingWas = S.status?.pending;
  S.status = next;
  if (pendingWas !== next.pending && $('header nav')) { $('header nav').dataset.sig = ''; drawNav(); }
  const st = S.status.channel.status;
  const dot = $('#wa-dot'); if (dot) { dot.className = `dot ${st === 'open' ? 'ok' : ['qr', 'reconnecting', 'starting'].includes(st) ? 'warn' : 'bad'}`; dot.setAttribute('aria-label', `WhatsApp: ${st === 'open' ? 'connected' : st.replace('_', ' ')}`); }
  const sub = $('#brand-sub'); if (sub) sub.textContent = S.status.settings.paused ? 'paused' : `${S.status.agents.filter((b) => b.enabled).length} agents live`;
  serverBadge(S.status.osUpdates);
  if (S.tab === 'overview') import('./overview.js').then((m) => { if (S.tab === 'overview' && S.renderDone === S.renderSeq) m.renderOverview(true); }); // 066: never over another screen, never mid-navigation
  if (S.tab === 'settings' && document.querySelector('[id^="ch-"]')) import('./channels.js').then((m) => { if (S.tab === 'settings') m.refreshChannelPage(); }); // 075: a new QR, connected, off
}
// #96: the Server tab counts only OS updates that will install now (not gradual roll-outs or held packages); "!" when
// a restart is needed to finish updates.
export function serverBadge(o) {
  for (const b of document.querySelectorAll('.server-badge')) {
    b.textContent = !o ? '' : o.count ? String(o.count) : o.restart ? '!' : '';
    b.title = !o ? '' : [o.count ? `${o.count} OS update${o.count > 1 ? 's' : ''} to install` : '', o.restart ? 'Restart needed to finish updates' : ''].filter(Boolean).join(' · ');
  }
}
/** Each screen is its own module, loaded on its first visit (063); the browser keeps it for the next one. */
const SCREENS = {
  overview: () => import('./overview.js').then((m) => m.renderOverview()),
  chats: () => import('./chats.js').then((m) => m.renderChats()),
  agents: () => import('./agents.js').then((m) => m.renderAgents()),
  activity: () => import('./activity.js').then((m) => m.renderActivity()),
  usage: () => import('./usage.js').then((m) => m.renderUsage()),
  models: () => import('./models.js').then((m) => m.renderModels()),
  people: () => import('./people.js').then((m) => m.renderPeople()),
  pending: () => import('./pending.js').then((m) => m.renderPending()),
  server: () => import('./server.js').then((m) => m.renderServer()),
  backups: () => import('./backups.js').then((m) => m.renderBackups()),
  settings: () => import('./settings.js').then((m) => m.renderSettings()),
};
/** Find anything (062), loaded when first opened. */
export const openFind = () => sheet((m) => m.openPalette());
/** 066: open a sheet from find.js (Find anything, More). If the module never arrives, the page reloads (the browser
 * would keep waiting on the same import), landing on the same screen. */
const sheet = (open) => deadline(import('./find.js'), S.loadTimeout, 'screen').then(open).catch(() => {
  toast('Part of the app did not arrive. Reloading…', { bad: true }); setTimeout(() => location.reload(), 1200);
});
export function show(tab) {
  if (Object.hasOwn(MOVED, tab)) { const rest = location.hash.split('/').slice(1).join('/'); history.replaceState(null, '', `#${MOVED[tab]}${rest && !MOVED[tab].includes('/') ? `/${rest}` : ''}`); tab = MOVED[tab].split('/')[0]; }
  if (!TABS().some(([id]) => id === tab) && !(tab === 'pending' && can('viewer'))) tab = 'overview';
  const from = S.tab; S.tab = tab;
  document.title = `${LABEL[tab] || 'Duniya'}${LABEL[tab] ? ' · Duniya' : ''}`;
  const title = $('#screen-title'); if (title) title.textContent = LABEL[tab] || 'Duniya';
  if (location.hash.slice(1).split('/')[0] !== tab) history.replaceState(null, '', `#${tab}`);
  markTabs();
  // Wide screens: the top tab bar may scroll sideways; keep the current tab in view.
  const onBtn = document.querySelector('nav.tabs button.on'); const navEl = onBtn?.parentElement;
  if (navEl && navEl.clientWidth) {
    const b = onBtn.getBoundingClientRect(); const n = navEl.getBoundingClientRect();
    if (b.left < n.left || b.right > n.right) navEl.scrollTo({ left: navEl.scrollLeft + (b.left - n.left) - (n.width - b.width) / 2, behavior: 'smooth' });
  }
  const seq = (S.renderSeq = (S.renderSeq || 0) + 1);
  const main = $('#main');
  const moved = from !== tab; // another screen: placeholder cards while it loads; the same one: dim it
  // 066: a new screen starts at the top *before* its content changes. Left deep in a long screen, a shorter one was drawn
  // far below the top and iPhone (WebKit) painted the area above blank, header included, until the next scroll.
  if (moved && !location.hash.includes('/')) window.scrollTo(0, 0);
  // 066: placeholders only while nothing new is drawn. A screen that draws and then waits for more (Activity draws its
  // card, then loads the list) used to have its card replaced by the placeholders for good.
  const shown = main?.firstElementChild;
  const slow = setTimeout(() => { if (S.renderSeq !== seq || !main || main.firstElementChild !== shown) return; if (moved) main.replaceChildren(skeleton()); else main.classList.add('loading'); main.setAttribute('aria-busy', 'true'); }, 120);
  const r = Object.hasOwn(SCREENS, tab) ? SCREENS[tab] : null;
  // 066: a screen that fails or stalls (a module or request hung after the phone suspended the app) shows why and Retry,
  // instead of placeholder cards forever.
  Promise.resolve(r && deadline(r(), S.loadTimeout + 5000, 'screen')).catch((e) => {
    console.error('Duniya: a screen did not load:', String(tab), e);
    if (S.renderSeq !== seq || !main || e?.message === 'Please sign in') return;
    // A screen module that is missing (the app was updated while this page was open: new file names) → load the new app
    // once; a second failure within a minute shows Retry instead of looping.
    const missing = /dynamically imported module|importing a module script failed|module script/i.test(e?.message || '');
    if (missing && Date.now() - Number(sessionStorage.getItem('duniya.reloadedAt') || 0) > 60000) { sessionStorage.setItem('duniya.reloadedAt', String(Date.now())); location.reload(); return; }
    main.replaceChildren(loadFailed(e, () => show(S.tab)));
  }).finally(() => {
    clearTimeout(slow);
    if (S.renderSeq === seq) {
      main?.classList.remove('loading'); main?.removeAttribute('aria-busy'); S.renderDone = seq;
      if (main) main.dataset.screen = tab;
      if (S.overdrawn === seq) { S.overdrawn = 0; show(S.tab); return; } // an older screen finished meanwhile and may have drawn over this one
      if (main?.querySelector(':scope > .skel')) { console.error('Duniya: a screen finished without drawing:', String(tab)); main.replaceChildren(loadFailed(new Error('This screen did not finish drawing.'), () => show(S.tab))); }
      if (moved && from && main) {
        main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
        // Keyboard and screen-reader users land on the new screen, not on the tab they left (064).
        if ((document.activeElement?.closest?.('nav, dialog') || document.activeElement === document.body) && !location.hash.includes('/')) main.focus({ preventScroll: true });
        if (!location.hash.includes('/')) { window.scrollTo(0, 0); requestAnimationFrame(() => window.scrollTo(0, 0)); }
      }
      jumpToSub(); return;
    }
    // A slower, older screen finished after a newer one started: it may have drawn over it. If the newer one is done,
    // draw it again now; otherwise when it is done (066: before, only the first case was handled, and an older screen
    // that drew while the newer one was still loading stayed under the newer tab).
    if (S.renderDone === S.renderSeq) { if (S.tab) show(S.tab); } else S.overdrawn = S.renderSeq;
  });
}
/** 066: "Couldn't load" with the reason and Retry. A screen module that never arrived cannot be asked for again in
 * this page (the browser keeps the pending import), so its Retry reloads the app; data is simply asked again. */
function loadFailed(e, retry) {
  const stuck = e?.kind === 'screen' || /import|module|dynamically/i.test(e?.message || '');
  return h('div', { class: 'card load-failed', role: 'alert' }, h('h2', {}, 'Couldn’t load this screen'),
    h('p', { class: 'small muted' }, stuck ? 'Part of the app did not arrive, probably while the phone was asleep or offline.' : e?.message || 'Something went wrong.'),
    h('button', { class: 'btn primary', onclick: () => (stuck ? location.reload() : (dropCache(), retry())) }, 'Retry'));
}
/** 066: back after a while (or pull to refresh, `force`): drop what is still waiting, reconnect the live stream, draw again. */
export function recover(force = false) {
  const main = $('#main');
  // draw again only when something was waiting or the screen is not drawn (keeps a half-edited form otherwise)
  const stuck = force || inflight.size > 0 || !!main?.querySelector('.skel, .load-failed') || main?.classList.contains('loading');
  for (const c of inflight) c.abort(); inflight.clear();
  dropCache();
  if (!S.user) return;
  connectEvents(); refreshStatus();
  if (stuck) show(S.tab);
}
/** 062: #tab/<section> scrolls to the element marked data-jump="<section>" (a settings card, a provider, a chat). */
export function jumpToSub() {
  const sub = decodeURIComponent(location.hash.split('/')[1] || '');
  const el = sub && document.querySelector(`[data-jump="${CSS.escape(sub)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800);
}
// 064: an agent's live state on Overview from the activity stream (no polling): reading… when a message for it arrives,
// using tools… while it works, answered when the reply went out. The pulse fades by itself (CSS), nothing to clean up.
const PULSE = { 'message.in': ['reading', 'reading…'], 'tool.call': ['reading', 'using tools…'], 'mcp.call': ['reading', 'using tools…'], 'message.out': ['answered', 'answered'] };
export const pulse = (agentId) => h('span', { class: 'pulse', 'data-pulse': agentId, 'aria-live': 'off' });
function livePulse(a) {
  const old = a.agent && PULSE[a.type] && document.querySelector(`[data-pulse="${CSS.escape(a.agent)}"]`);
  if (!old) return;
  const p = pulse(a.agent); p.classList.add(PULSE[a.type][0]); p.textContent = PULSE[a.type][1];
  old.replaceWith(p);
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
    S.onFeed?.(a); // a screen that follows live work (082: a run's page)
    if (S.tab === 'activity' && (!S.feedAgent || a.agent === S.feedAgent) && (!S.feedChat || a.chat === S.feedChat)) { const f = $('#feed'); if (f) feedPrepend(f, a); }
    // People filled in the background (phone contacts, group members): redraw the list unless the owner is typing
    if (S.tab === 'people' && / People$/.test(a.summary || '') && /^#people\/?$/.test(location.hash) && !document.activeElement?.matches('input, textarea, select')) show('people');
    if (S.tab === 'overview') { const r = $('#recent'); if (r) { feedPrepend(r, a, 8); $('#recent + .empty')?.remove(); } livePulse(a); }
  };
}

