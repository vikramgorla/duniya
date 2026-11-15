// #96: OS updates — full-upgrade (kept-back kernels install), Ubuntu phased updates respected but explained (with an
// option to include them), grouped package list, run summary, restart-needed banner and weekly line.
// Captured apt outputs live in test/fixtures/apt/ (owner-upgrade.txt is the owner's report). No real apt runs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, utimesSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';

const ROOT = resolve(import.meta.dirname, '..');
const FX = join(ROOT, 'test/fixtures/apt');
const fx = (f) => readFileSync(join(FX, f), 'utf8');
const HELPER = join(ROOT, 'deploy/ops/duniya-ops');

const ops = mkdtempSync(join(tmpdir(), 'duniya-osupd-'));
for (const d of ['req', 'state', 'apt']) mkdirSync(join(ops, d));
writeFileSync(join(ops, 'helper'), '#!/bin/sh\n'); // an old helper (no version line)
writeFileSync(join(ops, 'apt', 'simulate.txt'), fx('sim-full-upgrade-phased-held.txt'));
writeFileSync(join(ops, 'apt', 'policy.txt'), fx('policy.txt'));
writeFileSync(join(ops, 'apt', 'holds.txt'), 'docker-ce\n');
const REBOOT = join(ops, 'reboot-required');
const t = await setup({ env: {
  DUNIYA_OPS_HELPER: join(ops, 'helper'), DUNIYA_OPS_REQUEST_DIR: join(ops, 'req'), DUNIYA_OPS_STATE_DIR: join(ops, 'state'),
  DUNIYA_FAKE_APT: join(ops, 'apt'), DUNIYA_REBOOT_REQUIRED_FILE: REBOOT,
} });
const sys = await import('../src/core/system.js');
const owner = await t.login();
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vera', 'viewer password 123');
after(() => t.close());

test('#96 parsers: the owner\'s apt upgrade output — snapd deferred by phasing, kernel meta-packages kept back', () => {
  const l = sys.parseAptLists(fx('owner-upgrade.txt'));
  assert.deepEqual(l.phased, ['snapd']);
  assert.deepEqual(l.keptBack, ['linux-headers-oracle', 'linux-image-oracle', 'linux-oracle']);
  assert.deepEqual(l.summary, { upgraded: 0, installed: 0, removed: 0, notUpgraded: 4 });
  const r = sys.parseAptRun(fx('owner-upgrade.txt')); // an old helper's log (no step markers)
  assert.equal(sys.runSummaryText(r, { rebootRequired: false }), 'Nothing new to install · 1 rolling out gradually · 3 held back');
});

test('#96 parsers: a non-root simulation ignores phasing, so apt-cache policy marks snapd as rolling out; kernels install', () => {
  const sim = sys.parseAptSimulation(fx('sim-full-upgrade-nonroot.txt'));
  assert.equal(sim.inst.length, 8);
  assert.deepEqual(sim.summary, { upgraded: 4, installed: 4, removed: 0, notUpgraded: 0 });
  const pol = sys.parseAptPolicy(fx('policy.txt'));
  assert.deepEqual(pol.snapd, { installed: '2.77+ubuntu24.04', candidate: '2.78+ubuntu24.04', phased: 20 });
  assert.equal(pol['linux-oracle'].phased, null);
  assert.equal(pol['docker-ce'].installed, '5:28.5.1-1~ubuntu.24.04~noble');
  const g = sys.classifyUpdates(sim, pol, []);
  assert.deepEqual(g.phased.map((p) => [p.name, p.phased]), [['snapd', 20]]);
  assert.deepEqual(g.install.filter((p) => !p.isNew).map((p) => p.name).sort(), ['linux-headers-oracle', 'linux-image-oracle', 'linux-oracle']);
  assert.equal(g.install.filter((p) => p.isNew).length, 4, 'the new kernel packages');
  assert.ok(g.install.every((p) => p.security));
  assert.deepEqual(g.held, []);
});

