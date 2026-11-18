// @ts-check
// People (075, 078: the PRM core — personal relationship manager; "People" in the panel). One channel-neutral person
// per human, with their identities — (channel, external id, phone when the channel knows it, the name it showed).
// The same phone number joins identities automatically: on WhatsApp the phone jid and the LID of one person, and a
// Telegram account whose phone was shared with request_contact (the Telegram adapter only passes a phone after checking
// contact.user_id === from.id, so nobody can claim another person's number). Without a phone, an identity is its own
// person until a phone arrives; then the two people merge. Identities are noted only for chats that are on (router).
//
// 078 adds what the owner knows about a person: a display name, nickname, birthday, notes and a timeline, ties to other
// people (with a named inverse: "parent of" reads "child of" from the other side), households (adults and kids; a kid
// may have no identity and is then reached only through a household adult), free tags and named lists. People are
// created only from chats that are on or by the owner; phone address-book names (contacts.js) never create anyone.
// Merge, undo, export, erase and the one-time move of saved contacts live in people-ops.js.
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { digits, fail } from './config.js';
import { loggingSettings } from './events.js';
import { TENANT } from './store.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '', birthday TEXT NOT NULL DEFAULT '', shared INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS people_phone ON people (tenant_id, phone) WHERE phone <> '';
  CREATE TABLE IF NOT EXISTS identities (
    tenant_id TEXT NOT NULL, channel TEXT NOT NULL, external_id TEXT NOT NULL, person TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', PRIMARY KEY (tenant_id, channel, external_id)
  );
  CREATE INDEX IF NOT EXISTS identities_person ON identities (tenant_id, person);
`);
// 078, one release only (remove in the next): databases from before 2.39 get the new columns.
for (const [table, cols] of [['people', ['name', 'nickname', 'birthday', 'shared']], ['identities', ['name']]]) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const c of cols) if (!have.has(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${c === 'shared' ? 'INTEGER NOT NULL DEFAULT 0' : "TEXT NOT NULL DEFAULT ''"}`);
}
db.exec(`
  CREATE INDEX IF NOT EXISTS identities_phone ON identities (tenant_id, phone) WHERE phone <> '';
  CREATE TABLE IF NOT EXISTS person_ties (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    inverse TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS person_ties_a ON person_ties (tenant_id, a);
  CREATE INDEX IF NOT EXISTS person_ties_b ON person_ties (tenant_id, b);
  CREATE TABLE IF NOT EXISTS households (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS household_members (
    tenant_id TEXT NOT NULL, household TEXT NOT NULL, person TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'adult',
    PRIMARY KEY (tenant_id, household, person)
  );
  CREATE INDEX IF NOT EXISTS household_members_person ON household_members (tenant_id, person);
  CREATE TABLE IF NOT EXISTS person_notes (
    tenant_id TEXT NOT NULL, id INTEGER PRIMARY KEY, person TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note', by TEXT NOT NULL DEFAULT 'owner',
    author TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS person_notes_person ON person_notes (tenant_id, person, at);
  CREATE TABLE IF NOT EXISTS person_tags (tenant_id TEXT NOT NULL, person TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (tenant_id, person, tag));
  CREATE INDEX IF NOT EXISTS person_tags_tag ON person_tags (tenant_id, tag);
  CREATE TABLE IF NOT EXISTS person_lists (tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id));
  CREATE TABLE IF NOT EXISTS person_list_members (tenant_id TEXT NOT NULL, list TEXT NOT NULL, person TEXT NOT NULL, PRIMARY KEY (tenant_id, list, person));
  CREATE INDEX IF NOT EXISTS person_list_members_person ON person_list_members (tenant_id, person);
`);

