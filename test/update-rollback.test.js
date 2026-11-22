// 095: a release that does not start is rolled back by itself. The start guard on temporary git repositories and
// data folders (no network), the note an update leaves, what the owner is told, the automatic round, and the real
// entry point in a child process.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';

const t = await setup();
after(() => t.close());
const guard = await import('../src/core/update-guard.js');
const u = await import('../src/core/updates.js');
const dec = await import('../src/core/update-decision.js');
const { DATA_DIR } = await import('../src/core/config.js');
const owner = await t.login();

const ROOT = resolve(import.meta.dirname, '..');
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const NOTE = 'update-pending.json'; const RESULT = 'update-rolled-back.json';
const noteIn = (dir) => (existsSync(join(dir, NOTE)) ? JSON.parse(readFileSync(join(dir, NOTE), 'utf8')) : null);
const versionOf = (app) => `v${JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version}`;
const ALERT_PHONE = '41790000007'; const alertDm = `${ALERT_PHONE}@s.whatsapp.net`;
const alerts = () => t.sent.filter((m) => m.chat === alertDm);

/** A remote with v1.0.0 and v1.1.0 (same dependencies); `app` is a clone at v1.0.0. `release(ver)` adds one. */
function makeRepos() {
  const base = mkdtempSync(join(tmpdir(), 'duniya-rb-'));
  const remote = join(base, 'remote.git'); const work = join(base, 'work'); const app = join(base, 'app');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  mkdirSync(join(work, 'deploy'));
  copyFileSync(join(ROOT, 'deploy', 'update.sh'), join(work, 'deploy', 'update.sh'));
  writeFileSync(join(work, 'package-lock.json'), JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x' } } }));
  const release = (ver) => {
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version: ver, private: true }));
    git(work, 'add', '-A'); git(work, 'commit', '-qm', `v${ver}`); git(work, 'tag', `v${ver}`);
    return git(work, 'rev-parse', 'HEAD');
  };
  const commits = { 'v1.0.0': release('1.0.0') };
  git(work, 'remote', 'add', 'origin', remote); git(work, 'push', '-q', 'origin', 'main', '--tags');
  execFileSync('git', ['clone', '-q', remote, app]);
  commits['v1.1.0'] = release('1.1.0');
  git(work, 'push', '-q', 'origin', 'main', '--tags');
  return { app, commits, release: (ver) => { const c = release(ver); git(work, 'push', '-q', 'origin', 'main', '--tags'); return c; } };
}
/** A data folder with the note of an update from `from` (a commit of `app`'s repository); `starts`: tries already counted. */
function notedUpdate(from, { starts = 0, ...extra } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'duniya-rb-data-'));
  guard.noteUpdate(dataDir, { from, fromVersion: 'v1.0.0', to: 'v1.1.0', target: 'v1.1.0', commit: 'c0ffee1', deps: false, backup: null, ...extra });
  if (starts) writeFileSync(join(dataDir, NOTE), JSON.stringify({ ...noteIn(dataDir), starts }));
  return dataDir;
}
/** The server's checkout on a release, as an update leaves it. */
const installed = (app, tag) => { git(app, 'fetch', '-q', 'origin', '--tags'); git(app, 'checkout', '-q', tag); };
/** One start of an installer server. Returns { holds, exits }: what the entry calls after the start, and the exit codes asked for. */
function start(app, dataDir, kind = 'systemd') {
  const exits = [];
  const holds = guard.guardStart({ root: app, dataDir, kind, exit: (code) => exits.push(code) });
  return { holds, exits };
}

test('095: without an update nothing is guarded; Docker and development checkouts never are', () => {
  const { app, commits } = makeRepos();
  const empty = mkdtempSync(join(tmpdir(), 'duniya-rb-data-'));
  assert.deepEqual(start(app, empty).exits, []);
  assert.equal(noteIn(empty), null);
  for (const kind of ['docker', 'dev', 'unknown']) {
    const dataDir = notedUpdate(commits['v1.0.0'], { starts: 3 });
    assert.deepEqual(start(app, dataDir, kind).exits, []);
    assert.equal(noteIn(dataDir).starts, 3, `${kind}: the note is not touched`);
  }
});

