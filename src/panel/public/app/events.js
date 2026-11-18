// Events and Orders (081): People → Events (list → event page with registrations, waiting list, duties, payments)
// and People → Orders (list with filters and totals per event → order page with lines and payments). Loaded from
// people.js on first visit, only when the module is on. Names and notes are built from text nodes.
import { $, api, ask, can, emptyState, field, h, icon, menu, tryApi } from './core.js';
import { helpLink, plural } from './shared.js';
import { moduleBlocks, peopleNav, pickPerson } from './people.js';
const enc = encodeURIComponent;
const STATUS = { registered: ['Registered', 'ok'], waiting: ['Waiting list', 'warn'], pending: ['To confirm', 'info'], cancelled: ['Cancelled', ''],
  open: ['Open', 'warn'], part: ['Part paid', 'info'], paid: ['Paid', 'ok'], refunded: ['Refunded', ''] };
const pill = (s) => h('span', { class: `pill ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);
const money = (c, cur) => `${cur} ${(Number(c || 0) / 100).toFixed(2)}`;
const day = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const row = (name, sub, { href = null, mark = null, end = null, onclick = null } = {}) => h('li', { class: end ? 'has-end' : null },
  h(href ? 'a' : 'button', { class: 'lrow', href, type: href ? null : 'button', onclick }, mark,
    h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, name), sub ? h('span', { class: 'lrow-sub' }, sub) : null), href || onclick ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null), end);
const addRow = (label, sub, onclick) => row(label, sub, { onclick, mark: h('span', { class: 'lmark c3', 'aria-hidden': 'true' }, '+') });
const group = (title, ...kids) => h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, title), kids);
const dateMark = (d) => h('span', { class: 'lmark c2', 'aria-hidden': 'true' }, d ? String(Number(d.slice(8, 10))) : '?');
const back = (href, label) => h('a', { class: 'sub-back', href }, icon('back'), label);
const done = (redraw) => (r) => { if (r !== undefined) redraw(); return r; };

/** #people/events[/id], #people/orders[?event=…][/id] */
export function renderModule(a, b) {
  if (a === 'events') return b ? eventPage(b) : eventList();
  return b ? orderPage(b) : orderList(new URLSearchParams(a.split('?')[1] || '').get('event') || '');
}

// ---------- Events ----------
let past = false;
const countsLine = (c) => [plural(c.registrations, 'registration'), `${plural(c.people, 'person', 'people')} (${plural(c.adults, 'adult')}, ${plural(c.kids, 'kid')})`,
  c.waiting ? `${c.waiting} waiting` : '', c.pending ? `${c.pending} to confirm` : '', c.capacity ? `${plural(c.left, 'place')} left` : ''].filter(Boolean).join(' · ');

async function editEvent(e = null) {
  const v = e || { per: 'household', confirm: 'auto', currency: 'CHF', prices: {} };
  const F = { name: h('input', { value: v.name || '', autocomplete: 'off', placeholder: 'e.g. Sankranti 2027' }), starts: h('input', { type: 'date', value: (v.starts || '').slice(0, 10) }),
    ends: h('input', { type: 'date', value: (v.ends || '').slice(0, 10) }), place: h('input', { value: v.place || '', autocomplete: 'off' }),
    capacity: h('input', { type: 'number', min: 0, value: v.capacity || 0 }), deadline: h('input', { type: 'date', value: v.deadline || '' }),
    currency: h('input', { value: v.currency || 'CHF', maxlength: 3, style: 'text-transform:uppercase' }),
    per: h('select', {}, h('option', { value: 'household', selected: v.per === 'household' }, 'Per household'), h('option', { value: 'person', selected: v.per === 'person' }, 'Per person')),
    confirm: h('select', {}, h('option', { value: 'auto', selected: v.confirm === 'auto' }, 'Automatically'), h('option', { value: 'organizer', selected: v.confirm === 'organizer' }, 'An organizer confirms')),
    adult: h('input', { type: 'number', min: 0, step: '0.05', value: (v.prices.adult || 0) / 100 }), kid: h('input', { type: 'number', min: 0, step: '0.05', value: (v.prices.kid || 0) / 100 }),
    freeUnder: h('input', { type: 'number', min: 0, max: 18, value: v.prices.freeUnder || 0 }), payBy: h('input', { type: 'date', value: v.payBy || '' }) };
  if (!await ask({ title: e ? `Edit ${e.name}` : 'New event', ok: e ? 'Save' : 'Create event', wide: true, body: h('div', { class: 'grid2' },
    field('Name', F.name), field('Place', F.place), field('Starts', F.starts), field('Ends (optional)', F.ends), field('Places (0 = no limit)', F.capacity, 'Counts people: adults and kids.'),
    field('Registration closes', F.deadline, 'Organizers can still add people after.'), field('Registration', F.per), field('Confirmed', F.confirm),
    field('Currency', F.currency, 'One per event.'), field('Pay by (optional)', F.payBy), field('Price per adult', F.adult), field('Price per kid', F.kid),
    field('Kids under this age are free', F.freeUnder, 'Uses their birthday in People; 0 = none.')) })) return null;
  const body = { name: F.name.value, starts: F.starts.value, ends: F.ends.value, place: F.place.value, capacity: Number(F.capacity.value), deadline: F.deadline.value, currency: F.currency.value,
    per: F.per.value, confirm: F.confirm.value, payBy: F.payBy.value, prices: { adult: F.adult.value, kid: F.kid.value, freeUnder: F.freeUnder.value } };
  return tryApi(() => api(e ? 'PUT' : 'POST', e ? `/api/module/events/${e.id}` : '/api/module/events', body), e ? 'Saved' : 'Event created');
}

async function eventList() {
  const list = await api('GET', `/api/module/events${past ? '?past=1' : ''}`);
  const create = async () => { const r = await editEvent(); if (r) location.hash = `people/events/${r.event.id}`; };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Which events' }, [[false, 'Upcoming'], [true, 'Past']].map(([v, l]) => h('button', { type: 'button', class: past === v ? 'on' : '', 'aria-pressed': String(past === v), onclick: () => { past = v; eventList(); } }, l)));
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav('people/events'),
    h('div', { class: 'sec-head' }, h('h2', {}, `Events (${list.length})`), h('button', { class: 'btn small primary', type: 'button', onclick: create }, '+ New'), helpLink('events.md')),
    h('div', { class: 'ld-tools', style: 'margin-top:8px' }, seg),
    list.length ? h('ul', { class: 'people-list' }, list.map((e) => row(e.name, [day(e.starts), e.place, countsLine(e.counts)].filter(Boolean).join(' · '), { href: `#people/events/${enc(e.id)}`, mark: dateMark(e.starts) })))
      : emptyState('list', past ? 'No past events' : 'No upcoming events', 'An event has a date, places, a deadline and a price list. People register through an agent ("register us for Sankranti") or here.', h('button', { class: 'btn primary', onclick: create }, 'New event'))));
}

