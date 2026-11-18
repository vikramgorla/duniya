// @ts-check
// Agent people tools (079, People step 2), exposed as people__<name>: find a person, get a person's card, add an agent
// note, tag, add to a list. They replace the contacts__* tools of 078. Access is decided in code (people-access.js):
// only people the agent may see (its own chats, lists shared with it, or everyone; owner turns see everyone), never
// hidden people; participants only the people the owner marked Shared. Changes are for organizers, and a change to
// anyone other than the sender is held for an organizer's "confirm XXXX" (the runner's confirm gate). Merge, hide and
// erase are never agent tools.
import { fail, clip, digits } from './config.js';
import { addNote, householdsOf, listLists, listPeople, listsOf, personById, personByRef, seenNameOf, setListMember, setTags, tagsOf, tiesOf, timeline } from './people.js';
import { canSee, peopleScope } from './people-access.js';
import { agentName } from './contacts.js';

/** The name an agent sees (#113: phone contact names only while the owner allows them). */
const nameFor = (p) => (p.phone ? agentName({ phone: p.phone, fallbackName: seenNameOf(p.id) }) || `+${p.phone}` : p.ownName || seenNameOf(p.id) || 'Someone');

const PEOPLE_DEFAULT_ALLOW = { organizer: ['people:*'], participant: ['people:find_person', 'people:get_person'] };
// 079, one release only (remove in the next): saved `contacts:` rules of 078 keep working as the matching people rules.
const LEGACY = { 'contacts:*': ['people:*'], 'contacts:find_contact': ['people:find_person', 'people:get_person'], 'contacts:save_contact': ['people:add_note', 'people:tag_person'] };
/** The people rules of a role: its explicit people: (or old contacts:) rules, else the defaults. */
export function peopleRules(agent, role) {
  const allow = agent.tools?.[role] || [];
  const rules = [...allow.filter((r) => r.startsWith('people:')), ...allow.flatMap((r) => LEGACY[r] || [])];
  return rules.length ? rules : PEOPLE_DEFAULT_ALLOW[role] || [];
}

const scopeOf = (ctx) => peopleScope(ctx.agent, { owner: !!ctx.ownerTurn });
/** Organizers (and the owner, on any turn) see everyone in scope; participants only the people the owner shared. */
const full = (ctx) => ctx.role === 'organizer' || !!ctx.ownerTurn;
/** The person a tool names (id, phone or a name that matches exactly one visible person), if the agent may see them. */
function visible(ref, ctx) {
  const scope = scopeOf(ctx);
  const r = String(ref || '').trim();
  if (!r) throw fail('Name the person (id, number or name)');
  let p = personByRef(r);
  if (!p && !/^p_/.test(r) && digits(r).length < 6) {
    const hits = listPeople({ q: r, scope, limit: 3, shared: !full(ctx) });
    if (hits.length > 1) throw fail(`More than one person matches "${clip(r, 40)}": ${hits.map((h) => `${h.name} (${h.id})`).join(', ')}. Use the id.`);
    p = hits[0] ? personById(hits[0].id) : null;
  }
  if (!p || !canSee(scope, p.id) || (!full(ctx) && !p.shared)) throw fail('No such person that this agent may see');
  return p;
}
const short = (p, org) => ({ id: p.id, name: nameFor(p), ...(p.nickname ? { nickname: p.nickname } : {}), ...(p.phone ? { phone: `+${p.phone}` } : {}), ...(org ? { tags: tagsOf(p.id) } : {}) });
/** A change to someone other than the sender waits for an organizer's confirm code. */
function change(p, ctx, action, summary) {
  if (p.id === ctx.personId || !ctx.hold) return applyPeopleAction(action, ctx.agent);
  ctx.hold({ kind: 'people', action, summary });
  return `Held for an organizer's confirmation: ${summary}. The confirm code is added to your answer; say that it applies after confirm.`;
}

/** Carry out a people change (now, or after "confirm XXXX"). Returns a short result. */
export function applyPeopleAction(action, agent) {
  const p = personById(action.person);
  if (!p) throw fail('That person is no longer in People');
  const by = agent?.name || agent?.id || 'an agent';
  if (action.op === 'note') { addNote(p.id, { text: action.text, by: 'agent', author: by }); return `Note added to ${p.name}.`; }
  if (action.op === 'tag') {
    const next = setTags(p.id, [...tagsOf(p.id).filter((t) => !(action.remove || []).includes(t)), ...(action.add || [])]);
    return `${p.name}'s tags: ${next.join(', ') || '(none)'}.`;
  }
  if (action.op === 'list') { setListMember(action.list, p.id, true); return `${p.name} added to the list.`; }
  throw fail('Unknown change');
}

