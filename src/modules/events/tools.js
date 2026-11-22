// @ts-check
// Events agent tools (081), exposed as events__<name>. Roles and confirmation are decided here, in code:
//   everyone      list_events, show_event, register (myself or my household; pending when the event needs an
//                 organizer's confirmation), cancel_my_registration, take_duty
//   organizers    registration_list (names, counts, notes), and — held for an organizer's "confirm XXXX" —
//                 register_someone, update_registration (confirm / waiting list / cancel), assign_duty
// Hidden people (People → Hide) are left out of names agents see.
import { clip, fail, money } from '../../core/config.js';
import { householdsOf, listHouseholds, listPeople, personByRef, personRow } from '../../core/people.js';
import { canSee, peopleScope } from '../../core/people-access.js';
import { STATUS_WORD, cameButNotRegistered, change, counts, dutiesOf, dutyHistory, findDuty, findEvent, getEvent, listEvents, registrationFor, registrationsOf } from './index.js';

const me = (ctx) => { if (!ctx.personId) throw fail('I do not know who you are on this app yet, so I cannot register you. Ask an organizer.'); return ctx.personId; };
const organizer = (ctx) => ctx.role === 'organizer' || !!ctx.ownerTurn;
const nameOf = (id) => { const p = personRow(id); return !p ? 'Someone' : p.hidden ? '(hidden)' : p.name; };

/** A person (id, number or a name only one visible person has) or a household (by name) an organizer names. */
function whoRef(ref, ctx) {
  const r = String(ref || '').trim();
  if (!r) throw fail('Name the person or household');
  const hh = listHouseholds().filter((h) => h.name.toLowerCase() === r.toLowerCase() || h.id === r);
  if (hh.length === 1) return { household: hh[0].id, name: hh[0].name };
  const scope = peopleScope(ctx.agent, { owner: !!ctx.ownerTurn }); // People access decides whom it may name
  let p = personByRef(r);
  if (!p && scope) {
    const hits = listPeople({ q: r, scope, limit: 3 });
    if (hits.length > 1) throw fail(`More than one person matches "${clip(r, 40)}": ${hits.map((x) => `${x.name} (${x.id})`).join(', ')}. Use the id.`);
    p = hits[0] ? personByRef(hits[0].id) : null;
  }
  if (!p || !canSee(scope, p.id)) throw fail(`No person or household "${clip(r, 40)}" that this agent may see`);
  return { person: p.id, name: p.name };
}
const counted = (c) => ({ registered: c.registrations, people: c.people, adults: c.adults, kids: c.kids, waitingList: c.waiting, pendingConfirmation: c.pending, ...(c.capacity ? { capacity: c.capacity, placesLeft: c.left } : {}) });
const n = { type: 'integer', minimum: 0, maximum: 50 };
const ev = { type: 'string', description: 'Event name (or part of it) or id' };

