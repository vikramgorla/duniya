// @ts-check
// Who a message goes to (082), decided in code. An audience is one of:
//   list {list}, tag {tag}, household {household}, event {event} (its registered people), orders {event?} (people and
//   households with an open order), people {people: [ids]}
// It turns into units: a person, or a household (one message per household: the first of its adults who can get it).
// A person without an app who is in a household (a kid) is reached through that household's adults. Each unit gets
// one recipient row: who, which chat (Telegram when linked, WhatsApp otherwise), whether they wrote there before,
// and the facts their message may use (from People and the modules, never invented) — or the reason it is skipped:
// hidden, no consent for the purpose (unknown = no), no app, their chat switched off.
import { db } from '../../core/db.js';
import { clip, fail, plural } from '../../core/config.js';
import { TENANT } from '../../core/store.js';
import { getHousehold, householdsOf, personRow } from '../../core/people.js';
import { chatsOfPerson, consentsOf } from '../../core/people-access.js';
import { getChatPrefs } from '../../core/chat-prefs.js';
import { channelOf, isDirect, phoneChat } from '../../channels/index.js';
import { need } from '../index.js';

export const KINDS = { list: 'A list', tag: 'A tag', household: 'A household', event: 'People registered for an event', orders: 'People with an open order', people: 'Chosen people' };
export const PURPOSES = { updates: 'Updates', marketing: 'Marketing' };
const MAX = 5000;
/** The placeholders a message may use, and the audience kinds that have them. */
export const FIELDS = { first_name: null, name: null, household: null, event: ['event', 'orders'], date: ['event', 'orders'], place: ['event', 'orders'], people: ['event'], amount: ['orders'], due: ['orders'], ways_to_pay: ['orders'] };

/** A validated audience (400 with field "audience" when it names nothing). */
export function cleanAudience(a = {}) {
  const kind = String(a.kind || '');
  if (!KINDS[kind]) throw fail(`Audience: one of ${Object.keys(KINDS).join(', ')}`, 400, { field: 'audience' });
  const v = (k) => clip(a[k], 80);
  if (kind === 'people') {
    const people = [...new Set((Array.isArray(a.people) ? a.people : []).map(String))].slice(0, MAX);
    if (!people.length) throw fail('Choose at least one person', 400, { field: 'audience' });
    return { kind, people };
  }
  if (kind === 'orders') return { kind, event: v('event') };
  if (!v(kind)) throw fail(`Which ${kind}?`, 400, { field: 'audience' });
  return { kind, [kind]: v(kind) };
}
/** "List: Badminton Tuesdays" */
export function describe(a) {
  const nameIn = (t, id) => db.prepare(`SELECT name FROM ${t} WHERE tenant_id = ? AND id = ?`).get(TENANT, id)?.name || id;
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!a.kind) return 'One post in a group';
  if (a.kind === 'list') return `List: ${nameIn('person_lists', a.list)}`;
  if (a.kind === 'tag') return `Tag: ${a.tag}`;
  if (a.kind === 'household') return `Household: ${nameIn('households', a.household)}`;
  if (a.kind === 'event') return `Registered for ${has('ev_events') ? nameIn('ev_events', a.event) : a.event}`;
  if (a.kind === 'orders') return a.event ? `Open orders for ${has('ev_events') ? nameIn('ev_events', a.event) : a.event}` : 'Everyone with an open order';
  return plural(a.people.length, 'chosen person', 'chosen people');
}

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const firstName = (n) => (String(n || '').startsWith('+') ? '' : String(n || '').split(/\s+/)[0]);

/** The units of an audience, with the facts that come from the audience (event, registration, open amount). */
async function units(a) {
  const P = (ids) => ids.map((person) => ({ person, facts: {} }));
  if (a.kind === 'list') return P(db.prepare('SELECT person FROM person_list_members WHERE tenant_id = ? AND list = ? LIMIT ?').all(TENANT, a.list, MAX).map((r) => r.person));
  if (a.kind === 'tag') return P(db.prepare('SELECT person FROM person_tags INDEXED BY person_tags_tag WHERE tenant_id = ? AND tag = ? LIMIT ?').all(TENANT, a.tag, MAX).map((r) => r.person));
  if (a.kind === 'household') return [{ household: a.household, facts: {} }];
  if (a.kind === 'people') return P(a.people);
  const ev = a.event ? (await need('events')).getEvent(a.event) : null;
  const evFacts = ev ? { event: ev.name, date: day(ev.starts), place: ev.place } : {};
  if (a.kind === 'event') {
    return db.prepare("SELECT person, household, adults, kids FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status = 'registered' ORDER BY created_at LIMIT ?").all(TENANT, ev.id, MAX)
      .map((r) => ({ person: r.household ? '' : r.person, household: r.household, facts: { ...evFacts, people: [plural(r.adults, 'adult'), r.kids ? plural(r.kids, 'kid') : ''].filter(Boolean).join(', ') } }));
  }
  const om = await need('orders');
  const rows = a.event
    ? db.prepare("SELECT person, household, currency, SUM(total - paid) AS left, MIN(due) AS due FROM ord_orders WHERE tenant_id = ? AND event = ? AND status IN ('open', 'part') GROUP BY person, household, currency LIMIT ?").all(TENANT, a.event, MAX)
    : db.prepare("SELECT person, household, currency, SUM(total - paid) AS left, MIN(due) AS due FROM ord_orders INDEXED BY ord_orders_status WHERE tenant_id = ? AND status IN ('open', 'part') GROUP BY person, household, currency LIMIT ?").all(TENANT, MAX);
  const ways = om.paymentMethods().join(', ');
  return rows.filter((r) => r.left > 0).map((r) => ({ person: r.household ? '' : r.person, household: r.household,
    facts: { ...evFacts, amount: om.money(r.left, r.currency), due: day(r.due), ways_to_pay: ways } }));
}

