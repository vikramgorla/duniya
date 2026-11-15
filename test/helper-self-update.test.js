// 056 (#107): the root maintenance helper updates itself from a release (action update-helper), so owners without SSH
// never need `sudo duniya update`. The real helper script runs against a local bare repository (DUNIYA_OPS_* test
// overrides) with a stubbed systemctl: no network, no root, nothing outside temp directories.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';

const ROOT = resolve(import.meta.dirname, '..');
const HELPER = join(ROOT, 'deploy/ops/duniya-ops');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const helperText = readFileSync(HELPER, 'utf8');
const BUNDLED = Number(helperText.match(/^# duniya-ops-version: (\d+)$/m)[1]);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
const git = (dir, ...args) => sh('git', ['-C', dir, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args]);

// ---------- a fake "official repository": releases with their deploy/ops files ----------
const base = mkdtempSync(join(tmpdir(), 'duniya-helper-'));
const work = join(base, 'work');
const bare = join(base, 'bare.git');
mkdirSync(join(work, 'deploy/ops'), { recursive: true });
mkdirSync(join(work, 'docs'), { recursive: true });
sh('git', ['init', '-q', '-b', 'main', work]);
function release(tag, { version = BUNDLED, marker = tag, broken = false, drop = '' } = {}) {
  for (const f of ['duniya-ops', 'duniya-ops.service', 'duniya-ops.path', 'webconfig.mjs']) copyFileSync(join(ROOT, 'deploy/ops', f), join(work, 'deploy/ops', f));
  let h = helperText.replace(/^# duniya-ops-version: \d+$/m, `# duniya-ops-version: ${version}\n# release-marker: ${marker}`);
  if (broken) h += '\nif then fi\n';
  writeFileSync(join(work, 'deploy/ops/duniya-ops'), h);
  writeFileSync(join(work, 'deploy/ops/webconfig.mjs'), `// webconfig of ${marker}\n`);
  writeFileSync(join(work, 'docs/big.bin'), `${marker}\n`.repeat(1000));
  if (drop) rmSync(join(work, 'deploy/ops', drop));
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', `release ${tag}`);
  git(work, 'tag', '-a', tag, '-m', tag);
}
release('v2.16.0', { version: 2 });
release('v2.17.0');
release('v2.18.0', { version: BUNDLED + 1 });
release('v2.19.0', { version: BUNDLED - 1 });
release('v2.20.0', { broken: true });
release('v2.21.0', { drop: 'webconfig.mjs' });
sh('git', ['clone', '-q', '--bare', work, bare]);
git(bare, 'config', 'uploadpack.allowFilter', 'true');

/** A server with the current helper installed; run one action with the request file the app would write. */
function server() {
  const d = mkdtempSync(join(base, 'srv-'));
  for (const s of ['req', 'state', 'sbin', 'units', 'lib', 'bin']) mkdirSync(join(d, s));
  writeFileSync(join(d, 'bin/systemctl'), `#!/bin/bash\necho "systemctl $*" >> "${d}/calls"\n`);
  chmodSync(join(d, 'bin/systemctl'), 0o755);
  copyFileSync(HELPER, join(d, 'sbin/duniya-ops'));
  writeFileSync(join(d, 'lib/webconfig.mjs'), '// old\n');
  const run = (version, { request = 'update-helper', repo = `file://${bare}` } = {}) => {
    if (version !== null) writeFileSync(join(d, 'req/helper-version'), `${version}\n`);
    writeFileSync(join(d, 'req/request'), `${request}\n`);
    try { rmSync(join(d, 'calls')); } catch { /* none yet */ }
    sh('bash', [join(d, 'sbin/duniya-ops')], { env: { PATH: `${join(d, 'bin')}:${process.env.PATH}`, DUNIYA_OPS_REQUEST_DIR: join(d, 'req'), DUNIYA_OPS_STATE_DIR: join(d, 'state'),
      DUNIYA_OPS_REPO: repo, DUNIYA_OPS_SBIN: join(d, 'sbin/duniya-ops'), DUNIYA_OPS_UNIT_DIR: join(d, 'units'), DUNIYA_OPS_WEBCONFIG: join(d, 'lib/webconfig.mjs'),
      DUNIYA_OPS_INSTALL_CONF: join(d, 'install.conf'), DUNIYA_OPS_APP_ENV: join(d, 'app.env') } });
    return {
      status: JSON.parse(readFileSync(join(d, 'state/status.json'), 'utf8')), log: readFileSync(join(d, 'state/last.log'), 'utf8'),
      calls: existsSync(join(d, 'calls')) ? readFileSync(join(d, 'calls'), 'utf8') : '',
      helper: readFileSync(join(d, 'sbin/duniya-ops'), 'utf8'), webconfig: readFileSync(join(d, 'lib/webconfig.mjs'), 'utf8'),
      release: existsSync(join(d, 'state/helper-release')) ? readFileSync(join(d, 'state/helper-release'), 'utf8').trim() : null,
      requestLeft: existsSync(join(d, 'req/helper-version')), srcLeft: existsSync(join(d, 'state/src')),
    };
  };
  return { d, run };
}

test('056 helper: update-helper installs deploy/ops of the requested release, reloads systemd, records the release', () => {
  const s = server();
  const r = s.run('v2.18.0');
  assert.equal(r.status.state, 'done', r.log);
  assert.equal(r.status.action, 'update-helper');
  assert.match(r.helper, /# release-marker: v2\.18\.0/);
  assert.match(r.helper, new RegExp(`^# duniya-ops-version: ${BUNDLED + 1}$`, 'm'));
  assert.equal(r.webconfig, '// webconfig of v2.18.0\n');
  assert.ok(existsSync(join(s.d, 'units/duniya-ops.service')) && existsSync(join(s.d, 'units/duniya-ops.path')));
  assert.equal(r.calls, 'systemctl daemon-reload\nsystemctl enable -q --now duniya-ops.path\n');
  assert.equal(r.release, 'v2.18.0');
  assert.equal(r.requestLeft, false, 'the request file is consumed');
  assert.equal(r.srcLeft, false, 'the root-owned working copy is removed afterwards');
  assert.match(r.log, /== step: fetch[\s\S]*== step: check[\s\S]*== step: install/);
  // The same release again changes nothing and does not reload systemd.
  const again = s.run('v2.18.0');
  assert.equal(again.status.state, 'done');
  assert.equal(again.calls, '');
  assert.match(again.log, /already the one of v2\.18\.0/);
});

test('056 helper: only strict vX.Y.Z is accepted from the app; nothing else is fetched or echoed', () => {
  const s = server();
  for (const bad of ['v2.17', 'main', '2.17.0', 'v2.17.0-rc1', '$(id)', '../v2.17.0']) {
    const r = s.run(bad);
    assert.equal(r.status.state, 'failed', bad);
    assert.match(r.log, /Refused: the requested version is not a release number/);
    assert.doesNotMatch(r.log, /Fetching/);
    assert.ok(!r.log.includes('$(id)'));
  }
  const none = s.run(null);
  assert.equal(none.status.state, 'failed');
  const odd = s.run('v2.17.0', { request: 'update-helper; reboot' }); // not an exact action word: ignored
  assert.deepEqual(odd.status, none.status);
  assert.equal(odd.calls, '');
});

test('056 helper: no downgrades — older than the first self-updating release, than the last installed, or a lower helper version', () => {
  const s = server();
  const old = s.run('v2.16.0');
  assert.equal(old.status.state, 'failed');
  assert.match(old.log, /v2\.16\.0 is older than v2\.17\.0/);
  assert.equal(s.run('v2.18.0').status.state, 'done');
  const back = s.run('v2.17.0');
  assert.equal(back.status.state, 'failed');
  assert.match(back.log, /v2\.17\.0 is older than v2\.18\.0 \(the helper is never downgraded\)/);
  assert.match(back.helper, /release-marker: v2\.18\.0/, 'unchanged');
  const lower = s.run('v2.19.0');
  assert.equal(lower.status.state, 'failed');
  assert.match(lower.log, new RegExp(`helper version ${BUNDLED - 1}, older than this one \\(${BUNDLED + 1}\\)`));
});

test('056 helper: a missing tag, a helper that does not parse or missing files change nothing', () => {
  const s = server();
  const before = readFileSync(join(s.d, 'sbin/duniya-ops'), 'utf8');
  const missing = s.run('v9.9.9');
  assert.equal(missing.status.state, 'failed');
  assert.match(missing.log, /Could not fetch v9\.9\.9/);
  const broken = s.run('v2.20.0');
  assert.equal(broken.status.state, 'failed');
  assert.match(broken.log, /does not look right/);
  const partial = s.run('v2.21.0');
  assert.equal(partial.status.state, 'failed');
  assert.match(partial.log, /has no deploy\/ops\/webconfig\.mjs/);
  assert.equal(readFileSync(join(s.d, 'sbin/duniya-ops'), 'utf8'), before);
  assert.equal(readFileSync(join(s.d, 'lib/webconfig.mjs'), 'utf8'), '// old\n');
  assert.equal(missing.calls + broken.calls + partial.calls, '');
});

test('056 helper: git as root is locked down (https only with TLS checks, no hooks, clean environment, one tag, blobless)', () => {
  const fn = helperText.slice(helperText.indexOf('update_helper() {'), helperText.indexOf('rollback() {'));
  assert.match(fn, /-c http\.sslVerify=true/);
  assert.match(fn, /protocol\.allow=never -c protocol\.https\.allow=always/);
  assert.match(fn, /core\.hooksPath=\/dev\/null/);
  assert.match(fn, /env -i PATH=\/usr\/local\/bin:\/usr\/bin:\/bin HOME="\$src" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(fn, /fetch -q --depth 1 --filter=blob:none --no-tags origin "\+refs\/tags\/\$tag:refs\/tags\/\$tag"/);
  assert.doesNotMatch(fn, /APP_DIR|\/opt\/whatsapp-agent-duniya/, 'never reads the app checkout');
  // Repository: root-owned install config (https only) or the official one; the app can only name a release.
  const repo = helperText.slice(helperText.indexOf('helper_repo() {'), helperText.indexOf('update_helper() {'));
  assert.match(repo, /\^https:\/\//);
  assert.match(helperText, /^OFFICIAL_REPO=https:\/\/github\.com\/vikramgorla\/whatsapp-agent-duniya\.git$/m);
});

// ---------- the app side ----------
const ops = mkdtempSync(join(base, 'app-'));
for (const s of ['req', 'state']) mkdirSync(join(ops, s));
const installHelper = (v) => writeFileSync(join(ops, 'helper'), v ? `#!/bin/bash\n# duniya-ops-version: ${v}\n` : '#!/bin/sh\n');
installHelper(2);
const t = await setup({ env: { DUNIYA_OPS_HELPER: join(ops, 'helper'), DUNIYA_OPS_REQUEST_DIR: join(ops, 'req'), DUNIYA_OPS_STATE_DIR: join(ops, 'state') } });
const sys = await import('../src/core/system.js');
const { updateSettings } = await import('../src/core/store.js');
const owner = await t.login();
after(() => { t.close(); rmSync(base, { recursive: true, force: true }); });
const clearReq = () => { for (const f of ['request', 'helper-version']) rmSync(join(ops, 'req', f), { force: true }); };

test('056 app: a helper older than the self-updating one cannot be asked; the panel says run once or reinstall', async () => {
  installHelper(2);
  const st = (await t.api(owner, 'GET', '/api/system/ops')).body;
  assert.equal(st.helperBundled, BUNDLED);
  assert.equal(st.helperOutdated, true);
  assert.equal(st.helperSelfUpdate, false);
  const r = await t.api(owner, 'POST', '/api/system/ops', { action: 'update-helper' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'helper_too_old');
  assert.match(r.body.error, /run sudo duniya update on the server once, or reinstall if you have no SSH access/);
  assert.equal(existsSync(join(ops, 'req/request')), false);
  assert.deepEqual(sys.maybeUpdateHelper(), { requested: false, reason: 'too_old' });
  const html = readFileSync(join(ROOT, 'src/panel/public/index.html'), 'utf8');
  assert.match(html, /cannot update itself yet\. Run ', h\('code', \{\}, 'sudo duniya update'\)/);
  assert.match(html, /No SSH access \(for example an Oracle server created without an SSH key\)\? Reinstall instead/);
  assert.match(html, /upgrading\.md#the-maintenance-helper/);
  assert.match(html, /'Update maintenance helper'/);
});

test('056 app: update-helper writes only the action word and this release number; owner only', async () => {
  installHelper(BUNDLED);
  clearReq();
  const st = (await t.api(owner, 'GET', '/api/system/ops')).body;
  assert.equal(st.helperSelfUpdate, true);
  assert.equal(st.helperOutdated, false);
  t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 1234' });
  const admin = await t.login('ada', 'admin password 1234');
  assert.equal((await t.api(admin, 'POST', '/api/system/ops', { action: 'update-helper' })).status, 403);
  const r = await t.api(owner, 'POST', '/api/system/ops', { action: 'update-helper' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(readFileSync(join(ops, 'req/request'), 'utf8'), 'update-helper\n');
  assert.equal(readFileSync(join(ops, 'req/helper-version'), 'utf8'), `v${PKG}\n`);
  assert.match(sys.appVersion(), /^v\d+\.\d+\.\d+$/);
  clearReq();
});

test('056 app: after an app update the helper is asked to update itself once per version, only when it is older', async () => {
  installHelper(BUNDLED);
  clearReq();
  assert.deepEqual(sys.maybeUpdateHelper(), { requested: false, reason: 'current' });
  // This release ships a newer helper than the installed (self-updating) one.
  installHelper(3);
  updateSettings({ opsHelperAuto: null });
  assert.deepEqual(sys.maybeUpdateHelper({ bundled: 4 }), { requested: true });
  assert.equal(readFileSync(join(ops, 'req/request'), 'utf8'), 'update-helper\n');
  assert.equal(readFileSync(join(ops, 'req/helper-version'), 'utf8'), `v${PKG}\n`);
  clearReq();
  assert.deepEqual(sys.maybeUpdateHelper({ bundled: 4 }), { requested: false, reason: 'already tried' }, 'a failed fetch is not retried in a loop');
  assert.equal(existsSync(join(ops, 'req/request')), false);
});

test('056 admin MCP: run_maintenance offers update-helper and get_maintenance_status explains the helper fields', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const run = TOOLS.find((x) => x.name === 'run_maintenance');
  assert.ok(run.risky);
  assert.ok(run.input.action.enum.includes('update-helper'));
  assert.match(TOOLS.find((x) => x.name === 'get_maintenance_status').description, /helperSelfUpdate/);
});
