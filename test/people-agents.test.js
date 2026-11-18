// 079: People step 2 — agents and people. People tools (and the old contacts: rules), access decided in code (own
// chats, shared lists, everyone, owner turns), the sender card (never message text), roles that are people and lists
// across WhatsApp and Telegram, the confirm gate for changes to others, consent from the privacy notice, members of
// groups that are on and phone contacts becoming people, Hide, the source filter, the one-time migrations, admin MCP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ privacyNotice: true, env: { RATE_LIMIT_PER_MIN: '1000' } });
const owner = await t.login();
after(() => t.close());
const people = await import('../src/core/people.js');
const access = await import('../src/core/people-access.js');
const contacts = await import('../src/core/contacts.js');
const { upkeepTick, resetUpkeep } = await import('../src/core/upkeep.js');
const { TOOLS } = await import('../src/panel/admin-tools.js');
const api = async (m, p, b) => { const r = await t.api(owner, m, p, b); if (r.status >= 400) throw Object.assign(new Error(r.body.error), { status: r.status }); return r.body; };
const x = { call: (m, p, b) => api(m, p, b) };
const jid = (phone) => `${phone}@s.whatsapp.net`;
const say = (chat, phone, text, o = {}) => t.route(t.msg({ chat, phone, senderJid: jid(phone), senderName: o.name || `P${phone.slice(-3)}`, text, ...o }));
/** One agent turn that calls a tool; returns the tool result the model got back and the turn's text. */
async function toolTurn(chat, phone, trigger, name, input, o = {}) {
  t.script.push([{ type: 'tool_use', id: `tu${t.claudeReqs.length}`, name, input }], [{ type: 'text', text: 'ok' }]);
  await say(chat, phone, `${trigger} please`, o);
  const res = t.claudeReqs.at(-1).messages.at(-1).content[0];
  return { tools: t.claudeReqs.at(-2).tools.map((y) => y.name), result: res.content, isError: res.is_error, turn: t.claudeReqs.at(-2).messages[0].content };
}
const ORG = '41790000001';
// g1 → panduga (organizer 01), g2 → helper (organizer 01)
await say('g1@g.us', '41790000401', 'hello from Gita', { name: 'Gita' });
await say('g2@g.us', '41790000402', 'hello from Hari', { name: 'Hari' });
const gita = people.personByPhone('41790000401'); const hari = people.personByPhone('41790000402');

test('agents get the people tools (never merge, hide or erase); old contacts: rules keep working for one release', async () => {
  const r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__find_person', { query: 'gita' });
  assert.deepEqual(r.tools.filter((n) => n.startsWith('people__')).sort(), ['people__add_note', 'people__add_to_list', 'people__find_person', 'people__get_person', 'people__tag_person']);
  assert.ok(!r.tools.some((n) => /contacts__|merge|erase|hide/.test(n)));
  assert.match(r.result, /Gita/, JSON.stringify(r));
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g1@g.us', '41790000401', '!panduga hi');
  assert.deepEqual(t.toolNames(t.claudeReqs.length - 1).filter((n) => n.startsWith('people__')), ['people__find_person', 'people__get_person'], 'participants: find and get');
  // a saved 078 rule "contacts:find_contact" is the people find/get pair
  await t.agents.updateAgent('helper', { tools: { organizer: ['contacts:find_contact'], participant: [], deny: [] } });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g2@g.us', ORG, '!help hi');
  assert.deepEqual(t.toolNames(t.claudeReqs.length - 1).filter((n) => n.startsWith('people__')), ['people__find_person', 'people__get_person']);
  await t.agents.updateAgent('helper', { tools: { organizer: [], participant: [], deny: [] } });
});

