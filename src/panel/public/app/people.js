// People (078, PRM core): the list, a person's page, and the People · Households · Lists switch. Households and Lists
// load from people-groups.js. Module of the panel (063). Text from WhatsApp or people is built from text nodes.
import { $, S, ago, api, ask, avatar, can, emptyState, field, h, icon, menu, tryApi } from './core.js';
import { helpLink } from './shared.js';
import { tagInput } from './tags.js';
let query = ''; let filter = '';
const PAGE = 100;
const APPS = { whatsapp: 'WhatsApp', telegram: 'Telegram' };
const enc = encodeURIComponent;
const personHref = (id) => `#people/${enc(id)}`;
const appsLine = (p) => [p.apps.map((a) => APPS[a] || a).join(' · ') || 'No app', p.lastContact ? `${ago(p.lastContact)} ago` : p.source === 'phone' ? 'from your phone' : ''].filter(Boolean).join(' · ');
/** One person row: avatar · name · apps and last contact · chevron (calm rows, 073). `end`: a control next to the row. */
export const personRow = (p, sub = appsLine(p), end = null) => h('li', { class: end ? 'has-end' : null }, h('a', { class: 'lrow', href: personHref(p.id || p.person) }, avatar(p.who || p.name, p.id || p.person, 's'),
  h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, p.name), sub ? h('span', { class: 'lrow-sub' }, sub) : null), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')), end);
/** People · Households · Lists, and Events · Orders when their module is on (081; one switch on each list). */
const modsOn = () => S.status?.settings?.modulesOn || [];
export const peopleNav = (on) => h('nav', { class: 'seg pnav', 'aria-label': 'People, households, lists and modules', style: 'margin-bottom:10px' },
  [['people', 'People'], ['people/households', 'Households'], ['people/lists', 'Lists'], modsOn().includes('events') && ['people/events', 'Events'], modsOn().includes('orders') && ['people/orders', 'Orders']].filter(Boolean).map(([href, l]) => h('a', { href: `#${href}`, class: href === on ? 'on' : null, 'aria-current': href === on ? 'page' : null }, l)));

/** Pick a person by typing a name: a search field with up to six matches. Returns { el, value() }. */
export function pickPerson(label, exclude = '') {
  let chosen = ''; let timer;
  const hits = h('div', { class: 'row', style: 'gap:6px;margin-top:6px' });
  const who = h('div', { class: 'small muted', role: 'status' });
  const input = h('input', { type: 'search', placeholder: 'Type a name or number', autocomplete: 'off' });
  input.oninput = () => { chosen = ''; who.textContent = ''; clearTimeout(timer); timer = setTimeout(async () => {
    const list = input.value.trim() ? await api('GET', `/api/people?q=${enc(input.value)}&limit=7`).catch(() => []) : [];
    hits.replaceChildren(...list.filter((p) => p.id !== exclude).slice(0, 6).map((p) => h('button', { type: 'button', class: 'btn small', onclick: () => {
      chosen = p.id; input.value = p.name; who.textContent = `Chosen: ${p.name}${p.phone ? ` · +${p.phone}` : ''}`; hits.replaceChildren();
    } }, p.name)), input.value.trim() && !list.length ? h('span', { class: 'small muted' }, 'Nobody in People matches.') : null);
  }, 250); };
  return { el: field(label, h('div', {}, input, hits, who)), value: () => chosen };
}

