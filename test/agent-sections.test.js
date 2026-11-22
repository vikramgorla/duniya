// 068: the agent page saves one section at a time (only that section's fields) and Undo puts the previous values
// back. The panel serves the page modules and deep links reach every section.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup } from './harness.js';

let t; let owner; let viewer;
before(async () => {
  t = await setup(); owner = await t.login();
  const r = await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Rides', triggers: ['carpool'], prompt: 'Be brief.', historySize: 30, timezone: 'Europe/Zurich' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await t.api(owner, 'POST', '/api/users', { username: 'vera', role: 'viewer', password: 'viewer-password-123' });
  viewer = await t.login('vera', 'viewer-password-123');
});
after(() => t.close());

const get = async () => (await t.api(owner, 'GET', '/api/agents/rides')).body.config;

test('a section saves only its own fields; the rest of the agent stays as it was', async () => {
  const before0 = await get();
  const r = await t.api(owner, 'PUT', '/api/agents/rides', { triggers: ['rides', '!lift'], respondToMentions: false, dm: 'organizers' }); // "Where it answers"
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const now = await get();
  assert.deepEqual(now.triggers, ['rides', '!lift']);
  assert.equal(now.dm, 'organizers');
  for (const k of ['prompt', 'historySize', 'timezone', 'model', 'memory', 'schedules']) assert.deepEqual(now[k], before0[k], k);
});

test('Undo: putting the previous values of a section back restores it', async () => {
  const prev = await get();
  await t.api(owner, 'PUT', '/api/agents/rides', { name: 'Rides 2', description: 'x', prompt: 'Changed.' }); // "Character"
  await t.api(owner, 'PUT', '/api/agents/rides', { name: prev.name, description: prev.description, prompt: prev.prompt }); // Undo
  const now = await get();
  assert.equal(now.name, prev.name); assert.equal(now.prompt, 'Be brief.');
  assert.deepEqual(now.triggers, prev.triggers);
});

test('viewers can open the page but not save a section', async () => {
  assert.equal((await t.api(viewer, 'GET', '/api/agents/rides')).status, 200);
  assert.equal((await t.api(viewer, 'PUT', '/api/agents/rides', { prompt: 'hacked' })).status, 403);
  assert.equal((await get()).prompt, 'Be brief.');
});

test('the agent page keeps every section reachable', () => {
  const src = readFileSync(new URL('../src/panel/public/app/agent-editor.js', import.meta.url), 'utf8');
  for (const id of ['character', 'where', 'people', 'quick', 'welcome', 'schedules', 'model', 'tools', 'memory', 'media', 'cap', 'alerts', 'advanced', 'test']) assert.match(src, new RegExp(`id: '${id}'`), id);
  const find = readFileSync(new URL('../src/panel/public/app/find.js', import.meta.url), 'utf8');
  assert.match(find, /AGENT_SECTIONS/, 'Find anything lists the sections');
});
