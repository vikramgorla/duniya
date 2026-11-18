// @ts-check
// People and agents (079, People step 2). Who an agent may see, roles that are people and lists, the sender card,
// consent records, and how everyone becomes a person by themselves:
//   - the chats a person is in (person_chats): noted when they write in a chat that is on (router) and from the member
//     lists of groups that are on (the upkeep refresh: on switch-on, after member changes, every 12 h);
//   - the owner's phone contacts (address-book and profile names WhatsApp syncs): one person per number, bounded per
//     upkeep tick, never someone hidden or already there.
// Agent access is decided here, in code: an agent sees people from its own chats plus the lists the owner shares with
// it ("Own chats", the default), everyone ("Everyone in People"), or nobody ("Off"). A turn whose sender is the owner
// (verified identity, any channel) gets owner-level access. Hidden people are never shown to an agent.
import { randomBytes } from 'node:crypto';
import { db, kvGet, kvSet } from './db.js';
import { digits, clip, fail } from './config.js';
import { TENANT } from './store.js';
import { activity } from './events.js';
import { forgetPeopleCache, householdsOf, personByPhone, personFor, personRow, tagsOf } from './people.js';

const st = (() => { const m = new Map(); return (sql) => { let s = m.get(sql); if (!s) { s = db.prepare(sql); m.set(sql, s); } return s; }; })();

// ---------- the chats a person is in ----------
const TOUCH_MS = 3600000;
const touched = new Map(); // "person|chat" → last write (ms): one write per person, chat and hour
/**
 * A person wrote in a chat that is on (`via` 'wrote'), or is a member of a group that is on ('member'). The first time
 * also records that they saw the chat's privacy notice when it was posted there. Never throws.
 */
export function notePersonChat(person, chat, via = 'wrote', now = Date.now()) {
  if (!person || !chat) return;
  const key = `${person}|${chat}|${via}`;
  if (now - (touched.get(key) || 0) < TOUCH_MS) return;
  if (touched.size > 5000) touched.clear();
  touched.set(key, now);
  try {
    const had = st('SELECT 1 FROM person_chats WHERE tenant_id = ? AND person = ? AND chat = ?').get(TENANT, person, chat);
    st(`INSERT INTO person_chats (tenant_id, person, chat, wrote, member, last_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET wrote = MAX(wrote, excluded.wrote), member = MAX(member, excluded.member), last_at = MAX(last_at, excluded.last_at)`)
      .run(TENANT, person, chat, via === 'wrote' ? 1 : 0, via === 'member' ? 1 : 0, now);
    st("UPDATE people SET source = 'chat' WHERE tenant_id = ? AND id = ? AND source = 'phone'").run(TENANT, person);
    if (!had) {
      const posted = st('SELECT posted_at FROM privacy_notices WHERE tenant_id = ? AND chat = ?').get(TENANT, chat);
      if (posted) recordConsent(person, 'privacy_notice', 'yes', 'Group notice', posted.posted_at);
    }
  } catch { /* best effort: the next message or refresh notes it again */ }
}

/**
 * The member list of a group that is on (upkeep refresh): every member becomes a person (identities only, no message
 * content); people no longer in it lose the membership (the person stays). `members`: [{ jid, phone }].
 */
export function noteMembers(channel, chat, members = [], now = Date.now()) {
  const seen = new Set();
  for (const m of members) {
    const person = personFor({ channel, externalId: m.jid || (m.phone ? `${m.phone}@s.whatsapp.net` : ''), phone: m.phone || '' });
    if (!person) continue;
    seen.add(person);
    touched.delete(`${person}|${chat}|member`);
    notePersonChat(person, chat, 'member', now);
  }
  if (!members.length) return 0; // an empty answer is no proof that everyone left
  const gone = st('SELECT person, wrote FROM person_chats WHERE tenant_id = ? AND chat = ? AND member = 1').all(TENANT, chat).filter((r) => !seen.has(r.person));
  for (const r of gone) {
    if (r.wrote) st('UPDATE person_chats SET member = 0 WHERE tenant_id = ? AND person = ? AND chat = ?').run(TENANT, r.person, chat);
    else st('DELETE FROM person_chats WHERE tenant_id = ? AND person = ? AND chat = ?').run(TENANT, r.person, chat);
  }
  return seen.size;
}
/** The chats a person is in, newest first: [{ chat, wrote, member, lastAt }]. */
export const chatsOfPerson = (person) => st('SELECT chat, wrote, member, last_at AS lastAt FROM person_chats WHERE tenant_id = ? AND person = ? ORDER BY last_at DESC LIMIT 200')
  .all(TENANT, String(person)).map((r) => ({ chat: r.chat, wrote: !!r.wrote, member: !!r.member, lastAt: r.lastAt }));

