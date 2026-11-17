// @ts-check
// Contacts (issue #11, #110): names synced from the linked WhatsApp phone(s) plus the owner's own entries.
// Agents look contacts up with contacts__find_contact. Participants only ever see contacts marked shared;
// organizers see all and manage them (owner decision on #11). Synced contacts are never shared by default.
//
// 057 (#110): WhatsApp gives three kinds of names and they are kept apart, so a later profile-name update never
// replaces the name from the owner's address book:
//   book_name — the owner's phone address book (app-state contact sync, history chats)
//   biz_name  — a WhatsApp Business verified name
//   push_name — the profile name the person chose (sent with every message)
// One resolver (personInfo) decides what the panel shows: own name > address book > business > profile > number.
// People WhatsApp only identifies by a LID (hidden number) are kept in contact_lids until the LID↔phone mapping
// arrives; then their names move to the phone's row. A raw LID is never shown as if it were a number.
import { db } from './db.js';
import { digits, fail } from './config.js';
import { activity } from './events.js';
import { getSetting, updateSettings } from './store.js';

const TENANT = 'default';
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    tenant_id TEXT NOT NULL, phone TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', book_name TEXT NOT NULL DEFAULT '',
    biz_name TEXT NOT NULL DEFAULT '', push_name TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', shared INTEGER NOT NULL DEFAULT 0, own INTEGER NOT NULL DEFAULT 0, updated_at INTEGER,
    PRIMARY KEY (tenant_id, phone)
  );
  CREATE TABLE IF NOT EXISTS contact_lids (
    tenant_id TEXT NOT NULL, lid TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', book_name TEXT NOT NULL DEFAULT '',
    biz_name TEXT NOT NULL DEFAULT '', push_name TEXT NOT NULL DEFAULT '', updated_at INTEGER,
    PRIMARY KEY (tenant_id, lid)
  );