test('an agent sees only people from its own chats, plus lists shared with it; Everyone in People widens it; Off removes the tools', async () => {
  let r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__get_person', { person: hari.id });
  assert.ok(r.isError && /may see/.test(r.result), 'Hari wrote only in the helper agent\'s group');
  r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__find_person', { query: 'hari' });
  assert.match(r.result, /Nobody matching/);
  r = await toolTurn('g2@g.us', ORG, '!help', 'people__get_person', { person: hari.id });
  assert.ok(!r.isError && /Hari/.test(r.result), 'the helper agent sees him');
  // a list shared with the agent
  const list = await api('POST', '/api/lists', { name: 'Committee' });
  await api('PUT', `/api/lists/${list.id}/members/${hari.id}`);
  await t.agents.updateAgent('panduga', { peopleLists: [list.id] });
  r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__get_person', { person: hari.id });
  assert.ok(!r.isError && /Hari/.test(r.result), 'a shared list lets the agent see its members');
  await t.agents.updateAgent('panduga', { peopleLists: [] });
  // a phone-only person (never in a chat that is on): only with Everyone in People
  contacts.syncWhatsAppContacts([{ id: jid('41790000409'), name: 'Phone Only Pia' }]);
  const pia = people.personByPhone('41790000409');
  assert.equal(pia.source, 'phone');
  r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__get_person', { person: pia.id });
  assert.ok(r.isError);
  await t.agents.updateAgent('panduga', { peopleAccess: 'everyone' });
  r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__get_person', { person: pia.id });
  assert.ok(!r.isError && /Phone Only Pia/.test(r.result));
  await t.agents.updateAgent('panduga', { peopleAccess: 'off' });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g1@g.us', ORG, '!panduga hi');
  assert.ok(!t.toolNames(t.claudeReqs.length - 1).some((n) => n.startsWith('people__')), 'Off: no people tools');
  assert.ok(!/About the sender/.test(t.userTurn(t.claudeReqs.length - 1)), 'Off: no sender card');
  await t.agents.updateAgent('panduga', { peopleAccess: 'own' });
  assert.equal((await t.api(owner, 'PUT', '/api/agents/panduga', { peopleAccess: 'all' })).status, 400);
});

test('a turn whose sender is the owner gets owner-level access; a member\'s turn in the same group stays scoped', async () => {
  const uid = t.db.db.prepare("SELECT id FROM users WHERE role = 'owner'").get().id;
  t.db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, linked_at) VALUES ('default', ?, '41790000409', 'linked', ?)").run(uid, Date.now());
  let r = await toolTurn('g1@g.us', '41790000409', '!panduga', 'people__find_person', { query: 'hari' });
  assert.match(r.result, /Hari/, 'the owner finds someone outside the group');
  r = await toolTurn('g1@g.us', '41790000401', '!panduga', 'people__find_person', { query: 'hari' });
  assert.match(r.result, /Nobody matching/, 'a member does not');
  t.db.db.prepare('DELETE FROM owner_links WHERE user_id = ?').run(uid);
});