async function eventPage(id) {
  const g = await api('GET', `/api/module/events/${enc(id)}`).catch(() => null);
  const bk = back('#people/events', 'Events');
  if (!g) { $('#main').replaceChildren(h('div', { class: 'card' }, bk, h('p', { class: 'muted' }, 'This event is gone.'))); return; }
  const { event: e, counts: c } = g;
  document.title = `${e.name} · Duniya`;
  const redraw = () => eventPage(id);
  const set = (r, body, ok) => tryApi(() => api('PUT', `/api/module/registrations/${r.id}`, body), ok).then(done(redraw));
  const register = async () => {
    const homes = await api('GET', '/api/households').catch(() => []);
    const hh = h('select', {}, h('option', { value: '' }, 'A person (choose below)'), homes.map((x) => h('option', { value: x.id, selected: false }, x.name)));
    const pk = pickPerson('Person'); const adults = h('input', { type: 'number', min: 0, placeholder: 'from the household' }); const kids = h('input', { type: 'number', min: 0, placeholder: 'from the household' });
    const notes = h('input', { placeholder: 'e.g. vegetarian', autocomplete: 'off' });
    if (!await ask({ title: `Register for ${e.name}`, ok: 'Register', body: [field('Household', hh), pk.el, h('div', { class: 'grid2' }, field('Adults', adults), field('Kids', kids)), field('Notes', notes)] })) return;
    tryApi(() => api('POST', `/api/module/events/${e.id}/registrations`, { household: hh.value, person: hh.value ? '' : pk.value(), adults: adults.value, kids: kids.value, notes: notes.value }), 'Registered').then(done(redraw));
  };
  const numbers = async (r) => {
    const adults = h('input', { type: 'number', min: 0, value: r.adults }); const kids = h('input', { type: 'number', min: 0, value: r.kids }); const notes = h('input', { value: r.notes, autocomplete: 'off' });
    if (await ask({ title: r.who, ok: 'Save', body: [h('div', { class: 'grid2' }, field('Adults', adults), field('Kids', kids)), field('Notes', notes)] })) set(r, { adults: Number(adults.value), kids: Number(kids.value), notes: notes.value }, 'Saved');
  };
  const regRow = (r) => row(r.who, [`${plural(r.adults, 'adult')}${r.kids ? `, ${plural(r.kids, 'kid')}` : ''}`, r.notes, r.attended ? 'came' : ''].filter(Boolean).join(' · '), {
    href: r.person ? `#people/${enc(r.person)}` : r.household ? `#people/households/${enc(r.household)}` : null,
    end: h('span', { class: 'row-end' }, pill(r.status), can('admin') ? menu(`More for ${r.who}`,
      r.status !== 'registered' ? h('button', { class: 'btn small', type: 'button', onclick: () => set(r, { status: 'registered' }, r.status === 'pending' ? 'Confirmed' : 'Registered') }, r.status === 'pending' ? 'Confirm' : 'Register') : null,
      r.status !== 'waiting' && r.status !== 'cancelled' ? h('button', { class: 'btn small', type: 'button', onclick: () => set(r, { status: 'waiting' }, 'On the waiting list') }, 'Waiting list') : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => numbers(r) }, 'Change numbers…'),
      r.status === 'registered' ? h('button', { class: 'btn small', type: 'button', onclick: () => set(r, { attended: !r.attended }, 'Saved') }, r.attended ? 'Did not come' : 'Came') : null,
      r.status !== 'cancelled' ? h('button', { class: 'btn small danger', type: 'button', onclick: () => set(r, { status: 'cancelled' }, 'Cancelled') }, 'Cancel registration') : null) : null) });
  const by = (s) => g.registrations.filter((r) => r.status === s);
  const addDuty = async () => {
    const task = h('input', { placeholder: 'e.g. Set up chairs', autocomplete: 'off' }); const at = h('input', { placeholder: 'e.g. 09:00', autocomplete: 'off' }); const needed = h('input', { type: 'number', min: 1, value: 2 });
    if (await ask({ title: 'Add a duty', ok: 'Add duty', body: [field('Task', task), h('div', { class: 'grid2' }, field('When', at), field('People needed', needed))] })) tryApi(() => api('POST', `/api/module/events/${e.id}/duties`, { task: task.value, at: at.value, needed: Number(needed.value) }), 'Duty added').then(done(redraw));
  };
  const give = async (d) => { const pk = pickPerson('Who'); if (await ask({ title: d.task, ok: 'Give the duty', body: pk.el })) tryApi(() => api('PUT', `/api/module/duties/${d.id}/people/${pk.value()}`, { on: true }), 'Saved').then(done(redraw)); };
  const dutyRow = (d) => row(`${d.task}${d.at ? ` · ${d.at}` : ''}`, `${d.people.map((p) => p.name).join(', ') || 'Nobody yet'} · ${d.open ? `${d.open} of ${d.needed} open` : 'full'}`, {
    end: can('admin') ? menu(`More for ${d.task}`, d.open ? h('button', { class: 'btn small', type: 'button', onclick: () => give(d) }, 'Give to…') : null,
      d.people.map((p) => h('button', { class: 'btn small', type: 'button', onclick: () => tryApi(() => api('PUT', `/api/module/duties/${d.id}/people/${p.id}`, { on: false }), 'Saved').then(done(redraw)) }, `Take ${p.name} off`)),
      h('button', { class: 'btn small danger', type: 'button', onclick: () => tryApi(() => api('DELETE', `/api/module/duties/${d.id}`), 'Duty removed').then(done(redraw)) }, 'Remove duty')) : null });
  const remove = async () => (await ask({ title: `Delete ${e.name}?`, danger: true, ok: 'Delete event', text: `Its ${plural(g.registrations.length, 'registration')} and duties go too; unpaid orders are cancelled. This cannot be undone.` }))
    && tryApi(async () => { await api('DELETE', `/api/module/events/${e.id}`); location.hash = 'people/events'; }, 'Deleted');
  const prices = e.prices.adult || e.prices.kid ? `${money(e.prices.adult, e.currency)} per adult, ${money(e.prices.kid, e.currency)} per kid${e.prices.freeUnder ? `, free under ${e.prices.freeUnder}` : ''}` : '';
  const cancelled = by('cancelled');
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, bk,
    h('div', { class: 'ap-head' }, dateMark(e.starts),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, e.name), h('div', { class: 'small muted' }, [`${day(e.starts)}${e.ends && e.ends !== e.starts ? ` – ${day(e.ends)}` : ''}`, e.place].filter(Boolean).join(' · '))),
      can('admin') ? menu(`More for ${e.name}`, h('button', { class: 'btn small', type: 'button', onclick: () => editEvent(e).then(done(redraw)) }, 'Edit…'),
        h('a', { class: 'btn small', href: `/api/module/events/${e.id}/csv`, download: '' }, 'Download CSV'), h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete…')) : null),
    h('p', { class: 'small', style: 'margin:8px 0 0' }, countsLine(c)),
    h('p', { class: 'small muted', style: 'margin:4px 0 0' }, [e.per === 'household' ? 'Per household' : 'Per person', e.confirm === 'organizer' ? 'an organizer confirms' : 'confirmed automatically',
      e.deadline ? `closes ${day(e.deadline)}` : '', prices, e.payBy ? `pay by ${day(e.payBy)}` : ''].filter(Boolean).join(' · ')),
    by('pending').length ? group('To confirm', h('ul', {}, by('pending').map(regRow))) : null,
    group('Registered', h('ul', {}, by('registered').map(regRow), addRow('Register someone', 'A person or a household', register))),
    by('waiting').length ? group('Waiting list', h('ul', {}, by('waiting').map(regRow)), h('p', { class: 'small muted lempty' }, 'They get a place by themselves, in order, when one opens up.')) : null,
    group('Duties', h('ul', {}, g.duties.map(dutyRow), addRow('Add a duty', 'A task, when, how many people', addDuty))),
    moduleBlocks(g.modules),
    cancelled.length ? h('details', { class: 'sblock' }, h('summary', {}, `Cancelled (${cancelled.length})`), h('ul', { class: 'mini-list' }, cancelled.map(regRow))) : null));
  $('#main h2')?.focus({ preventScroll: true });
}