`);
const HIDDEN_NUMBER = 'Unknown (hidden number)';
const synced = (r) => r.book_name || r.biz_name || r.push_name || '';
const view = (r) => ({
  phone: r.phone, name: r.name || synced(r) || `+${r.phone}`, ownName: r.name, whatsappName: synced(r),
  bookName: r.book_name, businessName: r.biz_name, profileName: r.push_name, note: r.note,
  shared: !!r.shared, source: r.own ? (synced(r) ? 'both' : 'own') : 'whatsapp', updatedAt: r.updated_at,
});
const normPhone = (p) => {
  const d = digits(p);
  if (d.length < 6 || d.length > 15) throw fail(`"${p}" is not a phone number with country code`);
  return d;
};
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 100);
/** user part of a jid without device: "123:4@lid" → "123@lid". */
export const bareJid = (j) => { const s = String(j || ''); const at = s.indexOf('@'); return at < 0 ? '' : `${s.slice(0, at).split(':')[0]}${s.slice(at)}`; };
const isLid = (j) => /@(lid|hosted\.lid)$/.test(String(j || ''));
const isPn = (j) => /@(s\.whatsapp\.net|c\.us|hosted)$/.test(String(j || ''));
const pnDigits = (j) => (isPn(j) ? digits(String(j).split('@')[0].split(':')[0]) : '');

const getRow = db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND phone = ?');
const getLid = db.prepare('SELECT * FROM contact_lids WHERE tenant_id = ? AND lid = ?');
const NAME_COLS = { book: 'book_name', biz: 'biz_name', push: 'push_name' };
const upPhone = Object.fromEntries(Object.entries(NAME_COLS).map(([k, col]) => [k, db.prepare(`INSERT INTO contacts (tenant_id, phone, ${col}, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (tenant_id, phone) DO UPDATE SET ${col} = excluded.${col}, updated_at = excluded.updated_at WHERE contacts.${col} <> excluded.${col}`)]));
const upLid = Object.fromEntries(Object.entries(NAME_COLS).map(([k, col]) => [k, db.prepare(`INSERT INTO contact_lids (tenant_id, lid, ${col}, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (tenant_id, lid) DO UPDATE SET ${col} = excluded.${col}, updated_at = excluded.updated_at WHERE contact_lids.${col} <> excluded.${col}`)]));
const setLidPhone = db.prepare(`INSERT INTO contact_lids (tenant_id, lid, phone, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (tenant_id, lid) DO UPDATE SET phone = excluded.phone, updated_at = excluded.updated_at WHERE contact_lids.phone <> excluded.phone`);

/**
 * Remember that a LID belongs to a phone number (from Baileys' lid-mapping.update, history mappings, contacts with
 * both, message keys with participantAlt, group metadata). Names that arrived for the LID move to the phone's row.
 * Returns true when something changed.
 */
export function mapLid(lid, phone) {
  const l = bareJid(lid); const p = digits(String(phone || '').split('@')[0].split(':')[0]);
  if (!isLid(l) || p.length < 6 || p.length > 15) return false;
  const changed = setLidPhone.run(TENANT, l, p, Date.now()).changes > 0;
  const r = getLid.get(TENANT, l);
  let moved = 0;
  for (const [k, col] of Object.entries(NAME_COLS)) if (r?.[col]) moved += Number(upPhone[k].run(TENANT, p, r[col], Date.now()).changes);
  return changed || moved > 0;
}
/** Phone digits of a LID when the mapping is known, else ''. */
export const lidPhone = (lid) => (isLid(lid) ? getLid.get(TENANT, bareJid(lid))?.phone || '' : '');

/**
 * Contacts from Baileys (contacts.upsert / contacts.update / history): { id, lid?, phoneNumber?, name?, notify?,
 * verifiedName? }. `name` is the address-book name (app-state contact sync, history chats), `verifiedName` the
 * business name, `notify` the profile name. Each kind only replaces the same kind. Returns the number of changes.
 */
export function syncWhatsAppContacts(list = []) {
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const c of list) {
      const id = bareJid(c?.id);
      const lid = [id, bareJid(c?.lid)].find(isLid) || '';
      const phone = pnDigits(id) || pnDigits(bareJid(c?.phoneNumber)) || (lid ? lidPhone(lid) : '');
      if (lid && phone) mapLid(lid, phone);
      const names = { book: clean(c?.name), biz: clean(c?.verifiedName), push: clean(c?.notify) };
      for (const [k, v] of Object.entries(names)) {
        if (!v || /^\+?\d[\d\s]{5,}$/.test(v)) continue; // a "name" that is only a number adds nothing
        if (phone.length >= 6) n += Number(upPhone[k].run(TENANT, phone, v, Date.now()).changes);
        else if (lid) n += Number(upLid[k].run(TENANT, lid, v, Date.now()).changes);
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return n;
}
/** LIDs with names but no phone yet (the channel asks Baileys for their mapping). */
export const unmappedLids = (limit = 500) => db.prepare("SELECT lid FROM contact_lids WHERE tenant_id = ? AND phone = '' LIMIT ?").all(TENANT, limit).map((r) => r.lid);

/**
 * The one resolver for showing a person (057). Give what you know: phone digits, the WhatsApp jid (PN or LID) and a
 * fallback name (e.g. the profile name seen with a message). Returns { phone, name, label, source, hidden }:
 * name '' when nothing is known; label is what to show (name, else +number, else "Unknown (hidden number)").
 * source: own | book | business | profile | seen | ''. What agents see: agentName() (#113).
 */
export function personInfo({ phone = '', jid = '', fallbackName = '' } = {}) {
  const j = bareJid(jid);
  const p = digits(phone) || pnDigits(j) || lidPhone(j);
  const r = p ? getRow.get(TENANT, p) : null;
  const l = isLid(j) ? getLid.get(TENANT, j) : null;
  const fb = clean(fallbackName);
  const seen = fb && digits(fb) !== fb.replace(/[\s+]/g, '') ? fb : ''; // a fallback that is only the number is no name
  const pick = [['own', r?.name], ['book', r?.book_name || l?.book_name], ['business', r?.biz_name || l?.biz_name], ['profile', r?.push_name || l?.push_name], ['seen', seen]]
    .find(([, v]) => v);
  const name = pick?.[1] || '';
  return { phone: p, name, label: name || (p ? `+${p}` : HIDDEN_NUMBER), source: pick?.[0] || '', hidden: !p };
}
/**
 * The name an agent sees for a person (#113). By default the same choice as the panel (own > phone contact > business >
 * profile), because profile names are often incomplete; the owner can switch phone-contact names off for agents
 * (Contacts page), then agents get own > business > profile. Never a number or a hidden id: '' when nothing is known.
 */
export const contactNamesForAgents = () => getSetting('contactNamesForAgents', true) !== false;
export function setContactNamesForAgents(on) { updateSettings({ contactNamesForAgents: !!on }); return contactNamesForAgents(); }
export function agentName({ phone = '', jid = '', fallbackName = '' } = {}) {
  const info = personInfo({ phone, jid, fallbackName });
  if (info.source !== 'book' || contactNamesForAgents()) return info.name || clean(fallbackName);
  const j = bareJid(jid);
  const r = info.phone ? getRow.get(TENANT, info.phone) : null;
  const l = isLid(j) ? getLid.get(TENANT, j) : null;
  return r?.biz_name || l?.biz_name || r?.push_name || l?.push_name || clean(fallbackName);
}
/** Label for a chat seen by the app (1:1: the person; groups: their subject). `c`: { id, phone, name, isGroup }. */
export function chatTitle(c) {
  if (!c) return '';
  if (c.isGroup) return c.name || c.id;
  const jid = String(c.id || '').split('#').pop();
  return personInfo({ phone: c.phone, jid, fallbackName: c.name }).label;
}

/** Counts for the Contacts page: how many names of each kind, and people WhatsApp shows only by a hidden number. */
export function contactSummary() {
  const r = db.prepare(`SELECT COUNT(*) total, SUM(own) own, SUM(book_name <> '') book, SUM(biz_name <> '') business, SUM(push_name <> '') profile
    FROM contacts WHERE tenant_id = ?`).get(TENANT);
  const hidden = db.prepare("SELECT COUNT(*) n FROM contact_lids WHERE tenant_id = ? AND phone = ''").get(TENANT).n;
  return { total: r.total || 0, own: r.own || 0, book: r.book || 0, business: r.business || 0, profile: r.profile || 0, hiddenNumbers: hidden || 0 };
}

/** Contacts by name; `limit` + `offset` page through them (069: the panel loads 100 at a time). */
export function listContacts({ q = '', sharedOnly = false, limit = 500, offset = 0 } = {}) {
  const like = `%${String(q).trim().toLowerCase()}%`;
  const d = digits(q);
  return db.prepare(`SELECT * FROM contacts WHERE tenant_id = ? ${sharedOnly ? 'AND shared = 1' : ''}
      AND (lower(name) LIKE ? OR lower(book_name) LIKE ? OR lower(biz_name) LIKE ? OR lower(push_name) LIKE ? OR lower(note) LIKE ? ${d.length >= 3 ? 'OR phone LIKE ?' : ''})
      ORDER BY lower(COALESCE(NULLIF(name, ''), NULLIF(book_name, ''), NULLIF(biz_name, ''), NULLIF(push_name, ''), phone)) LIMIT ? OFFSET ?`)
    .all(...[TENANT, like, like, like, like, like, ...(d.length >= 3 ? [`%${d}%`] : []), Math.min(Number(limit) || 500, 2000), Math.max(0, Number(offset) || 0)]).map(view);
}

export function getContact(phone) {
  const r = getRow.get(TENANT, digits(phone));
  return r ? view(r) : null;
}

/** Create or change an own contact. Only the given fields change. */
export function saveContact({ phone, name, note, shared }, by = 'panel') {
  const p = normPhone(phone);
  const cur = getRow.get(TENANT, p);
  const next = {
    name: name !== undefined ? String(name).trim().slice(0, 100) : cur?.name || '',
    note: note !== undefined ? String(note).trim().slice(0, 300) : cur?.note || '',
    shared: shared !== undefined ? (shared ? 1 : 0) : cur?.shared || 0,
  };
  if (!next.name && !(cur && synced(cur))) throw fail('A name is required');
  db.prepare(`INSERT INTO contacts (tenant_id, phone, name, note, shared, own, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT (tenant_id, phone) DO UPDATE SET name = excluded.name, note = excluded.note, shared = excluded.shared, own = 1, updated_at = excluded.updated_at`)
    .run(TENANT, p, next.name, next.note, next.shared, Date.now());
  activity('config', { summary: `Contact ${cur ? 'updated' : 'added'}: ${next.name || (cur && synced(cur))} (+${p})${next.shared ? ', shared' : ''} — ${by}` });
  return getContact(p);
}

/** Remove an own contact. A contact synced from WhatsApp keeps its WhatsApp name but loses own fields and sharing. */
export function removeContact(phone, by = 'panel') {
  const p = digits(phone);
  const cur = getRow.get(TENANT, p);
  if (!cur) return false;
  if (synced(cur)) db.prepare("UPDATE contacts SET name = '', note = '', shared = 0, own = 0, updated_at = ? WHERE tenant_id = ? AND phone = ?").run(Date.now(), TENANT, p);
  else db.prepare('DELETE FROM contacts WHERE tenant_id = ? AND phone = ?').run(TENANT, p);
  activity('config', { summary: `Contact removed: ${cur.name || synced(cur)} (+${p}) — ${by}` });
  return true;
}


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
    async run(input, ctx) { return out(saveContact(input, `${ctx.senderName} via ${ctx.agent.id}`), true); },
  },
  {
    name: 'remove_contact',
    description: 'Remove a contact from the own list by phone number (organizers only).',
    input_schema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    roles: ['organizer'],
    async run({ phone }, ctx) { return { removed: removeContact(phone, `${ctx.senderName} via ${ctx.agent.id}`) }; },
  },
];
