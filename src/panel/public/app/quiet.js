// Why agents stayed silent (#34): Overview card and fixes. Module of the panel (063).
// ---------- why agents stayed silent (#34) ----------
import { $, S, ago, api, can, h, refreshStatus, tryApi } from './core.js';
import { quietLine } from './shared.js';
/** One-click fix for a silence, or null. `after` runs once fixed (the record is cleared). */
export function silenceFix(s, after, { onChats = false } = {}) {
  if (!can('admin')) return null;
  const agentHref = (sub = '') => `#agents/${encodeURIComponent(s.agent)}${sub}`;
  const act = (label, fn, ok) => h('button', { class: 'btn small', onclick: () => tryApi(async () => {
    await fn(); await api('DELETE', `/api/silences?chat=${encodeURIComponent(s.chat)}&reason=${s.reason}`); refreshStatus(); after?.();
  }, ok) }, label);
  const link = (label, href) => h('a', { class: 'btn small', href }, label);
  switch (s.fix) {
    case 'chat_on': return act('Switch chat on', () => api('PUT', `/api/chats/${encodeURIComponent(s.chat)}/prefs`, { enabled: true }), 'On — agents may answer here');
    case 'agent_on': return s.agent ? act(`Switch ${s.agentName || 'agent'} on`, () => api('PUT', `/api/agents/${encodeURIComponent(s.agent)}`, { enabled: true }), 'Agent on') : null;
    case 'resume': return act('Resume agents', () => api('POST', '/api/settings', { paused: false }), 'Resumed');
    case 'triggers': return s.agent ? link('Open triggers', agentHref('/triggers')) : null;
    case 'agent': return s.agent ? link('Who may message it', agentHref('/dm')) : null;
    case 'assign': return onChats ? null : link('Choose an agent', '#chats');
    case 'models': return link('Open Models', '#models');
    case 'usage': return link('Open Usage', '#usage');
    case 'server': return link('Open Server', '#server');
    default: return null;
  }
}
export function silencesCard(rows, after) {
  const top = rows.slice(0, 6);
  if (!top.length) return null;
  return h('div', { class: 'card', id: 'ov-silences' },
    h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'Why agents stayed quiet'), h('span', { class: 'pill' }, 'last 7 days')),
    h('p', { class: 'small muted' }, 'Messages an agent did not answer, and why. Only counts are kept — never the messages.'),
    h('table', { class: 'stack flat' }, h('tbody', {}, top.map((s) => h('tr', {},
      h('td', { 'data-label': '' }, h('b', {}, s.chatName || 'Unnamed chat'), s.agentName ? h('span', { class: 'small muted' }, ` · ${s.agentName}`) : null,
        h('div', { class: `small${s.reason === 'not_addressed' ? ' muted' : ''}`, style: s.reason === 'not_addressed' ? '' : 'color:var(--warn)', title: s.explain }, quietLine(s)),
        h('div', { class: 'small muted' }, `${s.explain} Last ${ago(s.lastTs)} ago${s.sampleSender ? ` · e.g. ${s.sampleSender}` : ''}`)),
      h('td', { 'data-label': '', style: 'text-align:right;white-space:nowrap' }, silenceFix(s, after),
        can('admin') ? h('button', { class: 'btn small mut', title: 'Forget this record', onclick: () => tryApi(async () => { await api('DELETE', `/api/silences?chat=${encodeURIComponent(s.chat)}&reason=${s.reason}${s.agent ? `&agent=${encodeURIComponent(s.agent)}` : ''}`); after?.(); }, 'Cleared') }, 'Clear') : null))))));
}
export async function refreshSilences() {
  const slot = $('#ov-silences-slot'); if (!slot) return;
  const r = await api('GET', '/api/silences?days=7&limit=6').catch(() => null);
  if (!r) return;
  const sig = JSON.stringify(r.silences.map((s) => [s.chat, s.agent, s.reason, s.count, s.chatName]));
  if (sig === S.silencesSig && (slot.childElementCount > 0) === (r.silences.length > 0)) return;
  S.silences = r.silences; S.silencesSig = sig;
  slot.replaceChildren(...[silencesCard(r.silences, refreshSilences)].filter(Boolean));
  slot.style.display = r.silences.length ? '' : 'none';
}

/**
 * Follow an update to the end, whatever happens to this page: checks every 3 s; notices when the service goes away
 * (restart) and when it answers again, then reloads the page on the new version. Never stops on a failed request;
 * gives up waiting after 5 minutes and reloads anyway. Only one watcher runs.
 */