// ---------- Orders ----------
let status = 'open';
async function orderList(event) {
  const g = await api('GET', `/api/orders?status=${status}${event ? `&event=${enc(event)}` : ''}`);
  const create = async () => {
    const pk = pickPerson('Person'); const item = h('input', { placeholder: 'e.g. T-shirt', autocomplete: 'off' }); const qty = h('input', { type: 'number', min: 1, value: 1 });
    const price = h('input', { type: 'number', min: 0, step: '0.05' }); const due = h('input', { type: 'date' });
    if (!await ask({ title: 'New order', ok: 'Create order', body: [pk.el, field('What', item), h('div', { class: 'grid2' }, field('How many', qty), field('Price each', price)), field('Due (optional)', due)] })) return;
    const r = await tryApi(() => api('POST', '/api/orders', { person: pk.value(), title: item.value, lines: [{ item: item.value, qty: Number(qty.value), price: price.value }], due: due.value }), 'Order created');
    if (r) location.hash = `people/orders/${r.id}`;
  };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Which orders' }, [['open', 'Not paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['all', 'All']].map(([v, l]) =>
    h('button', { type: 'button', class: status === v ? 'on' : '', 'aria-pressed': String(status === v), onclick: () => { status = v; orderList(event); } }, l)));
  const ev = g.events.find((x) => x.id === event);
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav('people/orders'),
    h('div', { class: 'sec-head' }, h('h2', {}, `Orders${ev ? `: ${ev.name}` : ''} (${g.orders.length})`), h('button', { class: 'btn small primary', type: 'button', onclick: create }, '+ New'), helpLink('orders.md')),
    h('div', { class: 'ld-tools', style: 'margin-top:8px' }, seg, h('a', { class: 'btn small', href: `/api/orders/csv?status=${status}${event ? `&event=${enc(event)}` : ''}`, download: '' }, 'CSV')),
    g.events.length ? group('By event', h('ul', {}, ev ? row('All events', '', { href: '#people/orders' }) : null, g.events.filter((x) => !ev || x.id === ev.id).map((x) => row(x.name,
      `${money(x.paid, x.currency)} of ${money(x.total, x.currency)} collected · ${x.unpaid ? `${plural(x.unpaid, 'order')} not fully paid` : 'all paid'}`, { href: `#people/orders?event=${enc(x.id)}` })))) : null,
    g.orders.length ? h('ul', { class: 'people-list', style: 'margin-top:10px' }, g.orders.map((o) => row(o.who, [o.title, o.left && o.status !== 'cancelled' ? `${money(o.left, o.currency)} left` : money(o.total, o.currency),
      o.due ? `${o.overdue ? 'overdue since' : 'due'} ${day(o.due)}` : ''].filter(Boolean).join(' · '), { href: `#people/orders/${enc(o.id)}`, end: h('span', { class: 'row-end' }, pill(o.status)) })))
      : emptyState('list', 'Nothing here', 'Orders come from event registrations when the event has prices, or add one by hand. Duniya records payments; it never takes money.', null),
    h('p', { class: 'small muted' }, `Ways to pay: ${g.methods.join(', ')}. `, h('a', { href: '#settings/modules' }, 'Change'))));
}

