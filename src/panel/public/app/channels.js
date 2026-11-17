// Settings → Channels (075): one row per channel this server has (today WhatsApp), and the channel's page. The
// WhatsApp page holds the numbers (moved here from Overview): QR / pairing code, direct-message agent, add, unlink,
// remove; plus on/off and the memory the channel uses. Module of the panel (063).
import { S, api, ask, can, field, h, icon, menu, refreshStatus, time, toggle, tryApi } from './core.js';
import { plural } from './shared.js';
import { checklistNext, goTo, linkNumberBox } from './start.js';

/** A channel's state in a few words, for its row and its page. */
export function channelLine(c) {
  if (c.state === 'not_set_up') return 'Not set up yet';
  if (c.state === 'off') return 'Switched off';
  if (c.state === 'error') return 'Did not start';
  return c.accounts > 1 ? `${c.connected} of ${plural(c.accounts, 'number')} connected` : c.connected ? 'Connected' : 'Not connected';
}
const tone = (c) => (c.state === 'on' && c.connected === c.accounts && c.accounts ? 'ok' : c.state === 'on' ? 'warn' : c.state === 'off' ? '' : 'bad');
const memoryLine = (c) => (c.state !== 'on' ? 'Uses no memory while it is off: nothing is loaded and no connection is open.'
  : c.measuring ? 'Memory used: measured a minute after it starts.' : `Uses about ${c.memoryMb} MB of this server's memory.`);

/** Settings list rows: real channels only (no "coming soon" entries). */
export const channelItems = (st) => (st?.channel?.channels || []).map((c) => ({ id: c.id, name: c.label, sub: channelLine(c),
  mark: h('span', { class: 'lmark c3', 'aria-hidden': 'true' }, icon('chats')) }));

let pageSig = '';
/** The channel's page (Settings → <channel>). Redrawn in place by live status updates (refreshChannelPage). */
export function channelPage(id) {
  const box = h('div', { id: `ch-${id}`, style: 'display:grid;gap:16px' });
  drawPage(box, id);
  return box;
}
/** Live status (new QR, connected, switched off) redraws the open channel page, never under the owner's typing. */
export function refreshChannelPage() {
  const box = document.querySelector('[id^="ch-"]');
  if (!box || box.contains(document.activeElement)) return;
  drawPage(box, box.id.slice(3));
}
function drawPage(box, id) {
  const st = S.status; const c = st?.channel?.channels?.find((x) => x.id === id);
  if (!c) return;
  const sig = JSON.stringify([c, (st.channel.numbers || []).map((n) => ({ ...n, since: 0 })), st.agents.map((a) => a.id)]);
  if (box.childElementCount && sig === pageSig) return;
  pageSig = sig;
  box.replaceChildren(statusCard(c), c.state === 'on' && id === 'whatsapp' ? numbersCard(st) : null);
}

function statusCard(c) {
  const flip = async (on) => {
    if (!on && !(await ask({ title: `Switch ${c.label} off?`, text: `Agents stop answering on ${c.label} and its connections close, which frees its memory. Nothing is unlinked: switch it on again to continue.`, ok: `Switch ${c.label} off`, danger: true }))) return refreshChannelPage();
    await tryApi(async () => { await api('PUT', `/api/channels/${c.id}`, { enabled: on }); await refreshStatus(); }, on ? `${c.label} is on` : `${c.label} is off`);
  };
  const setUp = c.state === 'not_set_up';
  return h('div', { class: 'card' }, h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, c.label),
    !setUp && can('owner') ? toggle(c.state === 'on' || c.state === 'error', flip, false, `${c.label} on`) : null),
  h('p', { class: 'small', style: 'margin:6px 0 0' }, h('span', { class: `dot ${tone(c) || 'off'}`, 'aria-hidden': 'true' }), ` ${channelLine(c)}`),
  c.error ? h('div', { class: 'note bad' }, `It did not start: ${c.error}. It is tried again at the next restart; switching it off and on tries now.`) : null,
  setUp ? [h('p', { class: 'small muted' }, 'Link the phone number your agents answer from. Nothing of WhatsApp runs on this server until you do.'),
    can('admin') ? h('button', { class: 'btn primary', onclick: () => tryApi(async () => { await api('PUT', `/api/channels/${c.id}`, { enabled: true }); await refreshStatus(); }, 'Getting a QR code…') }, 'Link WhatsApp') : null]
    : h('p', { class: 'small muted', style: 'margin-bottom:0' }, memoryLine(c)),
  c.state === 'off' ? h('p', { class: 'small muted' }, 'Agents do not answer on WhatsApp while it is off.') : null);
}