// ---------- agent access ----------
export const PEOPLE_ACCESS = ['off', 'own', 'everyone'];
/**
 * What an agent may see in People for one turn: null (nothing), { all: true }, or { chats, lists } (its own chats and
 * the lists the owner shared with it). `owner`: the sender of this turn is the owner (owner-level access).
 * @returns {{ all?: boolean, chats?: string[], lists?: string[] } | null}
 */
export function peopleScope(agent, { owner = false } = {}) {
  if (owner) return { all: true };
  const access = agent?.peopleAccess || 'own';
  if (access === 'off') return null;
  if (access === 'everyone') return { all: true };
  return { chats: agent?.chats || [], lists: agent?.peopleLists || [] };
}
/** May this scope see this person? Hidden people: never. */
export function canSee(scope, person) {
  const p = person && st('SELECT hidden FROM people WHERE tenant_id = ? AND id = ?').get(TENANT, String(person));
  if (!scope || !p || p.hidden) return false;
  if (scope.all) return true;
  const chats = scope.chats || []; const lists = scope.lists || [];
  if (chats.length && db.prepare(`SELECT 1 FROM person_chats WHERE tenant_id = ? AND person = ? AND chat IN (${chats.map(() => '?').join(',')}) LIMIT 1`).get(TENANT, person, ...chats)) return true;
  return !!(lists.length && db.prepare(`SELECT 1 FROM person_list_members WHERE tenant_id = ? AND person = ? AND list IN (${lists.map(() => '?').join(',')}) LIMIT 1`).get(TENANT, person, ...lists));
}
/** The agents that can see a person (their page): [{ id, name, why }]. */
export function agentsSeeing(person, agents) {
  const p = st('SELECT hidden FROM people WHERE tenant_id = ? AND id = ?').get(TENANT, String(person));
  if (!p || p.hidden) return [];
  const chats = new Set(chatsOfPerson(person).map((c) => c.chat));
  const lists = new Set(st('SELECT list FROM person_list_members WHERE tenant_id = ? AND person = ?').all(TENANT, person).map((r) => r.list));
  return agents.flatMap((a) => {
    const access = a.peopleAccess || 'own';
    if (access === 'off') return [];
    if (access === 'everyone') return [{ id: a.id, name: a.name, why: 'Everyone in People' }];
    if (a.chats.some((c) => chats.has(c))) return [{ id: a.id, name: a.name, why: 'In its chats' }];
    if ((a.peopleLists || []).some((l) => lists.has(l))) return [{ id: a.id, name: a.name, why: 'A list shared with it' }];
    return [];
  });
}

// ---------- roles that are people and lists ----------
/** The phone numbers of a person (theirs and their apps'). */
const phonesOf = (person) => st("SELECT phone FROM people WHERE tenant_id = ? AND id = ? AND phone <> '' UNION SELECT phone FROM identities WHERE tenant_id = ? AND person = ? AND phone <> ''")
  .all(TENANT, person, TENANT, person).map((r) => r.phone);
/**
 * Is the sender in a role list? Entries are phone numbers, person ids (p_…) or list ids (l_…). A phone entry also
 * matches the person who holds that number on any app, so a role follows a person across WhatsApp and Telegram.
 */
