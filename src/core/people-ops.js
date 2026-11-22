// @ts-check
// People operations (078, PRM core): merge two people (owner only, undoable for 30 days), export one person, erase one
// person (079: admin MCP only, behind a confirm; the panel hides people instead). Merges are suggested only on evidence: an identity
// whose verified phone is another person's number. Undo records are pruned on the upkeep tick (no timers).
import { forgetPersonInsights } from './person-insights.js';
import { forgetCommitments } from './commitments.js';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { fail, plural } from './config.js';
import { activity } from './events.js';
import { eraseChatMemory } from './memory.js';
import { TENANT } from './store.js';
import { addEvent, forgetPeopleCache, householdsOf, listsOf, personById, personRow, tagsOf, tiesOf, timeline } from './people.js';
import { consentsOf, chatsOfPerson } from './people-access.js';
import { listAgentRows, saveAgentRow } from './store.js';
import { loadAgents } from './agents.js';
import { eraseModuleRows, exportModuleRows, moveModuleRows, restoreModuleRows } from '../modules/index.js';

const UNDO_MS = 30 * 86400000;
db.exec(`CREATE TABLE IF NOT EXISTS person_merges (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, kept TEXT NOT NULL, merged TEXT NOT NULL, snapshot TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
)`);
const all = (sql, ...a) => db.prepare(sql).all(TENANT, ...a);
const run = (sql, ...a) => db.prepare(sql).run(TENANT, ...a);
const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const raw = (id) => db.prepare('SELECT * FROM people WHERE tenant_id = ? AND id = ?').get(TENANT, id);

/**
 * Merge `other` into `keep`: identities, notes and events, ties, household memberships, tags and lists move; empty
 * fields of `keep` take the other's (name, nickname, birthday, number). Returns { merge, undoUntil, person }.
 */