test('the sender card: name, nickname, household, tags and owner/agent notes — never message text; hidden people get none', async () => {
  await api('PUT', `/api/people/${gita.id}`, { nickname: 'Gits' });
  const hh = await api('POST', '/api/households', { name: 'Rao family' });
  await api('PUT', `/api/households/${hh.id}/members/${gita.id}`, { role: 'adult' });
  await api('PUT', `/api/people/${gita.id}/tags`, { tags: ['driver'] });
  await api('POST', `/api/people/${gita.id}/notes`, { text: 'Prefers the 9:10 train' });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g1@g.us', '41790000401', '!panduga when do we leave?', { name: 'Gita' });
  const turn = t.userTurn(t.claudeReqs.length - 1);
  assert.match(turn, /About the sender \(from People[^\n]*: Gita \("Gits"\)/);
  assert.match(turn, /Household: Rao family \(adult\)/);
  assert.match(turn, /Tags: driver/);
  assert.match(turn, /Note \(owner\): Prefers the 9:10 train/);
  const card = turn.slice(turn.indexOf('About the sender'), turn.indexOf('New message from'));
  assert.ok(!/hello from Gita/.test(card), 'no message text in the card');
  await api('PUT', `/api/people/${gita.id}/hidden`, { hidden: true });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g1@g.us', '41790000401', '!panduga again', { name: 'Gita' });
  assert.ok(!/About the sender/.test(t.userTurn(t.claudeReqs.length - 1)));
  const r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__find_person', { query: 'gita' });
  assert.match(r.result, /Nobody matching/, 'hidden people are out of agent tools');
  assert.ok(!(await api('GET', '/api/people?q=gits')).length, 'and out of the list');
  assert.deepEqual((await api('GET', '/api/people?hidden=1')).map((p) => p.id), [gita.id], 'the Hidden filter shows them');
  await api('PUT', `/api/people/${gita.id}/hidden`, { hidden: false });
  assert.ok((await api('GET', '/api/people?q=gits')).length, 'Show again');
});

test('changes to someone else wait for an organizer\'s confirm code; a note about yourself applies at once', async () => {
  let r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__add_note', { person: gita.id, text: 'Brings the speakers' });
  assert.match(r.result, /Held for an organizer's confirmation/);
  const code = t.sent.at(-1).text.match(/confirm ([A-Z0-9]{4})/)[1];
  assert.ok(!people.timeline(gita.id).some((n) => n.text === 'Brings the speakers'));
  await say('g1@g.us', '41790000401', `confirm ${code}`);
  assert.match(t.sent.at(-1).text, /Only organizers/);
  await say('g1@g.us', ORG, `confirm ${code}`);
  assert.match(t.sent.at(-1).text, /Done/);
  const n = people.timeline(gita.id).find((y) => y.text === 'Brings the speakers');
  assert.deepEqual([n.by, n.author], ['agent', 'Panduga']);
  // the organizer tags themselves: no code
  await say('g1@g.us', ORG, 'hello', { name: 'Olga' });
  const olga = people.personByPhone(ORG);
  r = await toolTurn('g1@g.us', ORG, '!panduga', 'people__tag_person', { person: olga.id, add: ['treasurer'] });
  assert.match(r.result, /tags: treasurer/);
  // participants cannot change anyone
  r = await toolTurn('g1@g.us', '41790000401', '!panduga', 'people__add_note', { person: gita.id, text: 'x' });
  assert.ok(r.isError);
});

test('roles are people and lists: an organizer follows the person to Telegram; saved numbers move to people once', async () => {
  const hari2 = people.personByPhone('41790000402');
  const tg = 'tg:bot1#-100777';
  t.chatPrefs.setChatPrefs(tg, { enabled: true });
  await t.agents.updateAgent('helper', { chats: ['g2@g.us', tg], organizers: [ORG, hari2.id] });
  // Hari on Telegram, number verified by the channel: the same person, so an organizer there too
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ channel: 'telegram', chat: tg, phone: '41790000402', senderJid: '9001', senderName: 'Hari TG', text: '!help hi' }));
  assert.match(t.userTurn(t.claudeReqs.length - 1), /\(organizer\)/);
  // a list as organizers
  const committee = await api('POST', '/api/lists', { name: 'Organizers' });
  await t.agents.updateAgent('helper', { organizers: [committee.id] });
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g2@g.us', '41790000402', '!help hi');
  assert.match(t.userTurn(t.claudeReqs.length - 1), /\(participant\)/);
  await api('PUT', `/api/lists/${committee.id}/members/${hari2.id}`);
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g2@g.us', '41790000402', '!help hi');
  assert.match(t.userTurn(t.claudeReqs.length - 1), /\(organizer\)/);
  // the one-time move: saved numbers of people in People become the person; unknown numbers stay
  t.db.db.prepare("DELETE FROM kv WHERE k = 'people.rolesMoved'").run();
  await t.agents.updateAgent('helper', { organizers: ['41790000402', '41790009999'] });
  assert.ok(t.agents.migrateRolesToPeople() >= 1);
  await t.agents.loadAgents();
  assert.deepEqual(t.agents.getAgent('helper').organizers, [hari2.id, '41790009999']);
  assert.equal(t.agents.migrateRolesToPeople(), 0, 'once');
  const pp = await api('GET', '/api/agents/helper/people');
  assert.deepEqual(pp.entries.map((e) => [e.kind, e.label.startsWith('+')]), [['person', false], ['phone', true]], 'a person by name, an unknown number as a number');
  await t.agents.updateAgent('helper', { chats: ['g2@g.us'], organizers: [ORG] });
});

