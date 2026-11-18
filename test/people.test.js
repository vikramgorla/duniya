// 078: People (PRM core) — people from chats that are on, ties with a named inverse, households with a kid without an
// app, notes and timeline, tags and lists, merge + undo, export, erase, the one-time move of saved contacts, the panel
// API and its roles, the owner assistant's read tools and the admin MCP tools.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setup } from './harness.js';

// A database from before 2.39: Contacts with own names, notes and Shared, and the 075 people table without names.
const t = await setup({ beforeImport: (x) => {
  mkdirSync(join(x.tmp, 'data'), { recursive: true });
  const old = new DatabaseSync(join(x.tmp, 'data', 'duniya.sqlite'));
  old.exec(`CREATE TABLE contacts (tenant_id TEXT NOT NULL, phone TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', book_name TEXT NOT NULL DEFAULT '',
    biz_name TEXT NOT NULL DEFAULT '', push_name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', shared INTEGER NOT NULL DEFAULT 0,
    own INTEGER NOT NULL DEFAULT 0, updated_at INTEGER, PRIMARY KEY (tenant_id, phone));
    CREATE TABLE people (tenant_id TEXT NOT NULL, id TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id));
    INSERT INTO people VALUES ('default', 'p_0000000000aa', '41790000301', 1);
    INSERT INTO contacts (tenant_id, phone, name, book_name, note, shared, own) VALUES
      ('default', '41790000301', 'Dr. Meier', 'Meier Praxis', 'Mon–Fri 8–12', 1, 1),
      ('default', '41790000302', 'Taxi Morges', '', '', 0, 1),
      ('default', '41790000303', '', 'Only Phonebook', '', 0, 0);`);
  old.close();
} });
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 123' });
const admin = await t.login('ada', 'admin password 123');
const viewer = await t.login('vic', 'viewer password 123');
after(() => t.close());
const people = await import('../src/core/people.js');
const ops = await import('../src/core/people-ops.js');
const contacts = await import('../src/core/contacts.js');
const { TOOLS } = await import('../src/panel/admin-tools.js');
const api = async (m, p, b, who = owner) => { const r = await t.api(who, m, p, b); if (r.status >= 400) throw Object.assign(new Error(r.body.error), { status: r.status }); return r.body; };
const x = { call: (m, p, b) => api(m, p, b) };
const tool = (name, a = {}) => TOOLS.find((y) => y.name === name).run(a, x);

test('saved contacts move into People once: own name, Shared and the note; phone-book names create nobody', async () => {
  assert.equal(ops.migrateContacts(), 2);
  assert.equal(ops.migrateContacts(), 0, 'once only');
  const meier = people.personByPhone('41790000301');
  assert.equal(meier.id, 'p_0000000000aa', 'the existing person keeps their id');
  assert.deepEqual([meier.name, meier.ownName, meier.shared], ['Dr. Meier', 'Dr. Meier', true]);
  assert.deepEqual(people.timeline(meier.id).filter((n) => n.kind === 'note').map((n) => [n.text, n.author]), [['Mon–Fri 8–12', 'Contacts']]);
  assert.equal(people.personByPhone('41790000302').name, 'Taxi Morges');
  assert.equal(people.personByPhone('41790000303'), null, 'a phone-book name alone is no person');
  assert.equal(contacts.personInfo({ phone: '41790000301' }).source, 'own', 'the own name still wins everywhere');
});

test('people are created only from chats that are on; the name the app showed is kept', async () => {
  t.chatPrefs.setChatPrefs('g7@g.us', { enabled: false });
  const before = people.listPeople({ limit: 500 }).length;
  await t.route(t.msg({ chat: 'g7@g.us', phone: '41790000311', senderJid: '41790000311@s.whatsapp.net', senderName: 'Off Olga', text: 'hello' }));
  assert.equal(people.personByPhone('41790000311'), null, 'a chat that is off stores nobody');
  await t.route(t.msg({ chat: 'g1@g.us', phone: '41790000312', senderJid: '41790000312@s.whatsapp.net', senderName: 'Ravi R', text: 'hello all' }));
  const ravi = people.personByPhone('41790000312');
  assert.equal(ravi.name, 'Ravi R');
  assert.deepEqual(ravi.apps, ['whatsapp']);
  assert.ok(ravi.lastContact);
  assert.equal(people.listPeople({ limit: 500 }).length, before + 1);
});

