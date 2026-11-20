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
  // 075: WhatsApp numbers live under Settings → WhatsApp; Overview keeps one status chip that links there
  const wa = st.channel.channels?.find((x) => x.id === 'whatsapp') || { state: 'on' };
  const numbers = st.channel.numbers || [];
  // 075: one calm row per number; linking, adding and switching off are on the channel's page
  const pill = (n) => h('span', { class: `pill ${n.status === 'open' ? 'ok' : ['qr', 'reconnecting', 'starting'].includes(n.status) ? 'warn' : 'bad'}` }, n.status === 'open' ? 'connected' : n.status === 'qr' ? 'waiting for scan' : n.status.replace('_', ' '));
  const channelsCard = h('div', { class: 'card' }, h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, 'WhatsApp'), h('a', { class: 'small', href: '#settings/whatsapp' }, 'Details ›')),
    numbers.length ? h('ul', { class: 'ctl-list' }, numbers.map((n) => h('li', {}, h('div', {}, h('b', {}, n.label), h('div', { class: 'small muted num' }, n.status === 'open' ? `+${(n.me || '').split(':')[0].split('@')[0]}` : 'Open Details to link it')), pill(n))))
      : h('p', { class: 'small muted' }, wa.state === 'off' ? 'Switched off: agents do not answer on WhatsApp.' : 'Not linked yet: Getting started shows the QR code.'));
  // 064: avatars, a live pulse per agent (reading… / answered, from the activity stream) and named switches
  const pause = (v) => optimistic(() => { st.settings.paused = v; }, () => api('POST', '/api/settings', { paused: v }), v ? 'All agents paused' : 'Agents resumed', () => pause(!v));
  const control = h('div', { class: 'card' }, h('h2', {}, 'Control'),
    h('div', { class: 'row spread nowrap' }, h('b', {}, 'Pause all agents'),
      toggle(st.settings.paused, pause, false, 'Pause all agents')),
    st.agents.length ? h('ul', { class: 'ctl-list' }, st.agents.map((b) => h('li', {},
      avatar(b.name, b.id, b.enabled && !st.settings.paused ? '' : 'off'),
      // 073: the name opens the agent; Review is one tap away
      h('div', {}, h('a', { class: 'ctl-name', href: `#agents/${encodeURIComponent(b.id)}` }, b.name), h('div', { class: 'small muted' }, plural(b.chats, 'chat'), ' ', pulse(b.id))),
      can('admin') ? h('a', { class: 'qfix', href: `#agents/${encodeURIComponent(b.id)}/review`, 'aria-label': `Review ${b.name}'s answers` }, 'Review') : null,
      toggle(b.enabled, (v) => optimistic(() => { b.enabled = v; }, () => api('PUT', `/api/agents/${b.id}`, { enabled: v }), `${b.name} ${v ? 'on' : 'off'}`), false, `${b.name} on`))))
      : emptyState('agents', 'No agents yet', 'An agent answers in the chats you give it.', h('a', { class: 'btn small', href: '#agents' }, 'Create an agent')),
    st.pending ? h('p', {}, h('a', { class: 'pill warn', href: '#pending' }, `${plural(st.pending, 'change')} waiting for a confirm`)) : null);
  const reusedUpdates = soft && $('#updates-box')?.childElementCount ? $('#updates-box') : null;
  const updateBanner = (reusedUpdates && $('#ov-update-banner')) || h('div', { id: 'ov-update-banner' });
  // 068: one calm line instead of a table; details are on the Server screen. 073: updates are one row too.
  const server = h('div', { class: 'card' }, h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, 'Server'), h('a', { class: 'small', href: '#server' }, 'Details ›')),
    h('p', { class: 'small muted num', style: 'margin:6px 0 0' }, `${st.version} · up `, h('span', { id: 'ov-uptime' }, ago(Date.now() - st.uptimeSec * 1000)), ' · ', h('span', { id: 'ov-memory' }, `${st.memoryMb} MB`)),
    reusedUpdates || h('div', { id: 'updates-box' }));
  const recent = h('div', { class: 'card', style: 'grid-column:1/-1' }, h('div', { class: 'row spread' }, h('h2', {}, 'Recent activity'), h('button', { class: 'btn small', onclick: () => show('activity') }, 'All activity')),
    feedList('recent', S.feed.slice(0, 5)),
    S.feed.length ? null : emptyState('activity', 'Quiet so far', 'What your agents read, answer and change shows up here live.'));
  const hr = new Date().getHours();
  const hello = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const live = st.agents.filter((b) => b.enabled).length; const open = numbers.filter((n) => n.status === 'open').length;
  const allGood = !st.settings.paused && open > 0 && open === numbers.length && live > 0;
  const led = (ok, text, href) => h(href ? 'a' : 'span', { class: 'led', ...(href ? { href } : {}) }, h('span', { class: `dot ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}`, 'aria-hidden': 'true' }), text);
  // 062: the first thing that is missing, in the order Getting started asks for it
  const noModel = S.checklist?.steps?.find((x) => x.id === 'provider')?.done === false;
  const tgOk = (st.channel.channels || []).some((c) => c.id !== 'whatsapp' && c.connected > 0);
  const headline = st.settings.paused ? 'All agents are paused' : wa.state === 'off' && !tgOk ? 'WhatsApp is switched off' : !open && !tgOk ? 'Link WhatsApp or Telegram to begin' : noModel ? 'Connect an AI model so agents can answer'
    : !st.agents.length ? 'Create your first agent' : st.enabledChats === 0 ? 'No chat is switched on — agents stay silent' : allGood ? 'Everything is running'
      : open < numbers.length ? 'A WhatsApp number needs attention' : live ? 'Running, with something to check' : 'No agent is switched on yet';
  const hero = h('div', { class: 'card console' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${hello} · ${S.user.username}`),
      h('h2', {}, headline)),
    checklistActive() ? null : allGood && !st.pending ? h('p', { class: 'small muted calm-line' }, [numbers.length > 1 ? `WhatsApp ${open}/${numbers.length} connected` : 'WhatsApp connected', `${plural(live, 'agent')} live`, `${plural(st.enabledChats, 'chat')} on`].join(' · ')) : h('div', { class: 'leds' },
      // 066: plain sentence-case chips ("2 agents live"), not mono caps
      led(numbers.length && open === numbers.length ? true : open ? null : false, wa.state === 'off' ? 'WhatsApp off' : numbers.length > 1 ? `WhatsApp ${open}/${numbers.length} connected` : open ? 'WhatsApp connected' : 'WhatsApp not linked', '#settings/whatsapp'),
      led(st.settings.paused ? false : live ? true : null, st.settings.paused ? 'Agents paused' : live ? `${plural(live, 'agent')} live` : 'No agent live'),
      led(st.enabledChats ? true : null, st.enabledChats ? `${plural(st.enabledChats, 'chat')} on` : 'No chat on'),
      led(st.pending ? null : true, st.pending ? `${st.pending} waiting for a confirm` : 'Nothing waiting')),
    st.enabledChats === 0 && open && st.agents.length && !checklistActive() ? h('div', { style: 'grid-column:1/-1' }, h('div', { class: 'note warn', style: 'margin:0' }, 'For security, every chat starts Off. Open ', h('a', { href: '#chats' }, 'Chats'), ' and switch on the groups and people your agents should answer.')) : null);
  const suggestedSlot = h('div', { id: 'ov-suggested-slot', style: 'grid-column:1/-1;display:none' }); // 090: filled by owner-brief.js
  const silencesSlot = h('div', { id: 'ov-silences-slot', 'data-jump': 'quiet', style: `grid-column:1/-1${S.silences?.length ? '' : ';display:none'}` }, S.silences?.length ? silencesCard(S.silences, refreshSilences) : null);
  $('#main').replaceChildren(hero, whatsNewBox(), updateBanner, checklistBox(), drawInstallHint(h('div', { id: 'ov-install' })), h('div', { class: 'grid' }, noModel ? null : askCard(), checklistActive() && !open ? null : channelsCard, checklistActive() && !st.agents.length ? null : control, server, suggestedSlot, silencesSlot, recent));
  refreshSilences();
  if (can('admin') && !checklistActive()) import('./owner-brief.js').then((m) => m.fillSuggested(suggestedSlot)).catch(() => {});
  // the feed and the chat names it shows (064) load after the first paint
  Promise.resolve(S.feed.length ? S.feed : api('GET', '/api/activity?limit=50'))
    .then((rows) => { S.feed = rows; if (rows.length) { $('#recent')?.replaceWith(feedList('recent', rows.slice(0, 5))); $('#recent + .empty')?.remove(); } }).catch(() => {});
  if (can('owner') && !reusedUpdates) renderUpdates($('#updates-box'));
}
// 065: release notes load on demand (./releases.js).
/** "Updated to vX — see what's new": shown once per person after an update (the server keeps what each person saw). */
function whatsNewBox() {
  const w = S.status?.whatsNew;
  if (!w) return null;
  const box = h('div', { class: 'card whatsnew', role: 'status' });
  const seen = () => { box.remove(); if (S.status) S.status.whatsNew = null; api('POST', '/api/releases/seen', {}).catch(() => {}); };
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
