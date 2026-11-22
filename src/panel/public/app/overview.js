// Overview screen (the landing screen) and the install-on-your-phone hint. Module of the panel (063).
// ---------- overview ----------
import { feedList } from './activity.js';
import { askCard } from './ask.js';
import { $, S, ago, api, avatar, can, emptyState, h, logo, optimistic, pulse, show, toggle } from './core.js';
import { plural } from './shared.js';
import { refreshSilences, silencesCard } from './quiet.js';
import { checklistActive, checklistBox, refreshChecklist } from './start.js';
import { renderUpdates } from './updates.js';
let overviewSig = '';
// 062: the first thing that is missing, in the order Getting started asks for it; then how things run
function headline(x) {
  const { st, off, down } = x;
  if (st.settings.paused) return 'All agents are paused';
  if (!x.accounts.length && off) return `${off} ${off.includes(' and ') ? 'are' : 'is'} switched off`;
  if (!x.open) return `Link ${x.chans.map((c) => c.label).join(' or ')} to begin`;
  if (x.noModel) return 'Connect an AI model so agents can answer';
  if (!st.agents.length) return 'Create your first agent';
  if (st.enabledChats === 0) return 'No chat is switched on — agents stay silent';
  if (x.allGood) return 'Everything is running';
  if (down) return `${down.app} ${down.label} needs attention`;
  return x.live ? 'Running, with something to check' : 'No agent is switched on yet';
}
const word = (a) => (a.status === 'open' ? 'connected' : a.status === 'qr' ? 'waiting for scan' : a.status.replace('_', ' '));

// Every channel's accounts (WhatsApp numbers, a Telegram bot), the agents that are on, what is missing
function standing(st) {
  const accounts = st.channel.accounts || []; const chans = st.channel.channels || [];
  const apps = [...new Set(accounts.map((a) => a.app))];
  const of = (app, status) => accounts.filter((a) => a.app === app && (!status || a.status === status)).length;
  const open = accounts.filter((a) => a.status === 'open').length;
  const down = accounts.find((a) => a.status !== 'open'); const live = st.agents.filter((b) => b.enabled).length;
  return { st, accounts, chans, apps, open, down, live, off: chans.filter((c) => c.state === 'off').map((c) => c.label).join(' and '),
    // "WhatsApp connected", "WhatsApp 2/2 connected", "WhatsApp 2/2 · Telegram connected"
    connected: `${apps.map((app) => (of(app) > 1 ? `${app} ${of(app, 'open')}/${of(app)}` : app)).join(' · ')} connected`,
    noModel: S.checklist?.steps?.find((s) => s.id === 'provider')?.done === false, allGood: !st.settings.paused && open > 0 && !down && live > 0 };
}
// one calm row per account; linking and adding are on the channel's page
function channelsCard({ accounts, apps, off }) {
  const pill = (a) => h('span', { class: `pill ${a.status === 'open' ? 'ok' : ['qr', 'reconnecting', 'starting'].includes(a.status) ? 'warn' : 'bad'}` }, word(a));
  const line = (a) => (a.status !== 'open' ? 'Open Details to link it' : [apps.length > 1 || !Number(a.me) ? a.app : '', Number(a.me) ? `+${a.me}` : ''].filter(Boolean).join(' · '));
  return h('div', { class: 'card' }, h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, apps.length === 1 ? apps[0] : 'Channels'), h('a', { class: 'small', href: apps.length === 1 ? `#settings/${accounts[0].channel}` : '#settings' }, 'Details ›')),
    accounts.length ? h('ul', { class: 'ctl-list' }, accounts.map((a) => h('li', {}, h('div', {}, h('b', {}, a.label), h('div', { class: 'small muted num' }, line(a))), pill(a))))
      : h('p', { class: 'small muted' }, off ? `Switched off: agents do not answer on ${off}.` : 'Not linked yet: Getting started shows how.'));
}
// 064: avatars, a live pulse per agent (reading… / answered, from the activity stream) and named switches
function controlCard(st) {
  const pause = (v) => optimistic(() => { st.settings.paused = v; }, () => api('POST', '/api/settings', { paused: v }), v ? 'All agents paused' : 'Agents resumed', () => pause(!v));
  const agent = (b) => h('li', {}, avatar(b.name, b.id, b.enabled && !st.settings.paused ? '' : 'off'),
    // 073: the name opens the agent; Review is one tap away
    h('div', {}, h('a', { class: 'ctl-name', href: `#agents/${encodeURIComponent(b.id)}` }, b.name), h('div', { class: 'small muted' }, plural(b.chats, 'chat'), ' ', pulse(b.id))),
    can('admin') ? h('a', { class: 'qfix', href: `#agents/${encodeURIComponent(b.id)}/review`, 'aria-label': `Review ${b.name}'s answers` }, 'Review') : null,
    toggle(b.enabled, (v) => optimistic(() => { b.enabled = v; }, () => api('PUT', `/api/agents/${b.id}`, { enabled: v }), `${b.name} ${v ? 'on' : 'off'}`), false, `${b.name} on`));
  return h('div', { class: 'card' }, h('h2', {}, 'Control'),
    h('div', { class: 'row spread nowrap' }, h('b', {}, 'Pause all agents'), toggle(st.settings.paused, pause, false, 'Pause all agents')),
    st.agents.length ? h('ul', { class: 'ctl-list' }, st.agents.map(agent))
      : emptyState('agents', 'No agents yet', 'An agent answers in the chats you give it.', h('a', { class: 'btn small', href: '#agents' }, 'Create an agent')),
    st.pending ? h('p', {}, h('a', { class: 'pill warn', href: '#pending' }, `${plural(st.pending, 'change')} waiting for a confirm`)) : null);
}
// 068: one calm line instead of a table; details are on the Server screen. 073: updates are one row too.
const serverCard = (st, updates) => h('div', { class: 'card' }, h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, 'Server'), h('a', { class: 'small', href: '#server' }, 'Details ›')),
  h('p', { class: 'small muted num', style: 'margin:6px 0 0' }, `${st.version} · up `, h('span', { id: 'ov-uptime' }, ago(Date.now() - st.uptimeSec * 1000)), ' · ', h('span', { id: 'ov-memory' }, `${st.memoryMb} MB`)),
  updates || h('div', { id: 'updates-box' }));
