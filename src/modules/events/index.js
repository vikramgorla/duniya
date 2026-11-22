// @ts-check
// Events module (081): events with registrations, a waiting list, duties and optional attendance. Loaded only when
// switched on (Settings → Modules); see ../index.js for the frame. Rows name a person or a household (People).
//   - An event: name, dates, place, capacity (people, 0 = no limit), registration deadline, one currency (default
//     CHF), registration per household or per person, confirmation automatic or by an organizer, a price list
//     (adult, kid, free under an age; the Orders module turns a registration into an order) and a pay-by date.
//   - A registration: a person or a household, adults and kids (a household's kids are its kid members), a note
//     (diet …), status registered / waiting / pending (an organizer confirms) / cancelled, attended.
//   - Capacity counts people (adults + kids). Full → waiting list; a cancellation lets the first waiting
//     registrations that fit in, by themselves.
//   - Duties: a task, a time, how many people are needed, who took it.
import { randomBytes } from 'node:crypto';
import { db } from '../../core/db.js';
import { clip, fail, plural } from '../../core/config.js';
import { TENANT } from '../../core/store.js';
import { activity } from '../../core/events.js';
import { ownerDay } from '../../core/owner-clock.js';
import { addEvent, getHousehold, householdsOf, personName, personRow } from '../../core/people.js';
import { changeOrHold, emit } from '../index.js';
import { eventTools } from './tools.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ev_events (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, starts TEXT NOT NULL DEFAULT '', ends TEXT NOT NULL DEFAULT '',
    place TEXT NOT NULL DEFAULT '', capacity INTEGER NOT NULL DEFAULT 0, deadline TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'CHF',
    per TEXT NOT NULL DEFAULT 'household', confirm TEXT NOT NULL DEFAULT 'auto', prices TEXT NOT NULL DEFAULT '{}', pay_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS ev_events_starts ON ev_events (tenant_id, starts);
  CREATE TABLE IF NOT EXISTS ev_registrations (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, event TEXT NOT NULL, person TEXT NOT NULL DEFAULT '', household TEXT NOT NULL DEFAULT '',
    adults INTEGER NOT NULL DEFAULT 1, kids INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
    attended INTEGER NOT NULL DEFAULT 0, by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS ev_registrations_event ON ev_registrations (tenant_id, event, status, created_at);
  CREATE INDEX IF NOT EXISTS ev_registrations_person ON ev_registrations (tenant_id, person);
  CREATE INDEX IF NOT EXISTS ev_registrations_household ON ev_registrations (tenant_id, household);
  CREATE TABLE IF NOT EXISTS ev_duties (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, event TEXT NOT NULL, task TEXT NOT NULL, at TEXT NOT NULL DEFAULT '', needed INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS ev_duties_event ON ev_duties (tenant_id, event);
  CREATE TABLE IF NOT EXISTS ev_duty_people (tenant_id TEXT NOT NULL, duty TEXT NOT NULL, person TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, duty, person));
  CREATE INDEX IF NOT EXISTS ev_duty_people_person ON ev_duty_people (tenant_id, person);
`);

const rid = (p) => `${p}_${randomBytes(6).toString('hex')}`;
const clean = (v, n = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
export const STATUSES = ['registered', 'waiting', 'pending', 'cancelled'];
const ACTIVE = "('registered', 'waiting', 'pending')";
const STATUS_WORD = { registered: 'registered', waiting: 'on the waiting list', pending: 'waiting for an organizer to confirm', cancelled: 'cancelled' };
const money = (v) => Math.max(0, Math.round(Number(v || 0) * 100));
const today = () => ownerDay(); // deadlines and "upcoming" go by the owner's date, not the UTC day

// ---------- events ----------
const row = (id) => db.prepare('SELECT * FROM ev_events WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || ''));
const view = (r) => ({ id: r.id, name: r.name, starts: r.starts, ends: r.ends, place: r.place, capacity: r.capacity, deadline: r.deadline, currency: r.currency,
  per: r.per, confirm: r.confirm, prices: JSON.parse(r.prices || '{}'), payBy: r.pay_by, createdAt: r.created_at });
export function getEvent(id) { const r = row(id); if (!r) throw fail('No such event', 404); return view(r); }
/** An event by id or by (part of) its name; the soonest upcoming one when several names match. */
export function findEvent(ref) {
  const r = String(ref || '').trim();
  if (!r) throw fail('Which event? (name or id)');
  const exact = row(r);
  if (exact) return view(exact);
  const hits = db.prepare("SELECT * FROM ev_events WHERE tenant_id = ? AND lower(name) LIKE ? ORDER BY (starts < ?) , starts LIMIT 5").all(TENANT, `%${r.toLowerCase()}%`, today());
  if (!hits.length) throw fail(`No event matches "${clip(r, 40)}"`);
  return view(hits[0]);
}

const DATE_FIELDS = ['starts', 'ends', 'deadline', 'payBy'];
const CAPACITY_MAX = 100000; // people
const FREE_UNDER_MAX = 18; // years
/** The event's dates as entered: each a date (or a date and time); a start is needed, the end is not before it. */
function eventDates(pick) {
  const dates = {};
  for (const k of DATE_FIELDS) {
    const v = String(pick(k, '') || '').trim();
    if (v && !DATE.test(v)) throw fail('Use a date like 2027-01-14 (or 2027-01-14T18:00)', 400, { field: k });
    dates[k] = v;
  }
  if (!dates.starts) throw fail('When does it start?', 400, { field: 'starts' });
  if (dates.ends && dates.ends < dates.starts) throw fail('It ends before it starts', 400, { field: 'ends' });
  return dates;
}
/** How people register: capacity, currency, per household or per person, who confirms, the price list. */
function eventRules(pick) {
  const capacity = Number(pick('capacity', 0));
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > CAPACITY_MAX) throw fail(`Capacity: 0 (no limit) to ${CAPACITY_MAX} people`, 400, { field: 'capacity' });
  const currency = String(pick('currency', 'CHF') || 'CHF').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw fail('A three-letter currency, e.g. CHF, EUR, INR', 400, { field: 'currency' });
  const per = pick('per', 'household'); const confirm = pick('confirm', 'auto');
  if (!['household', 'person'].includes(per)) throw fail('Registration is per household or per person', 400, { field: 'per' });
  if (!['auto', 'organizer'].includes(confirm)) throw fail('Confirmation is automatic or by an organizer', 400, { field: 'confirm' });
  const p = pick('prices', {}) || {};
  const prices = { adult: money(p.adult), kid: money(p.kid), freeUnder: Math.max(0, Math.min(FREE_UNDER_MAX, Math.round(Number(p.freeUnder || 0)))) };
  return { capacity, currency, per, confirm, prices };
}
/** Validate and save an event (new without id). Prices in the event's currency (e.g. 25 = CHF 25.00). */
export function saveEvent(body = {}, by = 'panel') {
  const cur = body.id ? getEvent(body.id) : null;
  const pick = (k, d) => (body[k] !== undefined ? body[k] : cur ? cur[k] : d);
  const name = clean(pick('name', ''), 80);
  if (!name) throw fail('An event needs a name', 400, { field: 'name' });
  const dates = eventDates(pick);
  const { capacity, currency, per, confirm, prices } = eventRules(pick);
  const vals = [name, dates.starts, dates.ends, clean(pick('place', ''), 160), capacity, dates.deadline, currency, per, confirm, JSON.stringify(prices), dates.payBy];
  const id = cur?.id || rid('ev');
  if (cur) db.prepare('UPDATE ev_events SET name = ?, starts = ?, ends = ?, place = ?, capacity = ?, deadline = ?, currency = ?, per = ?, confirm = ?, prices = ?, pay_by = ? WHERE tenant_id = ? AND id = ?').run(...vals, TENANT, id);
  else db.prepare('INSERT INTO ev_events (name, starts, ends, place, capacity, deadline, currency, per, confirm, prices, pay_by, tenant_id, id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...vals, TENANT, id, Date.now());
  activity('config', { summary: `Event ${cur ? 'changed' : 'created'}: ${name} (${by})` });
  if (cur) fillFromWaitingList(id, by); // a larger capacity lets people in
  return eventPage(id);
}
export function deleteEvent(id, by = 'panel') {
  const e = getEvent(id);
  const regs = db.prepare('SELECT id FROM ev_registrations WHERE tenant_id = ? AND event = ?').all(TENANT, e.id);
  for (const r of regs) emit('registration', { id: r.id, deleted: true });
  db.prepare('DELETE FROM ev_duty_people WHERE tenant_id = ? AND duty IN (SELECT id FROM ev_duties WHERE tenant_id = ? AND event = ?)').run(TENANT, TENANT, e.id);
  for (const t of ['ev_duties', 'ev_registrations']) db.prepare(`DELETE FROM ${t} WHERE tenant_id = ? AND event = ?`).run(TENANT, e.id);
  db.prepare('DELETE FROM ev_events WHERE tenant_id = ? AND id = ?').run(TENANT, e.id);
  activity('config', { summary: `Event deleted: ${e.name}, ${plural(regs.length, 'registration')} (${by})` });
  return { ok: true };
}

/** Counts of an event: registrations, adults, kids, people (registered), waiting, pending, places left. */
export function counts(id) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n, SUM(adults) AS a, SUM(kids) AS k FROM ev_registrations WHERE tenant_id = ? AND event = ? GROUP BY status').all(TENANT, id);
  const by = Object.fromEntries(rows.map((r) => [r.status, { n: r.n, adults: r.a || 0, kids: r.k || 0 }]));
  const z = { n: 0, adults: 0, kids: 0 };
  const reg = by.registered || z;
  const cap = row(id)?.capacity || 0;
  const people = reg.adults + reg.kids;
  return { registrations: reg.n, adults: reg.adults, kids: reg.kids, people, waiting: (by.waiting || z).n, waitingPeople: (by.waiting || z).adults + (by.waiting || z).kids,
    pending: (by.pending || z).n, cancelled: (by.cancelled || z).n, capacity: cap, left: cap ? Math.max(0, cap - people) : null };
}
/** Events list: upcoming first, then past (newest first); with counts. */
export function listEvents({ past = false } = {}) {
  const t = today();
  const rows = past ? db.prepare('SELECT * FROM ev_events WHERE tenant_id = ? AND starts < ? ORDER BY starts DESC LIMIT 200').all(TENANT, t)
    : db.prepare('SELECT * FROM ev_events WHERE tenant_id = ? AND starts >= ? ORDER BY starts LIMIT 200').all(TENANT, t);
  return rows.map((r) => ({ ...view(r), counts: counts(r.id) }));
}

// ---------- registrations ----------
const regRow = (id) => db.prepare('SELECT * FROM ev_registrations WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || ''));
// one person lookup per registration (its name and whether the person is hidden; agent tools show hidden people as such)
const regView = (r) => {
  const p = r.household ? null : personName(r.person);
  const who = r.household ? db.prepare('SELECT name FROM households WHERE tenant_id = ? AND id = ?').get(TENANT, r.household)?.name || 'A household' : p?.name || 'Someone';
  return { id: r.id, event: r.event, person: r.person, household: r.household, who, ...(p?.hidden ? { hidden: true } : {}), adults: r.adults, kids: r.kids, people: r.adults + r.kids,
    notes: r.notes, status: r.status, attended: !!r.attended, by: r.by, createdAt: r.created_at, updatedAt: r.updated_at };
};
export const getRegistration = (id) => { const r = regRow(id); if (!r) throw fail('No such registration', 404); return regView(r); };
/** Registrations of an event (status filter optional), oldest first. */
export const registrationsOf = (event, status = '') => (status
  ? db.prepare('SELECT * FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status = ? ORDER BY created_at').all(TENANT, event, status)
  : db.prepare('SELECT * FROM ev_registrations WHERE tenant_id = ? AND event = ? ORDER BY created_at').all(TENANT, event)).map(regView);
/**
 * 090 (ask your data): who came to (or registered for) one event but has no active registration for another — names
 * of households and people, keyed the same way (a household that registered as a household, or a person).
 */
export function cameButNotRegistered(past, next, { attendedOnly = false } = {}) {
  const key = (r) => (r.household ? `h:${r.household}` : `p:${r.person}`);
  const now = new Set(db.prepare(`SELECT person, household FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status IN ${ACTIVE}`).all(TENANT, next).map(key));
  const then = db.prepare(`SELECT * FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status IN ${attendedOnly ? "('registered')" : ACTIVE} ORDER BY created_at LIMIT 2000`).all(TENANT, past)
    .filter((r) => !attendedOnly || r.attended);
  return then.filter((r) => !now.has(key(r))).map(regView);
}
/** 090: who took duties whose task matches the words, across all events, most often first: [{ person, times, tasks }]. */
export function dutyHistory(words) {
  const like = `%${String(words || '').toLowerCase().replace(/[%_\\]/g, '')}%`;
  return db.prepare(`SELECT p.person, COUNT(*) AS times, GROUP_CONCAT(DISTINCT d.task) AS tasks FROM ev_duty_people p JOIN ev_duties d ON d.tenant_id = p.tenant_id AND d.id = p.duty
    WHERE p.tenant_id = ? AND lower(d.task) LIKE ? GROUP BY p.person ORDER BY times DESC LIMIT 20`).all(TENANT, like);
}
/** The persons a registration is about (the person, or every member of the household): for timelines. */
const peopleOf = (r) => (r.household ? (() => { try { return getHousehold(r.household).members.map((m) => m.person); } catch { return []; } })() : [r.person].filter(Boolean));
const note = (r, text) => { for (const p of peopleOf(r)) addEvent(p, text); };

function fits(event, heads, exceptReg = '') {
  const e = row(event);
  if (!e?.capacity) return true;
  const used = db.prepare("SELECT COALESCE(SUM(adults + kids), 0) AS n FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status = 'registered' AND id <> ?").get(TENANT, event, exceptReg).n;
  return used + heads <= e.capacity;
}
/** Let waiting registrations in, oldest first, while they fit (after a cancellation or a larger capacity). */
function fillFromWaitingList(event, by) {
  const e = row(event);
  for (const r of db.prepare("SELECT * FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status = 'waiting' ORDER BY created_at LIMIT 200").all(TENANT, event)) {
    if (!fits(event, r.adults + r.kids)) continue;
    setStatusRow(r, 'registered', by, `A place opened up: registered for ${e.name}`);
  }
}
function setStatusRow(r, status, by, text) {
  db.prepare('UPDATE ev_registrations SET status = ?, updated_at = ?, by = ? WHERE tenant_id = ? AND id = ?').run(status, Date.now(), clean(by, 60), TENANT, r.id);
  note(r, text);
  const next = regRow(r.id);
  emit('registration', regView(next));
  return regView(next);
}

const HEADS_MAX = 50; // adults or kids of one registration
/** Adults and kids of a registration as whole numbers (at least one person), or a 400 for the form. */
function headcount(adults, kids) {
  const a = Number(adults); const k = Number(kids);
  const whole = (n) => Number.isInteger(n) && n >= 0 && n <= HEADS_MAX;
  if (!whole(a) || !whole(k) || a + k < 1) throw fail('Adults and kids: whole numbers, at least one person', 400, { field: 'adults' });
  return { a, k };
}
const given = (v) => v !== undefined && v !== null && v !== '';

/**
 * New numbers (and notes) for one registration. A registered party that no longer fits goes to the waiting list, and
 * the places that opened (a smaller party, or one that left the list of the registered) go to those who wait.
 */
function resize(e, r, { a, k, notes }, by) {
  const status = r.status === 'registered' && !fits(e.id, a + k, r.id) ? 'waiting' : r.status;
  db.prepare('UPDATE ev_registrations SET adults = ?, kids = ?, notes = ?, status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(a, k, notes, status, Date.now(), TENANT, r.id);
  note(regRow(r.id), `Registration for ${e.name} changed: ${a} adult(s), ${k} kid(s)`);
  if (status !== 'cancelled') fillFromWaitingList(e.id, by);
  const next = regView(regRow(r.id));
  emit('registration', next);
  return next;
}

/** The household that registers, or null for a person (who must be in People). */
function householdOf(person, household) {
  if (!person && !household) throw fail('Register a person or a household');
  if (household) return getHousehold(household);
  if (!personRow(person)) throw fail('No such person', 404);
  return null;
}
/** A new registration: registered when it fits, else on the waiting list; pending when an organizer has to confirm. */
function addRegistration(e, { hh, person, a, k, notes }, { by, organizer }) {
  const status = e.confirm === 'organizer' && !organizer ? 'pending' : fits(e.id, a + k) ? 'registered' : 'waiting';
  const id = rid('r'); const now = Date.now();
  db.prepare('INSERT INTO ev_registrations (tenant_id, id, event, person, household, adults, kids, notes, status, by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, id, e.id, hh ? '' : person, hh ? hh.id : '', a, k, notes, status, clean(by, 60), now, now);
  const r = regRow(id);
  note(r, `${hh ? `${hh.name}: ` : ''}${STATUS_WORD[status][0].toUpperCase()}${STATUS_WORD[status].slice(1)} for ${e.name} (${a} adult${a === 1 ? '' : 's'}${k ? `, ${k} kid${k === 1 ? '' : 's'}` : ''})`);
  activity('config', { summary: `Registration for ${e.name}: ${STATUS_WORD[status]} (${by})` });
  emit('registration', regView(r));
  return regView(r);
}

/**
 * Register a person or a household for an event. `organizer`: an organizer (or the owner) registers: the deadline and
 * organizer confirmation do not hold them back. Re-registering updates the active registration. Household: adults
 * and kids default to its members. Returns the registration.
 */
export function register({ event, person = '', household = '', adults, kids, notes = '' }, { by = 'panel', organizer = true } = {}) {
  const e = getEvent(event);
  const hh = householdOf(person, household);
  if (!organizer && e.deadline && today() > e.deadline.slice(0, 10)) throw fail(`Registration for ${e.name} closed on ${e.deadline}. An organizer can still add you.`);
  const members = (role) => (hh ? hh.members.filter((m) => m.role === role).length : role === 'adult' ? 1 : 0);
  const { a, k } = headcount(given(adults) ? adults : Math.max(1, members('adult')), given(kids) ? kids : members('kid'));
  const existing = db.prepare(`SELECT * FROM ev_registrations WHERE tenant_id = ? AND event = ? AND ${hh ? 'household' : 'person'} = ? AND status IN ${ACTIVE} ORDER BY created_at DESC LIMIT 1`).get(TENANT, e.id, hh ? hh.id : person);
  const n = clean(notes, 300);
  return existing ? resize(e, existing, { a, k, notes: n || existing.notes }, by) : addRegistration(e, { hh, person, a, k, notes: n }, { by, organizer });
}

/** A new status for a registration. Confirming (or leaving the waiting list) still respects the capacity: full → waiting list. */
function setStatus(e, r, status, by) {
  const next = status === 'registered' && !fits(r.event, r.adults + r.kids, r.id) ? 'waiting' : status;
  setStatusRow(r, next, by, next === 'cancelled' ? `Registration for ${e.name} cancelled` : `Now ${STATUS_WORD[next]} for ${e.name}`);
  if (r.status === 'registered' && next !== 'registered') fillFromWaitingList(r.event, by);
  activity('config', { summary: `Registration for ${e.name}: ${STATUS_WORD[next]} (${by})` });
}
/** Change a registration's status (confirm a pending one, waiting list, cancel), its numbers and notes, or attendance.
 * @param {string} id @param {{ status?: string, attended?: boolean, adults?: number, kids?: number, notes?: string }} [changes] @param {string} [by] */
export function updateRegistration(id, { status, attended, adults, kids, notes } = {}, by = 'panel') {
  let r = regRow(id); if (!r) throw fail('No such registration', 404);
  const e = getEvent(r.event);
  if (status !== undefined && !STATUSES.includes(status)) throw fail('Status: registered, waiting, pending or cancelled', 400, { field: 'status' });
  // this registration itself changes (also a cancelled one: it never becomes a second registration)
  if ([adults, kids, notes].some((v) => v !== undefined)) {
    resize(e, r, { ...headcount(adults ?? r.adults, kids ?? r.kids), notes: notes === undefined ? r.notes : clean(notes, 300) }, by);
    r = regRow(id);
  }
  if (attended !== undefined) db.prepare('UPDATE ev_registrations SET attended = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(attended ? 1 : 0, Date.now(), TENANT, r.id);
  if (status !== undefined && status !== r.status) setStatus(e, r, status, by);
  return getRegistration(r.id);
}

/** A person's active registration for an event: their own, or their household's. */
export function registrationFor(event, person) {
  const hs = householdsOf(person).map((h) => h.id);
  return db.prepare(`SELECT * FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status IN ${ACTIVE} AND (person = ?${hs.length ? ` OR household IN (${hs.map(() => '?').join(',')})` : ''}) ORDER BY created_at DESC LIMIT 1`)
    .get(TENANT, event, person, ...hs) || null;
}

// ---------- duties ----------
export function saveDuty({ id = '', event, task, at = '', needed = 1 }, by = 'panel') {
  const cur = id ? db.prepare('SELECT * FROM ev_duties WHERE tenant_id = ? AND id = ?').get(TENANT, id) : null;
  if (id && !cur) throw fail('No such duty', 404);
  const ev = getEvent(cur?.event || event);
  const t = clean(task ?? cur?.task, 100);
  if (!t) throw fail('Name the task, e.g. "Set up chairs"', 400, { field: 'task' });
  const n = Number(needed ?? cur?.needed ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw fail('How many people: 1 to 500', 400, { field: 'needed' });
  const when = clean(at ?? cur?.at, 40);
  if (cur) db.prepare('UPDATE ev_duties SET task = ?, at = ?, needed = ? WHERE tenant_id = ? AND id = ?').run(t, when, n, TENANT, cur.id);
  else db.prepare('INSERT INTO ev_duties (tenant_id, id, event, task, at, needed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(TENANT, rid('d'), ev.id, t, when, n, Date.now());
  activity('config', { summary: `Duty for ${ev.name}: ${t} (${by})` });
  return dutiesOf(ev.id);
}
export function deleteDuty(id) {
  const d = db.prepare('SELECT * FROM ev_duties WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || ''));
  if (!d) throw fail('No such duty', 404);
  db.prepare('DELETE FROM ev_duty_people WHERE tenant_id = ? AND duty = ?').run(TENANT, d.id);
  db.prepare('DELETE FROM ev_duties WHERE tenant_id = ? AND id = ?').run(TENANT, d.id);
  return dutiesOf(d.event);
}
export const dutiesOf = (event) => db.prepare('SELECT * FROM ev_duties WHERE tenant_id = ? AND event = ? ORDER BY at, created_at').all(TENANT, event).map((d) => {
  const people = db.prepare('SELECT person FROM ev_duty_people WHERE tenant_id = ? AND duty = ? ORDER BY at').all(TENANT, d.id).map((x) => ({ id: x.person, name: personRow(x.person)?.name || 'Someone' }));
  return { id: d.id, task: d.task, at: d.at, needed: d.needed, people, open: Math.max(0, d.needed - people.length) };
});
/** Someone takes a duty (or is assigned to it); refused when it is full. */
export function takeDuty(duty, person, by = 'panel', on = true) {
  const d = db.prepare('SELECT * FROM ev_duties WHERE tenant_id = ? AND id = ?').get(TENANT, String(duty || ''));
  if (!d) throw fail('No such duty', 404);
  if (!personRow(person)) throw fail('No such person', 404);
  const e = row(d.event);
  if (!on) {
    if (db.prepare('DELETE FROM ev_duty_people WHERE tenant_id = ? AND duty = ? AND person = ?').run(TENANT, d.id, person).changes) addEvent(person, `Left the duty "${d.task}" at ${e.name}`);
    return dutiesOf(d.event);
  }
  const taken = db.prepare('SELECT person FROM ev_duty_people WHERE tenant_id = ? AND duty = ?').all(TENANT, d.id).map((x) => x.person);
  if (taken.includes(person)) return dutiesOf(d.event);
  if (taken.length >= d.needed) throw fail(`"${d.task}" already has the ${plural(d.needed, 'person', 'people')} it needs`);
  db.prepare('INSERT INTO ev_duty_people (tenant_id, duty, person, at) VALUES (?, ?, ?, ?)').run(TENANT, d.id, person, Date.now());
  addEvent(person, `Took the duty "${d.task}" at ${e.name} (${by})`);
  return dutiesOf(d.event);
}
/** A duty by id or by task name within an event. */
export function findDuty(event, ref) {
  const r = String(ref || '').trim().toLowerCase();
  const list = dutiesOf(event);
  const d = list.find((x) => x.id === ref) || list.find((x) => x.task.toLowerCase() === r) || list.filter((x) => x.task.toLowerCase().includes(r))[0];
  if (!d) throw fail(`No duty matches "${clip(ref, 40)}". Duties: ${list.map((x) => x.task).join(', ') || '(none yet)'}`);
  return d;
}

// ---------- pages, CSV ----------
/** The event page: the event, counts, registrations, duties and what other modules add (payments). */
export function eventPage(id) {
  const e = getEvent(id);
  return { event: e, counts: counts(e.id), registrations: registrationsOf(e.id), duties: dutiesOf(e.id) };
}
/** Registrations as CSV rows (header first). */
export const csvRows = (id) => {
  const e = getEvent(id);
  return [['Who', 'Kind', 'Status', 'Adults', 'Kids', 'Notes', 'Attended', 'Registered at'],
    ...registrationsOf(e.id).map((r) => [r.who, r.household ? 'household' : 'person', r.status, r.adults, r.kids, r.notes, r.attended ? 'yes' : '', new Date(r.createdAt).toISOString()])];
};
/** By person: their registrations (own or household) and duties. */
function personSections(person) {
  const hs = householdsOf(person).map((h) => h.id);
  const regs = db.prepare(`SELECT r.*, e.name AS ename, e.starts FROM ev_registrations r JOIN ev_events e ON e.tenant_id = r.tenant_id AND e.id = r.event
    WHERE r.tenant_id = ? AND (r.person = ?${hs.length ? ` OR r.household IN (${hs.map(() => '?').join(',')})` : ''}) ORDER BY e.starts DESC LIMIT 20`).all(TENANT, person, ...hs);
  const duties = db.prepare(`SELECT d.task, d.at, e.name AS ename, e.id AS eid FROM ev_duty_people p JOIN ev_duties d ON d.tenant_id = p.tenant_id AND d.id = p.duty
    JOIN ev_events e ON e.tenant_id = d.tenant_id AND e.id = d.event WHERE p.tenant_id = ? AND p.person = ? ORDER BY e.starts DESC LIMIT 20`).all(TENANT, person);
  if (!regs.length && !duties.length) return [];
  return [{ title: 'Events', rows: [...regs.map((r) => ({ name: r.ename, sub: [{ day: r.starts }, `${STATUS_WORD[r.status]}${r.household ? ' with their household' : ''}`, `${r.adults + r.kids} ${r.adults + r.kids === 1 ? 'person' : 'people'}`], href: `#people/events/${r.event}` })),
    ...duties.map((d) => ({ name: `Duty: ${d.task}`, sub: `${d.ename}${d.at ? ` · ${d.at}` : ''}`, href: `#people/events/${d.eid}` }))] }];
}
function householdSections(id) {
  const regs = db.prepare(`SELECT r.*, e.name AS ename, e.starts FROM ev_registrations r JOIN ev_events e ON e.tenant_id = r.tenant_id AND e.id = r.event
    WHERE r.tenant_id = ? AND r.household = ? ORDER BY e.starts DESC LIMIT 20`).all(TENANT, id);
  return regs.length ? [{ title: 'Events', rows: regs.map((r) => ({ name: r.ename, sub: [{ day: r.starts }, STATUS_WORD[r.status], `${r.adults} ${r.adults === 1 ? 'adult' : 'adults'}, ${r.kids} ${r.kids === 1 ? 'kid' : 'kids'}`], href: `#people/events/${r.event}` })) }] : [];
}

