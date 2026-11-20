// @ts-check
// Panel routes: People (078, PRM core) — people, households, lists, and the names agents may see. Reading and editing
// need an admin; merge, undo, export and erase need the owner. Replaces the Contacts routes (073).
import { prefsOf } from '../../core/person-insights.js';
import { listCommitments } from '../../core/commitments.js';
import { contactNamesForAgents, contactSummary, setContactNamesForAgents } from '../../core/contacts.js';
import { agentForChat, listAgents, isBuiltin } from '../../core/agents.js';
import { agentsSeeing, chatsOfPerson, consentsOf, recordConsent, CONSENT_PURPOSES } from '../../core/people-access.js';
import { chatLabels } from '../../core/chat-names.js';
import { getChatPrefs } from '../../core/chat-prefs.js';
import { digits } from '../../core/config.js';
import { db, kvGet } from '../../core/db.js';
import { listDirectChats } from '../../core/direct-chats.js';
import { activity } from '../../core/events.js';
import { isGroup, phoneOf } from '../../channels/index.js';
import { personInfo } from '../../core/contacts.js';
import {
  addNote, addTie, createPerson, deleteHousehold, deleteList, getHousehold, getList, householdsOf, listHouseholds, listLists, listPeople, listsOf,
  peopleCounts, personByRef, reachVia, removeHouseholdMember, removeNote, removeTie, saveHousehold, saveList, setHidden, setHouseholdMember, setListMember,
  setTags, tagsOf, tiesOf, timeline, updatePerson, TIE_KINDS,
} from '../../core/people.js';
import { moduleSections } from '../../modules/index.js';
import { erasePerson, exportPerson, mergePeople, mergeSuggestions, mergesInto, undoMerge } from '../../core/people-ops.js';

/**
 * A person's chats: the direct chat(s) (prepared, seen or bound, on any number) and the groups they are in (079: wrote
 * in or a member of, while the chat was on). Each with its name, agent and on/off.
 */
