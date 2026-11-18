// @ts-check
// Phone contact names (issue #11, #110, 078): the names WhatsApp syncs from the linked phone(s). They are the name
// source for people; they never create a person (078: People — saved names, notes and Shared live in people.js).
//
// 057 (#110): WhatsApp gives three kinds of names and they are kept apart, so a later profile-name update never
// replaces the name from the owner's address book:
//   book_name — the owner's phone address book (app-state contact sync, history chats)
//   biz_name  — a WhatsApp Business verified name
//   push_name — the profile name the person chose (sent with every message)
// One resolver (personInfo) decides what the panel shows: own name (People) > address book > business > profile > number.
// People WhatsApp only identifies by a LID (hidden number) are kept in contact_lids until the LID↔phone mapping
// arrives; then their names move to the phone's row. A raw LID is never shown as if it were a number.
import { db } from './db.js';
import { digits } from './config.js';
import { bareJid, isLidJid, pnDigits } from '../channels/whatsapp/ids.js';
import { getSetting, updateSettings } from './store.js';
import { ownNameOf } from './people.js';

const TENANT = 'default';
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    tenant_id TEXT NOT NULL, phone TEXT NOT NULL, book_name TEXT NOT NULL DEFAULT '',
    biz_name TEXT NOT NULL DEFAULT '', push_name TEXT NOT NULL DEFAULT '', updated_at INTEGER,
    PRIMARY KEY (tenant_id, phone)
  );
  CREATE TABLE IF NOT EXISTS contact_lids (
    tenant_id TEXT NOT NULL, lid TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', book_name TEXT NOT NULL DEFAULT '',
    biz_name TEXT NOT NULL DEFAULT '', push_name TEXT NOT NULL DEFAULT '', updated_at INTEGER,
    PRIMARY KEY (tenant_id, lid)
  );
`);
const HIDDEN_NUMBER = 'Unknown (hidden number)';
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 100);

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
  if (!isLidJid(l) || p.length < 6 || p.length > 15) return false;
  const changed = setLidPhone.run(TENANT, l, p, Date.now()).changes > 0;
  const r = getLid.get(TENANT, l);
  let moved = 0;
  for (const [k, col] of Object.entries(NAME_COLS)) if (r?.[col]) moved += Number(upPhone[k].run(TENANT, p, r[col], Date.now()).changes);
  return changed || moved > 0;
}
/** Phone digits of a LID when the mapping is known, else ''. */
export const lidPhone = (lid) => (isLidJid(lid) ? getLid.get(TENANT, bareJid(lid))?.phone || '' : '');

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
      const lid = [id, bareJid(c?.lid)].find(isLidJid) || '';
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
  const own = p ? ownNameOf(p) : '';
  const l = isLidJid(j) ? getLid.get(TENANT, j) : null;
  const fb = clean(fallbackName);
  const seen = fb && digits(fb) !== fb.replace(/[\s+]/g, '') ? fb : ''; // a fallback that is only the number is no name
  const pick = [['own', own], ['book', r?.book_name || l?.book_name], ['business', r?.biz_name || l?.biz_name], ['profile', r?.push_name || l?.push_name], ['seen', seen]]
    .find(([, v]) => v);
  const name = pick?.[1] || '';
  return { phone: p, name, label: name || (p ? `+${p}` : HIDDEN_NUMBER), source: pick?.[0] || '', hidden: !p };
}
/**
 * The name an agent sees for a person (#113). By default the same choice as the panel (own > phone contact > business >
 * profile), because profile names are often incomplete; the owner can switch phone-contact names off for agents
 * (People), then agents get own > business > profile. Never a number or a hidden id: '' when nothing is known.
 */
export const contactNamesForAgents = () => getSetting('contactNamesForAgents', true) !== false;
export function setContactNamesForAgents(on) { updateSettings({ contactNamesForAgents: !!on }); return contactNamesForAgents(); }
export function agentName({ phone = '', jid = '', fallbackName = '' } = {}) {
  const info = personInfo({ phone, jid, fallbackName });
  if (info.source !== 'book' || contactNamesForAgents()) return info.name || clean(fallbackName);
  const j = bareJid(jid);
  const r = info.phone ? getRow.get(TENANT, info.phone) : null;
  const l = isLidJid(j) ? getLid.get(TENANT, j) : null;
  return r?.biz_name || l?.biz_name || r?.push_name || l?.push_name || clean(fallbackName);
}

/** Counts for People: how many names of each kind, and people WhatsApp shows only by a hidden number. */
export function contactSummary() {
  const r = db.prepare(`SELECT COUNT(*) total, SUM(book_name <> '') book, SUM(biz_name <> '') business, SUM(push_name <> '') profile
    FROM contacts WHERE tenant_id = ?`).get(TENANT);
  const hidden = db.prepare("SELECT COUNT(*) n FROM contact_lids WHERE tenant_id = ? AND phone = ''").get(TENANT).n;
  return { total: r.total || 0, book: r.book || 0, business: r.business || 0, profile: r.profile || 0, hiddenNumbers: hidden || 0 };
}