const pillFor = (x) => h('span', { class: `pill ${x.status === 'open' ? 'ok' : ['qr', 'reconnecting', 'starting'].includes(x.status) ? 'warn' : 'bad'}` }, x.status === 'open' ? 'connected' : x.status === 'qr' ? 'waiting for scan' : x.status.replace('_', ' '));
function numberBlock(n, st) {
  const body = { number: n.id };
  const linked = n.status === 'open';
  const dmSel = h('select', { disabled: !can('admin'), style: 'max-width:260px', 'aria-label': `Direct messages to ${n.label} go to`, onchange: (e) => tryApi(() => api('PUT', `/api/whatsapp/numbers/${n.id}`, { dmAgent: e.target.value }), 'Saved') },
    h('option', { value: '' }, 'Default agent (see Chats & direct messages)'), st.agents.map((b) => h('option', { value: b.id, selected: n.dmAgent === b.id }, b.name)));
  return h('div', { class: 'number-card' },
    h('div', { class: 'row spread' }, h('div', {}, h('b', {}, n.label), linked ? h('span', { class: 'muted small num' }, `  +${(n.me || '').split(':')[0].split('@')[0]}`) : null), h('div', { class: 'btns' }, pillFor(n), can('admin') ? menu(`Actions for ${n.label}`,
      h('button', { class: 'btn small', onclick: () => tryApi(() => api('POST', '/api/whatsapp/restart', body), 'Reconnecting…') }, linked ? 'Reconnect' : 'New QR code'),
      linked ? h('button', { class: 'btn small danger', onclick: async () => (await ask({ title: `Unlink ${n.label}?`, text: 'Agents stop answering on this number until you scan a new QR code with its phone.', ok: 'Unlink number', danger: true })) && tryApi(() => api('POST', '/api/whatsapp/logout', body), 'Unlinked') }, 'Unlink') : null,
      n.id !== 'main' && can('owner') ? h('button', { class: 'btn small danger', onclick: async () => (await ask({ title: `Remove the number “${n.label}”?`, text: 'Its chats keep their memory, but agents bound to them stop answering there.', ok: 'Remove number', danger: true })) && tryApi(async () => { await api('DELETE', `/api/whatsapp/numbers/${n.id}`); refreshStatus(); }, 'Removed') }, 'Remove') : null) : null)),
    !linked && can('admin') ? (checklistNext() === 'whatsapp' ? h('p', { class: 'small muted' }, 'Waiting for the scan: the QR code is in ', h('a', { href: '#overview/start', onclick: goTo('#overview/start') }, 'Getting started'), ' on Overview.') : linkNumberBox(n)) : null,
    n.lastError && !linked ? h('p', { class: 'small', style: 'color:var(--bad)' }, n.lastError) : null,
    linked ? h('details', { class: 'num-dm' }, h('summary', { class: 'small muted' }, `Direct messages: ${st.agents.find((b) => b.id === n.dmAgent)?.name || 'default agent'} · connected since ${time(n.since)}`), field('Direct messages to this number go to', dmSel)) : null);
}
function numbersCard(st) {
  const numbers = st.channel.numbers || [];
  const newLabel = h('input', { placeholder: 'Name, e.g. Shop', 'aria-label': 'Name of the new number' });
  return h('div', { class: 'card', id: 'wa-numbers' },
    h('div', { class: 'row spread' }, h('h2', {}, 'Numbers'), h('span', { class: 'pill' }, `${numbers.filter((n) => n.status === 'open').length}/${numbers.length} connected`)),
    numbers.map((n) => numberBlock(n, st)),
    can('owner') ? h('details', { class: 'mut' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, '+ Add another number'),
      h('div', { class: 'row' }, newLabel, h('button', { class: 'btn primary', onclick: () => tryApi(async () => { await api('POST', '/api/whatsapp/numbers', { label: newLabel.value }); newLabel.value = ''; document.activeElement?.blur?.(); await refreshStatus(); }, 'Added — scan its QR') }, 'Add number'))) : null);
}
