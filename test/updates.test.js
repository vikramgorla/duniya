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
  mkdirSync(join(work, 'src', 'core'), { recursive: true }); // update.sh asks the app what is installed
  copyFileSync(resolve(import.meta.dirname, '../src/core/update-guard.js'), join(work, 'src', 'core', 'update-guard.js'));
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

  // A release that changes only its own version and a development tool installs nothing (every release changes the lockfile)
  pkg('1.1.5');
  writeFileSync(join(work, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.1.5', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'x', version: '1.1.5', devDependencies: { tool: '^2.0.0' } }, 'node_modules/tool': { version: '2.0.0', dev: true } } }));
  git(work, 'commit', '-qam', 'v1.1.5'); git(work, 'push', '-q', 'origin', 'main');
  r = await u.applyUpdate({ root: app, target: 'main' });
  assert.equal(r.code, 0, r.log);
  assert.doesNotMatch(r.log, /Dependencies changed/, 'the packages the app runs on are the same');
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '1.1.5');

  // A release with a new package the app runs on installs; its lockfile lacks the package → npm ci fails → code is rolled back
  const before = git(app, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.0', private: true, dependencies: { 'left-pad': '1.0.0' } }));
  writeFileSync(join(work, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.2.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '1.2.0', dependencies: { 'left-pad': '1.0.0' } } } }));
  git(work, 'commit', '-qam', 'broken deps'); git(work, 'push', '-q', 'origin', 'main');
  r = await u.applyUpdate({ root: app, target: 'main' });
  assert.equal(r.code, 1);
  assert.match(r.log, /Dependencies changed, installing…[\s\S]*rolling back/);
  assert.equal(git(app, 'rev-parse', 'HEAD'), before);
});

test('084 update source: shown without credentials, switched to a fork (its tags replace the old ones), refused or put back when wrong', async () => {
  const base = mkdtempSync(join(tmpdir(), 'duniya-src-'));
  const repo = (name, versions) => {
    const work = join(base, `${name}-work`); const bare = join(base, `${name}.git`);
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    for (const v of versions) { writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version: v, note: name })); git(work, 'add', '-A'); git(work, 'commit', '-qm', v); git(work, 'tag', `v${v}`); }
    execFileSync('git', ['clone', '-q', '--bare', work, bare]);
    return bare;
  };
  const upstream = repo('upstream', ['1.0.0']);
  const fork = repo('fork', ['1.0.0', '1.2.0']); // its own v1.0.0 (another commit) and a newer release
  const app = join(base, 'app');
  execFileSync('git', ['clone', '-q', upstream, app]);
  // The "GitHub" repositories are local: git rewrites these URLs (no network; nothing in the app knows)
  git(app, 'config', `url.${fork}.insteadOf`, 'https://github.com/alice/duniya.git');
  git(app, 'config', `url.${join(base, 'missing.git')}.insteadOf`, 'https://github.com/bob/missing.git');
  git(app, 'remote', 'set-url', 'origin', 'https://x-access-token:ghs_SECRET123@github.com/carol/duniya.git');
  u._setAppRoot(app, { running: 'v1.0.0' });
  try {
    const owner = await t.login();
    let g = (await t.api(owner, 'GET', '/api/updates')).body;
    assert.deepEqual(g.source, { url: 'https://github.com/carol/duniya.git', repo: 'carol/duniya', project: JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')).repository.replace('github:', ''), official: false });
    assert.doesNotMatch(JSON.stringify(g), /SECRET123/, 'a token in the remote is never returned');

    for (const bad of ['', 'not a repo', 'https://gitlab.com/alice/duniya', 'alice/duniya; rm -rf /', 'git@github.com:alice/duniya.git']) {
      const r = await t.api(owner, 'PUT', '/api/updates/source', { repo: bad });
      assert.equal(r.status, 400, bad);
      assert.equal(r.body.field, 'repo');
    }
    const missing = await t.api(owner, 'PUT', '/api/updates/source', { repo: 'bob/missing' });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /Could not read bob\/missing on GitHub[\s\S]*The update source was not changed/);
    assert.match(git(app, 'config', '--get', 'remote.origin.url'), /ghs_SECRET123@github\.com\/carol\/duniya/, 'the previous source (with its token) is put back');

    const r = await t.api(owner, 'PUT', '/api/updates/source', { repo: 'https://github.com/alice/duniya' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.source.repo, 'alice/duniya');
    assert.equal(git(app, 'config', '--get', 'remote.origin.url'), 'https://github.com/alice/duniya.git');
    assert.equal(git(app, 'rev-parse', 'v1.0.0'), execFileSync('git', ['--git-dir', fork, 'rev-parse', 'v1.0.0']).toString().trim(), 'the fork\'s tags replace the old source\'s');
    assert.equal(r.body.status.latest, 'v1.2.0');
    assert.equal(r.body.status.available, true);
    g = (await t.api(owner, 'GET', '/api/updates')).body;
    assert.equal(g.source.repo, 'alice/duniya');
    const { listActivity } = await import('../src/core/db.js');
    assert.ok(listActivity({ limit: 20 }).some((a) => a.summary === 'Update source changed to alice/duniya by admin'));
  } finally { u._setAppRoot(null); }
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