/** A held change an organizer confirmed (or a change about the sender). */
function apply(action, agent) {
  const by = agent?.name || agent?.id || 'an agent';
  if (action.op === 'register') {
    const r = register(action.reg, { by, organizer: true });
    return `${r.who}: ${STATUS_WORD[r.status]} for ${getEvent(r.event).name} (${r.adults} adults, ${r.kids} kids).`;
  }
  if (action.op === 'self') { // the sender registers themselves or their household (organizer rights only for organizers)
    const r = register(action.reg, { by, organizer: !!action.organizer });
    return `${r.who}: ${STATUS_WORD[r.status]} for ${getEvent(r.event).name} (${r.adults} adults, ${r.kids} kids).`;
  }
  if (action.op === 'status') { const r = updateRegistration(action.registration, { status: action.status }, by); return `${r.who}: ${STATUS_WORD[r.status]} for ${getEvent(r.event).name}.`; }
  if (action.op === 'duty') { takeDuty(action.duty, action.person, by); return `${personRow(action.person)?.name || 'They'} took the duty.`; }
  throw fail('Unknown change');
}
/** For tools: a change about the sender happens now, others wait for an organizer's confirm. */
export const change = (ctx, action, summary, self = false) => changeOrHold(ctx, 'events', action, summary, { self });
export { STATUS_WORD };

export const manifest = { id: 'events', tools: eventTools, apply, person: personSections, household: householdSections };