export function mergePeople(keep, other, by = 'panel') {
  const k = raw(String(keep || '')); const o = raw(String(other || ''));
  if (!k || !o) throw fail('No such person', 404);
  if (k.id === o.id) throw fail('Choose two different people', 400, { field: 'other' });
  const otherName = personRow(o.id)?.name || 'someone';
  const id = `m_${randomBytes(6).toString('hex')}`;
  tx(() => {
    const has = (sql, x) => !!db.prepare(sql).get(TENANT, k.id, x);
    const snap = {
      person: o, keptBefore: { name: k.name, nickname: k.nickname, birthday: k.birthday, phone: k.phone, shared: k.shared },
      identities: all('SELECT channel, external_id FROM identities WHERE tenant_id = ? AND person = ?', o.id),
      notes: all('SELECT id FROM person_notes WHERE tenant_id = ? AND person = ?', o.id).map((r) => r.id),
      ties: all('SELECT * FROM person_ties WHERE tenant_id = ? AND (a = ? OR b = ?)', o.id, o.id),
      memberships: all('SELECT household, role FROM household_members WHERE tenant_id = ? AND person = ?', o.id),
      tags: all('SELECT tag FROM person_tags WHERE tenant_id = ? AND person = ?', o.id).map((r) => r.tag),
      lists: all('SELECT list FROM person_list_members WHERE tenant_id = ? AND person = ?', o.id).map((r) => r.list),
      chats: all('SELECT chat, wrote, member, last_at FROM person_chats WHERE tenant_id = ? AND person = ?', o.id), // 079
    };
    // what `keep` gains (so undo takes exactly that back)
    snap.added = {
      memberships: snap.memberships.filter((m) => !has('SELECT 1 FROM household_members WHERE tenant_id = ? AND person = ? AND household = ?', m.household)).map((m) => m.household),
      tags: snap.tags.filter((t) => !has('SELECT 1 FROM person_tags WHERE tenant_id = ? AND person = ? AND tag = ?', t)),
      lists: snap.lists.filter((l) => !has('SELECT 1 FROM person_list_members WHERE tenant_id = ? AND person = ? AND list = ?', l)),
    };
    db.prepare('UPDATE identities SET person = ? WHERE tenant_id = ? AND person = ?').run(k.id, TENANT, o.id);
    db.prepare('UPDATE person_notes SET person = ? WHERE tenant_id = ? AND person = ?').run(k.id, TENANT, o.id);
    db.prepare('UPDATE person_ties SET a = ? WHERE tenant_id = ? AND a = ?').run(k.id, TENANT, o.id);
    db.prepare('UPDATE person_ties SET b = ? WHERE tenant_id = ? AND b = ?').run(k.id, TENANT, o.id);
    run('DELETE FROM person_ties WHERE tenant_id = ? AND a = b');
    for (const m of snap.memberships) if (snap.added.memberships.includes(m.household)) run('INSERT INTO household_members (tenant_id, household, person, role) VALUES (?, ?, ?, ?)', m.household, k.id, m.role);
    for (const t of snap.added.tags) run('INSERT INTO person_tags (tenant_id, person, tag) VALUES (?, ?, ?)', k.id, t);
    for (const l of snap.added.lists) run('INSERT INTO person_list_members (tenant_id, list, person) VALUES (?, ?, ?)', l, k.id);
    // 079: the chats they are in and their consents move too (the kept person's own answers win)
    for (const t of ['person_chats', 'person_consents']) {
      db.prepare(`UPDATE OR IGNORE ${t} SET person = ? WHERE tenant_id = ? AND person = ?`).run(k.id, TENANT, o.id);
      run(`DELETE FROM ${t} WHERE tenant_id = ? AND person = ?`, o.id);
    }
    for (const t of ['household_members', 'person_tags', 'person_list_members']) run(`DELETE FROM ${t} WHERE tenant_id = ? AND person = ?`, o.id);
    snap.modules = moveModuleRows(o.id, k.id); // 081: registrations, duties, orders … (every module, on or off)
    // 079: agent roles that name the merged person name the kept one
    for (const row of listAgentRows()) {
      const swap = (l = []) => [...new Set(l.map((e) => (e === o.id ? k.id : e)))];
      if ([...(row.config.organizers || []), ...(row.config.participants || [])].includes(o.id)) saveAgentRow(row.id, { ...row.config, organizers: swap(row.config.organizers), participants: swap(row.config.participants) }, by);
    }
    run('DELETE FROM people WHERE tenant_id = ? AND id = ?', o.id);
    db.prepare('UPDATE people SET name = ?, nickname = ?, birthday = ?, phone = ?, shared = ? WHERE tenant_id = ? AND id = ?')
      .run(k.name || o.name, k.nickname || o.nickname, k.birthday || o.birthday, k.phone || o.phone, k.shared || o.shared ? 1 : 0, TENANT, k.id);
    run('INSERT INTO person_merges (tenant_id, id, kept, merged, snapshot, at) VALUES (?, ?, ?, ?, ?, ?)', id, k.id, o.id, JSON.stringify(snap), Date.now());
  });
  forgetPeopleCache();
  loadAgents(); // 079: roles that named the merged person
  addEvent(k.id, `Merged with ${otherName} (${by}); undo possible for 30 days`);
  activity('config', { summary: `Merged two people in People (${by})` });
  return { merge: id, undoUntil: Date.now() + UNDO_MS, person: personRow(k.id) };
}

