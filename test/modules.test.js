// 081: People step 3b — the module frame (off by default, on/off keeps data, tools by role with all/none rules, held
// changes, page sections, merge / undo / export / erase / household delete over module rows), Events (household vs
// person registration, kids from the household, capacity and waiting list, automatic vs organizer confirmation,
// deadline, duties, attendance, CSV) and Orders (price list → order, kids free under an age, part payments, refunds,
// payment methods, filters and totals, the owner's due list), agent tools with role and confirm rules, admin MCP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
const owner = await t.login();
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vera', 'viewer password 123');
after(() => t.close());
const { TOOLS } = await import('../src/panel/admin-tools.js');
const { upkeepTick } = await import('../src/core/upkeep.js');
const { ownerNow } = await import('../src/core/owner-clock.js');
/** Today on the owner's clock, at `hhmm`. */
const ownerAt = (hhmm) => { const mins = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)); const now = Date.now(); return now + (mins(hhmm) - mins(ownerNow(now).hhmm)) * 60000; };
const api = async (m, p, b) => { const r = await t.api(owner, m, p, b); if (r.status >= 400) throw Object.assign(new Error(r.body.error || r.body), { status: r.status, field: r.body.field }); return r.body; };
const x = { call: (m, p, b) => api(m, p, b) };
const tool = (n) => TOOLS.find((y) => y.name === n);
const jid = (phone) => `${phone}@s.whatsapp.net`;
const say = (chat, phone, text, o = {}) => t.route(t.msg({ chat, phone, senderJid: jid(phone), senderName: o.name || `P${phone.slice(-3)}`, text, ...o }));
/** One agent turn that calls a tool; returns the tool result the model got back and the tools it was offered. */
async function toolTurn(phone, name, input, chat = 'g1@g.us') {
  t.script.push([{ type: 'tool_use', id: `tu${t.claudeReqs.length}`, name, input }], [{ type: 'text', text: 'ok' }]);
  await say(chat, phone, '!panduga please');
  const res = t.claudeReqs.at(-1).messages.at(-1).content[0];
  return { tools: t.claudeReqs.at(-2).tools.map((y) => y.name), result: res.content, isError: res.is_error };
}
const confirmLast = async (phone = ORG) => { const code = t.sent.at(-1).text.match(/confirm ([A-Z0-9]{4})/)[1]; await say('g1@g.us', phone, `confirm ${code}`); return t.sent.at(-1).text; };
const ORG = '41790000001'; const ANU = '41790000002';

// People: the Chary family (Anu, Ravi; kids Vedika 4, Kabir 8) and the Rao family (Gita); Hari on his own
const person = (name, phone = '', birthday = '') => api('POST', '/api/people', { name, phone, birthday });
const anu = await person('Anu', ANU); const ravi = await person('Ravi', '41790000011');
const vedika = await person('Vedika', '', '2022-06-01'); const kabir = await person('Kabir', '', '2018-05-01');
const gita = await person('Gita', '41790000021'); const hari = await person('Hari', '41790000031');
const chary = await api('POST', '/api/households', { name: 'Chary family' });
for (const [p, role] of [[anu, 'adult'], [ravi, 'adult'], [vedika, 'kid'], [kabir, 'kid']]) await api('PUT', `/api/households/${chary.id}/members/${p.id}`, { role });
const rao = await api('POST', '/api/households', { name: 'Rao family' });
await api('PUT', `/api/households/${rao.id}/members/${gita.id}`, { role: 'adult' });
let sankranti;

test('modules are off by default (Web search on): no pages, no agent tools; viewers cannot switch them; on keeps going after off', async () => {
  const m = await api('GET', '/api/modules');
  assert.deepEqual(m.modules.map((r) => [r.id, r.on]), [['events', false], ['orders', false], ['sending', false], ['web', true], ['surveys', false]]);
  assert.equal((await t.api(owner, 'GET', '/api/module/events')).status, 409);
  assert.match((await t.api(owner, 'GET', '/api/orders')).body.error, /switched off/);
  t.script.push([{ type: 'text', text: 'hi' }]);
  await say('g1@g.us', ANU, '!panduga hi');
  assert.ok(!t.toolNames(t.claudeReqs.length - 1).some((n) => /^(events|orders)__/.test(n)));
  assert.equal((await t.api(viewer, 'PUT', '/api/modules/events', { on: true })).status, 403);
  for (const id of ['events', 'orders']) await api('PUT', `/api/modules/${id}`, { on: true });
  assert.deepEqual((await api('GET', '/api/modules')).methods, ['Cash', 'Bank transfer', 'Instant online payment']);
  const tools = await api('GET', '/api/modules/tools');
  assert.deepEqual(tools.map((g) => g.id).sort(), ['events', 'orders', 'web']);
  assert.equal(tools.find((g) => g.id === 'events').tools.find((y) => y.name === 'register_someone').organizerOnly, true);
});