test('ties read from both sides with the named inverse; custom ties; households with a kid reached through the adults', async () => {
  const ravi = people.personByPhone('41790000312');
  const mia = await api('POST', '/api/people', { name: 'Mia', birthday: '2018-04-23' }); // a kid without a phone
  const anu = await api('POST', '/api/people', { name: 'Anu', phone: '+41 79 000 03 13' });
  assert.equal((await t.api(owner, 'POST', '/api/people', { name: 'Again', phone: '41790000313' })).status, 409);
  assert.equal((await t.api(owner, 'POST', '/api/people', { name: 'X', birthday: '23.04.2018' })).body.field, 'birthday');
  await api('POST', `/api/people/${ravi.id}/ties`, { other: mia.id, kind: 'parent' });
  await api('POST', `/api/people/${ravi.id}/ties`, { other: anu.id, kind: 'partner' });
  await api('POST', `/api/people/${anu.id}/ties`, { other: mia.id, kind: 'parent', reverse: false });
  await api('POST', `/api/people/${mia.id}/ties`, { other: anu.id, kind: 'custom', label: 'Goddaughter of', inverse: 'Godmother of' });
  assert.equal((await t.api(owner, 'POST', `/api/people/${mia.id}/ties`, { other: mia.id, kind: 'parent' })).status, 400);
  assert.equal((await t.api(owner, 'POST', `/api/people/${mia.id}/ties`, { other: anu.id, kind: 'custom' })).body.field, 'label');
  const miaPage = await api('GET', `/api/people/${mia.id}`);
  assert.deepEqual(miaPage.ties.map((y) => `${y.label} ${y.other.name}`).sort(), ['Child of Anu', 'Child of Ravi R', 'Goddaughter of Anu']);
  assert.deepEqual((await api('GET', `/api/people/${anu.id}`)).ties.map((y) => `${y.label} ${y.other.name}`).sort(), ['Godmother of Mia', 'Parent of Mia', 'Partner of Ravi R']);
  // household: two adults and the kid; the kid is reached only through the adults with an app
  const hh = await api('POST', '/api/households', { name: 'Chary family', address: 'Rue du Lac 1, Morges' });
  await api('PUT', `/api/households/${hh.id}/members/${ravi.id}`, { role: 'adult' });
  await api('PUT', `/api/households/${hh.id}/members/${anu.id}`, { role: 'adult' });
  await api('PUT', `/api/households/${hh.id}/members/${mia.id}`, { role: 'kid' });
  assert.equal((await t.api(owner, 'PUT', `/api/households/${hh.id}/members/${mia.id}`, { role: 'boss' })).status, 400);
  const h2 = await api('GET', `/api/households/${hh.id}`);
  assert.deepEqual(h2.members.map((m) => [m.name, m.role, m.reachable]), [['Anu', 'adult', false], ['Ravi R', 'adult', true], ['Mia', 'kid', false]]);
  const page = await api('GET', `/api/people/${mia.id}`);
  assert.deepEqual(page.reachVia.map((r) => [r.name, r.household]), [['Ravi R', 'Chary family']]);
  assert.deepEqual(page.households.map((y) => [y.name, y.role]), [['Chary family', 'kid']]);
  assert.ok(page.timeline.some((e) => e.kind === 'event' && /Joined the household Chary family/.test(e.text)));
  // a person can be in more than one household
  const h3 = await api('POST', '/api/households', { name: 'Grandparents' });
  await api('PUT', `/api/households/${h3.id}/members/${mia.id}`, { role: 'kid' });
  assert.equal((await api('GET', `/api/people?household=${hh.id}`)).length, 3);
  assert.deepEqual((await api('GET', '/api/people?app=none')).map((p) => p.name).sort(), ['Anu', 'Dr. Meier', 'Mia', 'Taxi Morges']);
});