export async function renderPeople() {
  const [, a, b] = location.hash.slice(1).split('/').map(decodeURIComponent);
  if (a === 'households' || a === 'lists') return import('./people-groups.js').then((m) => m.renderGroup(a, b || ''));
  if (a === 'events' || a?.startsWith('orders')) return import('./events.js').then((m) => m.renderModule(a, b || '')); // 081
  if (a) return renderPerson(a);
  const [k, v] = filter.split(':');
  const page = (offset) => api('GET', `/api/people?q=${enc(query)}&${k ? `${k}=${enc(v)}&` : ''}limit=${PAGE}&offset=${offset}`);
  const [list, sum] = await Promise.all([page(0), api('GET', '/api/people/summary').catch(() => null)]);
  const search = h('input', { type: 'search', placeholder: 'Search name, number, tag or note', 'aria-label': 'Search people', value: query });
  let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { query = search.value; renderPeople().then(() => { const i = $('#main input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
  const opt = (value, label) => h('option', { value, selected: value === filter }, label);
  const pick = h('select', { 'aria-label': 'Show', onchange: () => { filter = pick.value; renderPeople(); } }, opt('', 'Everyone'),
    h('optgroup', { label: 'Source' }, opt('source:chat', 'From chats'), opt('source:phone', 'From your phone'), opt('source:owner', 'Added by you')),
    h('optgroup', { label: 'App' }, opt('app:whatsapp', 'On WhatsApp'), opt('app:telegram', 'On Telegram'), opt('app:none', 'No app (e.g. kids)')),
    sum?.tags.length ? h('optgroup', { label: 'Tag' }, sum.tags.map((t) => opt(`tag:${t.tag}`, `#${t.tag} (${t.count})`))) : null,
    sum?.lists.length ? h('optgroup', { label: 'List' }, sum.lists.map((l) => opt(`list:${l.id}`, l.name))) : null,
    sum?.households.length ? h('optgroup', { label: 'Household' }, sum.households.map((x) => opt(`household:${x.id}`, x.name))) : null,
    sum?.hidden ? opt('hidden:1', `Hidden (${sum.hidden})`) : null);
  const add = async () => {
    const F = { name: h('input', { autocomplete: 'off' }), phone: h('input', { placeholder: '+41 79 000 00 01', inputmode: 'tel', autocomplete: 'off' }), birthday: h('input', { placeholder: '2015-04-23', autocomplete: 'off' }) };
    if (!await ask({ title: 'Add a person', ok: 'Add person', body: [field('Name', F.name), field('Number (optional)', F.phone, 'Leave empty for a kid without a phone.'), field('Birthday (optional)', F.birthday)] })) return;
    const p = await tryApi(() => api('POST', '/api/people', { name: F.name.value, phone: F.phone.value, birthday: F.birthday.value }), 'Added');
    if (p) location.hash = personHref(p.id);
  };
  const ul = h('ul', { class: 'people-list' }, list.map((p) => personRow(p)));
  const more = h('button', { class: 'btn', type: 'button', hidden: list.length < PAGE, style: 'margin-top:10px', onclick: () => tryApi(async () => {
    const next = await page(ul.childElementCount); ul.append(...next.map((p) => personRow(p))); more.hidden = next.length < PAGE;
  }) }, 'Show more');
  // 079: the count is everyone (or how many match out of everyone); where people come from, in one line
  const total = sum?.people ?? list.length;
  const count = query || filter ? `${list.length.toLocaleString()}${list.length === PAGE ? '+' : ''} of ${total.toLocaleString()}` : total.toLocaleString();
  const WHERE = 'People appear when they write in, or are members of, a chat that is on, and from your phone’s contacts.';
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav('people'),
    h('div', { class: 'sec-head' }, h('h2', {}, `People (${count})`),
      h('button', { class: 'btn small primary', type: 'button', onclick: add }, '+ Add'), helpLink('people.md')),
    h('div', { class: 'ld-tools', style: 'margin-top:8px' }, search, pick),
    list.length ? [ul, more, !query && !filter && total < 20 ? h('p', { class: 'small muted' }, WHERE) : null] : query || filter ? h('p', { class: 'muted' }, 'Nobody matches.')
      : emptyState('list', 'No people yet', `${WHERE} You can also add someone, a kid without a phone too.`, h('button', { class: 'btn primary', onclick: add }, 'Add a person')),
    sum ? h('label', { class: 'tick small muted', style: 'justify-content:flex-start;margin-top:14px' }, h('input', { type: 'checkbox', checked: sum.namesForAgents !== false, disabled: !can('owner'),
      onchange: (e) => tryApi(async () => { await api('PUT', '/api/people/agent-names', { enabled: e.target.checked }); }, e.target.checked ? 'Agents use your contact names' : 'Agents use profile names') }),
      ' Agents may use the names from your phone contacts') : null));
}

/** 081: what the modules that are on add to a person's, household's or event's page: titled groups of link rows. */
export const moduleBlocks = (sections = []) => sections.map((s) => h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, s.title), h('ul', {}, s.rows.map((r) => h('li', {},
  h('a', { class: 'lrow', href: r.href || null }, h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, r.name), r.sub ? h('span', { class: 'lrow-sub' }, r.sub) : null), r.href ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null))))));
