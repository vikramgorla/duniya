// 2.56: schedules and the morning brief are not skipped by a restart or an update in their minute, and a failed run is
// tried again (at most 3 times); each still runs once a day.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t;
before(async () => { t = await setup(); });
after(() => t.close());

test('a daily time is due in its minute and up to 30 minutes after, never before', async () => {
  const { dueAt } = await import('../src/core/config.js');
  assert.equal(dueAt('09:00', '09:00'), true);
  assert.equal(dueAt('09:00', '09:12'), true, 'a restart at 09:00 runs it at 09:12');
  assert.equal(dueAt('09:00', '09:30'), true);
  assert.equal(dueAt('09:00', '09:31'), false);
  assert.equal(dueAt('09:00', '08:59'), false);
});

test('a scheduled post that failed is tried again on the next tick, then runs once a day', async () => {
  const { runSchedule } = await import('../src/core/scheduler.js');
  await t.agents.updateAgent('helper', { schedules: [{ id: 'daily', at: '09:00', days: 'daily', prompt: 'Post the plan', enabled: true }] });
  const agent = t.agents.getAgent('helper');
  const send = t.channel.send; let fail = true;
  t.channel.send = async (...a) => { if (fail) { fail = false; throw new Error('not connected'); } return send(...a); };
  t.script.push([{ type: 'text', text: 'Plan: train at 9:10.' }], [{ type: 'text', text: 'Plan: train at 9:10.' }]);
  assert.equal((await runSchedule(agent, agent.schedules[0], t.channel)).length, 0, 'the first run failed');
  assert.equal((await runSchedule(agent, agent.schedules[0], t.channel)).length, 1, 'tried again');
  assert.equal((await runSchedule(agent, agent.schedules[0], t.channel)).length, 0, 'once a day');
  t.channel.send = send;
});
