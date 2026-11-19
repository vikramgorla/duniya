// Events and Orders (081): People → Events (list → event page with registrations, waiting list, duties, payments)
// and People → Orders (list with filters and totals per event → order page with lines and payments). Loaded from
// people.js on first visit, only when the module is on. Names and notes are built from text nodes.
import { $, S, api, ask, avatar, can, emptyState, field, h, icon, menu, tryApi } from './core.js';
import { day, helpLink, money, plural } from './shared.js';
import { moduleBlocks, peopleNav, pickPerson } from './people.js';
const enc = encodeURIComponent;
const STATUS = { registered: ['Registered', 'ok'], waiting: ['Waiting list', 'warn'], pending: ['To confirm', 'info'], cancelled: ['Cancelled', ''],
  open: ['Not paid', 'warn'], part: ['Part paid', 'info'], paid: ['Paid', 'ok'], refunded: ['Refunded', ''], overdue: ['Overdue', 'bad'] };
const pill = (s) => h('span', { class: `pill ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);
export const row = (name, sub, { href = null, mark = null, end = null, onclick = null } = {}) => h('li', { class: end ? 'has-end' : null },
  h(href ? 'a' : 'button', { class: 'lrow', href, type: href ? null : 'button', onclick }, mark,
    h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, name), sub ? h('span', { class: 'lrow-sub' }, sub) : null), href || onclick ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null), end);
const addRow = (label, sub, onclick) => row(label, sub, { onclick, mark: h('span', { class: 'lmark c3', 'aria-hidden': 'true' }, '+') });
export const group = (title, ...kids) => h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, title), kids);
const dateMark = (d) => h('span', { class: 'lmark c2', 'aria-hidden': 'true' }, d ? String(Number(d.slice(8, 10))) : '?');
export const back = (href, label) => h('a', { class: 'sub-back', href }, icon('back'), label);
const modOn = (id) => (S.status?.settings?.modulesOn || []).includes(id);
const sendingOn = () => modOn('sending'); // 082: Lists and sending
/** 085: the messages and campaigns sent to an event's (or a survey's) people, newest first, and a row to send a new one. */
export async function sentBlock(match, newHref, newLabel) {
  if (!sendingOn() || !can('admin')) return null;
  const g = await api('GET', '/api/sending').catch(() => null);
  if (!g) return null;
  const runs = g.runs.filter(match); const camps = g.campaigns.filter(match);
  return group('Messages', h('ul', {}, runs.map((r) => row(r.title, `${day(r.createdAt, true)} · ${r.counts.reached} of ${r.counts.total - r.counts.skipped} sent`, { href: `#people/sending/${enc(r.id)}`, end: h('span', { class: 'row-end' }, runPill(r.status)) })),
    camps.map((c) => row(c.title, `Campaign · step ${Math.min(c.step + 1, c.steps.length)} of ${c.steps.length}`, { href: `#people/sending/campaign/${enc(c.id)}`, end: h('span', { class: 'row-end' }, runPill(c.status, true)) })),
    addRow(newLabel, 'Each person in their own chat, if they agreed', () => { location.hash = newHref; })));
}
const RUN = { running: ['Sending', 'info'], paused: ['Paused', 'warn'], stopped: ['Stopped', ''], done: ['Done', 'ok'], draft: ['Draft', ''] };
/** A message's (or campaign's: running = "Running") state as a pill. */
export const runPill = (s, campaign = false) => h('span', { class: `pill ${RUN[s]?.[1] || ''}` }, campaign && s === 'running' ? 'Running' : RUN[s]?.[0] || s);
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
    list.length ? h('ul', { class: 'people-list' }, list.map((e) => row(e.name, [day(e.starts, true), e.place, plural(e.counts.people, 'person', 'people')].filter(Boolean).join(' · '), { href: `#people/events/${enc(e.id)}`, mark: dateMark(e.starts) })))
      : emptyState('list', past ? 'No past events' : 'No upcoming events', 'Create one; people then register here or by asking an agent ("register us for Sankranti").', h('button', { class: 'btn primary', onclick: create }, 'New event'))));
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
    end: can('admin') ? menu(`More for ${r.who}`, // the group title says the status
      r.status !== 'registered' ? h('button', { class: 'btn small', type: 'button', onclick: () => set(r, { status: 'registered' }, r.status === 'pending' ? 'Confirmed' : 'Registered') }, r.status === 'pending' ? 'Confirm' : 'Register') : null,
      r.status !== 'waiting' && r.status !== 'cancelled' ? h('button', { class: 'btn small', type: 'button', onclick: () => set(r, { status: 'waiting' }, 'On the waiting list') }, 'Waiting list') : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => numbers(r) }, 'Change numbers…'),
      r.status === 'registered' ? h('button', { class: 'btn small', type: 'button', onclick: () => set(r, { attended: !r.attended }, 'Saved') }, r.attended ? 'Did not come' : 'Came') : null,
      r.status !== 'cancelled' ? h('button', { class: 'btn small danger', type: 'button', onclick: () => set(r, { status: 'cancelled' }, 'Cancelled') }, 'Cancel registration') : null) : null });
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
  const prices = e.prices.adult || e.prices.kid ? `${money(e.prices.adult, e.currency)} an adult, ${money(e.prices.kid, e.currency)} a kid${e.prices.freeUnder ? ` (under ${e.prices.freeUnder} free)` : ''}` : '';
  const cancelled = by('cancelled');
  const came = by('registered').filter((r) => r.attended).length;
  const today = new Date().toISOString().slice(0, 10);
  const sent = await sentBlock((x) => ['event', 'orders'].includes(x.audience?.kind) && x.audience.event === e.id, `people/sending/new?kind=event&event=${enc(e.id)}&title=${enc(e.name)}`, 'Message the registered people');
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, bk,
    h('div', { class: 'ap-head' }, dateMark(e.starts),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, e.name), h('div', { class: 'small muted' }, [`${day(e.starts)}${e.ends && e.ends !== e.starts ? ` – ${day(e.ends)}` : ''}`, e.place].filter(Boolean).join(' · '))),
      can('admin') ? menu(`More for ${e.name}`, h('button', { class: 'btn small', type: 'button', onclick: () => editEvent(e).then(done(redraw)) }, 'Edit…'),
        sendingOn() && modOn('orders') ? h('button', { class: 'btn small', type: 'button', onclick: () => autoReminders(e) }, 'Automatic payment reminders…') : null,
        h('a', { class: 'btn small', href: `/api/module/events/${e.id}/csv`, download: '' }, 'Download CSV'), h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete…')) : null),
    h('p', { class: 'small', style: 'margin:8px 0 0' }, [countsLine(c), came ? `${came} came` : ''].filter(Boolean).join(' · ')),
    h('p', { class: 'small muted', style: 'margin:4px 0 0' }, [e.deadline ? `Registration ${e.deadline < today ? 'closed' : 'closes'} ${day(e.deadline, true)}` : 'Registration open',
      e.per === 'household' ? 'per household' : 'per person', e.confirm === 'organizer' ? 'an organizer confirms' : '', prices].filter(Boolean).join(' · ')),
    by('pending').length ? group('To confirm', h('ul', {}, by('pending').map(regRow))) : null,
    group('Registered', h('ul', {}, by('registered').map(regRow), addRow('Register someone', 'A person or a household', register))),
    by('waiting').length ? group('Waiting list', h('ul', {}, by('waiting').map(regRow)), h('p', { class: 'small muted lempty' }, 'They get a place by themselves, in order, when one opens up.')) : null,
    group('Duties', h('ul', {}, g.duties.map(dutyRow), addRow('Add a duty', 'A task, when, how many people', addDuty))),
    moduleBlocks(g.modules),
    sent,
    cancelled.length ? h('details', { class: 'sblock' }, h('summary', {}, `Cancelled (${cancelled.length})`), h('ul', { class: 'mini-list' }, cancelled.map(regRow))) : null));
  $('#main h2')?.focus({ preventScroll: true });
}