/** Undo a merge (within 30 days): the other person comes back with what they brought; later additions stay. */
export function undoMerge(mergeId, by = 'panel') {
  const m = db.prepare('SELECT * FROM person_merges WHERE tenant_id = ? AND id = ?').get(TENANT, String(mergeId || ''));
  if (!m || Date.now() - m.at > UNDO_MS) throw fail('This merge can no longer be undone', 404);
  const s = JSON.parse(m.snapshot); const o = s.person; const kb = s.keptBefore;
  if (!raw(m.kept)) throw fail('The person it was merged into was erased', 409);
  tx(() => {
    db.prepare('UPDATE people SET name = ?, nickname = ?, birthday = ?, phone = ?, shared = ? WHERE tenant_id = ? AND id = ?')
      .run(kb.name, kb.nickname, kb.birthday, kb.phone, kb.shared, TENANT, m.kept);
    run('INSERT INTO people (tenant_id, id, phone, created_at, name, nickname, birthday, shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', o.id, o.phone, o.created_at, o.name, o.nickname, o.birthday, o.shared);
    const moveId = db.prepare('UPDATE identities SET person = ? WHERE tenant_id = ? AND channel = ? AND external_id = ? AND person = ?');
    for (const i of s.identities) moveId.run(o.id, TENANT, i.channel, i.external_id, m.kept);
    const moveNote = db.prepare('UPDATE person_notes SET person = ? WHERE tenant_id = ? AND id = ? AND person = ?');
    for (const n of s.notes) moveNote.run(o.id, TENANT, n, m.kept);
    for (const t of s.ties) {
      run('DELETE FROM person_ties WHERE tenant_id = ? AND id = ?', t.id);
      run('INSERT INTO person_ties (tenant_id, id, a, b, kind, label, inverse, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', t.id, t.a, t.b, t.kind, t.label, t.inverse, t.created_at);
    }
    for (const h of s.added.memberships) run('DELETE FROM household_members WHERE tenant_id = ? AND household = ? AND person = ?', h, m.kept);
    for (const x of s.memberships) run('INSERT OR IGNORE INTO household_members (tenant_id, household, person, role) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM households WHERE tenant_id = ? AND id = ?)', x.household, o.id, x.role, TENANT, x.household);
    for (const t of s.added.tags) run('DELETE FROM person_tags WHERE tenant_id = ? AND person = ? AND tag = ?', m.kept, t);
    for (const t of s.tags) run('INSERT OR IGNORE INTO person_tags (tenant_id, person, tag) VALUES (?, ?, ?)', o.id, t);
    for (const l of s.added.lists) run('DELETE FROM person_list_members WHERE tenant_id = ? AND list = ? AND person = ?', l, m.kept);
    for (const c of s.chats || []) run('INSERT OR IGNORE INTO person_chats (tenant_id, person, chat, wrote, member, last_at) VALUES (?, ?, ?, ?, ?, ?)', o.id, c.chat, c.wrote, c.member, c.last_at);
    restoreModuleRows(s.modules, m.kept, o.id); // 081
    for (const l of s.lists) run('INSERT OR IGNORE INTO person_list_members (tenant_id, list, person) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM person_lists WHERE tenant_id = ? AND id = ?)', l, o.id, TENANT, l);
    run('DELETE FROM person_merges WHERE tenant_id = ? AND id = ?', m.id);
  });
  forgetPeopleCache();
  addEvent(m.kept, `Merge undone (${by})`); addEvent(o.id, `Merge undone (${by})`);
  activity('config', { summary: `Undid a merge in People (${by})` });
  return { kept: personRow(m.kept), restored: personRow(o.id) };
}

/** Merges into this person that can still be undone: [{ id, name, at, undoUntil }]. */
export const mergesInto = (person) => all('SELECT id, snapshot, at FROM person_merges WHERE tenant_id = ? AND kept = ? AND at > ? ORDER BY at DESC', person, Date.now() - UNDO_MS)
  .map((r) => { const p = JSON.parse(r.snapshot).person; return { id: r.id, name: p.name || (p.phone ? `+${p.phone}` : 'Someone'), at: r.at, undoUntil: r.at + UNDO_MS }; });

/** Merge suggestions on evidence only: someone else holds a verified number that is this person's (or the reverse). */
export function mergeSuggestions(person) {
  const p = raw(person); if (!p) return [];
  const ids = new Set();
  if (p.phone) for (const r of all("SELECT DISTINCT person FROM identities WHERE tenant_id = ? AND phone = ? AND phone <> '' AND person <> ?", p.phone, p.id)) ids.add(r.person);
  for (const r of all("SELECT DISTINCT o.id FROM identities i JOIN people o ON o.tenant_id = i.tenant_id AND o.phone = i.phone AND o.phone <> '' WHERE i.tenant_id = ? AND i.person = ? AND i.phone <> '' AND o.id <> i.person", p.id)) ids.add(r.id);
  return [...ids].map((id) => personRow(id)).filter(Boolean).map((r) => ({ id: r.id, name: r.name, reason: 'Same verified phone number' }));
}

/** Their direct chats: chats_seen rows of their number or one of their ids (any WhatsApp number of this server). */
function directChats(p, ids) {
  const out = new Set();
  for (const r of all('SELECT chat, phone FROM chats_seen WHERE tenant_id = ? AND is_group = 0')) {
    const native = r.chat.split('#').pop();
    if ((p.phone && r.phone === p.phone) || ids.includes(native) || (p.phone && native.startsWith(`${p.phone}@`))) out.add(r.chat);
  }
  return [...out];
}
const whoSql = (n) => `(sender IN (${Array(n).fill('?').join(',')}) OR sender_jid IN (${Array(n).fill('?').join(',')}))`;