/** Save something on a person and draw the page again. */
const act = (ref, fn, ok) => tryApi(fn, ok).then((r) => { if (r !== false) renderPerson(ref); return r; });
const block = (title, help, ...kids) => h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, title, help ? [' ', helpLink(help)] : null), kids);
const rowBtn = (label, sub, onclick) => h('li', {}, h('button', { class: 'lrow', type: 'button', onclick }, h('span', { class: 'lmark c3', 'aria-hidden': 'true' }, '+'),
  h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, label), sub ? h('span', { class: 'lrow-sub' }, sub) : null), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
const x = (label, onclick) => h('button', { class: 'btn small ghost icon rm', type: 'button', 'aria-label': label, title: label, onclick }, '×');
const TIES = [['parent', 'Parent of', false], ['parent', 'Child of', true], ['partner', 'Partner of', false], ['sibling', 'Sibling of', false], ['works_with', 'Works with', false], ['custom', 'Something else…', false]];

/** A person's page: name and apps, then Family and ties, Notes and timeline, Tags and lists, their chats, Consent and the agents
 *  that can see them (079); ⋯ Edit, Merge, Export, Hide / Show again. */
async function renderPerson(ref) {
  const back = h('a', { class: 'sub-back', href: '#people' }, icon('back'), 'People');
  const p = await api('GET', `/api/people/${enc(ref)}`).catch(() => null);
  if (!p) { $('#main').replaceChildren(h('div', { class: 'card' }, back, h('h2', {}, 'People'), h('p', { class: 'muted' }, 'This person is not in People (any more).'))); return; }
  window.scrollTo(0, 0);
  document.title = `${p.name} · Duniya`;
  const chatRow = (c, sub) => h('li', {}, h('a', { class: 'lrow', href: `#chats/${enc(c.id)}` }, avatar(c.name, c.id, `s${c.enabled ? '' : ' off'}`),
    h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, c.name), h('span', { class: 'lrow-sub' }, [c.enabled ? c.agentName || 'No agent' : 'Off', sub].filter(Boolean).join(' · '))),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  const setUp = () => { S.dmPrefill = { phone: p.phone, name: p.name }; location.hash = 'chats/add'; };
  const noApp = !p.notInPeople && !p.apps.length && !p.phone;
  const chats = noApp ? null : [block('Direct chat', '', h('ul', {}, p.direct.length ? p.direct.map((c) => chatRow(c, ''))
    : p.phone ? rowBtn('Set up a direct chat', 'Give them an agent, before they write', setUp) : null)),
  block('Their groups', '', p.groups.length ? h('ul', {}, p.groups.map((c) => chatRow(c, c.wrote ? `wrote ${ago(c.lastAt)} ago` : 'member'))) : h('p', { class: 'small muted lempty' }, 'Not in a group that is on.'))];
  if (p.notInPeople) {
    const addThem = () => act(ref, () => api('POST', '/api/people', { name: p.name.startsWith('+') ? '' : p.name, phone: p.phone }), 'Added to People');
    $('#main').replaceChildren(h('div', { class: 'card person-page' }, back, h('div', { class: 'ap-head' }, avatar(p.name, p.phone, 'l'),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, p.name), h('div', { class: 'small muted num' }, `+${p.phone} · not in People`))),
    h('p', { class: 'small muted' }, 'People are added when they write in a chat that is on.', ' ', h('button', { class: 'btn small', onclick: addThem }, 'Add to People')), chats));
    return;
  }
  const edit = async () => {
    const F = { name: h('input', { value: p.ownName || '', placeholder: p.name, autocomplete: 'off' }), nickname: h('input', { value: p.nickname, autocomplete: 'off' }),
      phone: h('input', { value: p.phone ? `+${p.phone}` : '', inputmode: 'tel', autocomplete: 'off' }), birthday: h('input', { value: p.birthday, placeholder: '2015-04-23 or --04-23', autocomplete: 'off' }),
      shared: h('input', { type: 'checkbox', checked: p.shared }) };
    if (!await ask({ title: `Edit ${p.name}`, ok: 'Save', body: [field('Name', F.name, 'Empty: the name from their apps.'), field('Nickname', F.nickname), field('Number', F.phone), field('Birthday', F.birthday),
      h('label', { class: 'tick' }, F.shared, ' Shared: participants may look them up through agents')] })) return;
    act(p.id, () => api('PUT', `/api/people/${p.id}`, { name: F.name.value, nickname: F.nickname.value, phone: F.phone.value, birthday: F.birthday.value, shared: F.shared.checked }), 'Saved');
  };
  const merge = async (otherId = '', otherName = '') => {
    const pk = otherId ? null : pickPerson('Who is the same person?', p.id);
    if (!await ask({ title: otherId ? `Merge ${otherName} into ${p.name}?` : `Merge someone into ${p.name}`, ok: 'Merge',
      text: `Their apps, notes, ties, households, tags and lists move to ${p.name}. You can undo this for 30 days.`, body: pk ? pk.el : null })) return;
    const other = otherId || pk?.value(); if (!other) return tryApi(async () => { throw new Error('Choose a person from the matches'); });
    act(p.id, () => api('POST', `/api/people/${p.id}/merge`, { other }), 'Merged · undo below for 30 days');
  };
  const exportIt = () => tryApi(async () => {
    const data = await api('GET', `/api/people/${p.id}/export`);
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `person-${p.id}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'Exported');
  // 079: Hide instead of Erase — out of lists, search and agents; the data stays; Show again undoes it
  const hide = async () => (await ask({ title: `Hide ${p.name}?`, ok: 'Hide',
    text: 'They leave People lists and search, and agents no longer see them. Their notes, ties and chats stay, and your phone’s contacts don’t bring them back. Show them again any time (People → Hidden).' }))
    && act(p.id, () => api('PUT', `/api/people/${p.id}/hidden`, { hidden: true }), 'Hidden');
  const showAgain = () => act(p.id, () => api('PUT', `/api/people/${p.id}/hidden`, { hidden: false }), 'Shown again');
  const consentRow = (c) => h('li', { style: 'display:flex;align-items:center;gap:10px;padding:8px 10px' },
    h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, c.label), h('span', { class: 'lrow-sub' }, c.known ? `${c.source || 'Recorded'} · ${ago(c.at)} ago` : 'Not asked: counts as no')),
    h('select', { 'aria-label': c.label, style: 'width:auto;flex:none', onchange: (e) => act(p.id, () => api('PUT', `/api/people/${p.id}/consents`, { purpose: c.purpose, value: e.target.value }), 'Saved') },
      h('option', { value: 'yes', selected: c.value === 'yes' }, 'Yes'), h('option', { value: 'no', selected: c.value === 'no' }, 'No')));
  const owner = can('owner');
  // Family and ties
  const addTie = async () => {
    const kind = h('select', {}, TIES.map(([, l], i) => h('option', { value: String(i) }, l)));
    const label = h('input', { placeholder: 'e.g. Godparent of', autocomplete: 'off' }); const inverse = h('input', { placeholder: 'e.g. Godchild of', autocomplete: 'off' });
    const custom = h('div', { hidden: true }, field('Label', label), field('From their side', inverse));
    kind.onchange = () => { custom.hidden = TIES[Number(kind.value)][0] !== 'custom'; };
    const pk = pickPerson('Who', p.id);
    if (!await ask({ title: `${p.name} is…`, ok: 'Add tie', body: [field('Tie', kind), custom, pk.el] })) return;
    const [k, , reverse] = TIES[Number(kind.value)];
    act(p.id, () => (pk.value() ? api('POST', `/api/people/${p.id}/ties`, { other: pk.value(), kind: k, reverse, label: label.value, inverse: inverse.value }) : Promise.reject(new Error('Choose a person from the matches'))), 'Tie added');
  };
  const addToHousehold = async () => {
    const list = await api('GET', '/api/households').catch(() => []);
    const sel = h('select', {}, list.map((x) => h('option', { value: x.id }, x.name)), h('option', { value: '' }, 'New household…'));
    const name = h('input', { placeholder: 'e.g. Chary family', autocomplete: 'off' }); const nameF = field('Name', name);
    const role = h('select', {}, h('option', { value: 'adult' }, 'Adult'), h('option', { value: 'kid', selected: !p.apps.length }, 'Kid'));
    nameF.hidden = !!list.length; sel.onchange = () => { nameF.hidden = !!sel.value; };
    if (!await ask({ title: `Add ${p.name} to a household`, ok: 'Add', body: [list.length ? field('Household', sel) : null, nameF, field('As', role)] })) return;
    act(p.id, async () => { const id = sel.value || (await api('POST', '/api/households', { name: name.value })).id; return api('PUT', `/api/households/${id}/members/${p.id}`, { role: role.value }); }, 'Added');
  };
  const addToList = async () => {
    const list = await api('GET', '/api/lists').catch(() => []);
    const sel = h('select', {}, list.filter((l) => !p.lists.some((m) => m.id === l.id)).map((l) => h('option', { value: l.id }, l.name)), h('option', { value: '' }, 'New list…'));
    const name = h('input', { placeholder: 'e.g. Badminton Tuesdays', autocomplete: 'off' }); const nameF = field('Name', name);
    nameF.hidden = !!sel.options[0]?.value; sel.onchange = () => { nameF.hidden = !!sel.value; };
    if (!await ask({ title: `Add ${p.name} to a list`, ok: 'Add', body: [field('List', sel), nameF] })) return;
    act(p.id, async () => { const id = sel.value || (await api('POST', '/api/lists', { name: name.value })).id; return api('PUT', `/api/lists/${id}/members/${p.id}`); }, 'Added');
  };
  const tagIn = tagInput(p.tags, { placeholder: 'Add a tag', label: `Tags of ${p.name}` });
  let saved = p.tags.join();
  tagIn.box.addEventListener('input', () => { const v = tagIn.values(); if (v.join() !== saved) { saved = v.join(); tryApi(() => api('PUT', `/api/people/${p.id}/tags`, { tags: v }), 'Tags saved'); } });
  const note = h('textarea', { rows: 2, placeholder: `A note about ${p.name}`, 'aria-label': 'New note', maxlength: 1000 });
  const entry = (n) => h('li', { class: `tl ${n.kind}` }, h('div', {}, n.kind === 'event' ? h('span', { class: 'muted' }, n.text) : n.text),
    h('div', { class: 'small muted' }, [n.kind === 'event' ? '' : n.by === 'agent' ? 'Agent' : n.author || 'Owner', `${ago(n.at)} ago`].filter(Boolean).join(' · '),
      n.kind === 'note' ? [' ', x('Delete note', () => act(p.id, () => api('DELETE', `/api/people/${p.id}/notes/${n.id}`), 'Note deleted'))] : null));
  const facts = [p.phone ? `+${p.phone}` : '', p.apps.map((a) => APPS[a] || a).join(' · ') || (p.reachVia.length ? `No app · reached through ${p.reachVia.map((r) => r.name).join(', ')}` : 'No app: agents never message them'), p.nickname ? `“${p.nickname}”` : ''].filter(Boolean).join(' · ');
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, back,
    h('div', { class: 'ap-head' }, avatar(p.name, p.id, 'l'),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, p.name), h('div', { class: 'small muted num' }, facts)),
      menu(`More for ${p.name}`, h('button', { class: 'btn small', type: 'button', onclick: edit }, 'Edit…'),
        owner ? h('button', { class: 'btn small', type: 'button', onclick: () => merge() }, 'Merge…') : null,
        owner ? h('button', { class: 'btn small', type: 'button', onclick: exportIt }, 'Export') : null,
        p.hidden ? h('button', { class: 'btn small', type: 'button', onclick: showAgain }, 'Show again') : h('button', { class: 'btn small', type: 'button', onclick: hide }, 'Hide…'))),
    p.hidden ? h('p', { class: 'note' }, 'Hidden: not in People lists, search or agents. ', h('button', { class: 'qfix', type: 'button', onclick: showAgain }, 'Show again')) : null,
    h('p', { class: 'small muted', style: 'margin:6px 0 0' }, [p.birthday ? `Birthday ${p.birthday.replace(/^--/, '')}` : '', p.shared ? 'Shared with participants' : '', `In People since ${new Date(p.createdAt).toLocaleDateString()}`,
      p.lastContact ? `last contact ${ago(p.lastContact)} ago` : '', p.source === 'phone' ? 'from your phone’s contacts' : ''].filter(Boolean).join(' · ')),
    owner && p.suggestions.map((s) => h('p', { class: 'note' }, `${s.reason} as ${s.name}. `, h('button', { class: 'qfix', type: 'button', onclick: () => merge(s.id, s.name) }, `Merge ${s.name} into ${p.name}`))),
    owner && p.merges.map((m) => h('p', { class: 'small muted' }, `Merged with ${m.name} ${ago(m.at)} ago. `, h('button', { class: 'qfix', type: 'button', onclick: () => act(p.id, () => api('POST', `/api/people/merges/${m.id}/undo`), 'Merge undone') }, 'Undo merge'))),
    block('Family and ties', 'people.md#family-and-ties', h('ul', {}, p.ties.map((t) => personRow({ id: t.other.id, who: t.other.name, name: `${t.label} ${t.other.name}` }, '', x(`Remove ${t.label} ${t.other.name}`, () => act(p.id, () => api('DELETE', `/api/people/${p.id}/ties/${t.id}`), 'Tie removed')))),
      p.households.map((x2) => h('li', { class: 'has-end' }, h('a', { class: 'lrow', href: `#people/households/${enc(x2.id)}` }, h('span', { class: 'lmark c2', 'aria-hidden': 'true' }, x2.name[0] || 'H'),
        h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, x2.name), h('span', { class: 'lrow-sub' }, `Household · ${x2.role === 'kid' ? 'kid' : 'adult'}`)), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))),
      rowBtn('Add a tie', 'Parent, partner, sibling, works with…', addTie), rowBtn('Add to a household', 'Adults and kids', addToHousehold))),
    block('Notes and timeline', 'people.md#notes-and-timeline',
      h('form', { class: 'note-add', onsubmit: (e) => { e.preventDefault(); if (note.value.trim()) act(p.id, () => api('POST', `/api/people/${p.id}/notes`, { text: note.value }), 'Note added'); } }, note, h('button', { class: 'btn small' }, 'Add note')),
      p.timeline.length ? h('ul', { class: 'timeline' }, p.timeline.map(entry)) : null),
    block('Tags and lists', 'people.md#tags-and-lists',
      h('div', { style: 'padding:0 10px 6px' }, tagIn.box),
      h('ul', {}, p.lists.map((l) => h('li', { class: 'has-end' }, h('a', { class: 'lrow', href: `#people/lists/${enc(l.id)}` }, h('span', { class: 'lmark c4', 'aria-hidden': 'true' }, '≡'),
        h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, l.name), h('span', { class: 'lrow-sub' }, 'List')), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
      x(`Take off ${l.name}`, () => act(p.id, () => api('DELETE', `/api/lists/${l.id}/members/${p.id}`), 'Taken off the list')))), rowBtn('Add to a list', '', addToList))),
    chats,
    moduleBlocks(p.modules),
    block('Consent', 'people.md#consent', h('ul', {}, p.consents.map(consentRow))),
    block('Agents that can see them', 'people.md#what-agents-see', p.agents.length ? h('ul', { class: 'mini-list' }, p.agents.map((a) => h('li', {}, h('a', { class: 'lrow', href: `#agents/${enc(a.id)}/people` },
      h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, a.name), h('span', { class: 'lrow-sub' }, a.why)), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))))
      : h('p', { class: 'small muted lempty' }, p.hidden ? 'None while they are hidden.' : 'None: agents see the people of their own chats, or everyone when you choose that for an agent.')),
    p.identities.length ? block('Apps', '', h('ul', { class: 'mini-list' }, p.identities.map((i) => h('li', { class: 'small', style: 'padding:6px 10px' },
      `${APPS[i.channel] || i.channel}${i.name ? ` · ${i.name}` : ''}${i.phone ? ` · +${i.phone}` : ''} · since ${new Date(i.firstSeen).toLocaleDateString()}`)))) : null));
  $('#main h2')?.focus({ preventScroll: true });
}
