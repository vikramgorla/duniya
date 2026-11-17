// Overview screen (the landing screen) and the install-on-your-phone hint. Module of the panel (063).
// ---------- overview ----------
import { feedItem } from './activity.js';
import { askCard } from './ask.js';
import { $, S, ago, api, can, h, logo, optimistic, refreshStatus, show, time, toggle, tryApi } from './core.js';
import { refreshSilences, silencesCard } from './quiet.js';
import { checklistActive, checklistBox, checklistNext, goTo, linkNumberBox, refreshChecklist } from './start.js';
import { renderUpdates } from './updates.js';
let overviewSig = '';
export async function renderOverview(soft) {
  const st = S.status; if (!st) return;
  // The 5-second status poll only rebuilds the page when something visible changed; uptime and memory are updated
  // in place. (Rebuilding every time made the page flicker, the update box reloading each time.)
  const { uptimeSec, memoryMb, ...rest } = st;
  const sig = JSON.stringify({ ...rest, channel: { ...rest.channel, since: undefined } });
  if (soft && sig === overviewSig && $('#ov-uptime')) {
    $('#ov-uptime').textContent = ago(Date.now() - uptimeSec * 1000); $('#ov-memory').textContent = `${memoryMb} MB`;
    if (Date.now() - (S.checklistAt || 0) > 15000) { refreshChecklist(); refreshSilences(); }
    return;
  }
  if (soft && (S.overviewBusy || S.ask?.busy || $('#main')?.contains(document.activeElement))) return; // #66: never redraw under a streaming answer
  overviewSig = sig;
  const c = st.channel;
  const numbers = c.numbers || [{ id: 'main', label: 'Main', ...c }];
  const pillFor = (x) => h('span', { class: `pill ${x.status === 'open' ? 'ok' : ['qr', 'reconnecting', 'starting'].includes(x.status) ? 'warn' : 'bad'}` }, x.status === 'open' ? 'connected' : x.status === 'qr' ? 'waiting for scan' : x.status.replace('_', ' '));
  const numberBlock = (n) => {
    const body = { number: n.id };
    const linked = n.status === 'open';
    const dmSel = h('select', { disabled: !can('admin'), style: 'max-width:260px', 'aria-label': `Direct messages to ${n.label} go to`, onchange: (e) => tryApi(() => api('PUT', `/api/whatsapp/numbers/${n.id}`, { dmAgent: e.target.value }), 'Saved') },
      h('option', { value: '' }, 'Default agent (see Settings)'), st.agents.map((b) => h('option', { value: b.id, selected: n.dmAgent === b.id }, b.name)));
    return h('div', { class: 'number-card' },
      h('div', { class: 'row spread' }, h('div', {}, h('b', {}, n.label), linked ? h('span', { class: 'muted small num' }, `  +${(n.me || '').split(':')[0].split('@')[0]}`) : null), pillFor(n)),
      linked ? h('div', { class: 'small muted' }, `Connected since ${time(n.since)}`) : null,
      !linked && can('admin') ? (checklistNext() === 'whatsapp' ? h('p', { class: 'small muted' }, 'Waiting for the scan: the QR code is in ', h('a', { href: '#overview/start', onclick: goTo('#overview/start') }, 'Getting started'), ' above.') : linkNumberBox(n)) : null,
      n.lastError && !linked ? h('p', { class: 'small', style: 'color:var(--bad)' }, n.lastError) : null,
      linked ? [h('label', {}, 'Direct messages to this number go to'), dmSel] : null,
      h('div', { class: 'row mut', style: 'margin-top:10px' },
        h('button', { class: 'btn small', onclick: () => tryApi(() => api('POST', '/api/whatsapp/restart', body), 'Reconnecting…') }, linked ? 'Reconnect' : 'New QR code'),
        linked ? h('button', { class: 'btn small danger', onclick: () => confirm(`Unlink ${n.label}? Agents stop answering on it until you scan a new QR code.`) && tryApi(() => api('POST', '/api/whatsapp/logout', body), 'Unlinked') }, 'Unlink') : null,
        n.id !== 'main' && can('owner') ? h('button', { class: 'btn small danger', onclick: () => confirm(`Remove the number “${n.label}”? Its chats keep their memory; agents bound to them stop answering there.`) && tryApi(async () => { await api('DELETE', `/api/whatsapp/numbers/${n.id}`); refreshStatus(); }, 'Removed') }, 'Remove') : null));
  };
  const newLabel = h('input', { placeholder: 'Name, e.g. Shop', onfocus: () => (S.overviewBusy = true), onblur: () => (S.overviewBusy = false) });
  const wa = h('div', { class: 'card', id: 'ov-whatsapp', 'data-jump': 'whatsapp' },
    h('div', { class: 'row spread' }, h('h2', {}, 'WhatsApp numbers'), h('span', { class: 'pill' }, `${numbers.filter((n) => n.status === 'open').length}/${numbers.length} connected`)),
    numbers.map(numberBlock),
    can('owner') ? h('details', { class: 'mut' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, '+ Add another number'),
      h('p', { class: 'small muted' }, 'Each number is linked as its own device. Use a dedicated number for agents.'),
      h('div', { class: 'row' }, newLabel, h('button', { class: 'btn primary', onclick: () => tryApi(async () => { await api('POST', '/api/whatsapp/numbers', { label: newLabel.value }); S.overviewBusy = false; await refreshStatus(); renderOverview(); }, 'Added — scan its QR') }, 'Add number'))) : null);
  const control = h('div', { class: 'card' }, h('h2', {}, 'Control'),
    h('div', { class: 'row spread nowrap' }, h('div', {}, h('b', {}, 'Pause all agents'), h('div', { class: 'small muted' }, 'Stops all replies and scheduled posts')),
      toggle(st.settings.paused, (v) => optimistic(() => { st.settings.paused = v; }, () => api('POST', '/api/settings', { paused: v }), v ? 'Paused' : 'Resumed'))),
    h('div', { class: 'tscroll' }, h('table', { style: 'margin-top:10px' }, h('tbody', {}, st.agents.length ? st.agents.map((b) => h('tr', {},
      h('td', {}, h('b', {}, b.name), h('div', { class: 'small muted' }, `${b.chats} chat(s)`)),
      h('td', { style: 'text-align:right' }, toggle(b.enabled, (v) => optimistic(() => { b.enabled = v; }, () => api('PUT', `/api/agents/${b.id}`, { enabled: v }), `${b.name} ${v ? 'on' : 'off'}`))))) : h('tr', {}, h('td', { class: 'muted' }, 'No agents yet. ', h('a', { href: '#agents' }, 'Create one')))))),
    st.pending ? h('p', {}, h('span', { class: 'pill warn' }, `${st.pending} pending confirmation(s)`)) : null);
  const reusedUpdates = soft && $('#updates-box')?.childElementCount ? $('#updates-box') : null;
  const updateBanner = (reusedUpdates && $('#ov-update-banner')) || h('div', { id: 'ov-update-banner' });
  const server = h('div', { class: 'card' }, h('h2', {}, 'Server'),
    h('div', { class: 'tscroll' }, h('table', {}, h('tbody', {}, [['Version', st.version], ['Uptime', ago(Date.now() - st.uptimeSec * 1000), 'ov-uptime'], ['Memory', `${st.memoryMb} MB`, 'ov-memory'], ['Node', st.node]]
      .map(([k, v, id]) => h('tr', {}, h('td', { class: 'muted small' }, k), h('td', id ? { id } : {}, v)))))),
    reusedUpdates || h('div', { id: 'updates-box' }));
  const recent = h('div', { class: 'card', style: 'grid-column:1/-1' }, h('div', { class: 'row spread' }, h('h2', {}, 'Recent activity'), h('button', { class: 'btn small', onclick: () => show('activity') }, 'All activity')),
    h('ul', { class: 'feed', id: 'recent' }, S.feed.slice(0, 8).map(feedItem)));
  const hr = new Date().getHours();
  const hello = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const live = st.agents.filter((b) => b.enabled).length; const open = numbers.filter((n) => n.status === 'open').length;
  const allGood = !st.settings.paused && open === numbers.length && live > 0;
  const led = (label, ok, value) => h('div', { class: 'led' }, h('span', { class: `dot ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}` }), label, h('b', {}, value));
  // 062: the first thing that is missing, in the order Getting started asks for it
  const noModel = S.checklist?.steps?.find((x) => x.id === 'provider')?.done === false;
  const headline = st.settings.paused ? 'All agents are paused' : !open ? 'Link your WhatsApp number to begin' : noModel ? 'Connect an AI model so agents can answer'
    : !st.agents.length ? 'Create your first agent' : st.enabledChats === 0 ? 'No chat is switched on — agents stay silent' : allGood ? 'Everything is running'
      : open < numbers.length ? 'A WhatsApp number needs attention' : live ? 'Running, with something to check' : 'No agent is switched on yet';
  const hero = h('div', { class: 'card console' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${hello} · ${S.user.username}`),
      h('h2', {}, headline)),
    h('div', { class: 'leds' },
      led('WhatsApp', open === numbers.length ? true : open ? null : false, `${open}/${numbers.length}`),
      led('Agents', st.settings.paused ? false : live ? true : null, st.settings.paused ? 'paused' : `${live} live`),
      led('Chats on', st.enabledChats ? true : null, String(st.enabledChats ?? 0)),
      led('Waiting', st.pending ? null : true, String(st.pending || 0))),
    st.enabledChats === 0 && open && st.agents.length && !checklistActive() ? h('div', { style: 'grid-column:1/-1' }, h('div', { class: 'note warn', style: 'margin:0' }, 'For security, every chat starts Off. Open ', h('a', { href: '#chats' }, 'Chats'), ' and switch on the groups and people your agents should answer.')) : null);
  const silencesSlot = h('div', { id: 'ov-silences-slot', 'data-jump': 'quiet', style: `grid-column:1/-1${S.silences?.length ? '' : ';display:none'}` }, S.silences?.length ? silencesCard(S.silences, refreshSilences) : null);
  $('#main').replaceChildren(hero, updateBanner, checklistBox(), drawInstallHint(h('div', { id: 'ov-install' })), h('div', { class: 'grid' }, noModel ? null : askCard(), wa, control, server, silencesSlot, recent));
  refreshSilences();
  if (!S.feed.length) api('GET', '/api/activity?limit=50').then((rows) => { S.feed = rows; $('#recent')?.replaceChildren(...rows.slice(0, 8).map(feedItem)); }).catch(() => {});
  if (can('owner') && !reusedUpdates) renderUpdates($('#updates-box'));
}
// ---------- install on your phone (061): the panel is an installable web app ----------
const INSTALL_KEY = 'duniya.installHint';
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; drawInstallHint(); }); // Chrome, Edge, Samsung
addEventListener('appinstalled', () => { S.installPrompt = null; localStorage.setItem(INSTALL_KEY, 'installed'); drawInstallHint(); });
/** Phones and tablets only, never once installed or hidden on this device. Returns the box. */
function drawInstallHint(box = $('#ov-install')) {
  if (!box) return box;
  if (installed() || !matchMedia('(pointer: coarse)').matches || localStorage.getItem(INSTALL_KEY) || checklistActive()) return box.replaceChildren(), box; // 062: not during Getting started
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const hide = () => { localStorage.setItem(INSTALL_KEY, 'hidden'); box.replaceChildren(); };
  const install = async () => {
    const p = S.installPrompt; S.installPrompt = null; p.prompt();
    if ((await p.userChoice.catch(() => null))?.outcome === 'accepted') hide(); else drawInstallHint(box);
  };
  box.replaceChildren(h('div', { class: 'card install-hint' },
    h('div', { class: 'row nowrap' }, logo(), h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'eyebrow' }, 'Install on your phone'), h('h2', { style: 'margin:2px 0 0' }, 'Duniya on your home screen')),
      h('button', { class: 'btn small', title: 'Hide this hint on this device', onclick: hide }, 'Hide')),
    h('p', { class: 'small muted' }, 'Opens full screen like an app, with live status, Ask and confirmations. Nothing to download from a store.'),
    S.installPrompt ? h('button', { class: 'btn primary', onclick: install }, 'Install')
      : ios ? h('p', { class: 'small', style: 'margin-bottom:0' }, 'Tap ', h('b', {}, 'Share'), ' (the square with the arrow), then ', h('b', {}, 'Add to Home Screen'), '.')
        : h('p', { class: 'small', style: 'margin-bottom:0' }, 'Open the browser menu (⋮) and choose ', h('b', {}, 'Install app'), ' or ', h('b', {}, 'Add to Home screen'), '.')));
  return box;
}
