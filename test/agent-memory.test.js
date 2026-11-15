// #8: memory for every agent — chat notes plus notes shared by the agent across its chats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup();
const { memoryTools, buildContext } = t.memory;
const tool = (n) => memoryTools.find((x) => x.name === n);
const agent = { id: 'shared-agent', chats: ['g1@g.us', 'g2@g.us'] };
const ctx = (chat, role = 'organizer') => ({ agent, chat, role, senderName: role === 'organizer' ? 'Org' : 'Pat' });

test('organizers share notes across chats; participants cannot', async () => {
  const { saved, scope } = await tool('remember').run({ text: 'Pickup point is the north gate', scope: 'agent' }, ctx('g1@g.us'));
  assert.equal(scope, 'agent');
  await assert.rejects(tool('remember').run({ text: 'plant', scope: 'agent' }, ctx('g1@g.us', 'participant')), /Only organizers/);
  const inOther = await tool('list_notes').run({}, ctx('g2@g.us', 'participant'));
  assert.deepEqual(inOther.map((n) => [n.id, n.scope]), [[saved, 'agent']]);
  assert.match(buildContext({ agent, chat: 'g2@g.us' }), /<agent_memory[^>]*>\n- \[#\d+, [\d-]+\] Pickup point is the north gate/);
});

test('chat notes stay in their chat; find, update and forget work on both scopes', async () => {
  const { saved } = await tool('remember').run({ text: 'Anu brings the car seat' }, ctx('g1@g.us', 'participant'));
  assert.equal((await tool('find_notes').run({ query: 'car seat' }, ctx('g2@g.us'))).length, 0);
  assert.equal((await tool('find_notes').run({ query: 'car seat' }, ctx('g1@g.us'))).length, 1);
  const shared = (await tool('find_notes').run({ query: 'north' }, ctx('g2@g.us')))[0];
  await tool('update_note').run({ id: shared.id, text: 'Pickup point is the south gate' }, ctx('g2@g.us'));
  assert.match((await tool('list_notes').run({}, ctx('g1@g.us')))[0].text, /south gate/);
  await assert.rejects(tool('forget').run({ id: saved }, ctx('g2@g.us')), /No note/);
  assert.deepEqual(await tool('forget').run({ id: saved }, ctx('g1@g.us')), { deleted: true });
});

test('the panel lists an agent\'s shared notes', async () => {
  const cookie = await t.login();
  const agents = (await t.api(cookie, 'GET', '/api/agents')).body;
  const id = (agents.agents || agents)[0].id;
  await tool('remember').run({ text: 'Shared fact', scope: 'agent' }, { ...ctx('g1@g.us'), agent: { id } });
  const r = await t.api(cookie, 'GET', `/api/agents/${id}/memory`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.notes.map((n) => n.text), ['Shared fact']);
  assert.equal((await t.api(cookie, 'GET', '/api/agents/nope/memory')).status, 404);
  t.close();
});
