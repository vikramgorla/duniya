// #94: a trigger word wakes the agent anywhere in the message (natural conversation), as a whole word.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner;
before(async () => {
  t = await setup(); owner = await t.login();
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Mochi', triggers: ['mochi'], groupReplies: 'wake' } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: 'g7@g.us', agent: 'mochi' });
});
after(() => t.close());

const answers = async (text) => {
  const n = t.sent.length;
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: 'g7@g.us', text }));
  const replied = t.sent.length > n;
  if (!replied) t.script.pop();
  return replied;
};

test('trigger at the start, in the middle, at the end, any case and punctuation', async () => {
  assert.equal(await answers('mochi what is 2+2?'), true);
  assert.equal(await answers('hey, can Mochi help with homework?'), true);
  assert.equal(await answers('thanks MOCHI!'), true);
});

test('only whole words count', async () => {
  assert.equal(await answers('I ate a mochiko cake'), false);
  assert.equal(await answers('daifukumochi is tasty'), false);
});

test('a trigger in the middle keeps the sentence; at the start it is dropped', async () => {
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: 'g7@g.us', text: 'can mochi explain fractions?' }));
  const asked = JSON.stringify(t.claudeReqs.at(-1)?.messages?.at(-1) || '');
  assert.match(asked, /can mochi explain fractions\?/);
});