test('consent: the privacy notice is recorded per person (group post, later members, direct messages); unknown = no; editable', async () => {
  t.chatPrefs.setChatPrefs('g5@g.us', { enabled: false });
  await say('g5@g.us', '41790000405', 'before', { name: 'Kiran' }); // off: stores nobody
  assert.equal(people.personByPhone('41790000405'), null);
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent('g5@g.us')}/prefs`, { enabled: true })).status, 200); // the notice is posted
  await say('g5@g.us', '41790000405', 'after', { name: 'Kiran' });
  const kiran = people.personByPhone('41790000405');
  const c = (await api('GET', `/api/people/${kiran.id}`)).consents;
  assert.deepEqual(c.map((y) => [y.purpose, y.value, y.known]), [['privacy_notice', 'yes', true], ['updates', 'no', false], ['marketing', 'no', false]]);
  assert.equal(c[0].source, 'Group notice');
  const after2 = await api('PUT', `/api/people/${kiran.id}/consents`, { purpose: 'updates', value: 'yes' });
  assert.deepEqual([after2.consents[1].value, after2.consents[1].source], ['yes', 'Set by admin']);
  assert.equal((await t.api(owner, 'PUT', `/api/people/${kiran.id}/consents`, { purpose: 'spam', value: 'yes' })).status, 400);
  await tool('set_person_consent', { person: kiran.id, purpose: 'marketing', answer: 'no' });
  assert.equal(access.consentsOf(kiran.id)[2].known, true);
  // a direct message: the notice line once, recorded on the person
  t.script.push([{ type: 'text', text: 'hello' }]);
  await t.route(t.msg({ chat: jid('41790000001'), isGroup: false, phone: ORG, senderJid: jid(ORG), text: 'hi' }));
  assert.match(t.sent.at(-1).text, /stored/);
  assert.equal(access.consentsOf(people.personByPhone(ORG).id)[0].source, 'Direct message notice');
});
const tool = (name, a = {}) => TOOLS.find((y) => y.name === name).run(a, x);

test('members of groups that are on become people (identities only); leaving keeps the person; chats that are off create nobody', async () => {
  resetUpkeep();
  const members = { 'g3@g.us': [{ phone: '41790000501', jid: jid('41790000501') }, { phone: '41790000502', jid: jid('41790000502') }], 'g6@g.us': [{ phone: '41790000503', jid: jid('41790000503') }] };
  t.chatPrefs.setChatPrefs('g6@g.us', { enabled: false });
  const ch = { groupMembers: async (chat) => members[chat] || [], status: async () => ({ numbers: [] }) };
  for (let i = 0; i < 10; i++) await upkeepTick(ch); // two groups per tick
  const m1 = people.personByPhone('41790000501');
  assert.ok(m1 && people.personByPhone('41790000502'), 'members of a group that is on');
  assert.equal(people.personByPhone('41790000503'), null, 'a group that is off: nobody');
  assert.deepEqual(access.chatsOfPerson(m1.id).map((c) => [c.chat, c.member, c.wrote]), [['g3@g.us', true, false]]);
  members['g3@g.us'] = [members['g3@g.us'][1]];
  (await import('../src/core/upkeep.js')).markGroupDue('g3@g.us', 0); // a member change: due first
  await upkeepTick(ch);
  assert.deepEqual(access.chatsOfPerson(m1.id), [], 'left the group: no longer in its chats');
  assert.ok(people.personByPhone('41790000501'), 'the person stays');
});

test('phone contacts become people by themselves: idempotent, hidden people stay hidden; the source filter and the count', async () => {
  const before = (await api('GET', '/api/people/summary')).people;
  contacts.syncWhatsAppContacts([{ id: jid('41790000601'), name: 'Book Bea' }, { id: jid('41790000602'), notify: 'Profile Pat' }]);
  const bea = people.personByPhone('41790000601');
  assert.deepEqual([bea.name, bea.source, bea.lastContact], ['Book Bea', 'phone', null]);
  assert.equal((await api('GET', '/api/people/summary')).people, before + 2, 'the count is everyone');
  assert.equal(access.syncPhonePeople(), 0, 'nothing new');
  contacts.syncWhatsAppContacts([{ id: jid('41790000601'), name: 'Book Bea B' }]);
  assert.equal(people.listPeople({ q: 'Book Bea', limit: 10 }).length, 1, 'the same person, renamed');
  await tool('set_person_hidden', { person: bea.id, hidden: true });
  contacts.syncWhatsAppContacts([{ id: jid('41790000601'), name: 'Book Bea C' }]);
  assert.equal(people.personByPhone('41790000601').hidden, true, 'the sync does not bring a hidden person back');
  assert.ok((await api('GET', '/api/people?source=phone')).every((p) => p.source === 'phone'));
  assert.ok((await api('GET', '/api/people?source=owner')).every((p) => p.source === 'owner'));
  // writing in a chat that is on makes a phone contact a person "from chats"
  await say('g1@g.us', '41790000602', 'hi', { name: 'Pat' });
  assert.equal(people.personByPhone('41790000602').source, 'chat');
});

test('one-time: the chats people wrote in and the notices they saw come from what is stored', async () => {
  t.db.db.prepare('DELETE FROM person_chats').run();
  t.db.db.prepare("DELETE FROM kv WHERE k = 'people.chatsNoted'").run();
  access.migratePeopleChats();
  assert.ok(access.chatsOfPerson(hari.id).some((c) => c.chat === 'g2@g.us' && c.wrote));
  const page = await api('GET', `/api/people/${hari.id}`);
  assert.ok(page.groups.some((g) => g.id === 'g2@g.us'));
  assert.deepEqual(page.agents.map((a) => a.id), ['helper'], 'the agents that can see them');
});
