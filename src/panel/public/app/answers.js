// One agent answer, the same everywhere (072): 👍 / 👎 and, on a 👎, Teach… — in the agent's Review, a chat's Messages and
// an Activity reply. A rating is stored once (PUT /api/agents/<id>/review/<msg>); every copy on screen follows the change.
// Module of the panel (063), loaded with the screens that show answers.
import { api, can, dropCache, h, tryApi } from './core.js';
import { trunc } from './shared.js';

/** The words Teach starts the AI helper with; the cursor waits after "Better answer:". */
const teachText = (a) => `Someone asked: “${trunc(a.question?.text || '(no question found)', 300)}”\nIt answered: “${trunc(a.text, 400)}”\nBetter answer: `;

/**
 * The rating row of one answer. `a`: { id, agent, rating, text, question? }. `teach(text)`: what Teach does (the agent
 * page passes its own, so it redraws); `extra`: one more control at the end of the row (a link to where it was said).
 */
export function answerActions(a, { teach = null, extra = null } = {}) {
  const admin = can('admin');
  const row = h('div', { class: 'row rv-acts', 'data-answer': String(a.id) });
  const thumb = (v, label) => h('button', { class: 'btn small rv-t', type: 'button', 'aria-label': label, disabled: !admin, onclick: () => rate(a.rating === v ? 0 : v) }, v > 0 ? '👍' : '👎');
  const up = thumb(1, 'Good answer'); const down = thumb(-1, 'Wrong or unhelpful answer');
  const teachBtn = admin ? h('button', { class: 'btn small', type: 'button', onclick: () => (teach ? teach(teachText(a)) : import('./ai-helper.js').then((m) => m.changeWithAi(a.agent, teachText(a)))) },
    h('span', { class: 'ai-chip' }, 'AI'), ' Teach…') : null;
  /** @param {number} r */
  const paint = (r) => {
    a.rating = r;
    for (const [b, v] of [[up, 1], [down, -1]]) { b.classList.toggle('on', r === v); b.setAttribute('aria-pressed', String(r === v)); }
    teachBtn?.classList.toggle('hide', !(r < 0));
  };
  async function rate(v) {
    const r = await tryApi(() => api('PUT', `/api/agents/${encodeURIComponent(a.agent)}/review/${a.id}`, { rating: v }));
    if (!r) return;
    dropCache(); // the agent's 👍 / 👎 counts changed
    for (const el of document.querySelectorAll(`[data-answer="${CSS.escape(String(a.id))}"]`)) el.dispatchEvent(new CustomEvent('rated', { detail: r, bubbles: true }));
  }
  row.addEventListener('rated', (e) => paint(/** @type {CustomEvent} */ (e).detail.rating));
  row.append(up, down, teachBtn || '', extra || '');
  paint(a.rating || 0);
  return row;
}
/** 072: an open Activity entry: a reply's rating row, links to where it happened (the answer in the chat's messages,
 *  the chat, the agent) and the details. */
export function entryOpen(a, chatName, agentName) {
  const msg = a.type === 'message.out' && a.detail?.msg;
  const admin = can('admin');
  const chat = a.chat && encodeURIComponent(a.chat); const agent = a.agent && a.agent !== 'owner-assistant' ? encodeURIComponent(a.agent) : '';
  const links = [msg && admin ? h('a', { class: 'btn small', href: `#chats/${chat}/messages/${msg}` }, 'See in messages') : null,
    chat ? h('a', { class: 'btn small ghost', href: `#chats/${chat}` }, `Open ${chatName}`) : null,
    agent ? h('a', { class: 'btn small ghost', href: `#agents/${agent}` }, `Open ${agentName}`) : null].filter(Boolean);
  return [msg && agent && admin ? answerActions({ id: msg, agent: a.agent, rating: a.rating || 0, text: a.summary }) : null, links.length ? h('div', { class: 'row fx' }, links) : null,
    h('details', {}, h('summary', { class: 'small muted' }, 'Details'), h('pre', {}, JSON.stringify({ type: a.type, ...(a.detail ? { detail: a.detail } : {}) }, null, 2)))].filter(Boolean);
}
