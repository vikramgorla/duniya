// @ts-check
// Orders and payments module (081): what people owe and paid. Duniya records payments; it never takes money.
//   - An order belongs to a person or a household, optionally to an event (then its currency is the event's), with
//     lines (item, quantity, price), a total and a due date. Amounts are kept in cents.
//   - Payments: amount, date, method from the owner's own list (Settings → Modules → Orders; defaults cash, bank
//     transfer, instant online payment). Refunds are payments with a negative amount.
//   - Status: open, part paid, paid, refunded (money given back), cancelled (its registration was cancelled before
//     anything was paid).
//   - An event's price list (adult, kid, free under an age) turns a registration into an order by itself when it is
//     registered (the Events module's 'registration' signal); new numbers change an unpaid order; a cancellation
//     cancels an unpaid one.
//   - Before the due date the owner gets one list a day of open orders due within three days or overdue (owner
//     alert; sending reminders to people comes with list sending).
import { randomBytes } from 'node:crypto';
import { db, kvGet, kvSet } from '../../core/db.js';
import { fail, plural } from '../../core/config.js';
import { TENANT, getSetting, updateSettings } from '../../core/store.js';
import { activity } from '../../core/events.js';
import { addEvent, getHousehold, householdsOf, personRow } from '../../core/people.js';
import { sendOwnerAlert } from '../../core/owner-alerts.js';
import { changeOrHold } from '../index.js';
import { getEvent } from '../events/index.js';
import { orderTools } from './tools.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ord_orders (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, person TEXT NOT NULL DEFAULT '', household TEXT NOT NULL DEFAULT '', event TEXT NOT NULL DEFAULT '',
    registration TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'CHF', total INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0, due TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS ord_orders_status ON ord_orders (tenant_id, status, due);
  CREATE INDEX IF NOT EXISTS ord_orders_event ON ord_orders (tenant_id, event, status);
  CREATE INDEX IF NOT EXISTS ord_orders_person ON ord_orders (tenant_id, person);
  CREATE INDEX IF NOT EXISTS ord_orders_household ON ord_orders (tenant_id, household);
  CREATE INDEX IF NOT EXISTS ord_orders_registration ON ord_orders (tenant_id, registration);
  CREATE INDEX IF NOT EXISTS ord_orders_created ON ord_orders (tenant_id, created_at);
  CREATE TABLE IF NOT EXISTS ord_lines (tenant_id TEXT NOT NULL, ord TEXT NOT NULL, n INTEGER NOT NULL, item TEXT NOT NULL, qty INTEGER NOT NULL, price INTEGER NOT NULL, PRIMARY KEY (tenant_id, ord, n));
  CREATE TABLE IF NOT EXISTS ord_payments (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, ord TEXT NOT NULL, amount INTEGER NOT NULL, at TEXT NOT NULL, method TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS ord_payments_ord ON ord_payments (tenant_id, ord);
`);

const rid = (p) => `${p}_${randomBytes(6).toString('hex')}`;
const clean = (v, n = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const STATUS_WORD = { open: 'open', part: 'part paid', paid: 'paid', refunded: 'refunded', cancelled: 'cancelled' };
/** "CHF 25.00" */
export const money = (cents, cur) => `${cur} ${(Number(cents || 0) / 100).toFixed(2)}`;
const cents = (v, field) => {
  const n = Math.round(Number(String(v ?? '').replace(',', '.')) * 100);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw fail('Give an amount, e.g. 25 or 12.50', 400, { field });
  return n;
};

// ---------- payment methods (the owner's own list) ----------
const DEFAULT_METHODS = ['Cash', 'Bank transfer', 'Instant online payment'];
export const paymentMethods = () => { const l = getSetting('paymentMethods', null); return Array.isArray(l) && l.length ? l : DEFAULT_METHODS; };
export function setPaymentMethods(list, by = 'panel') {
  const next = [...new Set((Array.isArray(list) ? list : []).map((m) => clean(m, 40)).filter(Boolean))].slice(0, 20);
  if (!next.length) throw fail('Keep at least one way to pay', 400, { field: 'methods' });
  updateSettings({ paymentMethods: next });
  activity('config', { summary: `Payment methods: ${next.join(', ')} (${by})` });
  return next;
}
const methodOf = (m) => { const want = clean(m, 40).toLowerCase(); const l = paymentMethods(); return !want ? l[0] : l.find((x) => x.toLowerCase() === want) || l.find((x) => x.toLowerCase().includes(want)) || null; };

// ---------- orders ----------
const row = (id) => db.prepare('SELECT * FROM ord_orders WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || ''));
const hhName = (id) => db.prepare('SELECT name FROM households WHERE tenant_id = ? AND id = ?').get(TENANT, id)?.name || 'A household';
const whoOf = (o) => (o.household ? hhName(o.household) : personRow(o.person)?.name || 'Someone');
const eventName = (id) => (id ? db.prepare('SELECT name FROM ev_events WHERE tenant_id = ? AND id = ?').get(TENANT, id)?.name || '' : '');
const linesOf = (id) => db.prepare('SELECT item, qty, price FROM ord_lines WHERE tenant_id = ? AND ord = ? ORDER BY n').all(TENANT, id);
const view = (o, full = false) => ({ id: o.id, person: o.person, household: o.household, who: whoOf(o), event: o.event, eventName: eventName(o.event), title: o.title || eventName(o.event) || 'Order',
  currency: o.currency, total: o.total, paid: o.paid, left: Math.max(0, o.total - o.paid), due: o.due, status: o.status, overdue: ['open', 'part'].includes(o.status) && !!o.due && o.due < today(),
  note: o.note, createdAt: o.created_at, ...(full ? { lines: linesOf(o.id), payments: db.prepare('SELECT id, amount, at, method, note, by FROM ord_payments WHERE tenant_id = ? AND ord = ? ORDER BY at, created_at').all(TENANT, o.id) } : {}) });
export function getOrder(id) { const o = row(id); if (!o) throw fail('No such order', 404); return view(o, true); }
const notePeople = (o, text) => { const ids = o.household ? (() => { try { return getHousehold(o.household).members.filter((m) => m.role === 'adult').map((m) => m.person); } catch { return []; } })() : [o.person]; for (const p of ids.filter(Boolean)) addEvent(p, text); };

/** Status from what was paid: refunds bring it back to refunded when nothing is left paid. */
function restatus(id) {
  const o = row(id);
  const sums = db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid, COALESCE(SUM(amount < 0), 0) AS refunds FROM ord_payments WHERE tenant_id = ? AND ord = ?').get(TENANT, id);
  const status = o.status === 'cancelled' && !sums.paid ? 'cancelled' : sums.refunds && sums.paid <= 0 ? 'refunded' : sums.paid >= o.total && o.total > 0 ? 'paid' : sums.paid > 0 ? 'part' : 'open';
  db.prepare('UPDATE ord_orders SET paid = ?, status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(sums.paid, status, Date.now(), TENANT, id);
  return row(id);
}
function writeLines(id, lines) {
  db.prepare('DELETE FROM ord_lines WHERE tenant_id = ? AND ord = ?').run(TENANT, id);
  const ins = db.prepare('INSERT INTO ord_lines (tenant_id, ord, n, item, qty, price) VALUES (?, ?, ?, ?, ?, ?)');
  lines.forEach((l, i) => ins.run(TENANT, id, i, l.item, l.qty, l.price));
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  db.prepare('UPDATE ord_orders SET total = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(total, Date.now(), TENANT, id);
  return restatus(id);
}
const cleanLines = (lines) => {
  const out = (Array.isArray(lines) ? lines : []).map((l, i) => {
    const item = clean(l.item, 80); const qty = Number(l.qty ?? 1);
    if (!item) throw fail(`Line ${i + 1}: what is it?`, 400, { field: 'lines' });
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw fail(`Line ${i + 1}: quantity 1 to 1000`, 400, { field: 'lines' });
    const price = cents(l.price, 'lines');
    if (price < 0) throw fail(`Line ${i + 1}: a price is not negative`, 400, { field: 'lines' });
    return { item, qty, price };
  });
  if (!out.length) throw fail('Add at least one line', 400, { field: 'lines' });
  return out;
};

/** A new order by hand: { person | household, event?, title?, lines: [{ item, qty, price }], due?, note?, currency? }. */
export function createOrder(body = {}, by = 'panel') {
  if (!body.person && !body.household) throw fail('An order is for a person or a household', 400, { field: 'person' });
  if (body.household) getHousehold(body.household); else if (!personRow(body.person)) throw fail('No such person', 404);
  const ev = body.event ? getEvent(body.event) : null;
  const due = clean(body.due, 10);
  if (due && !DATE.test(due)) throw fail('Due date like 2027-01-10', 400, { field: 'due' });
  const currency = ev ? ev.currency : clean(body.currency || 'CHF', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw fail('A three-letter currency, e.g. CHF', 400, { field: 'currency' });
  const lines = cleanLines(body.lines);
  const id = rid('o'); const now = Date.now();
  db.prepare('INSERT INTO ord_orders (tenant_id, id, person, household, event, title, currency, due, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, id, body.household ? '' : body.person, body.household || '', ev?.id || '', clean(body.title, 80), currency, due || ev?.payBy || '', clean(body.note, 300), now, now);
  const o = writeLines(id, lines);
  notePeople(o, `Order: ${view(o).title}, ${money(o.total, o.currency)}`);
  activity('config', { summary: `Order created: ${money(o.total, o.currency)} (${by})` });
  return getOrder(id);
}
export function updateOrder(id, body = {}, by = 'panel') {
  const o = row(id); if (!o) throw fail('No such order', 404);
  if (body.due !== undefined) { const d = clean(body.due, 10); if (d && !DATE.test(d)) throw fail('Due date like 2027-01-10', 400, { field: 'due' }); db.prepare('UPDATE ord_orders SET due = ? WHERE tenant_id = ? AND id = ?').run(d, TENANT, o.id); }
  if (body.note !== undefined) db.prepare('UPDATE ord_orders SET note = ? WHERE tenant_id = ? AND id = ?').run(clean(body.note, 300), TENANT, o.id);
  if (body.lines !== undefined) writeLines(o.id, cleanLines(body.lines));
  if (body.cancelled !== undefined) {
    if (body.cancelled && o.paid > 0) throw fail('Something was paid: refund it first', 409);
    db.prepare('UPDATE ord_orders SET status = ? WHERE tenant_id = ? AND id = ?').run(body.cancelled ? 'cancelled' : 'open', TENANT, o.id);
    restatus(o.id);
  }
  activity('config', { summary: `Order changed (${by})` });
  return getOrder(o.id);
}
export function deleteOrder(id, by = 'panel') {
  const o = row(id); if (!o) throw fail('No such order', 404);
  for (const t of ['ord_lines', 'ord_payments']) db.prepare(`DELETE FROM ${t} WHERE tenant_id = ? AND ord = ?`).run(TENANT, o.id);
  db.prepare('DELETE FROM ord_orders WHERE tenant_id = ? AND id = ?').run(TENANT, o.id);
  activity('config', { summary: `Order deleted (${by})` });
  return { ok: true };
}

/** Record a payment (amount > 0) or a refund (refund: true). Amount defaults to what is left (or what was paid).
 * @param {string} id @param {{ amount?: number|string, at?: string, method?: string, note?: string, refund?: boolean }} [p] @param {string} [by] */
export function addPayment(id, { amount, at = '', method = '', note = '', refund = false } = {}, by = 'panel') {
  const o = row(id); if (!o) throw fail('No such order', 404);
  if (o.status === 'cancelled') throw fail('This order is cancelled');
  const value = amount === undefined || amount === '' || amount === null ? (refund ? o.paid : o.total - o.paid) : cents(amount, 'amount');
  if (value <= 0) throw fail(refund ? 'Nothing was paid, so nothing to refund' : 'Nothing is left to pay', 400, { field: 'amount' });
  if (refund && value > o.paid) throw fail(`At most ${money(o.paid, o.currency)} was paid`, 400, { field: 'amount' });
  const m = methodOf(method);
  if (!m) throw fail(`Payment method: one of ${paymentMethods().join(', ')}`, 400, { field: 'method' });
  const day = clean(at, 10) || today();
  if (!DATE.test(day)) throw fail('Date like 2027-01-10', 400, { field: 'at' });
  db.prepare('INSERT INTO ord_payments (tenant_id, id, ord, amount, at, method, note, by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, rid('pay'), o.id, refund ? -value : value, day, m, clean(note, 200), clean(by, 60), Date.now());
  const next = restatus(o.id);
  notePeople(next, `${refund ? 'Refund' : 'Payment'} of ${money(value, o.currency)} (${m}) for ${view(next).title}: now ${STATUS_WORD[next.status]}`);
  activity('config', { summary: `${refund ? 'Refund' : 'Payment'} recorded: ${money(value, o.currency)}, ${m} (${by})` });
  return getOrder(o.id);
}
export function removePayment(id, payment, by = 'panel') {
  const o = row(id); if (!o) throw fail('No such order', 404);
  if (!db.prepare('DELETE FROM ord_payments WHERE tenant_id = ? AND ord = ? AND id = ?').run(TENANT, o.id, String(payment)).changes) throw fail('No such payment', 404);
  restatus(o.id);
  activity('config', { summary: `Payment removed from an order (${by})` });
  return getOrder(o.id);
}

// ---------- lists ----------
const STATUS_SQL = { open: "status IN ('open', 'part')", paid: "status = 'paid'", refunded: "status = 'refunded'", cancelled: "status = 'cancelled'" };
/** Orders by status (open = open or part paid; overdue = open past the due date; all), optionally of one event. Due first (All: newest first), ≤ 200. */
export function listOrders({ status = 'open', event = '' } = {}) {
  const t = today();
  const where = status === 'overdue' ? `${STATUS_SQL.open} AND due <> '' AND due < ?` : STATUS_SQL[status] || '1 = 1';
  const args = status === 'overdue' ? [t] : [];
  const order = status === 'all' ? 'created_at DESC' : 'due, created_at DESC'; // all: newest first, walking ord_orders_created
  const rows = event
    ? db.prepare(`SELECT * FROM ord_orders WHERE tenant_id = ? AND event = ? AND ${where} ORDER BY ${order} LIMIT 200`).all(TENANT, event, ...args)
    : db.prepare(`SELECT * FROM ord_orders WHERE tenant_id = ? AND ${where} ORDER BY ${order} LIMIT 200`).all(TENANT, ...args);
  return rows.map((o) => view(o));
}
/** Totals of an event's orders (cancelled left out): { orders, total, paid, open, unpaid (orders not fully paid) }. */
export function eventTotals(event) {
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(paid), 0) AS paid, COALESCE(SUM(status IN ('open', 'part')), 0) AS unpaid FROM ord_orders WHERE tenant_id = ? AND event = ? AND status <> 'cancelled'").get(TENANT, event);
  return { orders: r.n, total: r.total, paid: r.paid, open: Math.max(0, r.total - r.paid), unpaid: r.unpaid };
}
/** The Orders page: the orders of the filter, and totals per event that has orders. */
export function ordersPage({ status = 'open', event = '' } = {}) {
  const orders = listOrders({ status, event });
  const events = db.prepare('SELECT id, name, currency FROM ev_events WHERE tenant_id = ? ORDER BY starts DESC LIMIT 50').all(TENANT)
    .map((e) => ({ id: e.id, name: e.name, currency: e.currency, ...eventTotals(e.id) })).filter((e) => e.orders);
  return { orders, events, methods: paymentMethods() };
}
/** Open orders of a person and of their households (what do I owe). */
export function openOrdersOf(person) {
  const hs = householdsOf(person).map((h) => h.id);
  return db.prepare(`SELECT * FROM ord_orders WHERE tenant_id = ? AND ${STATUS_SQL.open} AND (person = ?${hs.length ? ` OR household IN (${hs.map(() => '?').join(',')})` : ''}) ORDER BY due LIMIT 50`)
    .all(TENANT, person, ...hs).map((o) => view(o));
}
export const csvRows = (filter) => [['Who', 'Event', 'Title', 'Currency', 'Total', 'Paid', 'Left', 'Due', 'Status'],
  ...listOrders(filter).map((o) => [o.who, o.eventName, o.title, o.currency, (o.total / 100).toFixed(2), (o.paid / 100).toFixed(2), (o.left / 100).toFixed(2), o.due, STATUS_WORD[o.status]])];

// ---------- registrations → orders (an event's price list) ----------
const ageOn = (birthday, day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday || ''); if (!m) return null; const [y, mo, d] = day.slice(0, 10).split('-').map(Number); return y - Number(m[1]) - ((mo < Number(m[2]) || (mo === Number(m[2]) && d < Number(m[3]))) ? 1 : 0); };
/** Lines for a registration from its event's price list; [] when the event has no prices. */
export function linesFor(reg, ev) {
  const p = ev.prices || {};
  if (!p.adult && !p.kid) return [];
  const lines = [];
  if (reg.adults) lines.push({ item: 'Adult', qty: reg.adults, price: p.adult || 0 });
  let paidKids = reg.kids; let freeKids = 0;
  if (reg.household && p.freeUnder) {
    const kids = getHousehold(reg.household).members.filter((m) => m.role === 'kid').map((m) => ageOn(personRow(m.person)?.birthday, ev.starts));
    freeKids = Math.min(reg.kids, kids.filter((a) => a !== null && a < p.freeUnder).length);
    paidKids = reg.kids - freeKids;
  }
  if (paidKids) lines.push({ item: 'Kid', qty: paidKids, price: p.kid || 0 });
  if (freeKids) lines.push({ item: `Kid under ${p.freeUnder}`, qty: freeKids, price: 0 });
  return lines;
}
/** The Events module's signal: a registration was created or changed (or deleted with its event). */
function onRegistration(reg) {
  const o = db.prepare('SELECT * FROM ord_orders WHERE tenant_id = ? AND registration = ?').get(TENANT, reg.id);
  if (reg.deleted || reg.status === 'cancelled' || reg.status === 'waiting' || reg.status === 'pending') {
    if (o && !o.paid && o.status !== 'cancelled') { db.prepare("UPDATE ord_orders SET status = 'cancelled', updated_at = ? WHERE tenant_id = ? AND id = ?").run(Date.now(), TENANT, o.id); }
    else if (o && o.paid > 0 && reg.status === 'cancelled') notePeople(o, `Registration cancelled; ${money(o.paid, o.currency)} was paid (refund?)`);
    return;
  }
  const ev = getEvent(reg.event);
  const lines = linesFor(reg, ev);
  if (!lines.length) return;
  if (!o) {
    const id = rid('o'); const now = Date.now();
    db.prepare('INSERT INTO ord_orders (tenant_id, id, person, household, event, registration, currency, due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(TENANT, id, reg.household ? '' : reg.person, reg.household || '', ev.id, reg.id, ev.currency, ev.payBy || ev.deadline.slice(0, 10) || ev.starts.slice(0, 10), now, now);
    const made = writeLines(id, lines);
    notePeople(made, `Order for ${ev.name}: ${money(made.total, made.currency)}`);
    return;
  }
  if (o.status === 'cancelled') db.prepare("UPDATE ord_orders SET status = 'open' WHERE tenant_id = ? AND id = ?").run(TENANT, o.id);
  if (!o.paid) writeLines(o.id, lines); else restatus(o.id); // numbers changed after a payment: the organizer adjusts by hand
}

// ---------- pages, reminders ----------
const orderRows = (list) => list.map((o) => ({ name: `${o.title}: ${money(o.total, o.currency)}`, sub: `${STATUS_WORD[o.status]}${o.left && o.status !== 'cancelled' ? ` · ${money(o.left, o.currency)} left` : ''}${o.due ? ` · due ${o.due}` : ''}`, href: `#people/orders/${o.id}` }));
function personSections(person) {
  const hs = householdsOf(person).map((h) => h.id);
  const mine = db.prepare('SELECT * FROM ord_orders INDEXED BY ord_orders_person WHERE tenant_id = ? AND person = ? ORDER BY created_at DESC LIMIT 20').all(TENANT, person);
  const theirs = hs.flatMap((h) => db.prepare('SELECT * FROM ord_orders INDEXED BY ord_orders_household WHERE tenant_id = ? AND household = ? ORDER BY created_at DESC LIMIT 20').all(TENANT, h));
  const list = [...mine, ...theirs].sort((a, b) => b.created_at - a.created_at).slice(0, 20).map((o) => view(o));
  return list.length ? [{ title: 'Orders and payments', rows: orderRows(list) }] : [];
}
function householdSections(id) {
  const list = db.prepare('SELECT * FROM ord_orders INDEXED BY ord_orders_household WHERE tenant_id = ? AND household = ? ORDER BY created_at DESC LIMIT 20').all(TENANT, id).map((o) => view(o));
  return list.length ? [{ title: 'Orders and payments', rows: orderRows(list) }] : [];
}
function eventSections(event) {
  const t = eventTotals(event);
  if (!t.orders) return [];
  const cur = getEvent(event).currency;
  return [{ title: 'Payments', rows: [{ name: `${money(t.paid, cur)} paid of ${money(t.total, cur)}`, sub: `${plural(t.unpaid, 'order')} not fully paid · ${money(t.open, cur)} open`, href: `#people/orders?event=${event}` }] }];
}
/** Once a day: the owner gets the open orders due within three days or overdue (bounded). */
async function upkeep(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (kvGet('orders.remindedOn') === day) return;
  kvSet('orders.remindedOn', day);
  const soon = new Date(now + 3 * 86400000).toISOString().slice(0, 10);
  const list = db.prepare(`SELECT * FROM ord_orders WHERE tenant_id = ? AND ${STATUS_SQL.open} AND due <> '' AND due <= ? ORDER BY due LIMIT 30`).all(TENANT, soon).map((o) => view(o));
  if (!list.length) return;
  const lines = list.slice(0, 15).map((o) => `• ${o.who}: ${money(o.left, o.currency)} for ${o.title}, ${o.overdue ? `overdue since ${o.due}` : `due ${o.due}`}`);
  await sendOwnerAlert(`Duniya: ${plural(list.length, 'open order')} due soon or overdue:\n${lines.join('\n')}${list.length > 15 ? `\n… and more under People → Orders` : ''}`, { kind: 'orders' });
}

/** A held change an organizer confirmed: payment or refund. */
function apply(action, agent) {
  const by = agent?.name || agent?.id || 'an agent';
  const o = addPayment(action.order, { amount: action.amount, method: action.method, refund: action.op === 'refund' }, by);
  return `${o.who}: ${action.op === 'refund' ? 'refund' : 'payment'} recorded. ${o.title} is now ${STATUS_WORD[o.status]} (${money(o.paid, o.currency)} of ${money(o.total, o.currency)}).`;
}
export const change = (ctx, action, summary) => changeOrHold(ctx, 'orders', action, summary);

export const manifest = { id: 'orders', tools: orderTools, apply, person: personSections, household: householdSections, event: eventSections, upkeep, on: { registration: onRegistration } };