test('notes: owner and agent notes; agent notes never quote stored messages; tags and lists filter the list', async () => {
  const ravi = people.personByPhone('41790000312');
  t.db.logMessage({ channel: 'whatsapp', chat: 'g1@g.us', msgId: 'r1', sender: '41790000312', senderJid: '41790000312@s.whatsapp.net', name: 'Ravi R', text: 'I will bring the big tent on Saturday', ts: Date.now() });
  await api('POST', `/api/people/${ravi.id}/notes`, { text: 'Prefers voice notes' });
  const r = await t.api(owner, 'POST', `/api/people/${ravi.id}/notes`, { text: 'He said: I will bring the big tent on Saturday', by: 'agent' });
  assert.equal(r.status, 400, 'message text in an agent note is refused (logging policy)');
  await api('POST', `/api/people/${ravi.id}/notes`, { text: 'Brings camping gear', by: 'agent' });
  const tl = (await api('GET', `/api/people/${ravi.id}`)).timeline.filter((n) => n.kind === 'note');
  assert.deepEqual(tl.map((n) => [n.text, n.by]), [['Brings camping gear', 'agent'], ['Prefers voice notes', 'owner']]);
  assert.equal((await api('DELETE', `/api/people/${ravi.id}/notes/${tl[0].id}`)).ok, true);
  assert.deepEqual((await api('PUT', `/api/people/${ravi.id}/tags`, { tags: ['#Badminton', 'neighbour', 'badminton'] })).tags, ['badminton', 'neighbour']);
  const list = await api('POST', '/api/lists', { name: 'Badminton Tuesdays' });
  await api('PUT', `/api/lists/${list.id}/members/${ravi.id}`);
  assert.deepEqual((await api('GET', `/api/lists/${list.id}`)).members.map((m) => m.name), ['Ravi R']);
  assert.deepEqual((await api('GET', '/api/people?tag=badminton')).map((p) => p.name), ['Ravi R']);
  assert.deepEqual((await api('GET', `/api/people?list=${list.id}`)).map((p) => p.name), ['Ravi R']);
  assert.deepEqual((await api('GET', '/api/people?q=voice')).map((p) => p.name), ['Ravi R'], 'search finds notes');
  assert.deepEqual((await api('GET', '/api/people?q=0312')).map((p) => p.name), ['Ravi R'], 'and numbers');
  const sum = await api('GET', '/api/people/summary');
  assert.deepEqual(sum.tags.map((y) => y.tag), ['badminton', 'neighbour']);
  assert.equal(sum.lists[0].size, 1);
});