test('#96 parsers: phasing applied + a held package; apt 3 layout; security updates are never phased', () => {
  const sim = sys.parseAptSimulation(fx('sim-full-upgrade-phased-held.txt'));
  const g = sys.classifyUpdates(sim, sys.parseAptPolicy(fx('policy.txt')), ['docker-ce']);
  assert.deepEqual(g.install.map((p) => p.name), ['libssl3t64', 'openssl', 'tzdata']);
  assert.deepEqual(g.phased.map((p) => [p.name, p.from, p.to]), [['snapd', '2.77+ubuntu24.04', '2.78+ubuntu24.04']]);
  assert.deepEqual(g.held.map((p) => [p.name, p.reason]), [['docker-ce', 'hold']]);
  assert.match(g.held[0].why, /apt-mark hold/);
  const conflict = sys.classifyUpdates(sim, {}, []);
  assert.equal(conflict.held[0].reason, 'dependencies');

  const a3 = sys.parseAptSimulation(fx('sim-apt3.txt'));
  assert.deepEqual(a3.phased, ['snapd']); assert.deepEqual(a3.keptBack, ['docker-ce']);
  assert.deepEqual(a3.upgrade, ['curl', 'libcurl4t64']);
  assert.deepEqual(a3.summary, { upgraded: 2, installed: 0, removed: 0, notUpgraded: 2 });
  const sec = sys.classifyUpdates(a3, { curl: { installed: 'a', candidate: 'b', phased: 10 } }, []);
  assert.ok(sec.install.some((p) => p.name === 'curl'), 'a security update installs even while phased');
});

test('#96 parsers: summary of a full run from the helper log', () => {
  const r = sys.parseAptRun(fx('run-full-upgrade.log'));
  assert.equal(r.installed, 3); assert.equal(r.newPackages, 4); assert.equal(r.removed, 4);
  assert.deepEqual(r.phased, ['snapd']); assert.equal(r.failed, false); assert.equal(r.phasedIncluded, false);
  assert.equal(sys.runSummaryText(r), 'Installed 3 updates · 4 new packages · 4 old packages removed · 1 rolling out gradually · restart needed');
  assert.equal(sys.runSummaryText(sys.parseAptRun(fx('run-full-upgrade.log').replace('code 0', 'code 100'))).split(' · ')[0], 'Did not finish');
});

test('#96 API: grouped list, badge counts only what installs, restart status, last run summary, gradual option gated by helper version', async () => {
  const u = (await t.api(owner, 'GET', '/api/system/os-updates?refresh=1')).body;
  assert.equal(u.supported, true);
  assert.equal(u.count, 3); assert.equal(u.security, 2);
  assert.deepEqual([u.install.length, u.phased.length, u.held.length], [3, 1, 1]);
  const st = (await t.api(owner, 'GET', '/api/status')).body;
  assert.deepEqual(st.osUpdates, { count: 3, security: 2, at: u.at, restart: false });
  assert.equal((await t.api(viewer, 'GET', '/api/status')).body.osUpdates, null, 'viewers do not see it');
  assert.equal((await t.api(viewer, 'GET', '/api/system/os-updates')).status, 403);

  // a finished run and a pending restart
  writeFileSync(join(ops, 'state', 'last.log'), fx('run-full-upgrade.log'));
  writeFileSync(join(ops, 'state', 'status.json'), JSON.stringify({ action: 'os-update', state: 'done', code: 0, startedAt: 1, endedAt: 2 }));
  writeFileSync(REBOOT, '*** System restart required ***\n');
  writeFileSync(`${REBOOT}.pkgs`, 'linux-image-6.8.0-1035-oracle\nlinux-base\nlinux-base\n');
  const o = (await t.api(owner, 'GET', '/api/system/ops')).body;
  assert.match(o.result.text, /^Installed 3 updates · .* · restart needed$/);
  assert.equal(o.reboot.required, true); assert.equal(o.reboot.kernel, true);
  assert.deepEqual(o.reboot.packages, ['linux-image-6.8.0-1035-oracle', 'linux-base']);
  assert.equal(o.helperVersion, 1); assert.equal(o.helperCurrent, false);
  const snap = (await t.api(owner, 'GET', '/api/system')).body;
  assert.equal(snap.rebootRequired, true); assert.equal(snap.reboot.kernel, true);
  assert.equal((await t.api(owner, 'GET', '/api/status')).body.osUpdates.restart, true);

  // old helper: including gradual updates is refused with what to do; the plain update still works
  const r1 = await t.api(owner, 'POST', '/api/system/ops', { action: 'os-update-all' });
  assert.equal(r1.status, 400); assert.match(r1.body.error, /sudo duniya update/);
  writeFileSync(join(ops, 'helper'), '#!/bin/bash\n# duniya-ops-version: 2\n');
  assert.equal((await t.api(owner, 'GET', '/api/system/ops')).body.helperCurrent, true);
  const r2 = await t.api(owner, 'POST', '/api/system/ops', { action: 'os-update-all' });
  assert.equal(r2.status, 200);
  assert.equal(readFileSync(join(ops, 'req', 'request'), 'utf8'), 'os-update-all\n');
  rmSync(REBOOT); rmSync(`${REBOOT}.pkgs`);
});

