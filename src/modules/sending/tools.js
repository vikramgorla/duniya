// @ts-check
// Lists and sending agent tools (082), exposed as sending__<name>. Roles and confirmation are decided here, in code:
//   everyone      stop_messages (the sender does not want messages from lists: "no" for the purpose, confirmed once)
//   organizers    sending_status; send_to_list prepares a run and always waits for an organizer's "confirm XXXX"
//                 with the preview (who, how many, which channel, how long, who is skipped and why). Only people this
//                 agent may see (its People access) get the message; the others are skipped.
import { db } from '../../core/db.js';
import { clip, fail } from '../../core/config.js';
import { TENANT } from '../../core/store.js';
import { canSee, peopleScope } from '../../core/people-access.js';
import { need as needModule } from '../index.js';
import { confirmText, hold, listRuns, preview, stopFor } from './index.js';

const byName = (table, ref) => {
  const r = String(ref || '').trim();
  return db.prepare(`SELECT id, name FROM ${table} WHERE tenant_id = ? AND (id = ? OR lower(name) = lower(?))`).get(TENANT, r, r)
    || db.prepare(`SELECT id, name FROM ${table} WHERE tenant_id = ? AND lower(name) LIKE ? ORDER BY name LIMIT 1`).get(TENANT, `%${r.toLowerCase()}%`);
};
/** An audience from the names an organizer uses. */
async function audienceOf({ to, name = '' }) {
  if (to === 'list' || to === 'household') {
    const r = byName(to === 'list' ? 'person_lists' : 'households', name);
    if (!r) throw fail(`No ${to} "${clip(name, 40)}"`);
    return { kind: to, [to]: r.id };
  }
  if (to === 'tag') { if (!String(name).trim()) throw fail('Which tag?'); return { kind: 'tag', tag: String(name).trim().toLowerCase() }; }
  if (to === 'event' || to === 'orders') {
    const e = name ? (await needModule('events')).findEvent(name) : null;
    if (to === 'event' && !e) throw fail('Which event?');
    return { kind: to, event: e?.id || '' };
  }
  throw fail('to: list, tag, household, event or orders');
}

export const sendingTools = [
  {
    name: 'stop_messages', roles: ['organizer', 'participant'], participantDefault: true,
    description: 'The sender does not want messages from lists any more (they said stop, unsubscribe, "don\'t send me these", in any language). Records it in code; reply with the text this returns.',
    input_schema: { type: 'object', properties: {} },
    async run(args, ctx) {
      if (!ctx.personId) return 'I do not know who you are on this app yet; ask an organizer.';
      const { purposes } = await stopFor(ctx.personId, 'Asked the agent');
      return confirmText(purposes);
    },
  },
  {
    name: 'sending_status', roles: ['organizer'],
    description: 'Messages sent to lists (organizers): the latest runs with their state and counts (sent, replied, skipped, waiting, failed).',
    input_schema: { type: 'object', properties: {} },
    async run() {
      const list = listRuns().slice(0, 10);
      return list.length ? list.map((r) => ({ title: r.title, to: r.audienceText, state: r.status, ...(r.reason ? { why: r.reason } : {}), ...(r.wait ? { waiting: r.wait } : {}),
        sent: r.counts.reached, replied: r.counts.replied + r.counts.stop, skipped: r.counts.skipped, waiting: r.counts.waiting, failed: r.counts.failed })) : 'Nothing was sent to lists yet.';
    },
  },
  {
    name: 'send_to_list', roles: ['organizer'],
    description: 'Prepare a message to people (organizers): a list, a tag, a household, the people registered for an event, or people with an open order (optionally of one event). Each person gets their own wording of the message; it may use {first_name}, {household}, and for events {event}, {date}, {place}, {people}, for open orders {amount}, {due}, {ways_to_pay}. Only people who agreed to the purpose get it. Nothing is sent until an organizer confirms the code; tell them the preview.',
    input_schema: { type: 'object', properties: {
      to: { type: 'string', enum: ['list', 'tag', 'household', 'event', 'orders'] }, name: { type: 'string', description: 'The list, tag, household or event (for orders: optional event)' },
      purpose: { type: 'string', enum: ['updates', 'marketing'], description: 'updates (news about things they take part in) or marketing' },
      title: { type: 'string', maxLength: 80 }, message: { type: 'string', maxLength: 1500 } }, required: ['to', 'purpose', 'message'] },
    async run(a, ctx) {
      const p = await preview({ title: a.title || a.message.slice(0, 40), audience: await audienceOf(a), purpose: a.purpose, agent: ctx.agent.id, template: a.message },
        `${ctx.agent.name} (organizer)`, 'agent', { visible: (id) => canSee(peopleScope(ctx.agent, { owner: !!ctx.ownerTurn }), id) });
      if (!p.to.total) return `Nobody would get it: ${p.skipped.length} skipped (${[...new Set(p.skipped.map((s) => s.reason))].join(', ')}).`;
      return hold(ctx, p);
    },
  },
];
