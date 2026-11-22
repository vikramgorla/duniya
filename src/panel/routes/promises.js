// @ts-check
// Panel routes (091): commitments people made in chats, people's preferences, and suggested family ties. Admins.
// 092: People → Promises: every agent's promises with filters, names and links; change or delete one.
import { chatLabels } from '../../core/chat-names.js';
import { deleteCommitment, listCommitments, updateCommitment } from '../../core/commitments.js';
import { isBuiltin, listAgents } from '../../core/agents.js';
import { decideTie, prefsOf, setPrefs, tieSuggestions } from '../../core/person-insights.js';
import { personByRef } from '../../core/people.js';
import { activity } from '../../core/events.js';

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function promiseRoutes(route, { channel } = {}) {
  const admin = /** @type {{ role: 'admin' }} */ ({ role: 'admin' });
  const person = (ref) => { const p = personByRef(decodeURIComponent(ref)); if (!p) throw Object.assign(new Error('No such person'), { status: 404 }); return p; };
  route('GET', '/api/commitments', async ({ query }) => {
    const list = listCommitments({ agent: query.get('agent') || '', person: query.get('person') || '', chat: query.get('chat') || '', status: query.get('status') || 'open' });
    const names = chatLabels([...new Set(list.map((c) => c.chat))]);
    const agents = new Map(listAgents().filter((a) => !isBuiltin(a)).map((a) => [a.id, a.name]));
    return list.map((c) => ({ ...c, chatName: names.get(c.chat), agentName: agents.get(c.agent) || c.agent }));
  }, admin);
  route('PUT', '/api/commitments/:id', async ({ body, params, user }) => updateCommitment(params.id, body || {}, user.username), admin);
  route('DELETE', '/api/commitments/:id', async ({ params, user }) => deleteCommitment(params.id, user.username), admin);
  route('GET', '/api/people/:ref/prefs', async ({ params }) => prefsOf(person(params.ref).id), admin);
  route('PUT', '/api/people/:ref/prefs', async ({ body, params, user }) => {
    const x = person(params.ref);
    const out = setPrefs(x.id, body || {});
    activity('config', { summary: `A person's preferences changed (${user.username})` });
    return out;
  }, admin);
  route('GET', '/api/people-suggestions', async () => tieSuggestions(), admin);
  route('POST', '/api/people-suggestions/:key', async ({ body, params, user }) => decideTie(decodeURIComponent(params.key), !!body.accept, user.username), admin);
}
