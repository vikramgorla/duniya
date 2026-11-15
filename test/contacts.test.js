// #11: contacts — WhatsApp-synced names + own entries; participants only see shared contacts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup();
const c = await import('../src/core/contacts.js');
const tool = (n) => c.contactsTools.find((x) => x.name === n);
const bot = { id: 'b' };
after(() => t.close());

test('WhatsApp sync stores names but never shares them', () => {
  c.syncWhatsAppContacts([
    { id: '41790000101@s.whatsapp.net', name: 'Anu Phone' },
    { id: '123@lid', phoneNumber: '41790000102@s.whatsapp.net', notify: 'Ravi' },
    { id: '999@lid' }, { id: 'g@g.us', name: 'group' },
  ]);
  const all = c.listContacts();
  assert.deepEqual(all.map((x) => [x.phone, x.name, x.shared, x.source]), [['41790000101', 'Anu Phone', false, 'whatsapp'], ['41790000102', 'Ravi', false, 'whatsapp']]);
});

test('participants find only shared contacts; organizers find all and manage', async () => {
  const org = { bot, role: 'organizer', senderName: 'Org' };
  const pat = { bot, role: 'participant', senderName: 'Pat' };
  assert.match(await tool('find_contact').run({ query: 'anu' }, pat), /No matching contact/);
  assert.equal((await tool('find_contact').run({ query: 'anu' }, org))[0].phone, '+41790000101');
  await tool('save_contact').run({ phone: '+41 79 000 01 01', name: 'Anu', note: 'Drives Tuesdays', shared: true }, org);
  const seen = await tool('find_contact').run({ query: 'tuesdays' }, pat);
  assert.deepEqual(seen, [{ name: 'Anu', phone: '+41790000101', note: 'Drives Tuesdays' }]);
  assert.equal(c.getContact('41790000101').source, 'both');
  await tool('remove_contact').run({ phone: '41790000101' }, org);
  const after = c.getContact('41790000101');
  assert.deepEqual([after.name, after.shared, after.source], ['Anu Phone', false, 'whatsapp']);
});

test('participants do not get the managing tools; panel routes respect roles', async () => {
  assert.deepEqual(c.CONTACTS_DEFAULT_ALLOW.participant, ['contacts:find_contact']);
  const owner = await t.login();
  t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 123' });
  const viewer = await t.login('vic', 'viewer password 123');
  assert.equal((await t.api(owner, 'PUT', '/api/contacts/41790000105', { name: 'Mira', shared: true })).status, 200);
  assert.equal((await t.api(viewer, 'PUT', '/api/contacts/41790000106', { name: 'X' })).status, 403);
  const list = (await t.api(viewer, 'GET', '/api/contacts?q=mira')).body;
  assert.deepEqual(list.map((x) => x.name), ['Mira']);
  assert.equal((await t.api(owner, 'PUT', '/api/contacts/12', { name: 'Bad' })).status, 400);
  assert.equal((await t.api(owner, 'DELETE', '/api/contacts/41790000105')).status, 200);
  assert.equal((await t.api(owner, 'DELETE', '/api/contacts/41790000105')).status, 404);
});