test('an event is validated; household registration counts adults and kids from the household; the price list makes the order', async () => {
  const bad = await t.api(owner, 'POST', '/api/module/events', { name: 'X', starts: '14.1.2027' });
  assert.deepEqual([bad.status, bad.body.field], [400, 'starts']);
  assert.equal((await t.api(owner, 'POST', '/api/module/events', { name: 'X', starts: '2027-01-14', currency: 'francs' })).body.field, 'currency');
  sankranti = (await api('POST', '/api/module/events', { name: 'Sankranti 2027', starts: '2027-01-14', place: 'Aigle hall', capacity: 6, deadline: '2027-01-10', currency: 'CHF',
    per: 'household', confirm: 'auto', prices: { adult: 25, kid: 10, freeUnder: 5 }, payBy: '2027-01-08' })).event;
  const r = await toolTurn(ANU, 'events__register', { event: 'sankranti' });
  assert.ok(r.tools.includes('events__register') && r.tools.includes('orders__what_do_i_owe'));
  assert.ok(!r.tools.includes('events__register_someone') && !r.tools.includes('orders__mark_paid'), 'participants: no organizer tools');
  assert.match(r.result, /Chary family: registered for Sankranti 2027 \(2 adults, 2 kids\)/);
  const page = await api('GET', `/api/module/events/${sankranti.id}`);
  assert.deepEqual([page.counts.registrations, page.counts.adults, page.counts.kids, page.counts.left], [1, 2, 2, 2]);
  const { orders } = await api('GET', '/api/orders');
  assert.equal(orders.length, 1);
  const o = await api('GET', `/api/orders/${orders[0].id}`);
  assert.deepEqual(o.lines, [{ item: 'Adult', qty: 2, price: 2500 }, { item: 'Kid', qty: 1, price: 1000 }, { item: 'Kid under 5', qty: 1, price: 0 }]);
  assert.deepEqual([o.total, o.currency, o.due, o.status, o.who], [6000, 'CHF', '2027-01-08', 'open', 'Chary family']);
  assert.ok((await api('GET', `/api/people/${kabir.id}`)).timeline.some((e) => /registered for Sankranti/i.test(e.text)), 'timeline entry for every member');
  const owe = await toolTurn(ANU, 'orders__what_do_i_owe', {});
  assert.match(owe.result, /CHF 60\.00/);
  assert.match(owe.result, /Bank transfer/);
  // the person page and the household page show the module sections
  const pg = await api('GET', `/api/people/${anu.id}`);
  assert.deepEqual(pg.modules.map((s) => s.title), ['Events', 'Orders and payments']);
  assert.deepEqual((await api('GET', `/api/households/${chary.id}`)).modules.map((s) => s.title), ['Events', 'Orders and payments']);
});

test('capacity: a full event puts people on the waiting list; a cancellation lets them in by themselves; person registration', async () => {
  await api('POST', `/api/module/events/${sankranti.id}/registrations`, { household: rao.id, adults: 2, kids: 0 }); // 4 + 2 = 6: full
  const late = await api('POST', `/api/module/events/${sankranti.id}/registrations`, { person: hari.id }); // 1 more: waiting list
  assert.equal(late.status, 'waiting');
  assert.equal((await api('GET', `/api/module/events/${sankranti.id}`)).counts.waiting, 1);
  const hariOrders = () => api('GET', '/api/orders?status=all').then((r) => r.orders.filter((o) => o.person === hari.id));
  assert.equal((await hariOrders()).length, 0, 'no order while on the waiting list');
  const raoReg = (await api('GET', `/api/module/events/${sankranti.id}`)).registrations.find((r) => r.household === rao.id);
  await api('PUT', `/api/module/registrations/${raoReg.id}`, { status: 'cancelled' });
  const after = await api('GET', `/api/module/events/${sankranti.id}`);
  assert.equal(after.registrations.find((r) => r.person === hari.id).status, 'registered', 'the waiting person got the place');
  assert.deepEqual((await hariOrders()).map((o) => [o.total, o.status]), [[2500, 'open']]);
  assert.equal((await api('GET', '/api/orders?status=all')).orders.find((o) => o.household === rao.id).status, 'cancelled', 'unpaid order of a cancellation is cancelled');
});

