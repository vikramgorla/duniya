// The owner's morning brief and suggested next steps (090). Overview's Suggested card: what the server sees that you may
// want to do — people who have not paid (send reminders), a paused send (resume), an update (install); Approve opens
// the usual preview or applies the one safe step it names, Dismiss hides it for good (for that same thing). Settings →
// Owner assistant → Morning brief: on/off, time, sections and a preview. Loaded when either is shown.
import { api, can, h, toast, tryApi } from './core.js';
import { helpLink } from './shared.js';

const SECTION = { payments: 'Payments due or overdue', questions: 'Questions for you nobody answered', commitments: 'Commitments due', birthdays: 'Birthdays',
  stuck: 'Things that are stuck (sends, model errors, updates, confirmations)', people: 'New people in your chats' };
/** Settings → Owner assistant → Morning brief; saves as you change it. */
export async function briefBlock() {
  const b = await api('GET', '/api/owner-assistant/brief');
  const admin = can('admin');
  const on = h('input', { type: 'checkbox', checked: b.enabled, disabled: !admin });
  const at = h('input', { type: 'time', value: b.at, disabled: !admin, 'aria-label': 'Time of the morning brief' });
  const ticks = b.all.map((k) => { const i = h('input', { type: 'checkbox', checked: b.sections.includes(k), disabled: !admin }); i.dataset.k = k; return i; });
  const when = h('p', { class: 'small muted' });
  const out = h('div', {});
  const paint = (s) => { when.textContent = s.enabled ? `Daily at ${s.sendsAt}${s.sendsAt !== s.at ? ` (your sending hours start then; ${s.at} is outside them)` : ''}, in your own WhatsApp chat. Nothing to report: no message.` : 'Off.'; };
  const save = () => tryApi(async () => paint(await api('PUT', '/api/owner-assistant/brief', { enabled: on.checked, at: at.value, sections: ticks.filter((i) => i.checked).map((i) => i.dataset.k) })), 'Saved');
  for (const el of [on, at, ...ticks]) el.onchange = save;
  paint(b);
  const preview = h('button', { class: 'btn small', type: 'button', onclick: () => tryApi(async () => {
    const r = await api('GET', '/api/owner-assistant/brief/preview');
    out.replaceChildren(h('pre', { class: 'small' }, r.text || 'Nothing to report right now — no brief would go out.'),
      r.suggestions.length ? h('p', { class: 'small muted' }, `With ${r.suggestions.length} suggested step${r.suggestions.length === 1 ? '' : 's'}, each with a confirm code.`) : null);
  }) }, 'Preview');
  return h('div', { class: 'sblock', id: 'morning-brief' }, h('h3', {}, 'Morning brief ', helpLink('owner-assistant.md#morning-brief')),
    h('label', { class: 'inline' }, on, 'Send me a short brief every morning'), h('div', { class: 'row' }, at, preview), when,
    h('div', { class: 'brief-secs' }, ticks.map((i) => h('label', { class: 'tick' }, i, ` ${SECTION[i.dataset.k] || i.dataset.k}`))), out);
}

/** Fill Overview's slot with the Suggested card (hidden when there is nothing to suggest). */
export async function fillSuggested(slot) {
  const list = await api('GET', '/api/suggestions').catch(() => []);
  slot.style.display = list.length ? '' : 'none';
  if (!list.length) { slot.replaceChildren(); return; }
  const key = (s) => encodeURIComponent(s.key);
  const row = (s) => {
    const li = h('li', { class: 'sug' }, h('span', { class: 'sug-text' }, s.title),
      h('span', { class: 'row fx' },
        h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
          const r = await tryApi(() => api('POST', `/api/suggestions/${key(s)}/approve`));
          if (!r) return;
          li.remove(); if (!slot.querySelector('.sug')) slot.style.display = 'none';
          if (r.href) location.hash = r.href.slice(1); else toast('Done');
        } }, s.action.tool === 'send_to_people' ? 'Review and send' : s.action.href ? 'Open' : 'Approve'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => tryApi(async () => {
          await api('POST', `/api/suggestions/${key(s)}/dismiss`); li.remove(); if (!slot.querySelector('.sug')) slot.style.display = 'none';
        }, 'Dismissed — it won’t come back for this') }, 'Dismiss')));
    return li;
  };
  slot.replaceChildren(h('div', { class: 'card', id: 'ov-suggested' },
    h('div', { class: 'sec-head' }, h('h2', {}, 'Suggested'), helpLink('owner-assistant.md#suggested-next-steps')),
    h('ul', { class: 'sug-list' }, list.map(row))));
}