export const peopleTools = [
  {
    name: 'find_person',
    description: 'Find people in People by name, nickname, number or tag. Only people this agent may see (from its chats or lists shared with it).',
    input_schema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['query'] },
    roles: ['organizer', 'participant'],
    async run({ query }, ctx) {
      if (String(query || '').trim().length < 2) throw fail('query too short');
      const org = full(ctx);
      const found = listPeople({ q: query, scope: scopeOf(ctx), shared: !org, limit: 10 }).map((p) => short(p, org));
      return found.length ? found : 'Nobody matching that this agent may see';
    },
  },
  {
    name: 'get_person',
    description: 'A person\'s card: name, nickname, number, birthday, households, family ties, tags, lists and the latest notes. Never message text.',
    input_schema: { type: 'object', properties: { person: { type: 'string', description: 'Person id (p_…), number or name' } }, required: ['person'] },
    roles: ['organizer', 'participant'],
    async run({ person }, ctx) {
      const p = visible(person, ctx);
      const scope = scopeOf(ctx);
      const org = full(ctx);
      return {
        ...short(p, org), ...(p.birthday ? { birthday: p.birthday.replace(/^--/, '') } : {}),
        households: householdsOf(p.id).map((h) => `${h.name} (${h.role})`),
        ties: tiesOf(p.id).filter((t) => canSee(scope, t.other.id)).map((t) => `${t.label} ${nameFor(personById(t.other.id) || t.other)}`),
        ...(org ? { lists: listsOf(p.id).map((l) => l.name), notes: timeline(p.id, 20).filter((n) => n.kind === 'note').slice(0, 5).map((n) => `${clip(n.text, 200)} (${n.by})`) } : {}),
      };
    },
  },
  {
    name: 'add_note',
    description: 'Add a short note to a person (marked as written by this agent; organizers). Never copy message text into it. A note about someone other than the sender waits for an organizer\'s confirm code.',
    input_schema: { type: 'object', properties: { person: { type: 'string' }, text: { type: 'string', maxLength: 500 } }, required: ['person', 'text'] },
    roles: ['organizer'],
    async run({ person, text }, ctx) {
      const p = visible(person, ctx);
      if (!String(text || '').trim()) throw fail('Write the note');
      return change(p, ctx, { op: 'note', person: p.id, text: String(text).slice(0, 500) }, `note on ${p.name}: "${clip(text, 80)}"`);
    },
  },
  {
    name: 'tag_person',
    description: 'Add or remove tags of a person (free words, e.g. "driver"; organizers). Changes to someone other than the sender wait for an organizer\'s confirm code.',
    input_schema: { type: 'object', properties: { person: { type: 'string' }, add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, required: ['person'] },
    roles: ['organizer'],
    async run({ person, add = [], remove = [] }, ctx) {
      const p = visible(person, ctx);
      const norm = (l) => (Array.isArray(l) ? l : []).map((t) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
      const a = norm(add); const r = norm(remove);
      if (!a.length && !r.length) throw fail('Give tags to add or remove');
      return change(p, ctx, { op: 'tag', person: p.id, add: a, remove: r }, `tags of ${p.name}: ${[...a.map((t) => `+${t}`), ...r.map((t) => `-${t}`)].join(' ')}`);
    },
  },
  {
    name: 'add_to_list',
    description: 'Add a person to one of the owner\'s named lists (by list name; organizers). Waits for an organizer\'s confirm code unless it is the sender.',
    input_schema: { type: 'object', properties: { person: { type: 'string' }, list: { type: 'string', description: 'List name' } }, required: ['person', 'list'] },
    roles: ['organizer'],
    async run({ person, list }, ctx) {
      const p = visible(person, ctx);
      const want = String(list || '').trim().toLowerCase();
      const l = listLists().find((x) => x.id === list || x.name.toLowerCase() === want);
      if (!l) throw fail(`No list named "${clip(list, 40)}". Lists: ${listLists().map((x) => x.name).join(', ') || '(none yet; the owner creates them)'}`);
      return change(p, ctx, { op: 'list', person: p.id, list: l.id }, `add ${p.name} to the list ${l.name}`);
    },
  },
];