export function inRole(entries = [], { phone = '', person = '' } = {}) {
  if (!entries.length) return false;
  const d = digits(phone);
  if (d && entries.includes(d)) return true;
  // the number the channel vouches for decides who it is; without one (a Telegram account), the person of the identity
  const who = (d ? personByPhone(d)?.id : '') || person;
  if (!who) return false;
  if (entries.includes(who)) return true;
  const lists = entries.filter((e) => e.startsWith('l_'));
  if (lists.length && db.prepare(`SELECT 1 FROM person_list_members WHERE tenant_id = ? AND person = ? AND list IN (${lists.map(() => '?').join(',')}) LIMIT 1`).get(TENANT, who, ...lists)) return true;
  const nums = entries.filter((e) => /^\d+$/.test(e));
  return !d && nums.length > 0 && phonesOf(who).some((x) => nums.includes(x));
}
/** A role entry as the panel shows it: { value, kind: phone | person | list, label }. */
export function roleEntry(value) {
  if (value.startsWith('l_')) return { value, kind: 'list', label: st('SELECT name FROM person_lists WHERE tenant_id = ? AND id = ?').get(TENANT, value)?.name || 'A list that was deleted' };
  if (value.startsWith('p_')) return { value, kind: 'person', label: personRow(value)?.name || 'Someone no longer in People' };
  const p = personByPhone(value);
  return { value, kind: 'phone', label: p ? p.name : `+${value}`, ...(p ? { person: p.id } : {}) };
}

// ---------- the sender card ----------
/**
 * A few lines about the sender for the agent: name, nickname, households, tags and the latest owner and agent notes.
 * Never message text (notes are written by the owner or an agent; timeline events are left out). '' when the scope
 * is off or the person is unknown or hidden. `name`: the name the agent knows them by (#113, the runner's).
 */
export function senderCard(person, scope, name = '') {
  if (!scope || !person) return '';
  const p = personRow(person);
  if (!p || p.hidden) return '';
  const notes = st("SELECT by, text FROM person_notes WHERE tenant_id = ? AND person = ? AND kind = 'note' ORDER BY at DESC LIMIT 3").all(TENANT, person);
  const hh = householdsOf(person); const tags = tagsOf(person);
  return [`About the sender (from People; use it, don't recite it): ${name || p.ownName || 'unnamed'}${p.nickname ? ` ("${p.nickname}")` : ''}`,
    hh.length ? `Household: ${hh.map((h) => `${h.name} (${h.role})`).join(', ')}` : '',
    tags.length ? `Tags: ${tags.join(', ')}` : '',
    ...notes.map((n) => `Note (${n.by}): ${clip(n.text, 160)}`)].filter(Boolean).join('\n');
}

// ---------- consent ----------
export const CONSENT_PURPOSES = Object.freeze({ privacy_notice: 'Saw the privacy notice', updates: 'May receive updates', marketing: 'May receive marketing' });
const CONSENT_VALUES = ['yes', 'no'];
/** Record a consent (the latest answer per purpose wins). */
export function recordConsent(person, purpose, value, source = '', at = Date.now()) {
  if (!Object.hasOwn(CONSENT_PURPOSES, purpose)) throw fail(`purpose must be one of ${Object.keys(CONSENT_PURPOSES).join(', ')}`, 400, { field: 'purpose' });
  if (!CONSENT_VALUES.includes(value)) throw fail('value must be yes or no', 400, { field: 'value' });
  st(`INSERT INTO person_consents (tenant_id, person, purpose, value, source, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET value = excluded.value, source = excluded.source, at = excluded.at`).run(TENANT, person, purpose, value, clip(source, 80), at);
}
/** Every purpose with its answer: [{ purpose, label, value: yes | no, known, source, at }] (unknown = no). */
export function consentsOf(person) {
  const rows = new Map(st('SELECT purpose, value, source, at FROM person_consents WHERE tenant_id = ? AND person = ?').all(TENANT, person).map((r) => [r.purpose, r]));
  return Object.entries(CONSENT_PURPOSES).map(([purpose, label]) => {
    const r = rows.get(purpose);
    return { purpose, label, value: r?.value || 'no', known: !!r, source: r?.source || '', at: r?.at || null };
  });
}
/** The direct-message notice line was added to an answer to this person (privacy-notice.js decides when). */
export const noticeSeenInDm = (phoneOrChat) => {
  const p = /^\d{6,15}$/.test(String(phoneOrChat)) ? personByPhone(phoneOrChat) : null; // a chat id (hidden number) names nobody
  if (p) try { recordConsent(p.id, 'privacy_notice', 'yes', 'Direct message notice'); } catch { /* best effort */ }
};
/** The group notice was posted: everyone known to be in the group saw it (later members when they are noted). */
export function noticePostedInGroup(chat, at = Date.now()) {
  for (const r of st('SELECT person FROM person_chats WHERE tenant_id = ? AND chat = ?').all(TENANT, chat)) recordConsent(r.person, 'privacy_notice', 'yes', 'Group notice', at);
}

