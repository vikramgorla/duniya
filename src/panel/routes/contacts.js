// @ts-check
// Panel routes: contacts and the names agents may see.
import { contactNamesForAgents, contactSummary, getContact, listContacts, removeContact, saveContact, setContactNamesForAgents } from '../../core/contacts.js';
import { kvGet } from '../../core/db.js';
import { activity } from '../../core/events.js';

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function contactRoutes(route, { channel } = {}) {
  // ---------- contacts (#11) ----------
  route('GET', '/api/contacts', async (req, res, body, q) => listContacts({ q: q.get('q') || '', sharedOnly: q.get('shared') === '1' }));
  // 057: counts per kind of name and when names were last refreshed (refreshes run by themselves after connect and daily)
  route('GET', '/api/contacts/summary', async () => {
    const numbers = ((await channel.status()).numbers || [{ id: 'main' }]).map((n) => n.id);
    const at = numbers.map((n) => Number(kvGet(`contactsRefreshedAt:${n}`)) || 0).filter(Boolean);
    return { ...contactSummary(), refreshedAt: at.length ? Math.max(...at) : null, automatic: true, namesForAgents: contactNamesForAgents() };
  });
  // #113: may agents see the names from the owner's phone contacts? (default yes; profile names are often incomplete)
  route('PUT', '/api/contacts/agent-names', async (req, res, body, q, p, user) => {
    if (typeof body.enabled !== 'boolean') return [400, { error: 'enabled must be true or false', field: 'enabled' }];
    const on = setContactNamesForAgents(body.enabled);
    activity('config', { summary: `Phone contact names for agents ${on ? 'on' : 'off'} by ${user.username}` });
    return { namesForAgents: on };
  }, { role: 'owner' });
  // Optional extra: refresh now (the server also does it by itself). At most every 10 minutes per number.
  route('POST', '/api/contacts/refresh', async (req, res, body, q, p, user) => {
    if (typeof channel.refreshNames !== 'function') return [501, { error: 'Not available' }];
    const r = await channel.refreshNames();
    activity('config', { summary: `Contact names refreshed from WhatsApp (${user.username})` });
    return { numbers: r, ...contactSummary() };
  });
  route('PUT', '/api/contacts/:phone', async (req, res, body, q, p, user) => saveContact({ ...body, phone: decodeURIComponent(p.phone) }, user.username));
  route('DELETE', '/api/contacts/:phone', async (req, res, body, q, p, user) => {
    if (!getContact(decodeURIComponent(p.phone))) return [404, { error: 'Not found' }];
    removeContact(decodeURIComponent(p.phone), user.username);
    return { ok: true };
  });
}