test('capacity: a smaller party frees places for those who wait; an edited registration stays one registration', async () => {
  const fest = (await api('POST', '/api/module/events', { name: 'Ugadi 2027', starts: '2027-04-07', per: 'person', capacity: 4 })).event;
  const regs = async () => (await api('GET', `/api/module/events/${fest.id}`)).registrations;
  const of = async (key, id) => (await regs()).filter((r) => r[key] === id);
  const big = await api('POST', `/api/module/events/${fest.id}/registrations`, { household: chary.id }); // 2 adults + 2 kids: full
  const one = await api('POST', `/api/module/events/${fest.id}/registrations`, { person: hari.id });
  assert.deepEqual([big.status, one.status], ['registered', 'waiting']);
  await api('PUT', `/api/module/registrations/${big.id}`, { kids: 1 }); // 3 of 4: a place opened
  assert.equal((await of('person', hari.id))[0].status, 'registered', 'the one who waited got the place by itself');

  const rao3 = await api('POST', `/api/module/events/${fest.id}/registrations`, { household: rao.id, adults: 3 });
  assert.equal(rao3.status, 'waiting');
  await api('PUT', `/api/module/registrations/${one.id}`, { status: 'cancelled' }); // one place: three do not fit
  assert.equal((await of('household', rao.id))[0].status, 'waiting');
  await api('PUT', `/api/module/registrations/${rao3.id}`, { adults: 1 });
  assert.equal((await of('household', rao.id))[0].status, 'registered', 'a waiting party that got smaller fits now');

  // numbers of a cancelled registration: the same registration changes, no second one appears
  await api('PUT', `/api/module/registrations/${rao3.id}`, { status: 'cancelled' });
  await api('PUT', `/api/module/registrations/${rao3.id}`, { adults: 2, notes: 'two after all' });
  assert.deepEqual((await of('household', rao.id)).map((r) => [r.id, r.status, r.adults, r.notes]), [[rao3.id, 'cancelled', 2, 'two after all']]);
  // back in with new numbers in one step: the capacity is checked against the new numbers (3 + 2 > 4)
  const back = await api('PUT', `/api/module/registrations/${rao3.id}`, { status: 'registered', adults: 2 });
  assert.deepEqual([(await of('household', rao.id)).length, back.status], [1, 'waiting']);
  await assert.rejects(api('PUT', `/api/module/registrations/${rao3.id}`, { status: 'nonsense', adults: 1 }), /Status:/);
  assert.equal((await of('household', rao.id))[0].adults, 2, 'a refused change changes nothing');
});