async function orderPage(id) {
  const o = await api('GET', `/api/orders/${enc(id)}`).catch(() => null);
  const bk = back('#people/orders', 'Orders');
  if (!o) { $('#main').replaceChildren(h('div', { class: 'card' }, bk, h('p', { class: 'muted' }, 'This order is gone.'))); return; }
  document.title = `${o.who} · ${o.title} · Duniya`;
  const redraw = () => orderPage(id);
  const methods = o.methods || [];
  const pay = async (refund = false) => {
    const amount = h('input', { type: 'number', min: 0, step: '0.05', value: ((refund ? o.paid : o.left) / 100).toFixed(2) });
    const method = h('select', {}, methods.map((m) => h('option', { value: m }, m))); const at = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    if (await ask({ title: refund ? 'Record a refund' : 'Record a payment', ok: refund ? 'Record refund' : 'Record payment', text: 'Duniya records it; no money moves.',
      body: [h('div', { class: 'grid2' }, field(`Amount (${o.currency})`, amount), field('Date', at)), field('How', method)] })) tryApi(() => api('POST', `/api/orders/${o.id}/payments`, { amount: amount.value, method: method.value, at: at.value, refund }), 'Recorded').then(done(redraw));
  };
  const edit = async () => {
    const due = h('input', { type: 'date', value: o.due }); const note = h('input', { value: o.note, autocomplete: 'off' });
    if (await ask({ title: 'Edit order', ok: 'Save', body: [field('Due', due), field('Note', note)] })) tryApi(() => api('PUT', `/api/orders/${o.id}`, { due: due.value, note: note.value }), 'Saved').then(done(redraw));
  };
  const remove = async () => (await ask({ title: 'Delete this order?', danger: true, ok: 'Delete order', text: 'Its lines and payments go too. This cannot be undone.' }))
    && tryApi(async () => { await api('DELETE', `/api/orders/${o.id}`); location.hash = 'people/orders'; }, 'Deleted');
  const whoHref = o.person ? `#people/${enc(o.person)}` : `#people/households/${enc(o.household)}`;
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, bk,
    h('div', { class: 'ap-head' }, h('span', { class: 'lmark l c4', 'aria-hidden': 'true' }, o.currency.slice(0, 1)),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, o.title), h('div', { class: 'small muted' }, h('a', { href: whoHref }, o.who), o.event ? [' · ', h('a', { href: `#people/events/${enc(o.event)}` }, o.eventName)] : null)),
      can('admin') ? menu('More for this order', h('button', { class: 'btn small', type: 'button', onclick: edit }, 'Edit…'),
        o.paid > 0 ? h('button', { class: 'btn small', type: 'button', onclick: () => pay(true) }, 'Refund…') : null, h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete…')) : null),
    h('p', { class: 'small', style: 'margin:8px 0 0' }, pill(o.status), ` ${money(o.paid, o.currency)} paid of ${money(o.total, o.currency)}${o.left && o.status !== 'cancelled' ? ` · ${money(o.left, o.currency)} left` : ''}${o.due ? ` · due ${day(o.due)}` : ''}`),
    o.note ? h('p', { class: 'small muted' }, o.note) : null,
    group('Lines', h('ul', {}, o.lines.map((l) => row(`${l.qty} × ${l.item}`, `${money(l.price, o.currency)} each · ${money(l.qty * l.price, o.currency)}`)))),
    group('Payments', h('ul', {}, o.payments.map((p) => row(`${p.amount < 0 ? 'Refund' : 'Payment'} ${money(Math.abs(p.amount), o.currency)}`, [day(p.at), p.method, p.by].filter(Boolean).join(' · '), {
      end: can('admin') ? h('button', { class: 'btn small ghost icon rm', type: 'button', 'aria-label': 'Remove this payment', title: 'Remove this payment',
        onclick: () => tryApi(() => api('DELETE', `/api/orders/${o.id}/payments/${p.id}`), 'Payment removed').then(done(redraw)) }, '×') : null })),
    o.left > 0 && o.status !== 'cancelled' && can('admin') ? addRow('Record a payment', 'Cash, bank transfer…', () => pay(false)) : null))));
  $('#main h2')?.focus({ preventScroll: true });
}