/** 082: payment reminders sent by themselves a few days before the due date (Orders with Lists and sending). */
async function autoReminders(e) {
  const [cur, agents] = await Promise.all([api('GET', `/api/order-reminders?event=${enc(e.id)}`), api('GET', '/api/agents')]);
  const mine = cur.auto[e.id];
  const days = h('input', { type: 'number', min: 0, max: 30, value: mine?.days ?? 3 });
  const agent = h('select', {}, agents.filter((a) => !a.builtin && a.enabled).map((a) => h('option', { value: a.id, selected: a.id === mine?.agent }, a.name)));
  const text = h('textarea', { rows: 4, maxlength: 1500 }, mine?.template || cur.template);
  const state = h('select', {}, h('option', { value: '1', selected: !!mine }, 'On'), h('option', { value: '', selected: !mine }, 'Off'));
  if (!await ask({ title: `Payment reminders for ${e.name}`, ok: 'Save', wide: true,
    text: 'People with an open order who agreed to updates get a reminder by themselves, once per due date, at the sending pace. Your switch is the confirmation.',
    body: [h('div', { class: 'grid2' }, field('Automatic reminders', state), field('Days before the due date', days)), field('Replies go to', agent), field('Message', text, '{first_name} {amount} {due} {event} {ways_to_pay}')] })) return;
  const on = !!state.value;
  tryApi(() => api('PUT', `/api/order-reminders/${e.id}`, { on, days: Number(days.value), agent: agent.value, template: text.value }), on ? 'Reminders on' : 'Reminders off');
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
    h('div', { class: 'ld-tools', style: 'margin-top:8px' }, seg, menu('More for these orders', h('a', { class: 'btn small', href: `/api/orders/csv?status=${status}${event ? `&event=${enc(event)}` : ''}`, download: '' }, 'Download CSV'),
      h('a', { class: 'btn small', href: '#settings/modules' }, 'Ways to pay…'))),
    sendingOn() && g.orders.some((o) => o.left > 0) ? h('p', { class: 'small', style: 'margin:2px 0 0' }, h('a', { class: 'qfix', href: `#people/sending/new?kind=orders${event ? `&event=${enc(event)}` : ''}` }, 'Remind everyone who has not paid')) : null,
    g.events.length ? group('By event', h('ul', {}, ev ? row('All events', '', { href: '#people/orders' }) : null, g.events.filter((x) => !ev || x.id === ev.id).map((x) => row(x.name,
      `${money(x.paid, x.currency)} of ${money(x.total, x.currency)} collected · ${x.unpaid ? `${plural(x.unpaid, 'order')} not fully paid` : 'all paid'}`, { href: `#people/orders?event=${enc(x.id)}` })))) : null,
    g.orders.length ? h('ul', { class: 'people-list', style: 'margin-top:10px' }, g.orders.map((o) => row(o.who, [o.title, o.left && o.status !== 'cancelled' ? `${money(o.left, o.currency)} left` : money(o.total, o.currency),
      o.due ? `${o.overdue ? 'was due' : 'due'} ${day(o.due, true)}` : ''].filter(Boolean).join(' · '), { href: `#people/orders/${enc(o.id)}`, end: h('span', { class: 'row-end' }, pill(o.overdue ? 'overdue' : o.status)) })))
      : emptyState('list', status === 'all' ? 'No orders yet' : 'Nothing here', status === 'all' ? 'An event with prices makes an order for each registration; add one by hand for anything else. Duniya records payments, it never takes money.' : 'No order in this view. All shows every order.',
        status === 'all' ? h('button', { class: 'btn primary', onclick: create }, 'New order') : h('button', { class: 'btn', onclick: () => { status = 'all'; orderList(event); } }, 'Show all orders'))));
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
    h('div', { class: 'ap-head' }, avatar(o.who, o.person || o.household, 'l'),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, o.title), h('div', { class: 'small muted' }, h('a', { href: whoHref }, o.who), o.event ? [' · ', h('a', { href: `#people/events/${enc(o.event)}` }, o.eventName)] : null)),
      can('admin') ? menu('More for this order', h('button', { class: 'btn small', type: 'button', onclick: edit }, 'Edit…'),
        o.paid > 0 ? h('button', { class: 'btn small', type: 'button', onclick: () => pay(true) }, 'Refund…') : null, h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete…')) : null),
    h('p', { class: 'small', style: 'margin:8px 0 0' }, pill(o.overdue ? 'overdue' : o.status), ' ', [`${money(o.total, o.currency)}`, o.paid ? `${money(o.paid, o.currency)} paid` : o.status === 'cancelled' ? '' : 'nothing paid yet',
      o.left && o.status !== 'cancelled' ? `${money(o.left, o.currency)} left` : '', o.due && o.left ? `${o.overdue ? 'was due' : 'due'} ${day(o.due, true)}` : ''].filter(Boolean).join(' · ')),
    o.note ? h('p', { class: 'small muted' }, o.note) : null,
    group('Lines', h('ul', {}, o.lines.map((l) => row(`${l.qty} × ${l.item}`, `${money(l.price, o.currency)} each · ${money(l.qty * l.price, o.currency)}`)))),
    group('Payments', h('ul', {}, o.payments.map((p) => row(`${p.amount < 0 ? 'Refund' : 'Payment'} ${money(Math.abs(p.amount), o.currency)}`, [day(p.at), p.method, p.by].filter(Boolean).join(' · '), {
      end: can('admin') ? h('button', { class: 'btn small ghost icon rm', type: 'button', 'aria-label': 'Remove this payment', title: 'Remove this payment',
        onclick: () => tryApi(() => api('DELETE', `/api/orders/${o.id}/payments/${p.id}`), 'Payment removed').then(done(redraw)) }, '×') : null })),
    o.left > 0 && o.status !== 'cancelled' && can('admin') ? addRow('Record a payment', 'Cash, bank transfer…', () => pay(false)) : null))));
  $('#main h2')?.focus({ preventScroll: true });
}
