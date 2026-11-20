// What agents learn about people (091): an agent's Promises & people section (track promises, how it follows up,
// suggested family ties; its open promises), a person's Preferences (language, usual hours, app — each Automatic or set
// by you) and Commitments, People → Suggestions (accept / reject a family tie), and (092) People → Promises: every
// agent's promises with filters (open, overdue, done, all; person, agent, chat). One row everywhere: the person, what,
// when it is due, the chat and the message it came from; Done / Reopen, and ⋯ Due date, Edit, Drop, Delete. Loaded on demand.
import { $, S, api, ask, can, emptyState, field, h, menu, tryApi } from './core.js';
import { helpLink } from './shared.js';
import { day, peopleNav } from './people.js';

const WORD = { partner: 'partner', child: 'child', parent: 'parent', sibling: 'sibling' };
const enc = encodeURIComponent;
const STATUS = { done: ['ok', 'done'], dropped: ['', 'dropped'] };

/** When it is due, in words: "overdue since 3 Nov" (warn), "due tomorrow", "no date". */
const dueLine = (c) => (!c.due ? 'no date' : c.overdue ? h('span', { class: 'pill warn' }, `overdue since ${day(c.due)}`) : `due ${day(c.due, true)}`);

/** Promises as rows: (person ·) what, then due · chat · the message · agent; Done or Reopen, ⋯ more. `after()` redraws. */
function commitmentRows(list, after, { who = true, agent = false, empty = 'No open promises.' } = {}) {
  if (!list.length) return h('p', { class: 'small muted' }, empty);
  const put = (c, patch, msg) => tryApi(async () => { await api('PUT', `/api/commitments/${c.id}`, patch); after(); }, msg);
  const editDue = async (c) => {
    const input = h('input', { type: 'date', value: c.due || '' });
    if (await ask({ title: 'Due date', text: 'The agent reminds them gently once when it is due (if its follow-ups are on). Empty: no date.', ok: 'Save', body: field('Due', input) })) put(c, { due: input.value }, 'Due date saved');
  };
  const editWhat = async (c) => {
    const input = h('input', { value: c.what, maxlength: 200, autocomplete: 'off' });
    if (await ask({ title: 'What was promised', ok: 'Save', body: field('What', input) })) put(c, { what: input.value }, 'Saved');
  };
  const remove = async (c) => {
    if (await ask({ title: 'Delete this promise?', text: `“${c.what}” goes for good. To keep it but stop reminders, use Drop.`, ok: 'Delete', danger: true }))
      tryApi(async () => { await api('DELETE', `/api/commitments/${c.id}`); after(); }, 'Deleted');
  };
  const item = (label, onclick) => h('button', { class: 'btn small', type: 'button', onclick }, label);
  return h('ul', { class: 'lessons promises' }, list.map((c) => h('li', {},
    h('div', { class: 'lesson-text' }, who ? [c.person ? h('a', { href: `#people/${enc(c.person)}` }, c.who || 'Someone') : c.who || 'Someone', ': '] : null, c.what,
      STATUS[c.status] ? [' ', h('span', { class: `pill ${STATUS[c.status][0]}` }, STATUS[c.status][1])] : null),
    h('div', { class: 'small muted' }, [dueLine(c), c.chatName ? h('a', { href: `#chats/${enc(c.chat)}` }, c.chatName) : null,
      c.msg ? h('a', { href: `#chats/${enc(c.chat)}/messages/${c.msg}` }, 'the message ›') : null, agent && c.agentName ? c.agentName : null,
      c.followedUpAt && c.status === 'open' ? 'reminded' : null].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))),
    can('admin') ? h('div', { class: 'row fx' }, c.status === 'open'
      ? h('button', { class: 'btn small', type: 'button', onclick: () => put(c, { status: 'done' }, 'Marked done') }, 'Done')
      : h('button', { class: 'btn small', type: 'button', onclick: () => put(c, { status: 'open' }, 'Reopened') }, 'Reopen'),
    menu(`More for “${c.what}”`, item('Due date…', () => editDue(c)), item('Edit…', () => editWhat(c)),
      c.status === 'open' ? item('Drop (no reminder)', () => put(c, { status: 'dropped' }, 'Dropped')) : null, h('button', { class: 'btn small danger', type: 'button', onclick: () => remove(c) }, 'Delete…'))) : null)));
}

