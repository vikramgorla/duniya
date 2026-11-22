// The owner's clock (src/core/owner-clock.js): the owner assistant's time zone, else the server's default. One clock
// for the whole server: agents without a time zone of their own, the months of spending caps, the times of automatic
// updates and backups, daily limits and the days of the usage chart go by it, not by the server's zone or by UTC.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
const owner = await t.login();
after(() => t.close());
const clock = await import('../src/core/owner-clock.js');
const budget = await import('../src/core/budget.js');
const { slotFor } = await import('../src/core/backup/index.js');
const { zoneOffset } = await import('../src/core/config.js');
const ownerZone = (timezone) => t.agents.updateAgent('owner-assistant', { timezone });
const HOUR = 3600 * 1000;

test('the owner assistant\'s time zone is the owner\'s clock; an agent without a zone of its own follows it', async () => {
  assert.equal(clock.ownerTz(), 'Europe/Zurich', 'the server\'s default until the owner sets one');
  await ownerZone('Asia/Kolkata');
  assert.equal(clock.ownerTz(), 'Asia/Kolkata');
  assert.equal(clock.ownerDay(Date.parse('2027-01-10T20:00:00Z')), '2027-01-11', '01:30 on the 11th in Kolkata');
  assert.equal(clock.agentTz({ timezone: '' }), 'Asia/Kolkata');
  assert.equal(clock.agentTz({ timezone: 'America/New_York' }), 'America/New_York');
  const view = (await t.api(owner, 'GET', '/api/agents/panduga')).body;
  assert.deepEqual(view.clock, { yours: 'Asia/Kolkata', server: 'Europe/Zurich' }, 'the editor shows whose clock an empty field means');
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ chat: 'g1@g.us', phone: '41790000002', senderName: 'Anu', text: '!panduga what time is it?' }));
  assert.match(t.claudeReqs.at(-1).system, /Current time: [^\n]*\(Asia\/Kolkata\)/, 'the agent is told the owner\'s time');
  await ownerZone('');
});

test('offsets: whole hours, half hours, three quarters, summer time', () => {
  const at = Date.parse('2027-01-10T12:00:31Z');
  assert.deepEqual(['Europe/Zurich', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/St_Johns', 'UTC'].map((z) => zoneOffset(z, at) / HOUR), [1, 5.5, 5.75, -3.5, 0]);
  assert.equal(zoneOffset('Europe/Zurich', Date.parse('2027-07-10T12:00:00Z')) / HOUR, 2);
});

test('spending-cap months, backup slots and the automatic update\'s time go by the owner\'s clock', async () => {
  const lateJan = Date.parse('2027-01-31T19:00:00Z'); // 20:00 in Zurich, 00:30 on 1 February in Kolkata
  assert.equal(budget.monthOf(lateJan).key, '2027-01');
  const daily = { schedule: 'daily', at: '03:30', weekday: 0 };
  assert.equal(slotFor(daily, new Date('2027-01-10T22:10:00Z')), '2027-01-10', '23:10 in Zurich: today\'s backup is due');
  await ownerZone('Asia/Kolkata');
  try {
    const feb = budget.monthOf(lateJan);
    assert.deepEqual([feb.key, feb.from], ['2027-02', Date.parse('2027-01-31T18:30:00Z')], 'February began at midnight in Kolkata');
    assert.equal(slotFor(daily, new Date('2027-01-10T21:50:00Z')), null, '03:20 on the 11th in Kolkata: not yet');
    assert.equal(slotFor(daily, new Date('2027-01-10T22:10:00Z')), '2027-01-11', '03:40 in Kolkata: the backup of the 11th');

    // an update is waiting (no git needed: the last check is stored) and updates are automatic at 04:00
    const u = await import('../src/core/updates.js');
    const dec = await import('../src/core/update-decision.js');
    u.setUpdateSettings({ mode: 'auto', at: '04:00' });
    const next = `v${u.runningVersion().replace(/^v/, '').split('.')[0]}.9999.0`; // a later release of the same major: nothing to decide
    const waiting = (now) => t.db.kvSet('updates:status', JSON.stringify({ current: u.runningVersion(), currentVersion: u.runningVersion(), latest: next, available: true, target: next, targetVersion: null,
      tags: [next], releases: {}, channel: 'stable', checkedAt: now.getTime(), lastResult: null }));
    const early = new Date('2027-01-10T22:00:00Z'); // 03:30 on the 11th in Kolkata (23:00 on the 10th in Zurich)
    waiting(early); t.db.kvSet('updates:autoDay', '');
    assert.deepEqual(await dec.updateTick({ now: early }), { action: 'later', target: next }, 'before 04:00 where the owner lives');
    const done = new Date('2027-01-10T23:00:00Z'); // 04:30 on the 11th in Kolkata; the 11th was already done
    waiting(done); t.db.kvSet('updates:autoDay', '2027-01-11');
    assert.deepEqual(await dec.updateTick({ now: done }), { action: 'later', target: next }, 'once on the owner\'s day');
    u.setUpdateSettings({ mode: 'notify' });
    t.db.kvSet('updates:status', 'null');
  } finally { await ownerZone(''); }
});