async function personChats(p, channel) {
  const phone = p.phone; const ids = (p.identities || []).map((i) => i.externalId);
  const direct = new Set(phone ? listDirectChats().filter((d) => d.phone === phone).map((d) => d.chat) : []);
  for (const r of db.prepare("SELECT chat, phone FROM chats_seen WHERE tenant_id = 'default' AND is_group = 0").all()) {
    const native = r.chat.split('#').pop();
    if ((phone && (r.phone === phone || phoneOf(r.chat) === phone)) || ids.includes(native)) direct.add(r.chat);
  }
  const groups = p.id ? chatsOfPerson(p.id).filter((g) => isGroup(g.chat)).slice(0, 50) : [];
  const names = await chatLabels([...direct, ...groups.map((g) => g.chat)], channel);
  const view = (id, extra) => { const a = agentForChat(id); return { id, name: names.get(id), agent: a?.id || '', agentName: a?.name || '', enabled: getChatPrefs(id).enabled, ...extra }; };
  return { direct: [...direct].map((id) => view(id, {})), groups: groups.map((g) => view(g.chat, { lastAt: g.lastAt, wrote: g.wrote, member: g.member })) };
}
const found = (ref) => { const p = personByRef(decodeURIComponent(ref)); if (!p) throw Object.assign(new Error('No such person'), { status: 404 }); return p; };

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function peopleRoutes(route, { channel } = {}) {
  const admin = { role: /** @type {'admin'} */ ('admin') }; const owner = { role: /** @type {'owner'} */ ('owner') };
  route('GET', '/api/people', async (req, res, body, q) => listPeople({ q: q.get('q') || '', tag: q.get('tag') || '', list: q.get('list') || '', household: q.get('household') || '',
    app: q.get('app') || '', source: q.get('source') || '', hidden: q.get('hidden') === '1', limit: Number(q.get('limit')) || 100, offset: Number(q.get('offset')) || 0 }), admin);
  // counts, tags in use, households and lists for the filters, names from the phone and when they were refreshed
  route('GET', '/api/people/summary', async () => {
    const numbers = ((await channel?.status?.())?.numbers || [{ id: 'main' }]).map((n) => n.id);
    const at = numbers.map((n) => Number(kvGet(`contactsRefreshedAt:${n}`)) || 0).filter(Boolean);
    return { ...peopleCounts(), households: listHouseholds(), lists: listLists(), names: contactSummary(), refreshedAt: at.length ? Math.max(...at) : null,
      namesForAgents: contactNamesForAgents(), tieKinds: Object.keys(TIE_KINDS), consentPurposes: CONSENT_PURPOSES };
  }, admin);
  route('POST', '/api/people', async (req, res, body, q, p, user) => createPerson(body || {}, user.username), admin);
  // #113: may agents see the names from the owner's phone contacts? (default yes; profile names are often incomplete)
  route('PUT', '/api/people/agent-names', async (req, res, body, q, p, user) => {
    if (typeof body.enabled !== 'boolean') return [400, { error: 'enabled must be true or false', field: 'enabled' }];
    const on = setContactNamesForAgents(body.enabled);
    activity('config', { summary: `Phone contact names for agents ${on ? 'on' : 'off'} by ${user.username}` });
    return { namesForAgents: on };
  }, owner);
  // Optional extra: refresh names now (the server also does it by itself). At most every 10 minutes per number.
  route('POST', '/api/people/refresh-names', async (req, res, body, q, p, user) => {
    if (typeof channel?.refreshNames !== 'function') return [501, { error: 'Not available' }];
    const r = await channel.refreshNames();
    activity('config', { summary: `Names refreshed from WhatsApp (${user.username})` });
    return { numbers: r, ...contactSummary() };
  }, admin);
  route('POST', '/api/people/merges/:id/undo', async (req, res, body, q, p, user) => undoMerge(p.id, user.username), owner);

  // a person's page: by id, or by number (someone with a chat who is not in People yet still has a page)
  route('GET', '/api/people/:ref', async (req, res, body, q, p) => {
    const ref = decodeURIComponent(p.ref);
    const x = personByRef(ref);
    if (!x) {
      const phone = digits(ref);
      if (phone.length < 6 || ref.startsWith('p_')) return [404, { error: 'No such person' }];
      return { notInPeople: true, phone, name: personInfo({ phone }).label, apps: [], ...(await personChats({ phone }, channel)) };
    }
    return { ...x, ...(await personChats(x, channel)), ties: tiesOf(x.id), households: householdsOf(x.id), reachVia: reachVia(x.id), timeline: timeline(x.id),
      tags: tagsOf(x.id), lists: listsOf(x.id), merges: mergesInto(x.id), suggestions: mergeSuggestions(x.id),
      consents: consentsOf(x.id), agents: agentsSeeing(x.id, listAgents().filter((a) => !isBuiltin(a))), modules: moduleSections('person', x.id),
      prefs: prefsOf(x.id), commitments: listCommitments({ person: x.id }) }; // 091
  }, admin);
  route('PUT', '/api/people/:ref', async (req, res, body, q, p) => updatePerson(found(p.ref).id, body || {}), admin);
  // 079: the panel hides people; a true delete (privacy requests) is the admin MCP's erase_person, behind a confirm
  route('DELETE', '/api/people/:ref', async (req, res, body, q, p, user) => erasePerson(found(p.ref).id, user.username), owner);
  route('PUT', '/api/people/:ref/hidden', async (req, res, body, q, p, user) => {
    if (typeof body.hidden !== 'boolean') return [400, { error: 'hidden must be true or false', field: 'hidden' }];
    return setHidden(found(p.ref).id, body.hidden, user.username);
  }, admin);
  route('PUT', '/api/people/:ref/consents', async (req, res, body, q, p, user) => {
    const id = found(p.ref).id;
    recordConsent(id, String(body.purpose || ''), String(body.value || ''), `Set by ${user.username}`);
    return { consents: consentsOf(id) };
  }, admin);
  route('GET', '/api/people/:ref/export', async (req, res, body, q, p) => exportPerson(found(p.ref).id), owner);
  route('POST', '/api/people/:ref/merge', async (req, res, body, q, p, user) => mergePeople(found(p.ref).id, String(body.other || ''), user.username), owner);
  route('POST', '/api/people/:ref/notes', async (req, res, body, q, p, user) => addNote(found(p.ref).id, { text: body.text, by: body.by || 'owner', author: user.username }), admin);
  route('DELETE', '/api/people/:ref/notes/:note', async (req, res, body, q, p) => (removeNote(found(p.ref).id, p.note) ? { ok: true } : [404, { error: 'No such note' }]), admin);
  route('POST', '/api/people/:ref/ties', async (req, res, body, q, p) => {
    const me = found(p.ref).id; const other = found(String(body.other || '')).id;
    const id = body.reverse ? addTie(other, me, body) : addTie(me, other, body);
    return { id, ties: tiesOf(me) };
  }, admin);
  route('DELETE', '/api/people/:ref/ties/:tie', async (req, res, body, q, p) => (removeTie(p.tie) ? { ties: tiesOf(found(p.ref).id) } : [404, { error: 'No such tie' }]), admin);
  route('PUT', '/api/people/:ref/tags', async (req, res, body, q, p) => ({ tags: setTags(found(p.ref).id, body.tags) }), admin);

  // ---------- households ----------
  route('GET', '/api/households', async () => listHouseholds(), admin);
  route('POST', '/api/households', async (req, res, body) => saveHousehold({ name: body.name, address: body.address }), admin);
  route('GET', '/api/households/:id', async (req, res, body, q, p) => ({ ...getHousehold(p.id), modules: moduleSections('household', p.id) }), admin);
  route('PUT', '/api/households/:id', async (req, res, body, q, p) => saveHousehold({ id: p.id, name: body.name, address: body.address }), admin);
  route('DELETE', '/api/households/:id', async (req, res, body, q, p) => ({ ok: deleteHousehold(p.id) }), admin);
  route('PUT', '/api/households/:id/members/:person', async (req, res, body, q, p) => setHouseholdMember(p.id, found(p.person).id, body.role || 'adult'), admin);
  route('DELETE', '/api/households/:id/members/:person', async (req, res, body, q, p) => removeHouseholdMember(p.id, found(p.person).id), admin);

  // ---------- lists ----------
  route('GET', '/api/lists', async () => listLists(), admin);
  route('POST', '/api/lists', async (req, res, body) => saveList({ name: body.name }), admin);
  route('GET', '/api/lists/:id', async (req, res, body, q, p) => getList(p.id), admin);
  route('PUT', '/api/lists/:id', async (req, res, body, q, p) => saveList({ id: p.id, name: body.name }), admin);
  route('DELETE', '/api/lists/:id', async (req, res, body, q, p) => ({ ok: deleteList(p.id) }), admin);
  route('PUT', '/api/lists/:id/members/:person', async (req, res, body, q, p) => setListMember(p.id, found(p.person).id, true), admin);
  route('DELETE', '/api/lists/:id/members/:person', async (req, res, body, q, p) => setListMember(p.id, found(p.person).id, false), admin);
}