test('merge moves everything, is owner only, suggested on a verified number, and can be undone', async () => {
  const ravi = people.personByPhone('41790000312');
  // Ravi on Telegram before he shared his number: a separate person
  people.personFor({ channel: 'telegram', externalId: '5001', name: 'Ravi TG' });
  const tg = people.listPeople({ q: 'Ravi TG' })[0];
  await api('PUT', `/api/people/${tg.id}/tags`, { tags: ['telegram-only', 'badminton'] });
  await api('POST', `/api/people/${tg.id}/notes`, { text: 'Met at the club' });
  assert.equal((await t.api(admin, 'POST', `/api/people/${ravi.id}/merge`, { other: tg.id })).status, 403, 'admins cannot merge');
  const m = await api('POST', `/api/people/${ravi.id}/merge`, { other: tg.id });
  assert.ok(m.undoUntil > Date.now() + 29 * 86400000);
  const page = await api('GET', `/api/people/${ravi.id}`);
  assert.deepEqual(page.apps, ['telegram', 'whatsapp']);
  assert.deepEqual(page.tags, ['badminton', 'neighbour', 'telegram-only']);
  assert.ok(page.timeline.some((n) => n.text === 'Met at the club'));
  assert.equal(page.merges.length, 1);
  assert.equal(people.personFor({ channel: 'telegram', externalId: '5001' }), ravi.id, 'the identity now belongs to Ravi');
  assert.equal((await t.api(owner, 'GET', `/api/people/${tg.id}`)).status, 404);
  // undo: the Telegram person comes back with what they brought; Ravi keeps his own
  const u = await api('POST', `/api/people/merges/${m.merge}/undo`);
  assert.equal(u.restored.id, tg.id);
  assert.deepEqual((await api('GET', `/api/people/${ravi.id}`)).tags, ['badminton', 'neighbour']);
  const back = await api('GET', `/api/people/${tg.id}`);
  assert.deepEqual([back.apps, back.tags], [['telegram'], ['badminton', 'telegram-only']]);
  assert.ok(back.timeline.some((n) => n.text === 'Met at the club'));
  assert.equal(people.personFor({ channel: 'telegram', externalId: '5001' }), tg.id);
  assert.equal((await t.api(owner, 'POST', `/api/people/merges/${m.merge}/undo`)).status, 404, 'undone once');
  // a second verified number keeps the person's own number and is suggested for a merge on evidence
  people.personFor({ channel: 'telegram', externalId: '5002', phone: '41790000313' }); // Anu shares her number on Telegram
  assert.equal(people.personByPhone('41790000313').apps.includes('telegram'), true, 'the same verified number joins automatically');
  const kim = await api('POST', '/api/people', { name: 'Kim', phone: '41790000330' });
  people.personFor({ channel: 'telegram', externalId: '5003', phone: '41790000331' });
  people.forgetPeopleCache();
  const kimTg = people.personFor({ channel: 'telegram', externalId: '5003', phone: '41790000330' }); // the account now shows Kim's number
  assert.notEqual(kimTg, kim.id, 'a person who has a number is never joined silently');
  assert.equal(people.personById(kimTg).phone, '41790000331', 'and keeps their own number');
  assert.deepEqual((await api('GET', `/api/people/${kim.id}`)).suggestions.map((y) => [y.id, y.reason]), [[kimTg, 'Same verified phone number']]);
  assert.deepEqual((await api('GET', `/api/people/${kimTg}`)).suggestions.map((y) => y.id), [kim.id]);
  // old undo records are pruned on the upkeep tick
  const m2 = await api('POST', `/api/people/${ravi.id}/merge`, { other: tg.id });
  assert.equal(ops.pruneMerges(Date.now() + 31 * 86400000), 1);
  assert.equal((await t.api(owner, 'POST', `/api/people/merges/${m2.merge}/undo`)).status, 404);
});

test('export has everything about one person; erase removes their messages, notes, ties and memberships (owner only)', async () => {
  const ravi = people.personByPhone('41790000312');
  const e = await api('GET', `/api/people/${ravi.id}/export`);
  assert.equal(e.person.id, ravi.id);
  assert.ok(e.messages.some((msg) => /big tent/.test(msg.text)));
  assert.ok(e.ties.length >= 2 && e.households.length === 1 && e.lists.length === 1);
  assert.equal((await t.api(admin, 'GET', `/api/people/${ravi.id}/export`)).status, 403);
  assert.equal((await t.api(admin, 'DELETE', `/api/people/${ravi.id}`)).status, 403);
  const c = await api('DELETE', `/api/people/${ravi.id}`);
  assert.ok(c.messages >= 2 && c.ties >= 2 && c.households === 1);
  assert.equal(t.db.db.prepare("SELECT COUNT(*) n FROM messages WHERE sender = '41790000312'").get().n, 0);
  assert.equal((await t.api(owner, 'GET', `/api/people/${ravi.id}`)).status, 404);
  const mia = people.listPeople({ q: 'Mia' })[0];
  assert.deepEqual((await api('GET', `/api/people/${mia.id}`)).ties.map((y) => y.other.name).sort(), ['Anu', 'Anu'], 'ties to the erased person are gone');
  const log = t.db.listActivity({ limit: 10 }).find((a) => /Erased a person/.test(a.summary));
  assert.ok(log && !/Ravi/.test(log.summary), 'the log keeps counts, not the name');
});