// ---------- People → Promises (092) ----------
const F = { status: 'open', agent: '', person: '', chat: '' };
const seen = { person: new Map(), chat: new Map() }; // the people and chats met in loaded lists: the filter choices
/** People → Promises. `pre`: "agent:<id>", "person:<id>" or "chat:<id>" from a link (the agent's page, a person's page). */
export async function renderPromises(pre = '') {
  const [k, ...v] = String(pre).split(':');
  if (k in F && k !== 'status' && v.length) { F.agent = ''; F.person = ''; F.chat = ''; F[k] = v.join(':'); }
  const q = Object.entries(F).filter(([, x]) => x).map(([key, x]) => `${key}=${enc(x)}`).join('&');
  const list = await api('GET', `/api/commitments?${q}`);
  for (const c of list) { if (c.person) seen.person.set(c.person, c.who || 'Someone'); seen.chat.set(c.chat, c.chatName || 'a chat'); }
  const agents = (S.status?.agents || []).filter((a) => a.promises || a.id === F.agent);
  const redraw = () => renderPromises();
  const set = (key) => (e) => { F[key] = e.target.value; redraw(); };
  const pick = (key, label, all, opts) => h('select', { 'aria-label': label, onchange: set(key) }, h('option', { value: '' }, all),
    [...opts].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => h('option', { value: id, selected: F[key] === id }, name)));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, [['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Done'], ['all', 'All']]
    .map(([val, l]) => h('button', { type: 'button', class: F.status === val ? 'on' : '', 'aria-pressed': String(F.status === val), onclick: () => { F.status = val; redraw(); } }, l)));
  const tools = h('div', { class: 'pfilters' }, seg, pick('person', 'Person', 'Everyone', seen.person), agents.length > 1 || F.agent ? pick('agent', 'Agent', 'All agents', agents.map((a) => [a.id, a.name])) : null,
    pick('chat', 'Chat', 'All chats', seen.chat));
  const filtered = F.person || F.agent || F.chat;
  const words = { open: 'open', overdue: 'overdue', done: 'done', all: '' }[F.status];
  const none = filtered ? h('p', { class: 'muted' }, `No ${words} promises match.`.replace('  ', ' '))
    : emptyState('list', `No ${words} promises`.replace('  ', ' '), agents.length ? 'When someone in a chat that is on says “I’ll bring the speakers on Friday”, it shows here; the agent reminds them gently when it is due.'
      : 'Switch on Track promises on an agent’s page (Promises & people): it notices promises in its chats and reminds gently when one is due.');
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav('people/promises'),
    h('div', { class: 'sec-head' }, h('h2', {}, `Promises (${list.length}${list.length === 200 ? '+' : ''})`), helpLink('people.md#promises')),
    tools, filtered ? h('button', { class: 'btn small ghost', type: 'button', style: 'margin:4px 0 6px', onclick: () => { F.person = ''; F.agent = ''; F.chat = ''; redraw(); } }, 'Clear filters') : null,
    list.length ? commitmentRows(list, redraw, { agent: agents.length > 1 }) : none));
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
    h('div', { class: 'sblock' }, h('h3', {}, 'Open promises ', h('a', { class: 'small', href: `#people/promises/agent:${x.enc}` }, 'All promises ›')), list));
}

/** A person's Preferences and Commitments blocks. `p`: the person (with prefs and commitments); `redraw()` after a change. */
export function personBlocks(p, redraw) {
  const admin = can('admin');
  const pf = p.prefs || { auto: {} };
  const put = (patch) => tryApi(async () => { await api('PUT', `/api/people/${encodeURIComponent(p.id)}/prefs`, patch); redraw(); }, 'Saved');
  const lang = h('select', { disabled: !admin, 'aria-label': 'Language', onchange: (e) => put({ language: e.target.value }) },
    h('option', { value: 'auto', selected: pf.auto.language }, `Automatic${pf.auto.language && pf.languageName ? ` (${pf.languageName})` : ''}`),
    Object.entries(pf.languages || {}).map(([k, v]) => h('option', { value: k, selected: !pf.auto.language && pf.language === k }, v)));
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
  const promises = p.commitments?.length ? h('div', { class: 'sblock' }, h('h3', {}, 'Commitments ', h('a', { class: 'small', href: `#people/promises/person:${enc(p.id)}` }, 'All promises ›')), commitmentRows(p.commitments, redraw, { who: false, agent: true })) : null;
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
