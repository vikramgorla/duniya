// @ts-check
// People across channels (075): one channel-neutral person id per human, with their identities — (channel, external
// id, phone when the channel knows it). The same phone number joins identities automatically: on WhatsApp the phone
// jid and the LID of one person, and later a Telegram account whose phone was shared with request_contact (the
// Telegram adapter only passes a phone after checking contact.user_id === from.id, so nobody can claim another
// person's number). Without a phone, an identity is its own person until a phone arrives; then the two people merge.
// Only ids and phone digits are stored, never message text; identities are noted only for chats that are on.
// Roles, contacts and owner links stay keyed by phone in this phase (person.phone links them).
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { digits } from './config.js';
import { TENANT } from './store.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS people_phone ON people (tenant_id, phone) WHERE phone <> '';
  CREATE TABLE IF NOT EXISTS identities (
    tenant_id TEXT NOT NULL, channel TEXT NOT NULL, external_id TEXT NOT NULL, person TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (tenant_id, channel, external_id)
  );
  CREATE INDEX IF NOT EXISTS identities_person ON identities (tenant_id, person);
`);

const q = {
  identity: db.prepare('SELECT person, phone FROM identities WHERE tenant_id = ? AND channel = ? AND external_id = ?'),
  byPhone: db.prepare("SELECT id FROM people WHERE tenant_id = ? AND phone = ? AND phone <> ''"),
  person: db.prepare('SELECT id, phone FROM people WHERE tenant_id = ? AND id = ?'),
  addPerson: db.prepare('INSERT INTO people (tenant_id, id, phone, created_at) VALUES (?, ?, ?, ?)'),
  setPhone: db.prepare('UPDATE people SET phone = ? WHERE tenant_id = ? AND id = ?'),
  addIdentity: db.prepare('INSERT INTO identities (tenant_id, channel, external_id, person, phone, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  touch: db.prepare('UPDATE identities SET phone = ?, last_seen = ? WHERE tenant_id = ? AND channel = ? AND external_id = ?'),
  move: db.prepare('UPDATE identities SET person = ? WHERE tenant_id = ? AND person = ?'),
  dropPerson: db.prepare('DELETE FROM people WHERE tenant_id = ? AND id = ?'),
  phoneOf: db.prepare('SELECT phone FROM identities WHERE tenant_id = ? AND channel = ? AND external_id = ?'),
  byChannelPhone: db.prepare("SELECT external_id AS id FROM identities WHERE tenant_id = ? AND channel = ? AND phone = ? AND phone <> '' ORDER BY last_seen DESC LIMIT 1"),
  list: db.prepare('SELECT channel, external_id AS externalId, phone, first_seen AS firstSeen, last_seen AS lastSeen FROM identities WHERE tenant_id = ? AND person = ? ORDER BY first_seen'),
};
const CACHE_MAX = 2000;
const TOUCH_MS = 3600000; // last_seen is written at most hourly per identity
const cache = new Map(); // "channel|external id" → { person, phone, at }
const newId = () => `p_${randomBytes(6).toString('hex')}`;

/**
 * The person id of an identity, created or joined by phone as needed. `phone`: digits the channel vouches for ('' when
 * unknown). Returns '' without an external id.
 */
export function personFor({ channel, externalId, phone = '' }) {
  const ext = String(externalId || '').trim();
  if (!channel || !ext) return '';
  const p = digits(phone);
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
      if (p && owner && owner !== person) { q.move.run(owner, TENANT, person); q.dropPerson.run(TENANT, person); person = owner; } // a phone joins two people
      else if (p && !owner) q.setPhone.run(p, TENANT, person);
      q.touch.run(p || row.phone, Date.now(), TENANT, channel, ext);
    } else {
      person = owner || newId();
      if (!owner) q.addPerson.run(TENANT, person, p, Date.now());
      q.addIdentity.run(TENANT, channel, ext, person, p, Date.now(), Date.now());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { person, phone: p, at: Date.now() });
  return person;
}

/** A person with their identities: { id, phone, identities: [{ channel, externalId, phone, firstSeen, lastSeen }] }, or null. */
export function personById(id) {
  const r = q.person.get(TENANT, String(id || ''));
  return r ? { id: r.id, phone: r.phone, identities: q.list.all(TENANT, r.id) } : null;
}
/** The person with this phone number, or null. */
export const personByPhone = (phone) => { const id = q.byPhone.get(TENANT, digits(phone))?.id; return id ? personById(id) : null; };

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
  try { return msg.fromMe ? '' : personFor({ channel: msg.channel, externalId: msg.senderJid, phone: msg.phone }); } catch { return ''; }
}