test('095: a start after an update counts; up for a minute, the update holds', (tt) => {
  const { app, commits } = makeRepos();
  installed(app, 'v1.1.0');
  const dataDir = notedUpdate(commits['v1.0.0']);
  tt.mock.timers.enable({ apis: ['setTimeout'] });
  const first = start(app, dataDir);
  assert.equal(noteIn(dataDir).starts, 1);
  assert.deepEqual(first.exits, []);
  // the release crashed before it had started: nothing calls holds(); the next start counts again
  const second = start(app, dataDir);
  assert.equal(noteIn(dataDir).starts, 2);
  second.holds(); // the app has started
  tt.mock.timers.tick(59 * 1000);
  assert.equal(noteIn(dataDir).starts, 2, 'not yet: a crash in the first minute still counts');
  tt.mock.timers.tick(1000);
  assert.equal(noteIn(dataDir), null, 'the update holds: nothing is counted any more');
  assert.deepEqual(start(app, dataDir).exits, []);
  assert.equal(versionOf(app), 'v1.1.0');
});

test('095: three starts that did not hold: the fourth puts the previous release back and ends', () => {
  const { app, commits } = makeRepos();
  installed(app, 'v1.1.0');
  const dataDir = notedUpdate(commits['v1.0.0'], { backup: 'duniya-20261122-040000-000.dbk' });
  for (const n of [1, 2, 3]) { assert.deepEqual(start(app, dataDir).exits, []); assert.equal(noteIn(dataDir).starts, n); }
  assert.equal(versionOf(app), 'v1.1.0', 'three tries on the new release');
  const fourth = start(app, dataDir);
  assert.deepEqual(fourth.exits, [1], 'ends, so the service manager starts the previous release');
  assert.equal(git(app, 'rev-parse', 'HEAD'), commits['v1.0.0']);
  assert.equal(versionOf(app), 'v1.0.0');
  assert.equal(noteIn(dataDir), null);
  // the previous release starts: not guarded again, and it reads what happened once
  assert.deepEqual(start(app, dataDir).exits, []);
  const r = guard.takeRollbackResult(dataDir);
  assert.deepEqual([r.ok, r.from, r.to, r.target, r.starts, r.backup], [true, 'v1.1.0', 'v1.0.0', 'v1.1.0', 3, 'duniya-20261122-040000-000.dbk']);
  assert.equal(guard.takeRollbackResult(dataDir), null);
  assert.equal(existsSync(join(dataDir, RESULT)), false);
});

test('095: the previous release put back by hand is left alone: no rollback, no notice', () => {
  const { app, commits } = makeRepos();
  installed(app, 'v1.1.0');
  const dataDir = notedUpdate(commits['v1.0.0'], { starts: 3 });
  git(app, 'checkout', '-q', commits['v1.0.0']); // the owner did it over SSH after three failed starts
  assert.deepEqual(start(app, dataDir).exits, [], 'the start goes on');
  assert.equal(noteIn(dataDir), null);
  assert.equal(guard.takeRollbackResult(dataDir), null, 'nothing to tell: nothing was undone');
});