test('organizer confirmation: self-registration is pending until an organizer confirms (held, confirm code); the deadline binds participants only', async () => {
  const diwali = (await api('POST', '/api/module/events', { name: 'Diwali 2027', starts: '2027-11-01', per: 'person', confirm: 'organizer', deadline: '2027-10-20' })).event;
  const r = await toolTurn('41790000031', 'events__register', { event: 'diwali' });
  assert.match(r.result, /waiting for an organizer to confirm/);
  const held = await toolTurn(ORG, 'events__update_registration', { event: 'diwali', who: 'Hari', status: 'registered' });
  assert.match(held.result, /Held for an organizer's confirmation/);
  assert.match(await confirmLast(), /Hari: registered for Diwali 2027/);
  assert.equal((await api('GET', `/api/module/events/${diwali.id}`)).counts.pending, 0);
  // a participant cannot confirm; an organizer registers a household for someone (held), past events' deadline
  const past = (await api('POST', '/api/module/events', { name: 'Picnic', starts: '2027-06-01', per: 'household', deadline: '2020-01-01' })).event;
  const closed = await toolTurn(ANU, 'events__register', { event: 'picnic' });
  assert.match(closed.result, /closed on 2020-01-01/);
  const seen = JSON.parse((await toolTurn(ANU, 'events__list_events', {})).result);
  assert.deepEqual(['Picnic', 'Diwali 2027'].map((n) => seen.find((e) => e.name === n).registrationClosed), [true, false], 'agents read whether registration is closed');
  const org = await toolTurn(ORG, 'events__register_someone', { event: 'picnic', who: 'Rao family', notes: 'vegetarian' });
  assert.match(org.result, /Held/);
  const code = t.sent.at(-1).text.match(/confirm ([A-Z0-9]{4})/)[1];
  await say('g1@g.us', ANU, `confirm ${code}`);
  assert.match(t.sent.at(-1).text, /Only organizers/);
  await say('g1@g.us', ORG, `confirm ${code}`);
  const list = await toolTurn(ORG, 'events__registration_list', { event: 'picnic' });
  assert.match(list.result, /Rao family.*vegetarian/);
  assert.equal((await api('GET', `/api/module/events/${past.id}`)).counts.registrations, 1);
});

test('duties: anyone takes one with room left; organizers assign (held); attendance; CSV is safe for spreadsheets', async () => {
  await api('POST', `/api/module/events/${sankranti.id}/duties`, { task: 'Set up chairs', at: '09:00', needed: 1 });
  const take = await toolTurn(ANU, 'events__take_duty', { event: 'sankranti', duty: 'chairs' });
  assert.doesNotMatch(take.result, /error/i);
  const full = await toolTurn('41790000031', 'events__take_duty', { event: 'sankranti', duty: 'Set up chairs' });
  assert.match(full.result, /already has the 1 person/);
  const page = await api('GET', `/api/module/events/${sankranti.id}`);
  assert.deepEqual(page.duties[0].people.map((p) => p.name), ['Anu']);
  // a duty is changed in place: what is not sent stays, and so does who took it
  const duty = page.duties[0];
  const more = await api('PUT', `/api/module/duties/${duty.id}`, { needed: 2 });
  assert.deepEqual([more[0].task, more[0].at, more[0].needed, more[0].open, more[0].people.map((p) => p.name)], ['Set up chairs', '09:00', 2, 1, ['Anu']]);
  const renamed = await tool('save_event_duty').run({ duty: duty.id, task: 'Set up the chairs' }, x);
  assert.deepEqual([renamed[0].task, renamed[0].at, renamed[0].needed], ['Set up the chairs', '09:00', 2], 'the admin tool changes only the task');
  await api('PUT', `/api/module/duties/${duty.id}`, { at: '' });
  assert.equal((await api('GET', `/api/module/events/${sankranti.id}`)).duties[0].at, '', 'a time can be taken away');
  await api('PUT', `/api/module/duties/${duty.id}/people/${ravi.id}`, { on: true });
  const fewer = await t.api(owner, 'PUT', `/api/module/duties/${duty.id}`, { needed: 1 });
  assert.deepEqual([fewer.status, fewer.body.field], [400, 'needed']);
  assert.match(fewer.body.error, /2 people have taken "Set up the chairs": take someone off/);
  assert.equal((await t.api(owner, 'PUT', '/api/module/duties/d_missing', { needed: 3 })).status, 404);
  await api('PUT', `/api/module/duties/${duty.id}/people/${ravi.id}`, { on: false });
  await api('PUT', `/api/module/duties/${duty.id}`, { task: 'Set up chairs', at: '09:00', needed: 1 });
  const reg = page.registrations.find((r) => r.household === chary.id);
  await api('PUT', `/api/module/registrations/${reg.id}`, { attended: true, notes: '=HYPERLINK("x")' });
  const r = await fetch(`${t.base}/api/module/events/${sankranti.id}/csv`, { headers: { cookie: owner } });
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const text = await r.text();
  assert.match(text, /"Chary family","household","registered","2","2","'=HYPERLINK\(""x""\)","yes"/);
});

test('payments: part paid, paid, refund; methods are the owner\'s list; organizers mark paid through the agent (held)', async () => {
  const o = (await api('GET', '/api/orders')).orders.find((y) => y.household === chary.id);
  assert.equal((await t.api(owner, 'POST', `/api/orders/${o.id}/payments`, { amount: 10, method: 'Bitcoin' })).body.field, 'method');
  let r = await api('POST', `/api/orders/${o.id}/payments`, { amount: 20, method: 'cash' });
  assert.deepEqual([r.status, r.paid, r.left], ['part', 2000, 4000]);
  await api('PUT', '/api/orders/methods', { methods: ['Cash', 'TWINT'] });
  const held = await toolTurn(ORG, 'orders__mark_paid', { who: 'Chary family', event: 'Sankranti', method: 'twint' });
  assert.match(held.result, /CHF 40\.00 paid by Chary family/);
  await confirmLast();
  r = await api('GET', `/api/orders/${o.id}`);
  assert.deepEqual([r.status, r.paid, r.payments.map((p) => p.method)], ['paid', 6000, ['Cash', 'TWINT']]);
  const owe = await toolTurn(ORG, 'orders__who_has_not_paid', { event: 'sankranti' });
  assert.match(owe.result, /"collected":"CHF 60\.00"/);
  assert.match(owe.result, /Hari/);
  // refunds
  r = await api('POST', `/api/orders/${o.id}/payments`, { refund: true, amount: 60 });
  assert.equal(r.status, 'refunded');
  assert.equal((await t.api(owner, 'POST', `/api/orders/${o.id}/payments`, { refund: true, amount: 1 })).status, 400, 'nothing left to refund');
  // filters and totals per event
  const page = await api('GET', `/api/orders?status=all&event=${sankranti.id}`);
  assert.ok(page.events.find((e) => e.id === sankranti.id).orders >= 2);
  const hand = await api('POST', '/api/orders', { person: gita.id, title: 'T-shirt', lines: [{ item: 'T-shirt', qty: 2, price: '15.50' }], due: '2020-02-01' });
  assert.equal(hand.total, 3100);
  assert.ok((await api('GET', '/api/orders?status=overdue')).orders.some((y) => y.id === hand.id));
});

test('the owner gets one list a day of orders due soon or overdue, in the sending hours of the owner\'s day (never at night)', async () => {
  const sent = t.sent.length;
  await t.agents.updateAgent('owner-assistant', { alerts: { to: '+41 79 000 00 99' } });
  const lists = () => t.sent.slice(sent).filter((m) => /open orders? due soon or overdue/.test(m.text));
  await upkeepTick(t.channel, ownerAt('01:30'));
  assert.equal(lists().length, 0, 'the day has begun, but nobody is written to at night');
  await upkeepTick(t.channel, ownerAt('09:05'));
  assert.equal(lists().length, 1, JSON.stringify(t.sent.slice(sent)));
  assert.match(lists()[0].text, /Gita: CHF 31\.00 for T-shirt, overdue since 2020-02-01/);
  await upkeepTick(t.channel, ownerAt('15:00'));
  assert.equal(lists().length, 1, 'once a day');
});

test('the owner\'s day, not the UTC day: a deadline closes at the owner\'s midnight and a payment is dated where the owner lives', async (tt) => {
  const ev = await import('../src/modules/events/index.js');
  await t.agents.updateAgent('owner-assistant', { timezone: 'Asia/Kolkata' }); // UTC+5:30, no summer time
  try {
    const mela = (await api('POST', '/api/module/events', { name: 'Mela 2027', starts: '2027-02-01', per: 'person', deadline: '2027-01-10' })).event;
    tt.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-10T18:00:00Z') }); // 23:30 on the 10th for the owner
    assert.equal(ev.register({ event: mela.id, person: hari.id }, { by: 'Hari', organizer: false }).status, 'registered');
    assert.equal(ev.eventPage(mela.id).event.registrationClosed, false, 'open until the owner\'s day ends');
    tt.mock.timers.setTime(Date.parse('2027-01-10T20:00:00Z')); // 01:30 on the 11th for the owner; still the 10th in UTC
    assert.throws(() => ev.register({ event: mela.id, person: gita.id }, { by: 'Gita', organizer: false }), /closed on 2027-01-10/);
    assert.equal(ev.eventPage(mela.id).event.registrationClosed, true, 'the page says what the server does');
    const ord = await import('../src/modules/orders/index.js');
    const o = ord.createOrder({ person: gita.id, lines: [{ item: 'Sweets', qty: 1, price: 5 }] });
    assert.equal(ord.addPayment(o.id, {}).payments[0].at, '2027-01-11', 'paid on the 11th where the owner lives');
  } finally { tt.mock.timers.reset(); await t.agents.updateAgent('owner-assistant', { timezone: '' }); }
  const anyOrder = (await api('GET', '/api/orders?status=all')).orders[0];
  assert.equal((await api('GET', `/api/orders/${anyOrder.id}`)).today, ownerNow().date, 'the payment dialog starts at the owner\'s day');
});

test('tool rules: none for participants removes the tools; switching a module off removes its tools and keeps its data', async () => {
  await t.agents.updateAgent('panduga', { tools: { ...t.agents.getAgent('panduga').tools, participant: ['events:-'] } });
  const r = await toolTurn(ANU, 'orders__what_do_i_owe', {});
  assert.ok(!r.tools.some((n) => n.startsWith('events__')) && r.tools.includes('orders__what_do_i_owe'));
  await t.agents.updateAgent('panduga', { tools: { ...t.agents.getAgent('panduga').tools, participant: [] } });
  await api('PUT', '/api/modules/events', { on: false });
  const off = await toolTurn(ANU, 'orders__what_do_i_owe', {});
  assert.ok(!off.tools.some((n) => n.startsWith('events__')));
  assert.equal((await t.api(owner, 'GET', `/api/module/events/${sankranti.id}`)).status, 409);
  assert.ok(!(await api('GET', `/api/people/${anu.id}`)).modules.some((s) => s.title === 'Events'));
  await api('PUT', '/api/modules/events', { on: true });
  assert.equal((await api('GET', `/api/module/events/${sankranti.id}`)).counts.registrations, 2, 'data kept');
});

test('merge, undo, export and erase cover module rows; deleting a household deletes its registrations and orders', async () => {
  const hari2 = await person('Hari (Telegram)');
  await api('POST', `/api/module/events/${sankranti.id}/registrations`, { person: hari2.id }); // waiting list
  const m = await api('POST', `/api/people/${hari.id}/merge`, { other: hari2.id });
  const regsOf = async (id) => (await api('GET', `/api/module/events/${sankranti.id}`)).registrations.filter((r) => r.person === id).length;
  assert.equal(await regsOf(hari.id), 2);
  await api('POST', `/api/people/merges/${m.merge}/undo`);
  assert.deepEqual([await regsOf(hari.id), await regsOf(hari2.id)], [1, 1]);
  const ex = await api('GET', `/api/people/${hari.id}/export`);
  assert.equal(ex.modules.events.ev_registrations.filter((r) => r.event === sankranti.id).length, 1);
  assert.ok(ex.modules.orders.ord_orders.length >= 1 && 'ord_lines' in ex.modules.orders);
  const erased = await api('DELETE', `/api/people/${hari.id}`);
  assert.ok(erased.moduleRows >= 2);
  assert.equal((await api('GET', '/api/orders?status=all')).orders.filter((o) => o.person === hari.id).length, 0);
  await api('DELETE', `/api/households/${rao.id}`);
  assert.ok(!(await api('GET', `/api/module/events/${sankranti.id}`)).registrations.some((r) => r.household === rao.id));
});

test('admin MCP: modules on/off, events, registrations, duties, orders, payments and methods; risky ones need a confirm', async () => {
  const names = ['list_modules', 'set_module_enabled', 'list_events', 'get_event', 'save_event', 'delete_event', 'register_for_event', 'update_registration', 'save_event_duty',
    'list_orders', 'get_order', 'create_order', 'record_payment', 'set_payment_methods'];
  for (const n of names) assert.ok(tool(n), n);
  for (const n of ['set_module_enabled', 'delete_event', 'record_payment']) assert.ok(tool(n).risky, `${n} is confirmed`);
  const ev = await tool('get_event').run({ event: 'sankranti' }, x);
  assert.equal(ev.counts.kids, 2, 'how many kids registered');
  const unpaid = await tool('list_orders').run({ status: 'open', event: 'Sankranti' }, x);
  assert.ok(Array.isArray(unpaid.orders));
  assert.match(await tool('record_payment').preview({ order: (await api('GET', '/api/orders')).orders[0].id, amount: 5 }, x), /Record a payment of CHF 5\.00 for /);
});

test('085: page rows carry days as parts the panel formats; an overdue order says so; one money format', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await api('POST', '/api/orders', { person: gita.id, title: 'Club cap', lines: [{ item: 'Cap', qty: 1, price: 12.5 }], due: yesterday });
  const rows = (await api('GET', `/api/people/${gita.id}`)).modules.find((s) => s.title === 'Orders and payments').rows;
  const cap = rows.find((r) => r.name.startsWith('Club cap'));
  assert.equal(cap.name, 'Club cap: CHF 12.50');
  assert.deepEqual(cap.sub, ['overdue', 'CHF 12.50 left', { day: yesterday, before: 'was due' }]);
  const ev = (await api('GET', `/api/people/${anu.id}`)).modules.find((s) => s.title === 'Events').rows[0];
  assert.ok(ev.sub.some((p) => typeof p === 'object' && /^\d{4}-\d{2}-\d{2}/.test(p.day)), 'the event day is a part, not a preformatted string');
});