test('panel API roles; a number without a person still has a page; agent contact tools read People', async () => {
  assert.equal((await t.api(viewer, 'GET', '/api/people')).status, 403);
  assert.equal((await t.api(viewer, 'GET', '/api/households')).status, 403);
  assert.equal((await t.api(admin, 'PUT', '/api/people/agent-names', { enabled: false })).status, 403);
  const page = await api('GET', '/api/people/41790000999', undefined, admin);
  assert.deepEqual([page.notInPeople, page.name], [true, '+41790000999']);
  const tool = (await import('../src/core/people.js')).contactsTools;
  const find = tool.find((y) => y.name === 'find_contact');
  assert.match(await find.run({ query: 'taxi' }, { role: 'participant' }), /No matching person/, 'participants see shared people only');
  assert.deepEqual(await find.run({ query: 'meier' }, { role: 'participant' }), [{ name: 'Dr. Meier', phone: '+41790000301', note: 'Mon–Fri 8–12' }]);
  await tool.find((y) => y.name === 'save_contact').run({ phone: '+41 79 000 03 20', name: 'Lea', shared: true }, { role: 'organizer', senderName: 'Org', agent: { id: 'panduga' } });
  assert.equal(people.personByPhone('41790000320').shared, true);
});

test('admin MCP and the owner assistant answer people questions; risky people tools need a confirm code', async () => {
  const anu = people.personByPhone('41790000313');
  const p = await tool('get_person', { person: '+41 79 000 03 13' });
  assert.equal(p.id, anu.id);
  assert.ok((await tool('list_people', { query: 'mia' })).some((y) => y.name === 'Mia'));
  assert.ok((await tool('list_households')).some((h) => h.name === 'Chary family'));
  for (const n of ['merge_people', 'undo_merge', 'erase_person', 'set_contact_names_for_agents']) assert.ok(TOOLS.find((y) => y.name === n).risky, n);
  assert.match(await TOOLS.find((y) => y.name === 'erase_person').preview({ person: anu.id }, x), /Erase "Anu"/);
  await tool('add_person_note', { person: anu.id, text: 'Allergic to nuts' });
  assert.equal(people.timeline(anu.id).find((n) => n.text === 'Allergic to nuts').by, 'agent');
  // the owner assistant reads People with the same tools (read-only: no confirm)
  t.script.push([{ type: 'tool_use', id: 'pp1', name: 'get_person', input: { person: people.listPeople({ q: 'Mia' })[0].id } }], [{ type: 'text', text: 'Mia is Anu\'s kid.' }]);
  const r = await t.api(owner, 'POST', '/api/owner/ask', { question: 'who is Anu\'s kid?' });
  assert.equal(r.body.reply, 'Mia is Anu\'s kid.');
  const res = t.claudeReqs.at(-1).messages.at(-1).content[0];
  assert.ok(!res.is_error && /Child of/.test(res.content) && /Chary family/.test(res.content));
  // changes from the owner assistant wait for the confirm code
  t.script.push([{ type: 'tool_use', id: 'pp2', name: 'set_person_tags', input: { person: anu.id, tags: ['vip'] } }], [{ type: 'text', text: 'Waiting for your confirmation.' }]);
  const r2 = await t.api(owner, 'POST', '/api/owner/ask', { question: 'tag Anu as vip' });
  assert.equal(r2.body.confirms.length, 1);
  assert.deepEqual(people.tagsOf(anu.id), []);
});
