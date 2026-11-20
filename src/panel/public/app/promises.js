// What agents learn about people (091): an agent's Promises & people section (track promises, how it follows up,
// suggested family ties; its open promises with Done / Drop), a person's Preferences (language, usual hours, app — each
// Automatic or set by you) and Commitments, and People → Suggestions (accept / reject a family tie). Loaded on demand.
import { api, can, h, tryApi } from './core.js';
import { helpLink } from './shared.js';

const LANGS = { en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch' };
const WORD = { partner: 'partner', child: 'child', parent: 'parent', sibling: 'sibling' };

/** Commitments as rows: who · what · due, with Done and Drop. `after()` redraws. */
function commitmentRows(list, after, { who = true } = {}) {
  if (!list.length) return h('p', { class: 'small muted' }, 'No open promises.');
  const set = (c, status, msg) => tryApi(async () => { await api('PUT', `/api/commitments/${c.id}`, { status }); after(); }, msg);
  return h('ul', { class: 'lessons' }, list.map((c) => h('li', {}, h('div', { class: 'lesson-text' }, `${who ? `${c.who || 'Someone'}: ` : ''}${c.what}`),
    h('div', { class: 'small muted' }, [c.due ? `due ${new Date(`${c.due}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}` : 'no date', c.chatName || '', c.followedUpAt ? 'reminded' : ''].filter(Boolean).join(' · '), ' ',
      c.msg ? h('a', { href: `#chats/${encodeURIComponent(c.chat)}/messages/${c.msg}` }, 'See the message ›') : null),
    can('admin') ? h('div', { class: 'row fx' }, h('button', { class: 'btn small', type: 'button', onclick: () => set(c, 'done', 'Marked done') }, 'Done'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => set(c, 'dropped', 'Dropped') }, 'Drop')) : null)));
}

/** The agent page's section. `x`: the page state; `save(patch)` saves agent fields. */
export function promisesView(x, save) {
  const admin = can('admin');
  const pr = { track: false, followUp: 'chat', ...(x.c.promises || {}) };
  const track = h('input', { type: 'checkbox', checked: pr.track, disabled: !admin });
  const follow = h('select', { disabled: !admin, 'aria-label': 'Follow up when a promise is due' },
    [['chat', 'In the chat where it was promised'], ['dm', 'In a direct message'], ['off', 'Don’t follow up']].map(([v, l]) => h('option', { value: v, selected: pr.followUp === v }, l)));
  const cues = h('input', { type: 'checkbox', checked: !!x.c.cues, disabled: !admin });
  const store = () => save({ promises: { track: track.checked, followUp: follow.value }, cues: cues.checked });
  track.onchange = store; follow.onchange = store; cues.onchange = store;
  const list = h('div', {});
  const load = () => api('GET', `/api/commitments?agent=${x.enc}`).then((r) => list.replaceChildren(commitmentRows(r, load))).catch(() => {});
  load();
  return h('div', {},
    h('p', { class: 'small muted' }, 'In its chats that are on, it notices promises ("I’ll bring the speakers on Friday") and reminds gently when one is due; when the chat shows it done, it is marked done. ', helpLink('intelligence.md#commitments')),
    h('label', { class: 'tick' }, track, ' Track promises'), h('label', { class: 'field' }, h('span', {}, 'When one is due'), follow),
    h('label', { class: 'tick' }, cues, ' Suggest family ties in People from what people say ("my daughter Vedika")'),
    h('div', { class: 'sblock' }, h('h3', {}, 'Open promises'), list));
}

/** A person's Preferences and Commitments blocks. `p`: the person (with prefs and commitments); `redraw()` after a change. */
export function personBlocks(p, redraw) {
  const admin = can('admin');
  const pf = p.prefs || { auto: {} };
  const put = (patch) => tryApi(async () => { await api('PUT', `/api/people/${encodeURIComponent(p.id)}/prefs`, patch); redraw(); }, 'Saved');
  const lang = h('select', { disabled: !admin, 'aria-label': 'Language', onchange: (e) => put({ language: e.target.value }) },
    h('option', { value: 'auto', selected: pf.auto.language }, `Automatic${pf.auto.language && pf.languageName ? ` (${pf.languageName})` : ''}`),
    Object.entries(LANGS).map(([k, v]) => h('option', { value: k, selected: !pf.auto.language && pf.language === k }, v)));
  const hourOpts = (sel, lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((i) => h('option', { value: i, selected: sel === i }, `${String(i).padStart(2, '0')}:00`));
  const from = h('select', { disabled: !admin, 'aria-label': 'Usual hours from' }, hourOpts(pf.hours?.from ?? 9, 0, 23));
  const to = h('select', { disabled: !admin, 'aria-label': 'Usual hours to' }, hourOpts(pf.hours?.to ?? 20, 1, 24));
  from.onchange = to.onchange = () => put({ hoursFrom: Number(from.value), hoursTo: Number(to.value) });
  const app = h('select', { disabled: !admin, 'aria-label': 'Preferred app', onchange: (e) => put({ app: e.target.value }) },
    h('option', { value: 'auto', selected: pf.auto.app }, `Automatic${pf.auto.app && pf.app ? ` (${pf.app === 'telegram' ? 'Telegram' : 'WhatsApp'})` : ''}`),
    h('option', { value: 'whatsapp', selected: !pf.auto.app && pf.app === 'whatsapp' }, 'WhatsApp'), h('option', { value: 'telegram', selected: !pf.auto.app && pf.app === 'telegram' }, 'Telegram'));
  const hoursLine = pf.hours ? `${pf.auto.hours ? 'Usually writes' : 'Messages go'} ${String(pf.hours.from).padStart(2, '0')}:00–${String(pf.hours.to).padStart(2, '0')}:00` : 'Not known yet';
  const prefs = h('div', { class: 'sblock' }, h('h3', {}, 'Preferences ', helpLink('people.md#preferences')),
    h('p', { class: 'small muted' }, 'Learned from their messages in chats that are on; agents answer in their language, and messages to lists go in their hours and on their app. Change any of it.'),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', {}, 'Language'), lang), h('label', { class: 'field' }, h('span', {}, 'App'), app)),
    h('div', { class: 'small' }, hoursLine, pf.auto.hours ? '' : ' (set by you)'),
    admin ? h('div', { class: 'row' }, from, to, pf.auto.hours ? null : h('button', { class: 'btn small ghost', type: 'button', onclick: () => put({ hoursFrom: 'auto' }) }, 'Automatic')) : null);
  const promises = p.commitments?.length ? h('div', { class: 'sblock' }, h('h3', {}, 'Commitments'), commitmentRows(p.commitments, redraw, { who: false })) : null;
  return [prefs, promises];
}

/** People → Suggestions: family ties heard in conversations, accept or reject (null when there are none). */
export async function tieSuggestionsCard(after) {
  const list = await api('GET', '/api/people-suggestions').catch(() => []);
  if (!list.length) return null;
  const decide = (s, accept) => tryApi(async () => { await api('POST', `/api/people-suggestions/${encodeURIComponent(s.key)}`, { accept }); after(); }, accept ? 'Tie added' : 'Won’t be suggested again');
  return h('div', { class: 'sblock', id: 'people-suggestions' }, h('h3', {}, `Suggestions (${list.length}) `, helpLink('people.md#suggestions')),
    h('ul', { class: 'lessons' }, list.map((s) => h('li', {}, h('div', { class: 'lesson-text' }, `${s.name} is ${s.personName}’s ${s.word}?`),
      h('div', { class: 'small muted' }, `${WORD[s.kind] || s.kind} · heard in a chat`),
      can('admin') ? h('div', { class: 'row fx' }, h('button', { class: 'btn small primary', type: 'button', onclick: () => decide(s, true) }, 'Add tie'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => decide(s, false) }, 'No')) : null))));
}
