// @ts-check
// Panel routes (091): commitments people made in chats, people's preferences, and suggested family ties. Admins.
import { chatLabels } from '../../core/chat-names.js';
import { listCommitments, updateCommitment } from '../../core/commitments.js';
import { decideTie, prefsOf, setPrefs, tieSuggestions } from '../../core/person-insights.js';
import { personByRef } from '../../core/people.js';
import { activity } from '../../core/events.js';

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function promiseRoutes(route, { channel } = {}) {
  const admin = { role: 'admin' };
  const person = (ref) => { const p = personByRef(decodeURIComponent(ref)); if (!p) throw Object.assign(new Error('No such person'), { status: 404 }); return p; };
  route('GET', '/api/commitments', async (req, res, body, q) => {
    const list = listCommitments({ agent: q.get('agent') || '', person: q.get('person') || '', chat: q.get('chat') || '', status: q.get('status') || 'open' });
    const names = await chatLabels([...new Set(list.map((c) => c.chat))], channel);
    return list.map((c) => ({ ...c, chatName: names.get(c.chat) }));
  }, admin);
  route('PUT', '/api/commitments/:id', async (req, res, body, q, p, user) => updateCommitment(p.id, body || {}, user.username), admin);
  route('GET', '/api/people/:ref/prefs', async (req, res, body, q, p) => prefsOf(person(p.ref).id), admin);
  route('PUT', '/api/people/:ref/prefs', async (req, res, body, q, p, user) => {
    const x = person(p.ref);
    const out = setPrefs(x.id, body || {});
    activity('config', { summary: `A person's preferences changed (${user.username})` });
    return out;
  }, admin);
  route('GET', '/api/people-suggestions', async () => tieSuggestions(), admin);
  route('POST', '/api/people-suggestions/:key', async (req, res, body, q, p, user) => decideTie(decodeURIComponent(p.key), !!body.accept, user.username), admin);
}
