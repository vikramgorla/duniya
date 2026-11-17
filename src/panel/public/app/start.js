// Getting started (#36, 062): the guided first run on Overview. Module of the panel (063).
// ---------- Getting started (#36, 062): a guided first run. The next step opens in place with its action ----------
import { $, S, api, can, dropCache, extLink, h, jumpToSub, openFind, refreshStatus, toast, tryApi } from './core.js';
import { PROVIDER_NAMES } from './names.js';
import { renderOverview } from './overview.js';
import { LINKS, saveSecretKey } from './shared.js';
const CHECK_ACTION = { whatsapp: 'Link WhatsApp', provider: 'Connect a model', agent: 'Create an agent', chat: 'Open Chats', reply: 'Open test console' };
export function goTo(href) {
  return (e) => { // links inside Overview scroll instead of reloading the page
    if (!href.startsWith('#overview/') || S.tab !== 'overview') return;
    e.preventDefault(); history.replaceState(null, '', href); jumpToSub();
  };
}
export const checklistActive = () => !!S.checklist && !S.checklist.complete && !S.checklist.dismissed;
export const checklistNext = () => (checklistActive() ? S.checklist.steps.find((x) => !x.done && !x.skipped)?.id : '');
/** Redraw Getting started after an action in it, and say so when the last step is done. */
async function checklistStep(okMsg, last = null) {
  if (okMsg) toast(okMsg);
  dropCache(); S.models = null;
  S.checklistDone = last ? { last } : { last: null }; // shown once if this was the last step (not kept over a reload)
  await refreshChecklist();
  if (!S.checklist?.complete) S.checklistDone = null;
}
/** The end of Getting started: what the test answered and where everyday things are. Closes for good. */
function doneCard(box, c) {
  const a = c.agent;
  return h('div', { class: 'card checklist', id: 'ov-start', 'data-jump': 'start' },
    h('div', { class: 'row spread nowrap' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Getting started'), h('h2', { style: 'margin:2px 0 0' }, 'All set: your agent is live')),
      h('button', { class: 'btn small', onclick: () => { S.checklistDone = null; box.replaceChildren(); } }, 'Close')),
    S.checklistDone.last ? h('div', { class: 'ck-do', style: 'margin:12px 0 0' }, S.checklistDone.last) : null,
    h('p', { class: 'small', style: 'margin-bottom:6px' }, a?.trigger ? ['Try it in WhatsApp: start a message with ', h('code', {}, a.trigger), ' in the group you switched on.'] : 'Try it in WhatsApp in the group you switched on.'),
    h('div', { class: 'row small', style: 'gap:8px' }, a ? h('a', { class: 'btn small primary', href: `#agents/${encodeURIComponent(a.id)}` }, `Edit ${a.name}`) : null,
      h('a', { class: 'btn small', href: '#chats' }, 'Switch on more chats'), h('button', { class: 'btn small', onclick: openFind }, 'Find anything (/)')));
}
/** Link a WhatsApp number: QR to scan, or a pairing code (Overview number cards and Getting started share it). */
export function linkNumberBox(n) {
  const phone = h('input', { placeholder: 'This number, e.g. 41791234567', inputmode: 'tel', onfocus: () => (S.overviewBusy = true), onblur: () => (S.overviewBusy = false), 'aria-label': 'Phone number to link' });
  return h('div', {},
    n.qrDataUrl ? h('div', {}, h('p', { class: 'small muted' }, 'On the phone of this number: WhatsApp → Settings → Linked devices → Link a device, then scan:'), h('img', { class: 'qr', src: n.qrDataUrl, alt: 'WhatsApp QR code' }))
      : h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Getting a QR code from WhatsApp…'),
    h('label', {}, 'Scanning is hard on the same phone? Link with a pairing code'), h('div', { class: 'row', style: 'max-width:460px' }, phone,
      h('button', { class: 'btn', onclick: () => tryApi(async () => { const r = await api('POST', '/api/whatsapp/pair', { number: n.id, phone: phone.value }); S.overviewBusy = false; toast(`Pairing code: ${r.code}`); refreshStatus(); }) }, 'Get code')),
    n.pairingCode ? h('p', {}, 'In WhatsApp → Linked devices → Link with phone number instead, enter ', h('span', { class: 'code' }, n.pairingCode)) : null);
}
/** 062: one box for any key: OpenRouter, Anthropic, OpenAI or a GitHub token for Copilot, recognised by how it starts. */
const KEY_KINDS = [
  [/^sk-or-/, PROVIDER_NAMES.openrouter, (key) => api('POST', '/api/providers/openrouter', { key, freeOnly: true })],
  [/^sk-ant-/, PROVIDER_NAMES.anthropic, (key) => saveSecretKey('ANTHROPIC_API_KEY')(key)],
  [/^github_pat_/, PROVIDER_NAMES.copilot, (token) => api('POST', '/api/providers/copilot', { token })],
  [/^sk-/, PROVIDER_NAMES.openai, (key) => saveSecretKey('OPENAI_API_KEY')(key)],
];
function quickProviderBox() {
  const key = h('input', { type: 'password', placeholder: 'sk-or-…, sk-ant-…, sk-… or github_pat_…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'API key', onfocus: () => (S.overviewBusy = true), onblur: () => (S.overviewBusy = false) });
  const msg = h('div', { class: 'small', style: 'min-height:1.2em;margin-top:4px' });
  const go = h('button', { class: 'btn primary' }, 'Connect');
  const connect = async (e) => {
    e.preventDefault(); const v = key.value.trim();
    const kind = KEY_KINDS.find(([re]) => re.test(v));
    if (!kind) { msg.textContent = v ? 'That is not a key Duniya recognises. OpenRouter keys start with sk-or-, Claude keys with sk-ant-, OpenAI keys with sk-. Other providers: Models.' : 'Paste a key first.'; return; }
    go.disabled = true; msg.replaceChildren(h('span', { class: 'spinner' }), ` Checking the ${kind[1]} key…`);
    try { await kind[2](v); S.overviewBusy = false; await checklistStep(`Connected: ${kind[1]}`); } catch (x) { msg.textContent = x.message; go.disabled = false; }
  };
  return h('div', {},
    h('form', { class: 'row', onsubmit: connect }, key, go), msg,
    h('div', { class: 'row small', style: 'gap:8px' }, h('span', { class: 'muted' }, 'No key yet?'),
      extLink(LINKS.openrouterKeys, 'Free key from OpenRouter'), h('a', { class: 'btn small', href: '#models/chatgpt' }, 'Use my ChatGPT plan'), h('a', { class: 'btn small', href: '#models' }, 'All options')));
}
async function quickAgentBox() {
  const templates = (await api('GET', '/api/templates').catch(() => [])).filter((t) => t.id !== 'blank');
  const make = (t) => tryApi(async () => { await api('POST', '/api/agents', { template: t.id, config: {} }); await checklistStep(`Created “${t.name}”`); });
  const { aiHelper } = await import('./ai-helper.js');
  const ai = await aiHelper({ bare: true, title: '', applyLabel: 'Create this agent', placeholder: 'Or describe it in your own words, e.g. “Helps our running club: keeps the weekly run schedule and answers where we meet.”',
    onApply: (r) => tryApi(async () => { await api('POST', '/api/agents', { config: r.proposed }); await checklistStep('Agent created'); }) });
  return h('div', {}, h('div', { class: 'tpl-chips' }, templates.map((t) => h('button', { class: 'choice', onclick: () => make(t) }, h('b', {}, t.name), h('span', {}, t.description || '')))),
    h('div', { style: 'margin-top:12px' }, ai));
}
async function quickChatBox(agent) {
  const chats = (await api('GET', '/api/chats').catch(() => [])).filter((c) => c.isGroup && c.size && !c.enabled);
  if (!chats.length) return h('p', { class: 'small muted' }, 'No groups yet. Your groups appear here once WhatsApp is linked; for a person, use ', h('a', { href: '#chats' }, 'Chats → Add a direct chat'), '.');
  const list = h('div', { class: 'quick-chats' });
  const draw = (q = '') => list.replaceChildren(...chats.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6).map((c) => h('div', { class: 'row spread nowrap' },
    h('div', { style: 'min-width:0' }, h('b', {}, c.name), h('div', { class: 'small muted' }, `${c.size} members`)),
    h('button', { class: 'btn small primary', onclick: () => tryApi(async () => {
      await api('POST', '/api/chats/bind', { chat: c.id, agent: agent.id, enable: true });
      refreshStatus(); await checklistStep(`${c.name} is on: ${agent.name} answers there`);
    }) }, 'Switch on'))));
  draw();
  return h('div', {}, h('p', { class: 'small', style: 'margin-top:0' }, `${agent.name} will answer in the group you choose. Members get a short privacy notice once.`),
    chats.length > 6 ? h('input', { type: 'search', placeholder: 'Find a group', 'aria-label': 'Find a group', oninput: (e) => draw(e.target.value), onfocus: () => (S.overviewBusy = true), onblur: () => (S.overviewBusy = false) }) : null, list);
}
function quickTestBox(agent) {
  const q = h('input', { placeholder: `Ask ${agent.name} something, e.g. “What can you do?”`, 'aria-label': 'Test message', onfocus: () => (S.overviewBusy = true), onblur: () => (S.overviewBusy = false) });
  const out = h('div', {});
  const send = h('button', { class: 'btn primary' }, 'Send');
  const go = async (e) => {
    e.preventDefault(); const text = q.value.trim() || 'What can you do?';
    send.disabled = true; out.replaceChildren(h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ` ${agent.name} is thinking…`));
    try {
      const r = await api('POST', `/api/agents/${encodeURIComponent(agent.id)}/test`, { text });
      const talk = () => h('div', { class: 'chat-mini' }, h('div', { class: 'bubble me' }, text), h('div', { class: 'bubble agent' }, r.reply || '(no reply)'));
      out.replaceChildren(talk());
      S.overviewBusy = false; await checklistStep('', talk());
    } catch (x) { out.replaceChildren(h('div', { class: 'note bad' }, x.message)); }
    send.disabled = false;
  };
  return h('div', {}, h('form', { class: 'row', onsubmit: go }, q, send), out,
    agent.trigger ? h('p', { class: 'small muted', style: 'margin-bottom:0' }, 'In WhatsApp, start a message with ', h('code', {}, agent.trigger), ' or mention the agent’s number.') : null);
}
async function stepBody(s, c) {
  const n = (S.status?.channel?.numbers || []).find((x) => x.status !== 'open');
  switch (s.id) {
    case 'whatsapp': return n ? linkNumberBox(n) : null;
    case 'provider': return quickProviderBox();
    case 'agent': return quickAgentBox();
    case 'chat': return c.agent ? quickChatBox(c.agent) : null;
    case 'reply': return c.agent ? quickTestBox(c.agent) : null;
    default: return null;
  }
}
async function drawChecklist(box, c) {
  const seq = (box.seq = (box.seq || 0) + 1); // a newer draw wins over a slower older one
  if (c?.complete && S.checklistDone) return box.replaceChildren(doneCard(box, c));
  if (!c || c.complete || c.dismissed) return box.replaceChildren();
  const next = c.steps.find((s) => !s.done && !s.skipped);
  const put = (body, msg) => tryApi(async () => { S.checklist = await api('PUT', '/api/checklist', body); drawChecklist(box, S.checklist); }, msg);
  const body = can('admin') && next ? await stepBody(next, c).catch(() => null) : null;
  if (box.seq !== seq) return;
  box.replaceChildren(h('div', { class: 'card checklist', id: 'ov-start', 'data-jump': 'start' },
    h('div', { class: 'row spread nowrap' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Getting started'), h('h2', { style: 'margin:2px 0 0' }, `${c.done} of ${c.total} done`)),
      can('admin') ? h('button', { class: 'btn small', title: 'Hide Getting started; it stays hidden', onclick: () => put({ dismissed: true }, 'Hidden. Settings → Getting started brings it back.') }, 'Hide') : null),
    h('div', { class: 'meter', style: 'margin-top:10px' }, h('i', { style: `width:${Math.round((c.done / c.total) * 100)}%` })),
    h('ol', { class: 'checklist-steps' }, c.steps.map((s, i) => h('li', { class: s.done ? 'done' : s === next ? 'next' : s.skipped ? 'skipped' : '' },
      h('span', { class: 'ck', 'aria-label': s.done ? 'done' : `step ${i + 1}` }, s.done ? '✓' : String(i + 1)),
      h('div', { class: 'ck-body' }, h('b', {}, s.title), s === next ? h('div', { class: 'small muted' }, s.hint) : null),
      s.done ? h('span', { class: 'pill ok' }, 'done')
        : s.skipped ? h('button', { class: 'btn small', title: 'Bring this step back', onclick: () => put({ unskip: s.id }) }, 'Skipped · undo')
          : s === next ? (can('admin') ? h('button', { class: 'btn small', title: 'Skip this step for now', onclick: () => put({ skip: s.id }) }, 'Skip') : h('a', { class: 'btn small primary', href: s.href, onclick: goTo(s.href) }, CHECK_ACTION[s.id] || 'Open'))
            : h('a', { class: 'btn small', href: s.href, onclick: goTo(s.href) }, CHECK_ACTION[s.id] || 'Open'),
      s === next && body ? h('div', { class: 'ck-do' }, body) : null)))));
}
export function checklistBox() {
  const box = h('div', { id: 'ov-checklist' });
  drawChecklist(box, S.checklist);
  refreshChecklist(box);
  return box;
}
export async function refreshChecklist(box = $('#ov-checklist')) {
  S.checklistAt = Date.now();
  const c = await api('GET', '/api/checklist').catch(() => null);
  if (!c || !box) return;
  if (JSON.stringify(c) === JSON.stringify(S.checklist) && box.childElementCount === ((c.complete && !S.checklistDone) || c.dismissed ? 0 : 1)) return; // nothing changed: no redraw
  if (box.contains(document.activeElement) && document.activeElement.matches('input,textarea') && document.activeElement.value) return; // never under typing
  const shape = (x) => JSON.stringify([x?.complete, x?.dismissed, x?.steps?.find((y) => y.id === 'provider')?.done, checklistNext()]);
  const before = shape(S.checklist);
  S.checklist = c;
  if (S.tab === 'overview' && before !== shape(c) && !S.ask?.busy) return renderOverview(); // the hero, Ask and the number card follow it
  await drawChecklist(box, c);
}