/** Where a person gets a message: their Telegram chat when they have one, else WhatsApp; and whether they wrote there. */
function routeOf(p, on) {
  const chats = chatsOfPerson(p.id).filter((c) => isDirect(c.chat));
  const tg = on.has('telegram') && chats.find((c) => channelOf(c.chat) === 'telegram');
  if (tg) return { chat: tg.chat, channel: 'telegram', known: !!tg.wrote };
  if (!on.has('whatsapp')) return null;
  const wa = chats.find((c) => channelOf(c.chat) === 'whatsapp');
  if (wa) return { chat: wa.chat, channel: 'whatsapp', known: !!wa.wrote };
  return p.phone ? { chat: phoneChat(p.phone), channel: 'whatsapp', known: false } : null;
}
/** Why a person cannot get a message for this purpose ('' when they can). */
function whyNot(p, purpose, route) {
  if (!p) return 'Not in People any more';
  if (p.hidden) return 'Hidden in People';
  const c = consentsOf(p.id).find((x) => x.purpose === purpose);
  if (c?.value !== 'yes') return c?.known ? `Said no to ${purpose}` : `Not asked about ${purpose}`;
  if (!route) return 'No app to reach them';
  if (getChatPrefs(route.chat).enabled === false && db.prepare('SELECT 1 FROM chat_prefs WHERE tenant_id = ? AND chat = ?').get(TENANT, route.chat)) return 'Their chat is switched off';
  return '';
}

/**
 * The recipients of an audience: [{ person, household, name, chat, channel, known, status: waiting | skipped, reason, facts }].
 * `on`: the channels that are running. One row per person (the first unit that names them wins).
 * @param {any} audience @param {string} purpose @param {Set<string>} on
 */
export async function resolve(audience, purpose, on) {
  const out = []; const seen = new Set();
  const add = (p, household, facts, reason = '') => {
    const id = p?.id || household;
    if (seen.has(id)) return;
    seen.add(id);
    const route = p ? routeOf(p, on) : null;
    const why = reason || whyNot(p, purpose, route);
    const hh = household ? getHousehold(household).name : householdsOf(p.id)[0]?.name || '';
    out.push({ person: id, household: household || '', name: household && p ? `${p.name} (${hh})` : p?.name || hh, chat: why ? '' : route.chat, channel: why ? '' : route.channel,
      known: !why && route.known, status: why ? 'skipped' : 'waiting', reason: why, facts: { first_name: firstName(p?.name), name: p?.name || '', household: hh, ...facts } });
  };
  /** One message per household: the first adult who can get it (people who wrote before first). */
  const viaHousehold = (household, facts) => {
    let h; try { h = getHousehold(household); } catch { return; }
    if (seen.has(household)) return;
    const adults = h.members.filter((m) => m.role === 'adult').map((m) => personRow(m.person)).filter(Boolean)
      .map((p) => ({ p, route: routeOf(p, on) })).sort((x, y) => Number(!!y.route?.known) - Number(!!x.route?.known));
    const ok = adults.find((x) => !whyNot(x.p, purpose, x.route) && !seen.has(x.p.id));
    if (ok) { add(ok.p, h.id, facts); seen.add(household); return; }
    if (!adults.length) { add(null, h.id, facts, 'A household without adults'); return; }
    if (adults.some((x) => seen.has(x.p.id))) return; // an adult already gets a message
    add(adults[0].p, h.id, facts, whyNot(adults[0].p, purpose, adults[0].route)); seen.add(household);
  };
  for (const u of await units(audience)) {
    if (u.household) { viaHousehold(u.household, u.facts); continue; }
    const p = personRow(u.person);
    if (p && !p.apps.length && !p.phone && !p.hidden) { const homes = householdsOf(p.id); if (homes.length) { for (const h of homes) viaHousehold(h.id, u.facts); continue; } }
    add(p || { id: u.person, name: 'Someone', hidden: false, apps: [] }, '', u.facts, p ? '' : 'Not in People any more');
  }
  return out;
}

/** The placeholders a template uses that this audience cannot fill. */
export const missingFields = (template, kind) => [...String(template).matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1])
  .filter((f) => !Object.hasOwn(FIELDS, f) || (FIELDS[f] && !FIELDS[f].includes(kind)));
/** The template with a recipient's facts. */
export const fill = (template, facts) => String(template).replace(/\{([a-z_]+)\}/g, (_, k) => String(facts[k] ?? '')).replace(/[ \t]+([,.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
/** The facts a template uses (what a rewrite must keep word for word). */
export const usedFacts = (template, facts) => [...new Set([...String(template).matchAll(/\{([a-z_]+)\}/g)].map((m) => String(facts[m[1]] ?? '').trim()).filter(Boolean))];
