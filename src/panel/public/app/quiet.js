// Why agents stayed silent (#34): Overview card and fixes. Module of the panel (063).
import { $, S, ago, api, avatar, can, h, menu, refreshStatus, tryApi } from './core.js';
/** One-click fix for a silence, or null: a small text link (073: never a bordered button). `after` runs once fixed
 *  (the record is cleared). Overview's why-quiet card and the chat page use it. */
function silenceFix(s, after, { onChats = false } = {}) {
  if (!can('admin')) return null;
  const agentHref = (sub = '') => `#agents/${encodeURIComponent(s.agent)}${sub}`;
  const act = (label, fn, ok) => h('button', { class: 'qfix', type: 'button', onclick: () => tryApi(async () => {
    await fn(); await api('DELETE', `/api/silences?chat=${encodeURIComponent(s.chat)}&reason=${s.reason}`); refreshStatus(); after?.();
  }, ok) }, label);
  const link = (label, href) => h('a', { class: 'qfix', href }, label);
  switch (s.fix) {
    case 'chat_on': return act('Switch on', () => api('PUT', `/api/chats/${encodeURIComponent(s.chat)}/prefs`, { enabled: true }), 'On — agents may answer here');
    case 'agent_on': return s.agent ? act(`Switch ${s.agentName || 'agent'} on`, () => api('PUT', `/api/agents/${encodeURIComponent(s.agent)}`, { enabled: true }), 'Agent on') : null;
    case 'resume': return act('Resume agents', () => api('POST', '/api/settings', { paused: false }), 'Resumed');
    // 089: it read the message and stayed out; the owner says it should have answered (a join-in lesson)
    case 'triggers': return s.reason === 'not_for_me' && s.agent ? h('button', { class: 'qfix', type: 'button', onclick: () => tryApi(() => api('POST', `/api/agents/${encodeURIComponent(s.agent)}/join-feedback`, { kind: 'missed', chat: s.chat }), 'Noted — a lesson on when to join in is proposed') }, 'It should have answered')
      : s.agent ? link('Open triggers', agentHref('/where/triggers')) : null;
    case 'agent': return s.agent ? link('Who may message it', agentHref('/where/dm')) : null;
    case 'assign': return onChats ? null : link('Choose an agent', `#chats/${encodeURIComponent(s.chat)}`);
    case 'models': return link('Open Models', '#models');
    case 'usage': return link('Open Usage', '#usage');
    case 'server': return link('Open Server', '#server');
    default: return null;
  }
}
/** One reason as a line: plain words · count · its fix (073). Not mentioned is muted, everything else amber. */
export const quietReason = (s, after, { onChats = false } = {}) => h('div', { class: 'q-line' },
  h('span', { class: s.reason === 'not_addressed' ? 'muted' : 'q-warn', title: `${s.explain} Last ${ago(s.lastTs)} ago.` }, `${s.label[0].toUpperCase()}${s.label.slice(1)} · ${s.count}×`),
  silenceFix(s, after, { onChats }), onChats ? h('span', { class: 'small muted q-why' }, s.explain) : null);
/** Why agents stayed quiet (073): grouped by chat — the chat's name (its page) and ⋯ Clear, then one line per reason. */
export function silencesCard(rows, after) {
  const byChat = new Map();
  for (const s of rows) { if (!byChat.has(s.chat)) byChat.set(s.chat, []); byChat.get(s.chat).push(s); }
  const top = [...byChat].slice(0, 5);
  if (!top.length) return null;
  const clear = (chat, name) => h('button', { class: 'btn small', type: 'button', onclick: () => tryApi(async () => { await api('DELETE', `/api/silences?chat=${encodeURIComponent(chat)}`); after?.(); }, `Cleared ${name}`) }, 'Clear');
  return h('div', { class: 'card', id: 'ov-silences' },
    h('div', { class: 'sec-head' }, h('h2', {}, 'Why agents stayed quiet'), h('span', { class: 'small muted' }, 'last 7 days')),
    h('ul', { class: 'quiet-list' }, top.map(([chat, list]) => {
      const name = list[0].chatName || 'Unnamed chat';
      return h('li', {}, avatar(name, chat, 's'),
        h('div', { class: 'q-main' }, h('a', { class: 'q-chat', href: `#chats/${encodeURIComponent(chat)}` }, name), list.map((s) => quietReason(s, after))),
        can('admin') ? menu(`More for ${name}`, clear(chat, name)) : null);
    })));
}
export async function refreshSilences() {
  const slot = $('#ov-silences-slot'); if (!slot) return;
  const r = await api('GET', '/api/silences?days=7&limit=20').catch(() => null);
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
