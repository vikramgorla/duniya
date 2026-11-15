// Contacts (issue #11): names synced from the linked WhatsApp phone(s) plus the owner's own entries.
// Agents look contacts up with contacts__find_contact. Participants only ever see contacts marked shared;
// organizers see all and manage them (owner decision on #11). Synced contacts are never shared by default.
import { db } from './db.js';
import { digits } from './config.js';
import { activity } from './events.js';

const TENANT = 'default';
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    tenant_id TEXT NOT NULL, phone TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', wa_name TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', shared INTEGER NOT NULL DEFAULT 0, own INTEGER NOT NULL DEFAULT 0, updated_at INTEGER,
    PRIMARY KEY (tenant_id, phone)
  );
`);

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const view = (r) => ({
  phone: r.phone, name: r.name || r.wa_name || `+${r.phone}`, ownName: r.name, whatsappName: r.wa_name, note: r.note,
  shared: !!r.shared, source: r.own ? (r.wa_name ? 'both' : 'own') : 'whatsapp', updatedAt: r.updated_at,
});
const normPhone = (p) => {
  const d = digits(p);
  if (d.length < 6 || d.length > 15) fail(`"${p}" is not a phone number with country code`);
  return d;
};

/** Contacts from Baileys (contacts.upsert / history): { id, phoneNumber?, name?, notify?, verifiedName? }. */
export function syncWhatsAppContacts(list = []) {
  const up = db.prepare(`INSERT INTO contacts (tenant_id, phone, wa_name, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (tenant_id, phone) DO UPDATE SET wa_name = excluded.wa_name, updated_at = excluded.updated_at
    WHERE excluded.wa_name <> '' AND excluded.wa_name <> contacts.wa_name`);
  let n = 0;
  for (const c of list) {
    const id = String(c?.id || '');
    const phone = id.endsWith('@s.whatsapp.net') ? digits(id.split('@')[0].split(':')[0]) : digits(String(c?.phoneNumber || '').split('@')[0]);
    const name = String(c?.name || c?.verifiedName || c?.notify || '').trim().slice(0, 100);
    if (phone.length < 6 || !name) continue;
    n += up.run(TENANT, phone, name, Date.now()).changes;
  }
  return n;
}

export function listContacts({ q = '', sharedOnly = false, limit = 500 } = {}) {
  const like = `%${String(q).trim().toLowerCase()}%`;
  const d = digits(q);
  return db.prepare(`SELECT * FROM contacts WHERE tenant_id = ? ${sharedOnly ? 'AND shared = 1' : ''}
      AND (lower(name) LIKE ? OR lower(wa_name) LIKE ? OR lower(note) LIKE ? ${d.length >= 3 ? 'OR phone LIKE ?' : ''})
      ORDER BY lower(CASE WHEN name <> '' THEN name ELSE wa_name END) LIMIT ?`)
    .all(...[TENANT, like, like, like, ...(d.length >= 3 ? [`%${d}%`] : []), Math.min(Number(limit) || 500, 2000)]).map(view);
}

export function getContact(phone) {
  const r = db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?').get(TENANT, digits(phone));
  return r ? view(r) : null;
}

/** Create or change an own contact. Only the given fields change. */
export function saveContact({ phone, name, note, shared }, by = 'panel') {
  const p = normPhone(phone);
  const cur = db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?').get(TENANT, p);
  const next = {
    name: name !== undefined ? String(name).trim().slice(0, 100) : cur?.name || '',
    note: note !== undefined ? String(note).trim().slice(0, 300) : cur?.note || '',
    shared: shared !== undefined ? (shared ? 1 : 0) : cur?.shared || 0,
  };
  if (!next.name && !cur?.wa_name) fail('A name is required');
  db.prepare(`INSERT INTO contacts (tenant_id, phone, name, note, shared, own, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT (tenant_id, phone) DO UPDATE SET name = excluded.name, note = excluded.note, shared = excluded.shared, own = 1, updated_at = excluded.updated_at`)
    .run(TENANT, p, next.name, next.note, next.shared, Date.now());
  activity('config', { summary: `Contact ${cur ? 'updated' : 'added'}: ${next.name || cur?.wa_name} (+${p})${next.shared ? ', shared' : ''} — ${by}` });
  return getContact(p);
}

/** Remove an own contact. A contact synced from WhatsApp keeps its WhatsApp name but loses own fields and sharing. */
export function removeContact(phone, by = 'panel') {
  const p = digits(phone);
  const cur = db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?').get(TENANT, p);
  if (!cur) return false;
  if (cur.wa_name) db.prepare("UPDATE contacts SET name = '', note = '', shared = 0, own = 0, updated_at = ? WHERE tenant_id = ? AND phone = ?").run(Date.now(), TENANT, p);
  else db.prepare('DELETE FROM contacts WHERE tenant_id = ? AND phone = ?').run(TENANT, p);
  activity('config', { summary: `Contact removed: ${cur.name || cur.wa_name} (+${p}) — ${by}` });
  return true;
}

export const contactCounts = () => db.prepare('SELECT COUNT(*) total, SUM(shared) shared, SUM(own) own FROM contacts WHERE tenant_id = ?').get(TENANT);

// ---------- agent tools (exposed as contacts__<name>) ----------
export const CONTACTS_DEFAULT_ALLOW = { organizer: ['contacts:*'], participant: ['contacts:find_contact'] };
const out = (c, full) => ({ name: c.name, phone: `+${c.phone}`, ...(c.note ? { note: c.note } : {}), ...(full ? { shared: c.shared, whatsappName: c.whatsappName } : {}) });

export const contactsTools = [
  {
    name: 'find_contact',
    description: 'Look up a person\'s phone number (and note) in the contact list by name, part of a name or number. Participants only see contacts the owner shared.',
    input_schema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['query'] },
    roles: ['organizer', 'participant'],
    async run({ query }, ctx) {
      if (String(query || '').trim().length < 2) throw new Error('query too short');
      const org = ctx.role === 'organizer';
      const found = listContacts({ q: query, sharedOnly: !org, limit: 10 }).map((c) => out(c, org));
      return found.length ? found : 'No matching contact' + (org ? '' : ' that is shared with this chat');
    },
  },
  {
    name: 'save_contact',
    description: 'Add or change a contact (organizers only): name, phone with country code, optional short note, and whether participants may look it up (shared).',
    input_schema: {
      type: 'object',
      properties: { phone: { type: 'string' }, name: { type: 'string', maxLength: 100 }, note: { type: 'string', maxLength: 300 }, shared: { type: 'boolean' } },
      required: ['phone'],
    },
    roles: ['organizer'],
    async run(input, ctx) { return out(saveContact(input, `${ctx.senderName} via ${ctx.bot.id}`), true); },
  },
  {
    name: 'remove_contact',
    description: 'Remove a contact from the own list by phone number (organizers only).',
    input_schema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    roles: ['organizer'],
    async run({ phone }, ctx) { return { removed: removeContact(phone, `${ctx.senderName} via ${ctx.bot.id}`) }; },
  },
];