// ---------- the owner's phone contacts become people ----------
const PHONE_BATCH = 300;
/**
 * Up to `limit` synced phone contacts (address-book, business or profile name, keyed by number) that changed since
 * the last run become people (source "phone", a WhatsApp identity for the number, no last contact). Idempotent: a
 * number that already belongs to someone (hidden people included) adds nobody. Upkeep tick and after a sync.
 */
export function syncPhonePeople(limit = PHONE_BATCH) {
  const [at, phone] = String(kvGet('people.phoneSync') || '0|').split('|');
  const rows = st(`SELECT phone, updated_at FROM contacts WHERE tenant_id = ? AND (updated_at, phone) > (?, ?) ORDER BY updated_at, phone LIMIT ?`)
    .all(TENANT, Number(at) || 0, phone || '', limit);
  if (!rows.length) return 0;
  let added = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of rows) {
      const d = digits(r.phone);
      if (d.length < 6 || d.length > 15) continue;
      if (st("SELECT 1 FROM people WHERE tenant_id = ? AND phone = ? AND phone <> ''").get(TENANT, d) || st("SELECT 1 FROM identities WHERE tenant_id = ? AND phone = ? AND phone <> '' LIMIT 1").get(TENANT, d)) continue;
      const id = `p_${randomBytes(6).toString('hex')}`;
      st("INSERT INTO people (tenant_id, id, phone, created_at, source) VALUES (?, ?, ?, ?, 'phone')").run(TENANT, id, d, Date.now());
      st('INSERT OR IGNORE INTO identities (tenant_id, channel, external_id, person, phone, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, 0)').run(TENANT, 'whatsapp', `${d}@s.whatsapp.net`, id, d, Date.now());
      added++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const last = rows.at(-1);
  kvSet('people.phoneSync', `${last.updated_at}|${last.phone}`);
  if (added) { forgetPeopleCache(); activity('config', { summary: `${added} ${added === 1 ? 'contact' : 'contacts'} from your phone added to People` }); }
  return added;
}

/**
 * 079, one release only (remove in the next): the chats people wrote in, from the stored messages, and the privacy
 * notices they saw (group notices posted there, the direct-message line), once.
 */
export function migratePeopleChats() {
  if (kvGet('people.chatsNoted')) return;
  db.prepare(`INSERT OR IGNORE INTO person_chats (tenant_id, person, chat, wrote, member, last_at)
    SELECT i.tenant_id, i.person, m.chat, 1, 0, MAX(m.ts) FROM messages m JOIN identities i ON i.tenant_id = ? AND i.channel = m.channel AND i.external_id = m.sender_jid
    WHERE m.from_agent = 0 AND m.sender_jid <> '' GROUP BY i.person, m.chat`).run(TENANT);
  db.exec(`INSERT OR IGNORE INTO person_consents (tenant_id, person, purpose, value, source, at)
    SELECT c.tenant_id, c.person, 'privacy_notice', 'yes', 'Group notice', n.posted_at FROM person_chats c JOIN privacy_notices n ON n.tenant_id = c.tenant_id AND n.chat = c.chat`);
  db.exec(`INSERT OR IGNORE INTO person_consents (tenant_id, person, purpose, value, source, at)
    SELECT p.tenant_id, p.id, 'privacy_notice', 'yes', 'Direct message notice', s.ts FROM privacy_dm_seen s JOIN people p ON p.tenant_id = s.tenant_id AND p.phone = s.who AND p.phone <> ''`);
  kvSet('people.chatsNoted', String(Date.now()));
}
