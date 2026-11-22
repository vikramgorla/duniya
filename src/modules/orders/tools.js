// @ts-check
// Orders and payments agent tools (081), exposed as orders__<name>. Roles and confirmation are decided here:
//   everyone      what_do_i_owe (the sender's and their households' open orders, and how to pay)
//   organizers    who_has_not_paid (with totals), and — held for an organizer's "confirm XXXX" — mark_paid, refund
// Duniya records payments; it never takes money. Hidden people are left out of names agents see.
import { clip, fail, money } from '../../core/config.js';
import { listHouseholds, listPeople, personByRef, personRow } from '../../core/people.js';
import { canSee, peopleScope } from '../../core/people-access.js';
import { findEvent } from '../events/index.js';
import { STATUS_WORD, change, eventTotals, listOrders, openOrdersOf, paymentMethods } from './index.js';

const ev = { type: 'string', description: 'Event name (or part of it) or id (optional)' };
const shown = (o) => ({ who: o.person && personRow(o.person)?.hidden ? '(hidden)' : o.who, for: o.title, total: money(o.total, o.currency), paid: money(o.paid, o.currency),
  left: money(o.left, o.currency), status: STATUS_WORD[o.status], ...(o.due ? { due: o.due } : {}), ...(o.overdue ? { overdue: true } : {}) });

/** The open order of a person or household an organizer names (for an event when given). */
function orderOf(who, event, ctx, { refund = false } = {}) {
  const r = String(who || '').trim();
  if (!r) throw fail('Whose order? (person or household name)');
  const e = event ? findEvent(event) : null;
  const hh = listHouseholds().find((h) => h.name.toLowerCase() === r.toLowerCase() || h.id === r);
  let person = '';
  if (!hh) {
    const scope = peopleScope(ctx.agent, { owner: !!ctx.ownerTurn });
    let p = personByRef(r);
    if (!p && scope) { const hits = listPeople({ q: r, scope, limit: 3 }); if (hits.length > 1) throw fail(`More than one person matches "${clip(r, 40)}": ${hits.map((x) => x.name).join(', ')}`); p = hits[0] ? personByRef(hits[0].id) : null; }
    if (!p || !canSee(scope, p.id)) throw fail(`No person or household "${clip(r, 40)}" that this agent may see`);
    person = p.id;
  }
  const list = [...listOrders({ status: refund ? 'paid' : 'open', event: e?.id || '' }), ...(refund ? listOrders({ status: 'open', event: e?.id || '' }).filter((o) => o.paid > 0) : [])]
    .filter((o) => (hh ? o.household === hh.id : o.person === person));
  if (!list.length) throw fail(`${hh ? hh.name : personRow(person)?.name} has no ${refund ? 'paid' : 'open'} order${e ? ` for ${e.name}` : ''}`);
  if (list.length > 1 && !e) throw fail(`${list.length} orders: say which event (${list.map((o) => o.title).join(', ')})`);
  return list[0];
}

export const orderTools = [
  {
    name: 'what_do_i_owe', annotations: { readOnlyHint: true }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'The sender\'s open orders (their own and their household\'s): what for, total, paid, left, due date, and the ways to pay.',
    input_schema: { type: 'object', properties: {} },
    async run(args, ctx) {
      if (!ctx.personId) return 'I do not know who you are on this app yet; ask an organizer.';
      const list = openOrdersOf(ctx.personId);
      return list.length ? { open: list.map(shown), waysToPay: paymentMethods() } : 'Nothing open: you owe nothing.';
    },
  },
  {
    name: 'who_has_not_paid', annotations: { readOnlyHint: true }, roles: ['organizer'],
    description: 'Orders not fully paid (organizers), for one event or all, with who, how much is left, due dates, and the totals (collected, open).',
    input_schema: { type: 'object', properties: { event: ev } },
    async run({ event }) {
      const e = event ? findEvent(event) : null;
      const list = listOrders({ status: 'open', event: e?.id || '' });
      const t = e ? eventTotals(e.id) : null;
      return { ...(e ? { event: e.name, totals: { orders: t.orders, total: money(t.total, e.currency), collected: money(t.paid, e.currency), open: money(t.open, e.currency), notFullyPaid: t.unpaid } } : {}),
        notPaid: list.slice(0, 200).map(shown) };
    },
  },
  {
    name: 'mark_paid', annotations: { readOnlyHint: false, destructiveHint: true }, roles: ['organizer'],
    description: 'Record a payment for a person\'s or household\'s open order (organizers): amount (default: all that is left) and method (one of the owner\'s payment methods). Waits for an organizer\'s confirm code. Duniya records payments; it never takes money.',
    input_schema: { type: 'object', properties: { who: { type: 'string', description: 'Person or household name' }, event: ev, amount: { type: 'number', minimum: 0.01 }, method: { type: 'string' } }, required: ['who'] },
    async run({ who, event, amount, method = '' }, ctx) {
      const o = orderOf(who, event, ctx);
      const m = method ? paymentMethods().find((x) => x.toLowerCase().includes(String(method).toLowerCase())) : paymentMethods()[0];
      if (!m) throw fail(`Payment method: one of ${paymentMethods().join(', ')}`);
      return change(ctx, { op: 'pay', order: o.id, amount, method: m }, `${money(amount ? Math.round(amount * 100) : o.left, o.currency)} paid by ${o.who} for ${o.title} (${m})`);
    },
  },
  {
    name: 'refund', annotations: { readOnlyHint: false, destructiveHint: true }, roles: ['organizer'],
    description: 'Record money given back for a person\'s or household\'s order (organizers): amount (default: all that was paid). Waits for an organizer\'s confirm code.',
    input_schema: { type: 'object', properties: { who: { type: 'string' }, event: ev, amount: { type: 'number', minimum: 0.01 }, method: { type: 'string' } }, required: ['who'] },
    async run({ who, event, amount, method = '' }, ctx) {
      const o = orderOf(who, event, ctx, { refund: true });
      return change(ctx, { op: 'refund', order: o.id, amount, method }, `refund ${money(amount ? Math.round(amount * 100) : o.paid, o.currency)} to ${o.who} for ${o.title}`);
    },
  },
];