const q = {
  identity: db.prepare('SELECT person, phone FROM identities WHERE tenant_id = ? AND channel = ? AND external_id = ?'),
  byPhone: db.prepare("SELECT id FROM people WHERE tenant_id = ? AND phone = ? AND phone <> ''"),
  byIdentityPhone: db.prepare("SELECT person AS id FROM identities WHERE tenant_id = ? AND phone = ? AND phone <> '' ORDER BY last_seen DESC LIMIT 1"),
  person: db.prepare('SELECT * FROM people WHERE tenant_id = ? AND id = ?'),
  addPerson: db.prepare('INSERT INTO people (tenant_id, id, phone, created_at) VALUES (?, ?, ?, ?)'),
  setPhone: db.prepare("UPDATE people SET phone = ? WHERE tenant_id = ? AND id = ? AND phone = ''"),
  addIdentity: db.prepare('INSERT INTO identities (tenant_id, channel, external_id, person, phone, first_seen, last_seen, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  touch: db.prepare("UPDATE identities SET phone = ?, last_seen = ?, name = CASE WHEN ? <> '' THEN ? ELSE name END WHERE tenant_id = ? AND channel = ? AND external_id = ?"),
  move: db.prepare('UPDATE identities SET person = ? WHERE tenant_id = ? AND person = ?'),
  dropPerson: db.prepare('DELETE FROM people WHERE tenant_id = ? AND id = ?'),
  phoneOf: db.prepare('SELECT phone FROM identities WHERE tenant_id = ? AND channel = ? AND external_id = ?'),
  byChannelPhone: db.prepare("SELECT external_id AS id FROM identities WHERE tenant_id = ? AND channel = ? AND phone = ? AND phone <> '' ORDER BY last_seen DESC LIMIT 1"),
  list: db.prepare('SELECT channel, external_id AS externalId, phone, name, first_seen AS firstSeen, last_seen AS lastSeen FROM identities WHERE tenant_id = ? AND person = ? ORDER BY first_seen'),
};
const CACHE_MAX = 2000;
const TOUCH_MS = 3600000; // last_seen (and the name the channel showed) is written at most hourly per identity
const cache = new Map(); // "channel|external id" → { person, phone, at }
const rid = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;
/** Forget cached identity → person links (after a merge, undo or erase moved identities). */
export const forgetPeopleCache = () => cache.clear();
const clean = (v, n = 100) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * The person id of an identity, created or joined by phone as needed. `phone`: digits the channel vouches for ('' when
 * unknown); `name`: the name the channel showed (profile name). Returns '' without an external id.
 */
export function personFor({ channel, externalId, phone = '', name = '' }) {
  const ext = String(externalId || '').trim();
  if (!channel || !ext) return '';
  const p = digits(phone);
  const n = clean(name, 80);
  const key = `${channel}|${ext}`;
  const hit = cache.get(key);
  if (hit && (!p || hit.phone === p) && Date.now() - hit.at < TOUCH_MS) return hit.person;
  let person;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = q.identity.get(TENANT, channel, ext);
    const owner = p ? q.byPhone.get(TENANT, p)?.id || '' : '';
    if (row) {
      person = row.person;
      // a phone joins two people — unless this identity's person already has another number (a merge kept it)
      if (p && owner && owner !== person && !q.person.get(TENANT, person)?.phone) { q.move.run(owner, TENANT, person); q.dropPerson.run(TENANT, person); person = owner; }
      else if (p && !owner) q.setPhone.run(p, TENANT, person); // only when the person has no number yet
      q.touch.run(p || row.phone, Date.now(), n, n, TENANT, channel, ext);
    } else {
      person = owner || rid('p');
      if (!owner) q.addPerson.run(TENANT, person, p, Date.now());
      q.addIdentity.run(TENANT, channel, ext, person, p, Date.now(), Date.now(), n);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { person, phone: p, at: Date.now() });
  return person;
}

// ---------- names ----------
// One display name (the panel's choice, 057): own name > phone contact > business > profile (contacts table) > the
// name a channel showed > +number. Lazy statements: the contacts table belongs to contacts.js, which imports this file.
const lazy = new Map();
const st = (sql) => { let s = lazy.get(sql); if (!s) { s = db.prepare(sql); lazy.set(sql, s); } return s; };
const LABEL = `COALESCE(NULLIF(p.name, ''), NULLIF(c.book_name, ''), NULLIF(c.biz_name, ''), NULLIF(c.push_name, ''),
  (SELECT i.name FROM identities i WHERE i.tenant_id = p.tenant_id AND i.person = p.id AND i.name <> '' ORDER BY i.last_seen DESC LIMIT 1),
  CASE WHEN p.phone <> '' THEN '+' || p.phone END, 'Unknown')`;
const FROM = "FROM people p LEFT JOIN contacts c ON c.tenant_id = p.tenant_id AND c.phone = p.phone AND p.phone <> ''";
const ROW = `p.id, p.phone, p.name AS ownName, p.nickname, p.birthday, p.shared, p.created_at AS createdAt, ${LABEL} AS label,
  (SELECT group_concat(DISTINCT i.channel) FROM identities i INDEXED BY identities_person WHERE i.tenant_id = p.tenant_id AND i.person = p.id) AS apps,
  (SELECT MAX(i.last_seen) FROM identities i WHERE i.tenant_id = p.tenant_id AND i.person = p.id) AS lastContact`;
const view = (r) => r && ({
  id: r.id, name: r.label, ownName: r.ownName, nickname: r.nickname, phone: r.phone, birthday: r.birthday, shared: !!r.shared,
  apps: r.apps ? String(r.apps).split(',').sort() : [], lastContact: r.lastContact || null, createdAt: r.createdAt,
});
/** The own name the owner gave the person with this phone ('' when none): the contacts resolver's first choice. */
export const ownNameOf = (phone) => (digits(phone) ? st("SELECT name FROM people WHERE tenant_id = ? AND phone = ? AND phone <> ''").get(TENANT, digits(phone))?.name || '' : '');

/** A person's row as lists show it ({ id, name, nickname, phone, birthday, shared, apps, lastContact, createdAt }), or null. */
export const personRow = (id) => view(st(`SELECT ${ROW} ${FROM} WHERE p.tenant_id = ? AND p.id = ?`).get(TENANT, String(id || ''))) || null;
const nameOf = (id) => personRow(id)?.name || 'Someone';

/** A person with their identities, or null. */
export function personById(id) {
  const r = personRow(id);
  return r ? { ...r, identities: q.list.all(TENANT, r.id) } : null;
}
/** The person with this phone number (theirs, or one of their identities'), or null. */
export const personByPhone = (phone) => {
  const d = digits(phone);
  const id = d ? q.byPhone.get(TENANT, d)?.id || q.byIdentityPhone.get(TENANT, d)?.id : '';
  return id ? personById(id) : null;
};
/** A person by id ("p_…") or by phone number. */
export const personByRef = (ref) => (/^p_[a-f0-9]+$/.test(String(ref)) ? personById(ref) : personByPhone(ref));

/**
 * 077: the phone an identity is linked to ('' when none). Channels without phone numbers (Telegram) pass it with every
 * message of that sender: only a phone the channel verified (its own contact, shared by that person) is ever stored.
 */
export function phoneOfIdentity(channel, externalId) {
  const hit = cache.get(`${channel}|${externalId}`);
  if (hit?.phone) return hit.phone;
  try { return q.phoneOf.get(TENANT, String(channel), String(externalId || ''))?.phone || ''; } catch { return ''; }
}
/** 077: the id of a person on a channel, found by their phone ('' when they never linked it there). */
export const identityByPhone = (channel, phone) => (digits(phone) ? q.byChannelPhone.get(TENANT, String(channel), digits(phone))?.id || '' : '');

/** The person who wrote a message (router, for chats that are on). Never throws; '' when unknown. */
export function notePerson(msg) {
  try { return msg.fromMe ? '' : personFor({ channel: msg.channel, externalId: msg.senderJid, phone: msg.phone, name: msg.senderName }); } catch { return ''; }
}

// ---------- the owner's fields ----------
const normBirthday = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (!/^(\d{4}|-)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) throw fail('Birthday must look like 2015-04-23, or --04-23 without the year', 400, { field: 'birthday' });
  return s;
};
const normPhone = (v) => {
  const d = digits(v);
  if (d && (d.length < 6 || d.length > 15)) throw fail(`"${v}" is not a phone number with country code`, 400, { field: 'phone' });
  return d;
};
const exists = (id) => { if (!q.person.get(TENANT, String(id || ''))) throw fail('No such person', 404); return String(id); };

