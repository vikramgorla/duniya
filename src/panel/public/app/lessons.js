// An agent's Lessons (089): what it learned from the owner's corrections — the ones waiting for an OK (Approve, Edit,
// Delete), the saved ones (answer lessons and when to join in, each for all its chats or one chat, with where it came
// from), Add a lesson, the two switches, and the join-in feedback per chat. Loaded with the agent page's Lessons section.
import { api, ask, can, h, time, tryApi } from './core.js';
import { helpLink } from './shared.js';

const SOURCE = { thumbs: 'from a 👎', correction: 'from your correction', needless: 'it did not need to answer', missed: 'it should have answered', owner: 'added by you' };
const FEEDBACK = { good: 'answered well', needless: 'did not need to answer', missed: 'should have answered' };

/** The Lessons section of agent `x` (its page's state); `save(patch)` saves agent fields; `done()` after a change. */
export function lessonsView(x, save) {
  const box = h('div', {}, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading lessons…'));
  const admin = can('admin');
  const path = `/api/agents/${x.enc}/lessons`;
  async function draw() {
    const r = await tryApi(() => api('GET', path));
    if (!r) return;
    x.b.lessonsToApprove = r.proposed.length;
    const scope = (l) => h('select', { 'aria-label': 'Where it applies', disabled: !admin, onchange: (e) => change(l, { chat: e.target.value }, 'Saved') },
      h('option', { value: '' }, 'All its chats'), r.chats.map((c) => h('option', { value: c.id, selected: l.chat === c.id }, c.name || 'a chat')),
      l.chat && !r.chats.some((c) => c.id === l.chat) ? h('option', { value: l.chat, selected: true }, l.chatName || 'another chat') : null);
    const change = (l, patch, msg) => tryApi(async () => { await api('PUT', `${path}/${l.id}`, patch); await draw(); }, msg);
    const edit = async (l) => {
      const t = h('textarea', { rows: 3, maxlength: 240, 'aria-label': 'Lesson' }, l.text);
      if (await ask({ title: 'Edit lesson', ok: 'Save', body: t })) change(l, { text: t.value }, 'Saved');
    };
    const del = (l) => tryApi(async () => { await api('DELETE', `${path}/${l.id}`); await draw(); }, 'Lesson deleted');
    const where = (l) => [l.kind === 'join' ? 'When to join in' : '', SOURCE[l.source] || '', time(l.createdAt)].filter(Boolean).join(' · ');
    const from = (l) => (l.msg && l.chat ? h('a', { href: `#chats/${encodeURIComponent(l.chat)}/messages/${l.msg}` }, 'See the message ›')
      : l.msg ? h('a', { href: `#agents/${x.enc}/review` }, 'In Review ›') : null);
    const row = (l, proposed) => h('li', { class: 'lesson' }, h('div', { class: 'lesson-text' }, l.text),
      h('div', { class: 'small muted' }, where(l), ' ', from(l)),
      admin ? h('div', { class: 'row fx' }, proposed ? h('button', { class: 'btn small primary', type: 'button', onclick: () => change(l, { status: 'active' }, 'Lesson approved') }, 'Approve') : null,
        scope(l), h('button', { class: 'btn small', type: 'button', onclick: () => edit(l) }, 'Edit'),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Delete lesson: ${l.text.slice(0, 40)}`, onclick: () => del(l) }, proposed ? 'Dismiss' : 'Delete')) : null);
    const on = h('input', { type: 'checkbox', checked: r.settings?.enabled !== false, disabled: !admin });
    const auto = h('input', { type: 'checkbox', checked: !!r.settings?.autoApprove, disabled: !admin });
    const setting = async () => { if (await save({ lessons: { enabled: on.checked, autoApprove: auto.checked } })) draw(); };
    on.onchange = setting; auto.onchange = setting;
    const text = h('input', { maxlength: 240, placeholder: 'e.g. Rides on Saturday leave from Morges station', 'aria-label': 'New lesson' });
    const add = h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); if (await tryApi(() => api('POST', path, { text: text.value }), 'Lesson saved')) { text.value = ''; draw(); } } },
      text, h('button', { class: 'btn' }, 'Add'));
    const fb = new Map();
    for (const f of r.feedback) { if (!fb.has(f.chat)) fb.set(f.chat, { name: f.chatName || 'a chat', parts: [] }); fb.get(f.chat).parts.push(`${f.count}× ${FEEDBACK[f.kind] || f.kind}`); }
    box.replaceChildren(
      h('p', { class: 'small muted' }, 'A 👎 on an answer, your corrections in a chat ("no, it’s Chary who…") and your feedback on when it joins in become short lessons. It follows the saved ones; the most relevant few go with each message. ', helpLink('intelligence.md#lessons')),
      h('label', { class: 'tick' }, on, ' Learn from my corrections'), h('label', { class: 'tick' }, auto, ' Save lessons without asking me'),
      r.proposed.length ? h('div', { class: 'sblock' }, h('h3', {}, `To approve (${r.proposed.length})`), h('ul', { class: 'lessons' }, r.proposed.map((l) => row(l, true)))) : null,
      h('div', { class: 'sblock' }, h('h3', {}, `Lessons (${r.active.length})`),
        r.active.length ? h('ul', { class: 'lessons' }, r.active.map((l) => row(l, false))) : h('p', { class: 'small muted' }, 'None yet.'), admin ? add : null),
      fb.size ? h('div', { class: 'sblock' }, h('h3', {}, 'When it joins in'), h('ul', { class: 'notes' }, [...fb].map(([, v]) => h('li', {}, h('b', {}, v.name), ` · ${v.parts.join(', ')}`)))) : null);
  }
  draw();
  return box;
}
