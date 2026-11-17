// @ts-check
// Panel routes: contacts and the names agents may see.
import { digits } from '../../core/config.js';
import { contactNamesForAgents, contactSummary, getContact, personInfo, listContacts, removeContact, saveContact, setContactNamesForAgents } from '../../core/contacts.js';
import { agentForChat } from '../../core/agents.js';
import { chatLabels } from '../../core/chat-names.js';
import { getChatPrefs } from '../../core/chat-prefs.js';
import { db, kvGet } from '../../core/db.js';
import { listDirectChats } from '../../core/direct-chats.js';
import { activity } from '../../core/events.js';

/**
 * 073: a person's page — the contact and their chats: the direct chat(s) (prepared, seen or bound, on any number) and the
 * groups they wrote in (stored messages, so only chats that were on). Each chat with its name, agent and on/off.
 */
async function personChats(phone, channel) {
  const direct = new Set(listDirectChats().filter((d) => d.phone === phone).map((d) => d.chat));
  for (const r of db.prepare("SELECT chat FROM chats_seen WHERE tenant_id = 'default' AND is_group = 0 AND (phone = ? OR chat = ? OR chat LIKE ?)").all(phone, `${phone}@s.whatsapp.net`, `%#${phone}@s.whatsapp.net`)) direct.add(r.chat);
  const groups = db.prepare("SELECT chat, MAX(ts) AS last FROM messages WHERE sender = ? AND chat LIKE '%@g.us' GROUP BY chat ORDER BY last DESC LIMIT 50").all(phone);
  const names = await chatLabels([...direct, ...groups.map((g) => g.chat)], channel);
  const view = (id, extra) => { const a = agentForChat(id); return { id, name: names.get(id), agent: a?.id || '', agentName: a?.name || '', enabled: getChatPrefs(id).enabled, ...extra }; };
  return { direct: [...direct].map((id) => view(id, {})), groups: groups.map((g) => view(g.chat, { lastAt: g.last })) };
}

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function contactRoutes(route, { channel } = {}) {
  // ---------- contacts (#11) ----------
  route('GET', '/api/contacts', async (req, res, body, q) => listContacts({ q: q.get('q') || '', sharedOnly: q.get('shared') === '1', limit: Number(q.get('limit')) || 500, offset: Number(q.get('offset')) || 0 }));
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
  route('GET', '/api/contacts/:phone/person', async (req, res, body, q, p) => {
    const phone = digits(decodeURIComponent(p.phone));
    if (phone.length < 6) return [404, { error: 'Not a phone number' }];
    // someone with a chat who is not a saved contact still has a page (name from WhatsApp, or the number)
    const c = getContact(phone) || { phone, name: personInfo({ phone }).label, source: 'none', notSaved: true };
    return { ...c, ...(await personChats(phone, channel)) };
  }, { role: 'admin' });
  route('PUT', '/api/contacts/:phone', async (req, res, body, q, p, user) => saveContact({ ...body, phone: decodeURIComponent(p.phone) }, user.username));
  route('DELETE', '/api/contacts/:phone', async (req, res, body, q, p, user) => {
    if (!getContact(decodeURIComponent(p.phone))) return [404, { error: 'Not found' }];
    removeContact(decodeURIComponent(p.phone), user.username);
    return { ok: true };
  });
}