test('095: dependencies are installed again only when the update changed them; a failing step is tried three times, never for good', () => {
  const { app, commits } = makeRepos();
  const bin = mkdtempSync(join(tmpdir(), 'duniya-rb-bin-'));
  const log = join(bin, 'calls'); const failing = join(bin, 'fail');
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\necho "$@" >> "$NPM_CALLS"\nif [ -f "$NPM_FAILS" ]; then echo "npm ERR! network unreachable" >&2; exit 1; fi\n');
  chmodSync(join(bin, 'npm'), 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  const path = process.env.PATH;
  Object.assign(process.env, { PATH: `${bin}:${path}`, NPM_CALLS: log, NPM_FAILS: failing });
  try {
    installed(app, 'v1.1.0');
    assert.deepEqual(start(app, notedUpdate(commits['v1.0.0'], { starts: 3 })).exits, [1]);
    assert.deepEqual(calls(), [], 'same dependencies: nothing to install');

    installed(app, 'v1.1.0');
    assert.deepEqual(start(app, notedUpdate(commits['v1.0.0'], { starts: 3, deps: true })).exits, [1]);
    assert.deepEqual(calls(), ['ci --omit=dev --prefer-offline --no-audit --no-fund --loglevel=error'], 'from the packages already on the server');

    // the install fails: the next two starts try again, the third gives up and lets the start go on
    installed(app, 'v1.1.0');
    writeFileSync(failing, '');
    const dataDir = notedUpdate(commits['v1.0.0'], { starts: 3, deps: true });
    assert.deepEqual(start(app, dataDir).exits, [1]);
    assert.deepEqual([noteIn(dataDir).undoTries, existsSync(join(dataDir, RESULT))], [1, false]);
    assert.deepEqual(start(app, dataDir).exits, [1]);
    assert.deepEqual(start(app, dataDir).exits, [], 'given up: the start is not held back');
    assert.equal(noteIn(dataDir), null, 'and nothing is tried or counted any more');
    const r = guard.takeRollbackResult(dataDir);
    assert.equal(r.ok, false);
    assert.match(r.error, /network unreachable/);
    assert.equal(calls().length, 4);
  } finally { Object.assign(process.env, { PATH: path }); delete process.env.NPM_CALLS; delete process.env.NPM_FAILS; }
});

test('095: a note that cannot be used is dropped and never reaches git; the start goes on', () => {
  const { app, commits } = makeRepos();
  installed(app, 'v1.1.0');
  const bad = ['not json', '{}', '[]', 'null', JSON.stringify({ from: '--orphan', starts: 3 }), JSON.stringify({ from: `${commits['v1.0.0']}; rm -rf /`, starts: 3 }),
    JSON.stringify({ from: commits['v1.0.0'], starts: '3' }), JSON.stringify({ from: commits['v1.0.0'], starts: -1 })];
  for (const text of bad) {
    const dataDir = mkdtempSync(join(tmpdir(), 'duniya-rb-data-'));
    writeFileSync(join(dataDir, NOTE), text);
    assert.deepEqual(start(app, dataDir).exits, [], text);
    assert.equal(existsSync(join(dataDir, NOTE)), false, `dropped: ${text}`);
  }
  assert.equal(versionOf(app), 'v1.1.0', 'nothing was checked out');
  // a commit that is not in the repository: putting it back fails three times, then the start goes on
  const dataDir = notedUpdate('0123456789abcdef0123456789abcdef01234567', { starts: 3 });
  assert.deepEqual([start(app, dataDir).exits, start(app, dataDir).exits, start(app, dataDir).exits], [[1], [1], []]);
  assert.equal(guard.takeRollbackResult(dataDir).ok, false);
});

test('095: an installed update leaves the note, only on an installer server and only when the code changed', async () => {
  const { app, commits } = makeRepos();
  u._setAppRoot(app, { running: 'v1.0.0' });
  const kind = process.env.DUNIYA_INSTALL;
  try {
    process.env.DUNIYA_INSTALL = 'dev';
    assert.equal((await u.applyUpdate({ target: 'v1.1.0', backup: false })).code, 0);
    assert.equal(noteIn(DATA_DIR), null, 'a development checkout is never guarded');
    git(app, 'checkout', '-q', 'v1.0.0');

    process.env.DUNIYA_INSTALL = 'systemd';
    assert.notEqual((await u.applyUpdate({ target: 'v9.9.9', backup: false })).code, 0, 'an update that fails');
    assert.equal(noteIn(DATA_DIR), null);
    assert.equal((await u.applyUpdate({ target: 'v1.1.0', backup: false })).code, 0);
    const note = noteIn(DATA_DIR);
    assert.deepEqual([note.from, note.fromVersion, note.to, note.target, note.commit, note.deps, note.backup, note.starts],
      [commits['v1.0.0'], 'v1.0.0', 'v1.1.0', 'v1.1.0', commits['v1.1.0'], false, null, 0]);
    assert.ok(Date.now() - note.at < 60000);

    writeFileSync(join(DATA_DIR, NOTE), JSON.stringify({ ...note, starts: 2 }));
    assert.equal((await u.applyUpdate({ target: 'v1.1.0', backup: false })).code, 0, 'already up to date');
    assert.equal(noteIn(DATA_DIR).starts, 2, 'nothing was installed: the note of the last update stands');
  } finally { process.env.DUNIYA_INSTALL = kind ?? ''; if (kind === undefined) delete process.env.DUNIYA_INSTALL; guard.takeRollbackResult(DATA_DIR); }
});

/** An installer server that updated from v1.0.0 to v1.1.0, which did not start: rolled back, and v1.0.0 has started again. */
async function rolledBackServer() {
  const repos = makeRepos();
  u._setAppRoot(repos.app, { running: 'v1.0.0' });
  for (const k of ['updates:rolledBack', 'updates:status', 'updates:report']) t.db.kvSet(k, 'null');
  t.db.kvSet('updates:autoDay', '');
  process.env.DUNIYA_INSTALL = 'systemd';
  await u.checkForUpdate();
  assert.equal((await u.applyUpdate({ target: 'v1.1.0', backup: false })).code, 0);
  for (let n = 0; n < 4; n++) start(repos.app, DATA_DIR);
  assert.equal(versionOf(repos.app), 'v1.0.0');
  assert.equal(u.takeRollback().ok, true);
  return repos;
}

test('095: the owner is told once: Activity, the Updates status and the alert, also when WhatsApp connects later', async () => {
  const kind = process.env.DUNIYA_INSTALL; const { send } = t.channel;
  try {
    const before = t.db.listActivity({ limit: 500 }).length;
    await rolledBackServer();
    const lines = t.db.listActivity({ limit: 500 }).slice(0, -before || undefined).filter((a) => /did not start/.test(a.summary));
    assert.equal(lines.length, 1);
    assert.match(lines[0].summary, /^The update to v1\.1\.0 did not start on this server \(3 tries\) and was rolled back: v1\.0\.0 is running again\. Your data was left as it is\./);
    assert.equal(lines[0].type, 'error');
    const status = (await t.api(owner, 'GET', '/api/updates')).body;
    assert.deepEqual([status.rolledBack.ok, status.rolledBack.from, status.rolledBack.to], [true, 'v1.1.0', 'v1.0.0']);
    assert.equal(status.rolledBack.text, lines[0].summary, 'the same words everywhere');
    assert.deepEqual(Object.keys(status.rolledBack).sort(), ['at', 'backup', 'from', 'ok', 'text', 'to'], 'only what the owner reads');
    assert.equal(u.takeRollback(), null, 'read once');

    // no alert number yet: nothing to send, and it is not tried again
    u.setUpdateSettings({ mode: 'notify' });
    const sent = alerts().length;
    await dec.updateTick();
    assert.equal(alerts().length, sent);
    assert.equal(u.rolledBack().alerted, true);

    // with a number: once, at the first round in which the message goes out
    await rolledBackServer();
    await t.agents.updateAgent('owner-assistant', { alerts: { to: `+${ALERT_PHONE}` } });
    t.channel.send = async () => { throw new Error('WhatsApp is not connected'); }; // still connecting after the start
    await dec.updateTick();
    assert.equal(alerts().length, sent);
    assert.equal(u.rolledBack().alerted, false);
    t.channel.send = send;
    await dec.updateTick();
    await dec.updateTick();
    assert.equal(alerts().length, sent + 1);
    assert.match(alerts().at(-1).text, /The update to v1\.1\.0 did not start on this server[\s\S]*Automatic updates will not install v1\.1\.0 again/);
  } finally { process.env.DUNIYA_INSTALL = kind ?? ''; if (kind === undefined) delete process.env.DUNIYA_INSTALL; t.channel.send = send; }
});

test('095: an update confirmed on WhatsApp that did not start is answered with what happened, and the alert does not repeat it', async () => {
  const kind = process.env.DUNIYA_INSTALL;
  try {
    await rolledBackServer();
    await t.agents.updateAgent('owner-assistant', { alerts: { to: `+${ALERT_PHONE}` } });
    u.setUpdateSettings({ mode: 'notify' });
    t.db.kvSet('updates:report', JSON.stringify({ chat: alertDm, target: 'v1.1.0', from: 'v1.0.0', backup: null, at: Date.now() }));
    const n = alerts().length;
    await dec.updateTick();
    assert.equal(alerts().length, n + 1);
    assert.match(alerts().at(-1).text, /^The update to v1\.1\.0 did not start on this server \(3 tries\) and was rolled back: v1\.0\.0 is running again/);
    await dec.updateTick();
    assert.equal(alerts().length, n + 1, 'said once in that chat');
  } finally { process.env.DUNIYA_INSTALL = kind ?? ''; if (kind === undefined) delete process.env.DUNIYA_INSTALL; }
});

test('095: the automatic round does not install the same release again; a newer one, or Update by hand, goes through', async () => {
  const kind = process.env.DUNIYA_INSTALL;
  try {
    const { app } = await rolledBackServer();
    u.setUpdateSettings({ mode: 'auto', at: '00:00' });
    assert.deepEqual(await dec.updateTick(), { action: 'rolled_back', target: 'v1.1.0' });
    assert.equal(versionOf(app), 'v1.0.0');
    assert.equal(noteIn(DATA_DIR), null);

    // by hand: installed and guarded like any update; when it holds, the notice goes
    assert.equal((await u.applyUpdate({ target: 'v1.1.0', backup: false })).code, 0);
    assert.equal(versionOf(app), 'v1.1.0');
    assert.equal(noteIn(DATA_DIR).starts, 0);
    u._setAppRoot(app, { running: 'v1.1.0' });
    assert.equal(u.takeRollback(), null);
    assert.equal((await t.api(owner, 'GET', '/api/updates')).body.rolledBack, null, 'another version runs: nothing to show');

    // a newer release after a rollback is installed by the automatic round
    const again = await rolledBackServer();
    again.release('1.2.0');
    await u.checkForUpdate();
    const r = await dec.updateTick();
    assert.deepEqual([r.action, r.target], ['updated', 'v1.2.0']);
    assert.equal(versionOf(again.app), 'v1.2.0');
  } finally { process.env.DUNIYA_INSTALL = kind ?? ''; if (kind === undefined) delete process.env.DUNIYA_INSTALL; u.setUpdateSettings({ mode: 'notify' }); guard.takeRollbackResult(DATA_DIR); }
});

/** The real entry point with a data folder of its own: started, then stopped as systemd does. Returns what it printed. */
function startAndStop(dataDir) {
  return new Promise((done, failed) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'],
      { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir, PANEL_PORT: '0', DUNIYA_INSTALL: 'systemd' } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    // started: the heartbeat file is written at the end of the start, when the app also listens for the stop signal
    const up = setInterval(() => { if (existsSync(join(dataDir, 'runtime.json'))) { clearInterval(up); p.kill('SIGTERM'); } }, 100);
    const late = setTimeout(() => { p.kill('SIGKILL'); failed(new Error(`the app did not start in time:\n${out}`)); }, 60000);
    p.on('close', (code) => { clearInterval(up); clearTimeout(late); done({ out, code }); });
  });
}

test('095: the real entry point counts the start and starts the app; a damaged note never keeps it from starting', async () => {
  // The note names the commit that is checked out: even by mistake nothing could be put back here.
  const head = git(ROOT, 'rev-parse', 'HEAD');
  const dataDir = mkdtempSync(join(tmpdir(), 'duniya-rb-entry-'));
  guard.noteUpdate(dataDir, { from: head, fromVersion: 'v0.0.1', to: 'v0.0.2', target: 'v0.0.2', commit: head, deps: false, backup: null });
  const first = await startAndStop(dataDir);
  assert.match(first.out, /Update guard: start 1 of 3 after the update to v0\.0\.2/);
  assert.equal(first.code, 0, first.out);
  assert.equal(noteIn(dataDir).starts, 1, 'stopped within the first minute: the start stays counted');

  writeFileSync(join(dataDir, NOTE), '{ half a note');
  rmSync(join(dataDir, 'runtime.json'));
  const second = await startAndStop(dataDir);
  assert.match(second.out, /Update guard: the note about the last update could not be read and was dropped/);
  assert.equal(second.code, 0, second.out);
  assert.equal(existsSync(join(dataDir, NOTE)), false);
});