const recentCard = () => h('div', { class: 'card', style: 'grid-column:1/-1' }, h('div', { class: 'row spread' }, h('h2', {}, 'Recent activity'), h('button', { class: 'btn small', onclick: () => show('activity') }, 'All activity')),
  feedList('recent', S.feed.slice(0, 5)),
  S.feed.length ? null : emptyState('activity', 'Quiet so far', 'What your agents read, answer and change shows up here live.'));
// 066: plain sentence-case chips ("2 agents live"), not mono caps
function leds({ st, accounts, chans, open, down, live, off, connected }) {
  const led = (ok, text, href) => h(href ? 'a' : 'span', { class: 'led', ...(href ? { href } : {}) }, h('span', { class: `dot ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}`, 'aria-hidden': 'true' }), text);
  const channels = down ? `${down.app} ${down.label}: ${word(down)}` : open ? connected : off ? `${off} off` : 'Nothing linked';
  const agents = st.settings.paused ? 'Agents paused' : live ? `${plural(live, 'agent')} live` : 'No agent live';
  return h('div', { class: 'leds' }, led(open && !down ? true : open ? null : false, channels, `#settings/${(down || accounts[0])?.channel || chans[0]?.id}`),
    led(st.settings.paused ? false : live ? true : null, agents),
    led(st.enabledChats ? true : null, st.enabledChats ? `${plural(st.enabledChats, 'chat')} on` : 'No chat on'),
    led(st.pending ? null : true, st.pending ? `${st.pending} waiting for a confirm` : 'Nothing waiting'));
}
function heroCard(x) {
  const { st, open, live, connected } = x;
  const hr = new Date().getHours();
  const hello = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const calm = x.allGood && !st.pending;
  return h('div', { class: 'card console' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${hello} · ${S.user.username}`), h('h2', {}, headline(x))),
    checklistActive() ? null : calm ? h('p', { class: 'small muted calm-line' }, [connected, `${plural(live, 'agent')} live`, `${plural(st.enabledChats, 'chat')} on`].join(' · ')) : leds(x),
    st.enabledChats === 0 && open && st.agents.length && !checklistActive() ? h('div', { style: 'grid-column:1/-1' }, h('div', { class: 'note warn', style: 'margin:0' }, 'For security, every chat starts Off. Open ', h('a', { href: '#chats' }, 'Chats'), ' and switch on the groups and people your agents should answer.')) : null);
}
// the status poll changed nothing visible: uptime and memory are updated in place
function refreshInPlace(st, sig) {
  if (sig !== overviewSig || !$('#ov-uptime')) return false;
  $('#ov-uptime').textContent = ago(Date.now() - st.uptimeSec * 1000); $('#ov-memory').textContent = `${st.memoryMb} MB`;
  if (Date.now() - (S.checklistAt || 0) > 15000) { refreshChecklist(); refreshSilences(); }
  return true;
}
// after the first paint: suggested steps, the feed and the chat names it shows (064), the update row
function fillLater(suggestedSlot, reusedUpdates) {
  refreshSilences();
  if (can('admin') && !checklistActive()) import('./owner-brief.js').then((m) => m.fillSuggested(suggestedSlot)).catch(() => {}); // an extra card: Overview stands without it
  Promise.resolve(S.feed.length ? S.feed : api('GET', '/api/activity?limit=50'))
    .then((rows) => { S.feed = rows; if (rows.length) { $('#recent')?.replaceWith(feedList('recent', rows.slice(0, 5))); $('#recent + .empty')?.remove(); } }).catch(() => {}); // the card keeps "Quiet so far"; the stream fills it
  if (can('owner') && !reusedUpdates) renderUpdates($('#updates-box'));
}
// #66: never redraw under a streaming answer
const inUse = () => S.overviewBusy || S.ask?.busy || $('#main')?.contains(document.activeElement);
const silencesSlot = () => h('div', { id: 'ov-silences-slot', 'data-jump': 'quiet', style: `grid-column:1/-1${S.silences?.length ? '' : ';display:none'}` }, S.silences?.length ? silencesCard(S.silences, refreshSilences) : null);
export async function renderOverview(soft) {
  const st = S.status; if (!st) return;
  // The 5-second status poll only rebuilds the page when something visible changed (rebuilding every time made it flicker)
  const { uptimeSec, memoryMb, ...rest } = st;
  const sig = JSON.stringify({ ...rest, channel: { ...rest.channel, since: undefined } });
  if (soft && (refreshInPlace(st, sig) || inUse())) return;
  overviewSig = sig;
  const x = standing(st); const guided = checklistActive();
  const reusedUpdates = soft && $('#updates-box')?.childElementCount ? $('#updates-box') : null;
  const updateBanner = (reusedUpdates && $('#ov-update-banner')) || h('div', { id: 'ov-update-banner' });
  const suggestedSlot = h('div', { id: 'ov-suggested-slot', style: 'grid-column:1/-1;display:none' }); // 090: filled by owner-brief.js
  $('#main').replaceChildren(heroCard(x), whatsNewBox(), updateBanner, checklistBox(), drawInstallHint(h('div', { id: 'ov-install' })),
    h('div', { class: 'grid' }, x.noModel ? null : askCard(), guided && !x.open ? null : channelsCard(x), guided && !st.agents.length ? null : controlCard(st), serverCard(st, reusedUpdates), suggestedSlot, silencesSlot(), recentCard()));
  fillLater(suggestedSlot, reusedUpdates);
}
// 065: release notes load on demand (./releases.js).
/** "Updated to vX — see what's new": shown once per person after an update (the server keeps what each person saw). */
function whatsNewBox() {
  const w = S.status?.whatsNew;
  if (!w) return null;
  const box = h('div', { class: 'card whatsnew', role: 'status' });
  const seen = () => { box.remove(); if (S.status) S.status.whatsNew = null; api('POST', '/api/releases/seen', {}).catch(() => {}); }; // not saved: the box shows once more, nothing is lost
  box.append(h('span', { class: 'lmark c5', 'aria-hidden': 'true' }, '✦'),
    h('div', { class: 'whatsnew-main' }, h('b', {}, `Updated to ${w.to}`), h('span', { class: 'small muted' }, ` · from ${w.from}`)),
    h('button', { class: 'btn small primary', onclick: async () => { await (await import('./releases.js')).showReleaseNotes({ from: w.from, to: w.to, title: `What's new in ${w.to}` }); seen(); } }, "See what's new"),
    h('button', { class: 'btn small icon', 'aria-label': "Hide what's new", title: 'Hide', onclick: seen }, '✕'));
  return box;
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
    S.installPrompt ? h('button', { class: 'btn primary', onclick: install }, 'Install')
      : ios ? h('p', { class: 'small', style: 'margin-bottom:0' }, 'Tap ', h('b', {}, 'Share'), ' (the square with the arrow), then ', h('b', {}, 'Add to Home Screen'), '.')
        : h('p', { class: 'small', style: 'margin-bottom:0' }, 'Open the browser menu (⋮) and choose ', h('b', {}, 'Install app'), ' or ', h('b', {}, 'Add to Home screen'), '.')));
  return box;
}