test('#96 weekly summary: one line when a restart has waited more than 7 days', async () => {
  const weekly = await import('../src/core/weekly.js');
  assert.equal(weekly.weeklyData().restart, null);
  writeFileSync(REBOOT, 'x'); writeFileSync(`${REBOOT}.pkgs`, 'linux-image-6.8.0-1035-oracle\n');
  assert.equal(weekly.weeklyData().restart, null, 'not after a day');
  const old = (Date.now() - 9 * 86400000) / 1000; utimesSync(REBOOT, old, old);
  const d = weekly.weeklyData();
  assert.deepEqual(d.restart, { days: 9, kernel: true });
  assert.match(weekly.weeklyText(d), /the server has waited 9 days for a restart to finish OS updates \(new kernel\)/);
  rmSync(REBOOT); rmSync(`${REBOOT}.pkgs`);
});

test('#96 admin MCP: run_maintenance offers os-update-all; list_os_updates explains the groups', async () => {
  const { TOOLS: ADMIN_TOOLS } = await import('../src/panel/admin-tools.js');
  const run = ADMIN_TOOLS.find((x) => x.name === 'run_maintenance');
  assert.ok(run.input.action.enum.includes('os-update-all'));
  assert.match(ADMIN_TOOLS.find((x) => x.name === 'list_os_updates').description, /phased.*held/s);
});

// ---------- the root helper with a stubbed apt-get / dpkg ----------
function helperRun(action, { failUpgrade = false, reboot = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'duniya-ops-apt-'));
  for (const s of ['req', 'state', 'bin']) mkdirSync(join(d, s));
  const stub = (name, body) => { writeFileSync(join(d, 'bin', name), `#!/bin/bash\n${body}\n`); chmodSync(join(d, 'bin', name), 0o755); };
  stub('apt-get', `echo "apt-get NEEDRESTART_MODE=$NEEDRESTART_MODE DEBIAN_FRONTEND=$DEBIAN_FRONTEND $*" >> "${d}/calls"
case " $* " in *" full-upgrade "*) ${failUpgrade ? 'exit 100' : `cat "${join(FX, 'run-full-upgrade.log')}" | sed -n '/step: full-upgrade/,/step: autoremove/p' | sed '1d;$d'`} ;; esac`);
  stub('dpkg', `echo "dpkg $*" >> "${d}/calls"`);
  if (reboot) writeFileSync(join(d, 'reboot-required'), 'x');
  writeFileSync(join(d, 'req', 'request'), `${action}\n`);
  execFileSync('bash', [HELPER], { env: { ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}`, DUNIYA_OPS_REQUEST_DIR: join(d, 'req'),
    DUNIYA_OPS_STATE_DIR: join(d, 'state'), DUNIYA_REBOOT_REQUIRED_FILE: join(d, 'reboot-required') }, stdio: 'pipe' });
  const calls = existsSync(join(d, 'calls')) ? readFileSync(join(d, 'calls'), 'utf8') : '';
  return { calls, log: readFileSync(join(d, 'state', 'last.log'), 'utf8'), status: JSON.parse(readFileSync(join(d, 'state', 'status.json'), 'utf8')) };
}

test('#96 helper: os-update runs update, dpkg recovery, full-upgrade (phasing respected), autoremove --purge; log has step markers', () => {
  const r = helperRun('os-update', { reboot: true });
  assert.equal(r.status.state, 'done', r.log);
  const lines = r.calls.trim().split('\n');
  assert.match(lines[0], /^apt-get NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive -y -q -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold update$/);
  assert.match(lines[1], /^dpkg --force-confdef --force-confold --configure -a$/);
  assert.match(lines[2], / full-upgrade$/); assert.doesNotMatch(lines[2], /Phased/);
  assert.match(lines[3], / autoremove --purge$/);
  assert.match(lines[4], / clean$/);
  assert.doesNotMatch(r.calls, / upgrade$/m, 'never plain apt-get upgrade');
  const sum = sys.parseAptRun(r.log);
  assert.equal(sys.runSummaryText(sum), 'Installed 3 updates · 4 new packages · 1 rolling out gradually · restart needed');
});

test('#96 helper: os-update-all includes phased updates; a failed upgrade stops before autoremove and is reported', () => {
  const all = helperRun('os-update-all');
  assert.match(all.calls, /-o APT::Get::Always-Include-Phased-Updates=true full-upgrade/);
  assert.equal(sys.parseAptRun(all.log).phasedIncluded, true);
  const bad = helperRun('os-update', { failUpgrade: true });
  assert.equal(bad.status.state, 'failed');
  assert.doesNotMatch(bad.calls, /autoremove/);
  assert.equal(sys.parseAptRun(bad.log).failed, true);
});