export const eventTools = [
  {
    name: 'list_events', annotations: { readOnlyHint: true }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'Upcoming events: name, dates, place, places left, registration deadline, whether an organizer confirms registrations, and prices.',
    input_schema: { type: 'object', properties: {} },
    async run() {
      const list = listEvents();
      if (!list.length) return 'No upcoming events.';
      return list.map((e) => ({ id: e.id, name: e.name, starts: e.starts, ...(e.ends ? { ends: e.ends } : {}), ...(e.place ? { place: e.place } : {}), registration: e.per,
        ...(e.capacity ? { placesLeft: e.counts.left } : {}), ...(e.deadline ? { deadline: e.deadline } : {}), organizerConfirms: e.confirm === 'organizer',
        ...(e.prices.adult || e.prices.kid ? { prices: { adult: money(e.prices.adult, e.currency), kid: money(e.prices.kid, e.currency), ...(e.prices.freeUnder ? { freeUnderAge: e.prices.freeUnder } : {}) } } : {}) }));
    },
  },
  {
    name: 'show_event', annotations: { readOnlyHint: true }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'One event: details, how many are registered (adults, kids), places left, duties with open places, and the sender\'s own registration.',
    input_schema: { type: 'object', properties: { event: ev }, required: ['event'] },
    async run({ event }, ctx) {
      const e = findEvent(event);
      const mine = ctx.personId ? registrationFor(e.id, ctx.personId) : null;
      return { ...e, prices: undefined, counts: counted(counts(e.id)), duties: dutiesOf(e.id).map((d) => ({ task: d.task, ...(d.at ? { at: d.at } : {}), needed: d.needed, open: d.open })),
        yourRegistration: mine ? `${STATUS_WORD[mine.status]} (${mine.adults} adults, ${mine.kids} kids)` : 'not registered' };
    },
  },
  {
    name: 'register', annotations: { readOnlyHint: false, destructiveHint: false }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'Register the sender ("me") or the sender\'s household for an event. Household: adults and kids default to its members. Pending when the event needs an organizer\'s confirmation; waiting list when full. Registering again changes the numbers.',
    input_schema: { type: 'object', properties: { event: ev, for: { type: 'string', enum: ['me', 'household'], description: 'me, or my household (default: what the event asks for)' }, adults: n, kids: n, notes: { type: 'string', maxLength: 300, description: 'e.g. vegetarian, arrives late' } }, required: ['event'] },
    async run({ event, for: who, adults, kids, notes = '' }, ctx) {
      const person = me(ctx); const e = findEvent(event);
      const useHh = (who || (e.per === 'household' ? 'household' : 'me')) === 'household';
      const hh = useHh ? householdsOf(person)[0] : null;
      if (useHh && !hh) throw fail('You are not in a household yet; register yourself ("me"), or ask an organizer to add your family');
      return change(ctx, { op: 'self', organizer: organizer(ctx), reg: { event: e.id, ...(hh ? { household: hh.id } : { person }), adults, kids, notes } }, '', true);
    },
  },
  {
    name: 'cancel_my_registration', annotations: { readOnlyHint: false, destructiveHint: false }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'Cancel the sender\'s (or their household\'s) registration for an event. Someone on the waiting list may get the place.',
    input_schema: { type: 'object', properties: { event: ev }, required: ['event'] },
    async run({ event }, ctx) {
      const e = findEvent(event); const r = registrationFor(e.id, me(ctx));
      if (!r) return `You are not registered for ${e.name}.`;
      return change(ctx, { op: 'status', registration: r.id, status: 'cancelled' }, '', true);
    },
  },
  {
    name: 'take_duty', annotations: { readOnlyHint: false, destructiveHint: false }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'The sender takes a duty at an event (by task name), if it still needs people.',
    input_schema: { type: 'object', properties: { event: ev, duty: { type: 'string', description: 'Task name' } }, required: ['event', 'duty'] },
    async run({ event, duty }, ctx) {
      const d = findDuty(findEvent(event).id, duty);
      return change(ctx, { op: 'duty', duty: d.id, person: me(ctx) }, '', true);
    },
  },
  {
    name: 'registration_list', annotations: { readOnlyHint: true }, roles: ['organizer'],
    description: 'Who is registered for an event (organizers): each registration with adults, kids, notes and status, and the counts. Filter by status.',
    input_schema: { type: 'object', properties: { event: ev, status: { type: 'string', enum: ['registered', 'waiting', 'pending', 'cancelled'] } }, required: ['event'] },
    async run({ event, status = '' }) {
      const e = findEvent(event);
      return { event: e.name, counts: counted(counts(e.id)),
        registrations: registrationsOf(e.id, status).slice(0, 200).map((r) => ({ who: r.hidden ? '(hidden)' : r.who, adults: r.adults, kids: r.kids, status: r.status, ...(r.notes ? { notes: r.notes } : {}) })) };
    },
  },
  // 090: ask your data — questions across events (organizers and the owner assistant)
  {
    name: 'compare_events', annotations: { readOnlyHint: true }, roles: ['organizer'],
    description: 'Who registered for (or came to) one event but has not registered for another (organizers), e.g. "which families came last year but haven\'t registered?". Names, with how many adults and kids they were.',
    input_schema: { type: 'object', properties: { came_to: { ...ev, description: 'The earlier event (name, part of it, or id)' }, not_registered_for: { ...ev, description: 'The event they have not registered for' },
      attended_only: { type: 'boolean', description: 'Only those marked as attended' } }, required: ['came_to', 'not_registered_for'] },
    async run({ came_to: past, not_registered_for: next, attended_only: attended = false }) {
      const a = findEvent(past); const b = findEvent(next);
      const list = cameButNotRegistered(a.id, b.id, { attendedOnly: !!attended });
      return { cameTo: a.name, notRegisteredFor: b.name, count: list.length, who: list.slice(0, 200).map((r) => ({ who: r.hidden ? '(hidden)' : r.who, adults: r.adults, kids: r.kids })) };
    },
  },
  {
    name: 'duty_history', annotations: { readOnlyHint: true }, roles: ['organizer'],
    description: 'Who usually takes a kind of duty (organizers), e.g. "who usually volunteers for cooking?": people with how many times they took duties whose task matches the words, across all events, most first.',
    input_schema: { type: 'object', properties: { task: { type: 'string', description: 'Words of the task, e.g. cooking' } }, required: ['task'] },
    async run({ task }) {
      const rows = dutyHistory(task);
      return rows.length ? rows.map((r) => ({ who: nameOf(r.person), times: r.times, tasks: r.tasks })) : `Nobody has taken a duty matching "${clip(task, 40)}" yet.`;
    },
  },
  {
    name: 'register_someone', annotations: { readOnlyHint: false, destructiveHint: true }, roles: ['organizer'],
    description: 'Register a person or a household (by name) for an event (organizers). Waits for an organizer\'s confirm code. Organizers are not held back by the deadline.',
    input_schema: { type: 'object', properties: { event: ev, who: { type: 'string', description: 'Person (name, number, id) or household name' }, adults: n, kids: n, notes: { type: 'string', maxLength: 300 } }, required: ['event', 'who'] },
    async run({ event, who, adults, kids, notes = '' }, ctx) {
      const e = findEvent(event); const w = whoRef(who, ctx);
      return change(ctx, { op: 'register', reg: { event: e.id, ...(w.household ? { household: w.household } : { person: w.person }), adults, kids, notes } }, `register ${w.name} for ${e.name}`);
    },
  },
  {
    name: 'update_registration', annotations: { readOnlyHint: false, destructiveHint: true }, roles: ['organizer'],
    description: 'Confirm a pending registration (status registered), move it to the waiting list, or cancel it (organizers). Waits for an organizer\'s confirm code.',
    input_schema: { type: 'object', properties: { event: ev, who: { type: 'string', description: 'Person or household name' }, status: { type: 'string', enum: ['registered', 'waiting', 'cancelled'] } }, required: ['event', 'who', 'status'] },
    async run({ event, who, status }, ctx) {
      const e = findEvent(event); const w = whoRef(who, ctx);
      const r = registrationsOf(e.id).find((x) => x.status !== 'cancelled' && (w.household ? x.household === w.household : x.person === w.person || (w.person && registrationFor(e.id, w.person)?.id === x.id)));
      if (!r) throw fail(`${w.name} is not registered for ${e.name}`);
      return change(ctx, { op: 'status', registration: r.id, status }, `${w.name} for ${e.name}: ${STATUS_WORD[status]}`);
    },
  },
  {
    name: 'assign_duty', annotations: { readOnlyHint: false, destructiveHint: true }, roles: ['organizer'],
    description: 'Give a duty at an event to a person (organizers). Waits for an organizer\'s confirm code.',
    input_schema: { type: 'object', properties: { event: ev, duty: { type: 'string' }, who: { type: 'string', description: 'Person (name, number, id)' } }, required: ['event', 'duty', 'who'] },
    async run({ event, duty, who }, ctx) {
      const e = getEvent(findEvent(event).id); const d = findDuty(e.id, duty); const w = whoRef(who, ctx);
      if (!w.person) throw fail('A duty goes to a person, not a household');
      return change(ctx, { op: 'duty', duty: d.id, person: w.person }, `${w.name} takes "${d.task}" at ${e.name}`, w.person === ctx.personId);
    },
  },
];