/** Add a person by hand (the owner; also a kid without any phone). A phone already in People gives that person back (409). */
export function createPerson({ name, nickname = '', birthday = '', phone = '', shared = false }, by = 'panel') {
  const n = clean(name);
  const p = normPhone(phone);
  if (!n && !p) throw fail('A name is required', 400, { field: 'name' }); // with a number, the name may come from their apps
  if (p && personByPhone(p)) throw fail('This number is already in People', 409, { field: 'phone', person: personByPhone(p)?.id });
  const id = rid('p');
  db.prepare('INSERT INTO people (tenant_id, id, phone, created_at, name, nickname, birthday, shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, id, p, Date.now(), n, clean(nickname, 60), normBirthday(birthday), shared ? 1 : 0);
  addEvent(id, `Added to People by ${by}`);
  return personRow(id);
}

/**
 * Change a person's own fields; only the given ones change. `name: ''` goes back to the name from their apps.
 * @param {string} id  @param {{ name?: string, nickname?: string, birthday?: string, phone?: string, shared?: boolean }} change
 */
export function updatePerson(id, { name, nickname, birthday, phone, shared }) {
  const cur = q.person.get(TENANT, exists(id));
  const next = {
    name: name !== undefined ? clean(name) : cur.name, nickname: nickname !== undefined ? clean(nickname, 60) : cur.nickname,
    birthday: birthday !== undefined ? normBirthday(birthday) : cur.birthday, shared: shared !== undefined ? (shared ? 1 : 0) : cur.shared,
    phone: phone !== undefined ? normPhone(phone) : cur.phone,
  };
  if (next.phone !== cur.phone) {
    const other = next.phone ? personByPhone(next.phone) : null;
    if (other && other.id !== cur.id) throw fail('This number belongs to someone else in People: merge them instead', 409, { field: 'phone', person: other.id });
    if (!next.phone && q.list.all(TENANT, cur.id).some((i) => i.phone === cur.phone)) throw fail('This number comes from their app and stays', 400, { field: 'phone' });
  }
  db.prepare('UPDATE people SET name = ?, nickname = ?, birthday = ?, shared = ?, phone = ? WHERE tenant_id = ? AND id = ?')
    .run(next.name, next.nickname, next.birthday, next.shared, next.phone, TENANT, cur.id);
  return personRow(cur.id);
}

// ---------- list and search ----------
/**
 * People by name. q matches names (own, phone contact, business, profile, app), nickname, number, tags and notes;
 * filters: tag, list, household, app (a channel id, or 'none' for people without any app). `limit` + `offset` page.
 */
export function listPeople({ q: text = '', tag = '', list = '', household = '', app = '', limit = 100, offset = 0, shared = false } = {}) {
  const where = ['p.tenant_id = ?']; const args = [TENANT];
  const s = String(text).trim().toLowerCase();
  if (s) {
    const like = `%${s}%`; const d = digits(s);
    where.push(`(lower(${LABEL}) LIKE ? OR lower(p.name) LIKE ? OR lower(p.nickname) LIKE ? OR lower(COALESCE(c.book_name, '')) LIKE ? OR lower(COALESCE(c.push_name, '')) LIKE ?
      OR EXISTS (SELECT 1 FROM person_tags t WHERE t.tenant_id = p.tenant_id AND t.person = p.id AND t.tag LIKE ?)
      OR EXISTS (SELECT 1 FROM person_notes n WHERE n.tenant_id = p.tenant_id AND n.person = p.id AND n.kind = 'note' AND lower(n.text) LIKE ?)${d.length >= 3 ? ' OR p.phone LIKE ?' : ''})`);
    args.push(like, like, like, like, like, like, like, ...(d.length >= 3 ? [`%${d}%`] : []));
  }
  // #174: a filter picks its people through its own index (the members of a tag, list or household; an app's identities)
  if (tag) { where.push('p.id IN (SELECT t.person FROM person_tags t WHERE t.tenant_id = ? AND t.tag = ?)'); args.push(TENANT, normTag(tag)); }
  if (list) { where.push('p.id IN (SELECT l.person FROM person_list_members l WHERE l.tenant_id = ? AND l.list = ?)'); args.push(TENANT, String(list)); }
  if (household) { where.push('p.id IN (SELECT m.person FROM household_members m WHERE m.tenant_id = ? AND m.household = ?)'); args.push(TENANT, String(household)); }
  if (app === 'none') where.push('NOT EXISTS (SELECT 1 FROM identities i WHERE i.tenant_id = p.tenant_id AND i.person = p.id)');
  else if (app) { where.push('p.id IN (SELECT i.person FROM identities i WHERE i.tenant_id = ? AND i.channel = ?)'); args.push(TENANT, String(app)); }
  if (shared) where.push('p.shared = 1');
  // Without such a filter every person's display name is needed to sort (and to search) by it: the one full read of
  // `people`, marked for scripts/check-perf.mjs and kept within its time budget.
  const all = !(tag || list || household || (app && app !== 'none')) ? '/* people: every name sorts */ ' : '';
  // the page is chosen by name first; apps and last contact are looked up for that page only
  const sql = `SELECT ${ROW} ${FROM} WHERE p.tenant_id = ? AND p.id IN (SELECT ${all}p.id ${FROM} WHERE ${where.join(' AND ')} ORDER BY lower(${LABEL}) LIMIT ? OFFSET ?) ORDER BY lower(label)`;
  return db.prepare(sql).all(TENANT, ...args, Math.min(Number(limit) || 100, 500), Math.max(0, Number(offset) || 0)).map(view);
}
/** How many people, households and lists there are, and the tags in use (with counts) for the filters. */
export function peopleCounts() {
  const n = (sql) => db.prepare(sql).get(TENANT).n;
  return {
    people: n('SELECT COUNT(*) n FROM people WHERE tenant_id = ?'), households: n('SELECT COUNT(*) n FROM households WHERE tenant_id = ?'),
    lists: n('SELECT COUNT(*) n FROM person_lists WHERE tenant_id = ?'),
    tags: db.prepare('SELECT tag, COUNT(*) AS count FROM person_tags WHERE tenant_id = ? GROUP BY tag ORDER BY count DESC, tag LIMIT 100').all(TENANT),
  };
}

// ---------- notes and timeline ----------
/**
 * A note (kind 'note', by owner | agent) or a timeline event (kind 'event', written by the app and later modules).
 * Agent notes never hold message text unless the logging policy keeps message contents (verbose): a note that
 * contains one of the person's stored messages is refused.
 */
export function addNote(person, { text, by = 'owner', author = '' }) {
  const id = exists(person);
  const t = String(text ?? '').trim().slice(0, 1000);
  if (!t) throw fail('Write a note first', 400, { field: 'text' });
  if (!['owner', 'agent'].includes(by)) throw fail('by must be owner or agent', 400, { field: 'by' });
  if (by === 'agent' && loggingSettings().level !== 'verbose' && quotesMessage(id, t)) throw fail('Agent notes may not contain message text (logging policy)', 400, { field: 'text' });
  const r = db.prepare("INSERT INTO person_notes (tenant_id, person, kind, by, author, text, at) VALUES (?, ?, 'note', ?, ?, ?, ?)").run(TENANT, id, by, clean(author, 60), t, Date.now());
  return { id: Number(r.lastInsertRowid), kind: 'note', by, author: clean(author, 60), text: t, at: Date.now() };
}
function quotesMessage(person, text) {
  const p = q.person.get(TENANT, person);
  const ids = q.list.all(TENANT, person).map((i) => i.externalId);
  const who = [p?.phone, ...ids].filter(Boolean);
  if (!who.length) return false;
  return !!db.prepare(`SELECT 1 FROM messages WHERE (sender IN (${who.map(() => '?').join(',')}) OR sender_jid IN (${who.map(() => '?').join(',')}))
    AND length(text) >= 20 AND instr(lower(?), lower(text)) > 0 LIMIT 1`).get(...who, ...who, text);
}
/** A timeline event (no message text; counts and plain facts). */
export function addEvent(person, text) {
  db.prepare("INSERT INTO person_notes (tenant_id, person, kind, by, author, text, at) VALUES (?, ?, 'event', 'app', '', ?, ?)").run(TENANT, person, clean(text, 300), Date.now());
}
export function removeNote(person, noteId) {
  return db.prepare("DELETE FROM person_notes WHERE tenant_id = ? AND person = ? AND id = ? AND kind = 'note'").run(TENANT, String(person), Number(noteId)).changes > 0;
}
/** Notes and events, newest first. */
export const timeline = (person, limit = 100) => db.prepare('SELECT id, kind, by, author, text, at FROM person_notes WHERE tenant_id = ? AND person = ? ORDER BY at DESC, id DESC LIMIT ?')
  .all(TENANT, String(person), Math.min(Number(limit) || 100, 500));

// ---------- ties (relationships) ----------
/** Kinds with the word from A's side and from B's side. `custom` brings its own label and inverse. */
export const TIE_KINDS = Object.freeze({
  parent: ['Parent of', 'Child of'], partner: ['Partner of', 'Partner of'], sibling: ['Sibling of', 'Sibling of'], works_with: ['Works with', 'Works with'], custom: null,
});
export function addTie(a, b, { kind, label = '', inverse = '' }) {
  exists(a); exists(b);
  if (a === b) throw fail('A person cannot be tied to themselves', 400, { field: 'other' });
  if (!Object.hasOwn(TIE_KINDS, kind)) throw fail(`kind must be one of ${Object.keys(TIE_KINDS).join(', ')}`, 400, { field: 'kind' });
  const l = kind === 'custom' ? clean(label, 40) : ''; const inv = kind === 'custom' ? clean(inverse, 40) || l : '';
  if (kind === 'custom' && !l) throw fail('A custom tie needs a label, e.g. "Godparent of"', 400, { field: 'label' });
  const dup = db.prepare('SELECT id FROM person_ties WHERE tenant_id = ? AND ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND kind = ? AND label = ?').get(TENANT, a, b, b, a, kind, l);
  if (dup && (TIE_KINDS[kind]?.[0] === TIE_KINDS[kind]?.[1] || db.prepare('SELECT 1 FROM person_ties WHERE tenant_id = ? AND id = ? AND a = ?').get(TENANT, dup.id, a))) return dup.id;
  const id = rid('t');
  db.prepare('INSERT INTO person_ties (tenant_id, id, a, b, kind, label, inverse, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(TENANT, id, a, b, kind, l, inv, Date.now());
  return id;
}
export const removeTie = (id) => db.prepare('DELETE FROM person_ties WHERE tenant_id = ? AND id = ?').run(TENANT, String(id)).changes > 0;
/** A person's ties as read from their side: [{ id, kind, label: "Child of", other: { id, name } }]. */
export function tiesOf(person) {
  return db.prepare('SELECT * FROM person_ties WHERE tenant_id = ? AND (a = ? OR b = ?) ORDER BY created_at').all(TENANT, person, person).map((t) => {
    const mine = t.a === person;
    const label = t.kind === 'custom' ? (mine ? t.label : t.inverse) : TIE_KINDS[t.kind]?.[mine ? 0 : 1] || t.kind;
    const other = mine ? t.b : t.a;
    return { id: t.id, kind: t.kind, label, other: { id: other, name: nameOf(other) } };
  });
}

// ---------- households ----------
export const HOUSEHOLD_ROLES = ['adult', 'kid'];
const hh = (id) => { const r = db.prepare('SELECT * FROM households WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || '')); if (!r) throw fail('No such household', 404); return r; };
const membersOf = (household) => db.prepare('SELECT person, role FROM household_members WHERE tenant_id = ? AND household = ?').all(TENANT, household)
  .map((m) => ({ ...m, name: nameOf(m.person), reachable: q.list.all(TENANT, m.person).length > 0 }))
  .sort((x, y) => (x.role === y.role ? x.name.localeCompare(y.name) : x.role === 'adult' ? -1 : 1));
export function listHouseholds() {
  return db.prepare(`SELECT h.id, h.name, h.address, SUM(m.role = 'adult') AS adults, SUM(m.role = 'kid') AS kids FROM households h
    LEFT JOIN household_members m ON m.tenant_id = h.tenant_id AND m.household = h.id WHERE h.tenant_id = ? GROUP BY h.id ORDER BY lower(h.name)`).all(TENANT)
    .map((r) => ({ id: r.id, name: r.name, address: r.address, adults: r.adults || 0, kids: r.kids || 0 }));
}
export function getHousehold(id) { const r = hh(id); return { id: r.id, name: r.name, address: r.address, createdAt: r.created_at, members: membersOf(r.id) }; }
export function saveHousehold({ id = '', name, address }) {
  const cur = id ? hh(id) : null;
  const n = name !== undefined ? clean(name, 80) : cur?.name;
  if (!n) throw fail('A household needs a name, e.g. "Chary family"', 400, { field: 'name' });
  const a = address !== undefined ? clean(address, 200) : cur?.address || '';
  if (cur) db.prepare('UPDATE households SET name = ?, address = ? WHERE tenant_id = ? AND id = ?').run(n, a, TENANT, cur.id);
  else { id = rid('h'); db.prepare('INSERT INTO households (tenant_id, id, name, address, created_at) VALUES (?, ?, ?, ?, ?)').run(TENANT, id, n, a, Date.now()); }
  return getHousehold(id);
}
export function deleteHousehold(id) {
  const r = hh(id);
  db.prepare('DELETE FROM household_members WHERE tenant_id = ? AND household = ?').run(TENANT, r.id);
  db.prepare('DELETE FROM households WHERE tenant_id = ? AND id = ?').run(TENANT, r.id);
  return true;
}
export function setHouseholdMember(household, person, role = 'adult') {
  const r = hh(household); exists(person);
  if (!HOUSEHOLD_ROLES.includes(role)) throw fail('role must be adult or kid', 400, { field: 'role' });
  const was = db.prepare('SELECT role FROM household_members WHERE tenant_id = ? AND household = ? AND person = ?').get(TENANT, r.id, person);
  db.prepare('INSERT INTO household_members (tenant_id, household, person, role) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role').run(TENANT, r.id, person, role);
  if (!was) addEvent(person, `Joined the household ${r.name} (${role})`);
  return getHousehold(r.id);
}
export function removeHouseholdMember(household, person) {
  const r = hh(household);
  db.prepare('DELETE FROM household_members WHERE tenant_id = ? AND household = ? AND person = ?').run(TENANT, r.id, String(person));
  return getHousehold(r.id);
}
export const householdsOf = (person) => db.prepare(`SELECT h.id, h.name, h.address, m.role FROM household_members m JOIN households h ON h.tenant_id = m.tenant_id AND h.id = m.household
  WHERE m.tenant_id = ? AND m.person = ? ORDER BY lower(h.name)`).all(TENANT, person);
/**
 * Who reaches a person: themselves when they have an app; else the adults of their households who have one (a kid
 * without a phone is reached only through them; nothing ever addresses a person without an identity).
 */
export function reachVia(person) {
  if (q.list.all(TENANT, person).length) return [];
  const seen = new Set();
  return householdsOf(person).flatMap((h) => membersOf(h.id).filter((m) => m.role === 'adult' && m.reachable && m.person !== person && !seen.has(m.person) && seen.add(m.person))
    .map((m) => ({ id: m.person, name: m.name, household: h.name })));
}

// ---------- tags and lists ----------
const normTag = (t) => String(t ?? '').toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
export const tagsOf = (person) => db.prepare('SELECT tag FROM person_tags WHERE tenant_id = ? AND person = ? ORDER BY tag').all(TENANT, person).map((r) => r.tag);
/** Replace a person's tags (free words, lower-case, at most 20). */
export function setTags(person, tags) {
  exists(person);
  const next = [...new Set((Array.isArray(tags) ? tags : []).map(normTag).filter(Boolean))].slice(0, 20);
  db.prepare('DELETE FROM person_tags WHERE tenant_id = ? AND person = ?').run(TENANT, person);
  const add = db.prepare('INSERT INTO person_tags (tenant_id, person, tag) VALUES (?, ?, ?)');
  for (const t of next) add.run(TENANT, person, t);
  return next;
}
const lst = (id) => { const r = db.prepare('SELECT * FROM person_lists WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || '')); if (!r) throw fail('No such list', 404); return r; };
export const listLists = () => db.prepare(`SELECT l.id, l.name, COUNT(m.person) AS size FROM person_lists l LEFT JOIN person_list_members m ON m.tenant_id = l.tenant_id AND m.list = l.id
  WHERE l.tenant_id = ? GROUP BY l.id ORDER BY lower(l.name)`).all(TENANT);
export function getList(id) {
  const r = lst(id);
  const members = db.prepare('SELECT person FROM person_list_members WHERE tenant_id = ? AND list = ?').all(TENANT, r.id).map((m) => personRow(m.person)).filter(Boolean)
    .sort((x, y) => x.name.localeCompare(y.name));
  return { id: r.id, name: r.name, createdAt: r.created_at, members };
}
export function saveList({ id = '', name }) {
  const n = clean(name, 80);
  if (!n) throw fail('A list needs a name, e.g. "Badminton Tuesdays"', 400, { field: 'name' });
  if (id) { lst(id); db.prepare('UPDATE person_lists SET name = ? WHERE tenant_id = ? AND id = ?').run(n, TENANT, id); }
  else { id = rid('l'); db.prepare('INSERT INTO person_lists (tenant_id, id, name, created_at) VALUES (?, ?, ?, ?)').run(TENANT, id, n, Date.now()); }
  return getList(id);
}
export function deleteList(id) {
  const r = lst(id);
  db.prepare('DELETE FROM person_list_members WHERE tenant_id = ? AND list = ?').run(TENANT, r.id);
  db.prepare('DELETE FROM person_lists WHERE tenant_id = ? AND id = ?').run(TENANT, r.id);
  return true;
}
export function setListMember(list, person, on = true) {
  const r = lst(list); exists(person);
  if (on) db.prepare('INSERT OR IGNORE INTO person_list_members (tenant_id, list, person) VALUES (?, ?, ?)').run(TENANT, r.id, person);
  else db.prepare('DELETE FROM person_list_members WHERE tenant_id = ? AND list = ? AND person = ?').run(TENANT, r.id, person);
  return getList(r.id);
}
export const listsOf = (person) => db.prepare(`SELECT l.id, l.name FROM person_list_members m JOIN person_lists l ON l.tenant_id = m.tenant_id AND l.id = m.list
  WHERE m.tenant_id = ? AND m.person = ? ORDER BY lower(l.name)`).all(TENANT, person);

// ---------- agent tools (exposed as contacts__<name>; step 2 of People replaces them with people tools) ----------
export const CONTACTS_DEFAULT_ALLOW = { organizer: ['contacts:*'], participant: ['contacts:find_contact'] };
const out = (c, full) => ({ name: c.name, phone: c.phone ? `+${c.phone}` : '', ...(c.note ? { note: c.note } : {}), ...(full ? { shared: c.shared } : {}) });
const withNote = (c) => ({ ...c, note: db.prepare("SELECT text FROM person_notes WHERE tenant_id = ? AND person = ? AND kind = 'note' ORDER BY at DESC LIMIT 1").get(TENANT, c.id)?.text || '' });
const byNumber = (phone) => { const d = normPhone(phone); if (!d) throw fail('A phone number with country code is needed'); return d; };

export const contactsTools = [
  {
    name: 'find_contact',
    description: 'Look up a person\'s phone number (and latest note) in People by name, part of a name or number. Participants only see people the owner shared.',
    input_schema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['query'] },
    roles: ['organizer', 'participant'],
    async run({ query }, ctx) {
      if (String(query || '').trim().length < 2) throw new Error('query too short');
      const org = ctx.role === 'organizer';
      const found = listPeople({ q: query, shared: !org, limit: 10 }).filter((c) => c.phone).map((c) => out(withNote(c), org));
      return found.length ? found : 'No matching person' + (org ? '' : ' that is shared with this chat');
    },
  },
  {
    name: 'save_contact',
    description: 'Add or change a person in People (organizers only): name, phone with country code, optional short note, and whether participants may look them up (shared).',
    input_schema: {
      type: 'object',
      properties: { phone: { type: 'string' }, name: { type: 'string', maxLength: 100 }, note: { type: 'string', maxLength: 300 }, shared: { type: 'boolean' } },
      required: ['phone'],
    },
    roles: ['organizer'],
    async run({ phone, name, note, shared }, ctx) {
      const d = byNumber(phone);
      const by = `${ctx.senderName} via ${ctx.agent.id}`;
      const cur = personByPhone(d);
      const p = cur ? updatePerson(cur.id, { name, shared }) : createPerson({ name, phone: d, shared: !!shared }, by);
      if (note) addNote(p.id, { text: note, by: 'agent', author: by });
      return out(withNote(personRow(p.id)), true);
    },
  },
  {
    name: 'remove_contact',
    description: 'Clear the saved name of a person and stop sharing them (organizers only). The person stays in People.',
    input_schema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    roles: ['organizer'],
    async run({ phone }) {
      const cur = personByPhone(byNumber(phone));
      if (cur) updatePerson(cur.id, { name: '', shared: false });
      return { removed: !!cur };
    },
  },
];
