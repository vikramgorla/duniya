// #109: the activity log names only the agent fields whose value changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup();
const { changeSummary } = await import('../src/core/agents.js');

const before = { name: 'Rides', triggers: ['duniya'], prompt: 'x'.repeat(500), enabled: true, model: 'a' };

test('only the changed field is named, with old → new for short values', () => {
  assert.equal(changeSummary(before, { ...before, triggers: ['bot', 'duniya'] }), 'Updated triggers: duniya → bot, duniya');
});

test('long or structured values are named without their content', () => {
  assert.equal(changeSummary(before, { ...before, prompt: 'y'.repeat(500) }), 'Updated prompt');
  assert.equal(changeSummary({ ...before, chats: [{ id: 'g1' }] }, { ...before, chats: [{ id: 'g2' }] }), 'Updated chats');
});

test('several changes and no changes', () => {
  assert.equal(changeSummary(before, { ...before, enabled: false, model: '' }), 'Updated enabled: true → false; model: a → (none)');
  assert.equal(changeSummary(before, { ...before }), 'Saved without changes');
  t.close();
});
