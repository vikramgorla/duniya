// Feature 008: updates (stable tags / main, rollback), proxy trust, owner-only routes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';

let t; let u;
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

before(async () => { t = await setup(); u = await import('../src/core/updates.js'); });
after(() => t.close());

test('status saved before an update is corrected after the restart (regression)', async () => {
  const { kvSet } = await import('../src/core/db.js');
  kvSet('updates:status', JSON.stringify({ current: 'v0.0.1', latest: u.RUNNING_VERSION, available: true, channel: 'stable', checkedAt: Date.now() }));
  const st = u.updateStatus();
  assert.equal(st.current, u.RUNNING_VERSION);
  assert.equal(st.available, false);
  kvSet('updates:status', JSON.stringify({ current: u.RUNNING_VERSION, latest: 'v99.0.0', available: false, channel: 'stable', checkedAt: Date.now() }));
  assert.equal(u.updateStatus().available, true);
  kvSet('updates:status', 'null');
});

test('auto model choice from any provider list', async () => {
  const { autoPick } = await import('../src/core/providers/index.js');
  const list = [{ id: 'text-embedding-3' }, { id: 'gpt-6-mini' }, { id: 'gpt-6' }, { id: 'whisper-2' }];
  assert.equal(autoPick(list, 'agent'), 'gpt-6');
  assert.equal(autoPick(list, 'background'), 'gpt-6-mini');
  assert.equal(autoPick([{ id: 'tts-1' }], 'agent'), null);
});

test('version helpers', () => {
  assert.equal(u.compareVersions('v1.2.3', 'v1.10.0'), -1);
  assert.equal(u.compareVersions('1.2.3', 'v1.2.3'), 0);
  assert.equal(u.newestTag(['v1.0.0', 'v1.10.0', 'v1.9.9', 'nightly', 'v2.0.0-rc1']), 'v1.10.0');
});

test('stable and main channels update a real checkout; failed dependency install rolls back', async () => {
  const base = mkdtempSync(join(tmpdir(), 'duniya-upd-'));
  const remote = join(base, 'remote.git'); const work = join(base, 'work'); const app = join(base, 'app');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  mkdirSync(join(work, 'deploy'));
  copyFileSync(resolve(import.meta.dirname, '../deploy/update.sh'), join(work, 'deploy', 'update.sh'));
  const pkg = (v) => writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version: v, private: true }));
  pkg('1.0.0');
  writeFileSync(join(work, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '1.0.0' } } }));
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'v1.0.0'); git(work, 'tag', 'v1.0.0');
  git(work, 'remote', 'add', 'origin', remote); git(work, 'push', '-q', 'origin', 'main', '--tags');
  execFileSync('git', ['clone', '-q', remote, app]);

  pkg('1.1.0'); git(work, 'commit', '-qam', 'v1.1.0'); git(work, 'tag', 'v1.1.0');
  writeFileSync(join(work, 'README'), 'unreleased'); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'unreleased work');
  git(work, 'push', '-q', 'origin', 'main', '--tags');

  let st = await u.checkForUpdate({ root: app, channel: 'stable' });
  assert.deepEqual([st.current, st.latest, st.available, st.target], ['v1.0.0', 'v1.1.0', true, 'v1.1.0']);
  let r = await u.applyUpdate({ root: app, target: st.target });
  assert.equal(r.code, 0, r.log);
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '1.1.0');
  st = await u.checkForUpdate({ root: app, channel: 'stable' });
  assert.equal(st.available, false);

  st = await u.checkForUpdate({ root: app, channel: 'main' });
  assert.equal(st.available, true);
  r = await u.applyUpdate({ root: app, target: 'main' });
  assert.equal(r.code, 0, r.log);
  assert.equal(git(app, 'rev-parse', 'HEAD'), git(work, 'rev-parse', 'HEAD'));

  // A release whose lockfile doesn't match package.json → npm ci fails → code is rolled back
  const before = git(app, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.0', private: true, dependencies: { 'left-pad': '1.0.0' } }));
  writeFileSync(join(work, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.2.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '1.2.0' } } }));
  git(work, 'commit', '-qam', 'broken deps'); git(work, 'push', '-q', 'origin', 'main');
  r = await u.applyUpdate({ root: app, target: 'main' });
  assert.equal(r.code, 1);
  assert.match(r.log, /rolling back/);
  assert.equal(git(app, 'rev-parse', 'HEAD'), before);
});

test('update routes are owner only; settings validated', async () => {
  const owner = await t.login();
  await t.api(owner, 'POST', '/api/users', { username: 'adm', role: 'admin', password: 'admin-password-12' });
  const adm = await t.login('adm', 'admin-password-12');
  assert.equal((await t.api(adm, 'GET', '/api/updates')).status, 403);
  const g = (await t.api(owner, 'GET', '/api/updates')).body;
  assert.equal(g.settings.mode, 'notify');
  assert.equal((await t.api(owner, 'PUT', '/api/updates/settings', { mode: 'sometimes' })).status, 400);
  assert.equal((await t.api(owner, 'PUT', '/api/updates/settings', { mode: 'auto', channel: 'main', at: '05:15' })).body.at, '05:15');
});

test('forwarded headers are ignored without TRUST_PROXY (rate limit can’t be dodged)', async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}` }, body: '{"username":"admin","password":"wrong"}' });
    codes.push(r.status);
  }
  assert.ok(codes.includes(429), `got ${codes}`);
  const ok = await fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: '{"username":"admin","password":"correct horse battery"}' });
  assert.ok(ok.status === 429 || !/;\s*Secure/.test(ok.headers.get('set-cookie') || ''), 'no Secure cookie from a spoofed proto header');
});
