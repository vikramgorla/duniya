// People (078): Households and Lists, each a list → page (#people/households/<id>, #people/lists/<id>). Loaded from
// people.js on first visit. A household's kid without any app is reached through its adults.
import { $, api, ask, emptyState, field, h, icon, menu, tryApi } from './core.js';
import { helpLink, plural } from './shared.js';
import { peopleNav, personRow, pickPerson } from './people.js';
const enc = encodeURIComponent;
const KIND = {
  households: { title: 'Households', one: 'household', api: '/api/households', add: 'New household', example: 'e.g. Chary family', help: 'people.md#households',
    sub: (x) => [plural(x.adults, 'adult'), x.kids ? plural(x.kids, 'kid') : '', x.address].filter(Boolean).join(' · '), mark: 'c2',
    empty: 'A household groups adults and kids, e.g. "Chary family". A kid without a phone is reached through its adults.' },
  lists: { title: 'Lists', one: 'list', api: '/api/lists', add: 'New list', example: 'e.g. Badminton Tuesdays', help: 'people.md#tags-and-lists',
    sub: (x) => plural(x.size, 'person', 'people'), mark: 'c4', empty: 'A list is a named group of people you put together by hand, e.g. "Badminton Tuesdays".' },
};

export async function renderGroup(kind, id) {
  const k = KIND[kind];
  if (id) return renderOne(kind, id);
  const items = await api('GET', k.api);
  const create = async () => {
    const name = h('input', { placeholder: k.example, autocomplete: 'off' }); const address = h('input', { autocomplete: 'off' });
    if (!await ask({ title: k.add, ok: `Create ${k.one}`, body: [field('Name', name), kind === 'households' ? field('Address (optional)', address) : null] })) return;
    const r = await tryApi(() => api('POST', k.api, { name: name.value, address: address.value }), 'Created');
    if (r) location.hash = `people/${kind}/${enc(r.id)}`;
  };
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav(`people/${kind}`),
    h('div', { class: 'sec-head' }, h('h2', {}, `${k.title} (${items.length})`), h('button', { class: 'btn small primary', type: 'button', onclick: create }, '+ New'), helpLink(k.help)),
    items.length ? h('ul', { class: 'people-list' }, items.map((x) => h('li', {}, h('a', { class: 'lrow', href: `#people/${kind}/${enc(x.id)}` },
      h('span', { class: `lmark ${k.mark}`, 'aria-hidden': 'true' }, (x.name[0] || '?').toUpperCase()),
      h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, x.name), h('span', { class: 'lrow-sub' }, k.sub(x))), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))))
      : emptyState('list', `No ${k.title.toLowerCase()} yet`, k.empty, h('button', { class: 'btn primary', onclick: create }, k.add))));
}

async function renderOne(kind, id) {
  const k = KIND[kind];
  const back = h('a', { class: 'sub-back', href: `#people/${kind}` }, icon('back'), k.title);
  const g = await api('GET', `${k.api}/${enc(id)}`).catch(() => null);
  if (!g) { $('#main').replaceChildren(h('div', { class: 'card' }, back, h('p', { class: 'muted' }, `This ${k.one} is gone.`))); return; }
  document.title = `${g.name} · Duniya`;
  const redraw = (fn, ok) => tryApi(fn, ok).then((r) => { if (r !== false) renderOne(kind, id); });
  const house = kind === 'households';
  const edit = async () => {
    const name = h('input', { value: g.name, autocomplete: 'off' }); const address = h('input', { value: g.address || '', autocomplete: 'off' });
    if (!await ask({ title: `Edit ${g.name}`, ok: 'Save', body: [field('Name', name), house ? field('Address (optional)', address) : null] })) return;
    redraw(() => api('PUT', `${k.api}/${enc(id)}`, { name: name.value, address: address.value }), 'Saved');
  };
  const remove = async () => (await ask({ title: `Delete ${g.name}?`, danger: true, ok: `Delete ${k.one}`, text: `The ${k.one} goes; the people in it stay in People.` }))
    && tryApi(async () => { await api('DELETE', `${k.api}/${enc(id)}`); location.hash = `people/${kind}`; }, 'Deleted');
  const add = async () => {
    const pk = pickPerson('Who');
    const role = h('select', {}, h('option', { value: 'adult' }, 'Adult'), h('option', { value: 'kid' }, 'Kid'));
    if (!await ask({ title: `Add to ${g.name}`, ok: 'Add', body: [pk.el, house ? field('As', role) : null] })) return;
    redraw(() => (pk.value() ? api('PUT', `${k.api}/${enc(id)}/members/${pk.value()}`, { role: role.value }) : Promise.reject(new Error('Choose a person from the matches'))), 'Added');
  };
  const out = (m) => h('button', { class: 'btn small ghost icon', type: 'button', 'aria-label': `Take ${m.name} out`, title: `Take ${m.name} out`,
    onclick: () => redraw(() => api('DELETE', `${k.api}/${enc(id)}/members/${m.id || m.person}`), 'Taken out') }, '×');
  const members = house ? g.members : g.members.map((m) => ({ ...m, person: m.id }));
  const sub = (m) => (house ? [m.role === 'kid' ? 'Kid' : 'Adult', m.reachable ? '' : 'no app: reached through the adults'].filter(Boolean).join(' · ') : undefined);
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, back,
    h('div', { class: 'ap-head' }, h('span', { class: `lmark l ${k.mark}`, 'aria-hidden': 'true' }, (g.name[0] || '?').toUpperCase()),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, g.name), h('div', { class: 'small muted' }, [house ? 'Household' : 'List', plural(members.length, 'member'), g.address].filter(Boolean).join(' · '))),
      menu(`More for ${g.name}`, h('button', { class: 'btn small', type: 'button', onclick: edit }, 'Edit…'), h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete…'))),
    h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, 'Members'), h('ul', {}, members.map((m) => personRow({ id: m.person, name: m.name, apps: m.apps || [] }, sub(m), out(m))),
      h('li', {}, h('button', { class: 'lrow', type: 'button', onclick: add }, h('span', { class: 'lmark c3', 'aria-hidden': 'true' }, '+'),
        h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, 'Add a person')), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))))));
  $('#main h2')?.focus({ preventScroll: true });
}