/** Everything Duniya stores about one person, as JSON (the owner downloads it). Includes their stored messages (≤ 5000). */
export function exportPerson(id) {
  const p = personById(id); if (!p) throw fail('No such person', 404);
  const who = [p.phone, ...p.identities.map((i) => i.externalId)].filter(Boolean);
  const names = p.phone ? db.prepare('SELECT book_name AS phoneContact, biz_name AS business, push_name AS profile FROM contacts WHERE tenant_id = ? AND phone = ?').get(TENANT, p.phone) || null : null;
  const messages = who.length ? db.prepare(`SELECT chat, ts, name, text FROM messages WHERE ${whoSql(who.length)} ORDER BY id DESC LIMIT 5000`).all(...who, ...who) : [];
  return {
    exportedAt: new Date().toISOString(), person: p, names, ties: tiesOf(p.id), households: householdsOf(p.id), tags: tagsOf(p.id), lists: listsOf(p.id),
    chats: chatsOfPerson(p.id), consents: consentsOf(p.id),
    modules: exportModuleRows(p.id), // 081: registrations, duties, orders and payments
    notes: timeline(p.id, 500), messages: messages.reverse().map((m) => ({ ...m, at: new Date(m.ts).toISOString() })),
  };
}

/**
 * Erase one person: their stored messages (in any chat), their direct chats' memory, names from the phone's contacts,
 * group member tags, notes, ties, memberships, tags, list entries, identities and the person. Returns counts. If they
 * write again in a chat that is on, they come back as a new person.
 */
export function erasePerson(id, by = 'panel') {
  const p = personById(id); if (!p) throw fail('No such person', 404);
  const ids = p.identities.map((i) => i.externalId);
  const who = [p.phone, ...ids].filter(Boolean);
  const chats = directChats(p, ids);
  for (const c of chats) eraseChatMemory(c, by);
  const counts = tx(() => {
    const messages = who.length ? Number(db.prepare(`DELETE FROM messages WHERE ${whoSql(who.length)}`).run(...who, ...who).changes) : 0;
    if (who.length) db.prepare(`DELETE FROM wa_reactions WHERE sender IN (${who.map(() => '?').join(',')})`).run(...who);
    if (p.phone) {
      db.prepare('DELETE FROM member_tags WHERE phone = ?').run(p.phone);
      run('DELETE FROM contacts WHERE tenant_id = ? AND phone = ?', p.phone);
      run('DELETE FROM contact_lids WHERE tenant_id = ? AND phone = ?', p.phone);
    }
    const notes = Number(run('DELETE FROM person_notes WHERE tenant_id = ? AND person = ?', p.id).changes);
    const ties = Number(run('DELETE FROM person_ties WHERE tenant_id = ? AND (a = ? OR b = ?)', p.id, p.id).changes);
    const households = Number(run('DELETE FROM household_members WHERE tenant_id = ? AND person = ?', p.id).changes);
    for (const t of ['person_tags', 'person_list_members', 'person_chats', 'person_consents', 'identities']) run(`DELETE FROM ${t} WHERE tenant_id = ? AND person = ?`, p.id);
    const moduleRows = eraseModuleRows('person', p.id); // 081: their registrations, duties, orders and payments
    run('DELETE FROM person_merges WHERE tenant_id = ? AND (kept = ? OR merged = ?)', p.id, p.id);
    run('DELETE FROM people WHERE tenant_id = ? AND id = ?', p.id);
    return { messages, directChats: chats.length, notes, ties, households, moduleRows };
  });
  forgetPeopleCache();
  forgetPersonInsights(p.id); forgetCommitments({ person: p.id }); // 091: what was learned about them
  // no name in the log: the person is gone
  activity('config', { summary: `Erased a person from People: ${plural(counts.messages, 'stored message')}, ${plural(counts.notes, 'note')}, ${plural(counts.ties, 'tie')} (${by})` });
  return counts;
}

/** Undo records older than 30 days go (upkeep tick; bounded). */
export function pruneMerges(now = Date.now()) {
  return Number(db.prepare('DELETE FROM person_merges WHERE rowid IN (SELECT rowid FROM person_merges WHERE tenant_id = ? AND at < ? LIMIT 200)').run(TENANT, now - UNDO_MS).changes);
}
