// 098: automatic OS updates — on by default; once a night after the app's update time the helper installs waiting OS
// updates, then the server restarts when an update asked for it; never while something else runs. Fake helper
// directories and captured apt output (test/fixtures/apt); no real apt or reboot.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';

const FX = resolve(import.meta.dirname, 'fixtures/apt');
const ops = mkdtempSync(join(tmpdir(), 'duniya-osauto-'));
for (const d of ['req', 'state', 'apt']) mkdirSync(join(ops, d));
writeFileSync(join(ops, 'helper'), '#!/bin/sh\n# duniya-ops-version: 3\n');
const APT = join(ops, 'apt');
const REBOOT = join(ops, 'reboot-required');
const REQUEST = join(ops, 'req', 'request');
const STATUS = join(ops, 'state', 'status.json');
const t = await setup({ env: {
  DUNIYA_OPS_HELPER: join(ops, 'helper'), DUNIYA_OPS_REQUEST_DIR: join(ops, 'req'), DUNIYA_OPS_STATE_DIR: join(ops, 'state'),
  DUNIYA_FAKE_APT: APT, DUNIYA_REBOOT_REQUIRED_FILE: REBOOT, TZ_DEFAULT: 'UTC',
} });
const { osAutoTick } = await import('../src/core/os-auto.js');
const { kvSet } = await import('../src/core/db.js');
const owner = await t.login();
after(() => t.close());

const at = (day, hh, mm) => Date.UTC(2026, 10, day, hh, mm);
const waiting = (yes) => writeFileSync(join(APT, 'simulate.txt'), yes ? readFileSync(join(FX, 'sim-full-upgrade-phased-held.txt'), 'utf8') : '');
const requested = () => (existsSync(REQUEST) ? readFileSync(REQUEST, 'utf8').trim() : null);
const helperDone = () => { rmSync(REQUEST, { force: true }); writeFileSync(STATUS, JSON.stringify({ action: 'os-update', state: 'done', code: 0, startedAt: 1, endedAt: 2 })); };
beforeEach(async () => {
  helperDone(); rmSync(REBOOT, { force: true });
  kvSet('os:autoInstall', ''); kvSet('os:autoRestart', '');
  writeFileSync(join(APT, 'policy.txt'), readFileSync(join(FX, 'policy.txt'), 'utf8'));
  writeFileSync(join(APT, 'holds.txt'), 'docker-ce\n');
  await t.api(owner, 'PUT', '/api/updates/settings', { os: 'auto', at: '04:00' });
});

test('098 on by default: the OS updates card shows the night window; off and back on; bad values refused', async () => {
  const fresh = (await import('../src/core/updates.js')).getUpdateSettings;
  assert.equal(fresh().os, 'auto');
  assert.deepEqual((await t.api(owner, 'GET', '/api/system/ops')).body.auto, { on: true, from: '04:30', until: '07:30' });
  assert.equal((await t.api(owner, 'PUT', '/api/updates/settings', { os: 'off' })).body.os, 'off');
  assert.equal((await t.api(owner, 'GET', '/api/system/ops')).body.auto.on, false);
  const bad = await t.api(owner, 'PUT', '/api/updates/settings', { os: 'sometimes' });
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'os');
});

test('098 a night: outside the window nothing; in it the updates install, then one restart; nothing more that night', async () => {
  waiting(true);
  assert.equal((await osAutoTick(at(24, 4, 10))).action, 'later', 'the app update comes first');
  assert.equal((await osAutoTick(at(24, 12, 0))).action, 'later', 'never in the day');
  assert.equal(requested(), null);
  const r = await osAutoTick(at(24, 4, 40));
  assert.deepEqual(r, { action: 'installing', count: 3 });
  assert.equal(requested(), 'os-update');
  const logged = (await t.api(owner, 'GET', '/api/activity?limit=5')).body;
  assert.ok(logged.some((e) => e.summary === 'Install OS updates requested by automatic OS updates'));
  writeFileSync(STATUS, JSON.stringify({ action: 'os-update', state: 'running', startedAt: Date.now() }));
  assert.equal((await osAutoTick(at(24, 4, 50))).action, 'busy', 'waits for the helper');
  helperDone(); writeFileSync(REBOOT, '*** System restart required ***\n');
  assert.equal((await osAutoTick(at(24, 5, 0))).action, 'restarting');
  assert.equal(requested(), 'reboot');
  helperDone(); // the server is back; the restart file would stay if a new kernel came later
  assert.equal((await osAutoTick(at(24, 5, 10))).action, 'none', 'once a night');
});

test('098 nothing waiting and no restart needed: nothing runs; a restart left from a manual install happens at night', async () => {
  waiting(false);
  assert.equal((await osAutoTick(at(24, 4, 40))).action, 'none');
  assert.equal(requested(), null);
  writeFileSync(REBOOT, 'x');
  assert.equal((await osAutoTick(at(24, 4, 50))).action, 'restarting');
});

test('098 off, or a window across midnight counted as one night', async () => {
  waiting(true);
  await t.api(owner, 'PUT', '/api/updates/settings', { os: 'off' });
  assert.equal((await osAutoTick(at(24, 4, 40))).action, 'off');
  await t.api(owner, 'PUT', '/api/updates/settings', { os: 'auto', at: '23:00' });
  assert.equal((await osAutoTick(at(24, 23, 40))).action, 'installing');
  helperDone();
  assert.equal((await osAutoTick(at(25, 0, 20))).action, 'none', 'after midnight it is still the same night');
});

test('098 admin MCP: set_os_auto_updates asks before switching on, not before switching off', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const tool = TOOLS.find((x) => x.name === 'set_os_auto_updates');
  assert.equal(tool.risky({ on: true }), true); assert.equal(tool.risky({ on: false }), false);
  const calls = [];
  const x = { call: async (m, p, b) => { calls.push([m, p, b]); return p === '/api/system/ops' ? { auto: { from: '04:30', until: '07:30' } } : {}; } };
  assert.match(await tool.preview({ on: true }, x), /between 04:30 and 07:30/);
  await tool.run({ on: false }, x);
  assert.deepEqual(calls.at(-1), ['PUT', '/api/updates/settings', { os: 'off' }]);
  assert.match(TOOLS.find((y) => y.name === 'get_maintenance_status').description, /set_os_auto_updates/);
});
