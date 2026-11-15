// 045 (#57): breaking releases need the owner's confirmation. Real git repositories in temp dirs, fake WhatsApp.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
after(() => t.close());
const u = await import('../src/core/updates.js');
const dec = await import('../src/core/update-decision.js');
const rel = await import('../src/core/releases.js');
const backup = await import('../src/core/backup/index.js');
const { setOwnerNumber } = await import('../src/core/owner-alerts.js');
const owner = await t.login();

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const OWNER_PHONE = '41790000001'; const ALERT_PHONE = '41790000007';
const ownerDm = `${OWNER_PHONE}@s.whatsapp.net`; const alertDm = `${ALERT_PHONE}@s.whatsapp.net`;
const sentTo = (chat) => t.sent.filter((m) => m.chat === chat);
const appVersion = (app) => JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;

const RELEASES = { versions: {
  '1.2.0': { breaking: true, title: 'New storage', summary: 'Chats move to a new table.', actions: ['Re-run the installer'], data: 'not-migrated', docs: 'docs/upgrading.md#x' },
  '1.1.0': { breaking: false, title: 'Small things', summary: '', actions: [] },
} };

/** remote with v1.0.0, v1.1.0, v1.2.0 (marked breaking), v1.3.0 and v2.0.0 (major, no entry); app cloned at v1.0.0. */
function makeRepos() {
  const base = mkdtempSync(join(tmpdir(), 'duniya-brk-'));
  const remote = join(base, 'remote.git'); const work = join(base, 'work'); const app = join(base, 'app');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  mkdirSync(join(work, 'deploy'));
  copyFileSync(resolve(import.meta.dirname, '../deploy/update.sh'), join(work, 'deploy', 'update.sh'));
  writeFileSync(join(work, 'package-lock.json'), JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x' } } }));
  const release = (ver, releases = null) => {
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version: ver, private: true }));
    if (releases) writeFileSync(join(work, 'releases.json'), JSON.stringify(releases));
    git(work, 'add', '-A'); git(work, 'commit', '-qm', `v${ver}`); git(work, 'tag', `v${ver}`);
  };
  release('1.0.0');
  git(work, 'remote', 'add', 'origin', remote); git(work, 'push', '-q', 'origin', 'main', '--tags');
  execFileSync('git', ['clone', '-q', remote, app]);
  release('1.1.0', RELEASES); release('1.2.0', RELEASES); release('1.3.0', RELEASES); release('2.0.0', RELEASES);
  git(work, 'push', '-q', 'origin', 'main', '--tags');
  return { app, work };
}

test('045: breaking detection — major bump, marked minor, safe target (pure)', () => {
  const releases = rel.normalizeReleases(RELEASES);
  const versions = ['v1.0.0', 'v1.1.0', 'v1.2.0', 'v1.3.0', 'v2.0.0'];
  let a = rel.analyzeJump({ current: 'v1.0.0', target: 'v2.0.0', versions, releases });
  assert.equal(a.breaking, true);
  assert.deepEqual(a.steps.map((s) => s.version), ['1.2.0', '2.0.0']);
  assert.equal(a.steps[0].title, 'New storage');
  assert.deepEqual(a.steps[0].actions, ['Re-run the installer']);
  assert.equal(a.steps[1].major, true, 'major bump without an entry is still breaking');
  assert.equal(a.safeTarget, 'v1.1.0');
  assert.equal(a.decisionVersion, '2.0.0');
  a = rel.analyzeJump({ current: 'v1.0.0', target: 'v1.1.0', versions: ['v1.1.0'], releases });
  assert.deepEqual([a.breaking, a.safeTarget], [false, 'v1.1.0']);
  a = rel.analyzeJump({ current: 'v1.2.0', target: 'v1.3.0', versions, releases });
  assert.deepEqual([a.breaking, a.safeTarget], [false, 'v1.3.0'], 'already past the breaking release');
  a = rel.analyzeJump({ current: 'v1.1.0', target: 'v1.3.0', versions, releases });
  assert.deepEqual([a.breaking, a.safeTarget], [true, null], 'nothing safe left');
  // hostile file shapes are dropped
  assert.deepEqual(rel.normalizeReleases({ versions: { nope: {}, '1.0.0': 'x', '3.0.0': { breaking: 'yes', docs: 'javascript:alert(1)' } } }), { '3.0.0': { breaking: false, title: '', summary: '', actions: [], data: '', docs: '' } });
});

test('045: CI rule and release notes', () => {
  const releases = rel.normalizeReleases({ versions: { '3.0.0': { breaking: true, title: 'Big', summary: 'S', actions: ['Do X'] }, '2.9.0': { breaking: false, title: 'Small' } } });
  assert.deepEqual(rel.releaseCheck({ version: '3.0.0', previous: 'v2.9.0', releases }).errors, []);
  assert.match(rel.releaseCheck({ version: '4.0.0', previous: 'v3.0.0', releases }).errors[0], /new major version/);
  assert.match(rel.releaseCheck({ version: '3.0.0', previous: 'v2.9.0', releases: rel.normalizeReleases({ versions: { '3.0.0': { breaking: true } } }) }).errors[0], /no actions/);
  assert.match(rel.releaseCheck({ version: '2.9.1', previous: 'v2.9.0', releases }).errors[0], /no entry/, 'every version needs an entry (#71)');
  assert.match(rel.releaseCheck({ version: '2.9.1', previous: '', releases }).errors[0], /no entry/, 'also without a release tag');
  assert.match(rel.releaseCheck({ version: '2.9.1', previous: 'v2.9.0', releases: rel.normalizeReleases({ versions: { '2.9.1': { breaking: false } } }) }).errors[0], /no title/);
  assert.deepEqual(rel.releaseCheck({ version: '2.9.0', previous: 'v2.8.2', releases }), { errors: [], warnings: [] });
  assert.match(rel.releaseNotes(releases, 'v3.0.0'), /Breaking release[\s\S]*### Big[\s\S]*- Do X/);
  assert.equal(rel.releaseNotes(releases, 'v1.0.0'), '');
  // the repository's own file is valid and passes for the current version
  const own = rel.normalizeReleases(JSON.parse(readFileSync(resolve(import.meta.dirname, '../releases.json'), 'utf8')));
  assert.equal(own['2.0.0'].breaking, true);
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')).version;
  assert.deepEqual(rel.releaseCheck({ version: pkg, previous: 'v2.8.2', releases: own }).errors, []);
  assert.ok(own[pkg], `releases.json has an entry for ${pkg}`);
});

test('045: auto mode installs the safe release (backup first), announces the breaking one once, never crosses it', async () => {
  const { app } = makeRepos();
  u._setAppRoot(app, { running: 'v1.0.0' });
  backup.setPassphrase('pre-update passphrase 123');
  setOwnerNumber(`+${ALERT_PHONE}`);
  // the owner linked the owner assistant; an admin too (admins never get update codes)
  await import('../src/core/owner-assistant.js');
  t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
  t.db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, linked_at) SELECT 'default', id, ?, 'linked', ? FROM users WHERE username = ?").run(OWNER_PHONE, Date.now(), 'admin');
  t.db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, linked_at) SELECT 'default', id, ?, 'linked', ? FROM users WHERE username = ?").run('41790000003', Date.now(), 'ada');
  u.setUpdateSettings({ mode: 'auto', at: '00:00', keepPreUpdate: 2 });

  const st = await u.checkForUpdate();
  assert.deepEqual([st.available, st.breaking, st.safeTarget, st.decisionVersion], [true, true, 'v1.1.0', '2.0.0']);
  const restarts = t.restarts;
  const r = await dec.updateTick();
  assert.deepEqual([r.action, r.target], ['updated', 'v1.1.0']);
  assert.equal(appVersion(app), '1.1.0');
  assert.equal(t.restarts, restarts + 1);
  assert.equal(backup.listPreUpdate().length, 1, 'backup made before the update');
  assert.match(u.updateStatus().lastResult.backup, /^duniya-\d{8}-\d{6}\.dbk$/);

  // notified once: alert number + the linked owner (with a code), never the admin
  const toOwner = sentTo(ownerDm);
  assert.equal(toOwner.length, 1);
  assert.match(toOwner[0].text, /v2\.0\.0 needs your decision[\s\S]*v1\.2\.0: New storage[\s\S]*- Re-run the installer[\s\S]*confirm [A-Z2-9]{4}\* to update to v2\.0\.0 — a backup is made first/);
  assert.equal(sentTo(alertDm).length, 1);
  assert.doesNotMatch(sentTo(alertDm)[0].text, /confirm/);
  assert.equal(sentTo('41790000003@s.whatsapp.net').length, 0);
  assert.ok(t.db.listActivity({ limit: 50 }).some((a) => /v2\.0\.0 needs your decision/.test(a.summary)));

  // after the restart (now on 1.1.0): nothing safe left, no second notice, nothing installed
  u._setAppRoot(app, { running: 'v1.1.0' });
  t.db.kvSet('updates:autoDay', '');
  const r2 = await dec.updateTick();
  assert.equal(r2.action, 'waiting');
  assert.equal(appVersion(app), '1.1.0');
  assert.equal(sentTo(ownerDm).length, 1, 'deduped');
  assert.equal(sentTo(alertDm).length, 1, 'deduped');

  // notify mode: same notice, never installs
  u.setUpdateSettings({ mode: 'notify' });
  assert.equal((await dec.updateTick()).action, 'none');
  assert.equal(appVersion(app), '1.1.0');
});

test('045: panel — decision, 409 without confirmation, snooze re-notifies after 7 days, dismiss', async () => {
  let g = (await t.api(owner, 'GET', '/api/updates')).body;
  assert.equal(g.decision.version, 'v2.0.0');
  assert.equal(g.decision.target, 'v2.0.0');
  assert.equal(g.decision.show, true);
  assert.deepEqual(g.decision.steps.map((s) => s.version), ['1.2.0', '2.0.0']);
  assert.equal(g.backup, true);
  const ap = await t.api(owner, 'POST', '/api/updates/apply', {});
  assert.equal(ap.status, 409);
  assert.match(ap.body.error, /v2\.0\.0 needs your decision/);
  const adm = await t.login('ada', 'admin password 123');
  assert.equal((await t.api(adm, 'POST', '/api/updates/apply', { breaking: true })).status, 403, 'owners only');

  assert.equal((await t.api(owner, 'POST', '/api/updates/decision', { action: 'later' })).status, 400);
  const sn = (await t.api(owner, 'POST', '/api/updates/decision', { action: 'snooze' })).body;
  assert.equal(sn.show, false);
  assert.ok(sn.snoozedUntil > Date.now() + 6 * 86400000);
  const before = sentTo(alertDm).length;
  assert.equal(await dec.announceBreaking(undefined, Date.now() + 86400000), false, 'still snoozed');
  assert.equal(await dec.announceBreaking(undefined, Date.now() + 8 * 86400000), true, 'reminded after 7 days');
  assert.equal(sentTo(alertDm).length, before + 1);
  g = (await t.api(owner, 'GET', '/api/updates')).body;
  assert.equal(g.decision.show, true);
  await t.api(owner, 'POST', '/api/updates/decision', { action: 'dismiss' });
  assert.equal((await t.api(owner, 'GET', '/api/updates')).body.decision.show, false);
  assert.equal(await dec.announceBreaking(undefined, Date.now() + 30 * 86400000), false, 'dismissed: no more reminders');
});

test('045: WhatsApp confirm — backup → update → restart, result reported after the restart', async () => {
  const code = /confirm ([A-Z2-9]{4})/.exec(sentTo(ownerDm).at(-1).text)[1];
  const msg = (phone, text) => t.msg({ isGroup: false, chat: `${phone}@s.whatsapp.net`, phone, senderName: 'Vik', text });
  // someone else's linked number can't use it
  await t.route(msg('41790000003', `confirm ${code}`));
  assert.match(sentTo('41790000003@s.whatsapp.net').at(-1).text, /belongs to another person/);
  const app = u.updateRoot();
  const restarts = t.restarts;
  const pre = backup.listPreUpdate();
  await t.route(msg(OWNER_PHONE, `confirm ${code.toLowerCase()}`));
  assert.match(sentTo(ownerDm).at(-1).text, /^Starting: backup, then update to v2\.0\.0/);
  await t.waitFor(() => t.restarts > restarts, 20000);
  assert.equal(appVersion(app), '2.0.0');
  assert.equal(backup.listPreUpdate().length, 2, 'a second pre-update backup');
  assert.ok(pre.every((f) => backup.listPreUpdate().includes(f)));
  assert.equal(JSON.parse(t.db.kvGet('updates:report')).chat, ownerDm);
  // the code is single-use
  await t.route(msg(OWNER_PHONE, `confirm ${code}`));
  assert.match(sentTo(ownerDm).at(-1).text, /unknown or expired/);
  // "restart": now running 2.0.0, the report goes out once
  u._setAppRoot(app, { running: 'v2.0.0' });
  assert.equal(await dec.deliverUpdateReport(), true);
  assert.match(sentTo(ownerDm).at(-1).text, /^✓ Updated to v2\.0\.0 \(from v1\.1\.0\)\. Everything restarted\. Backup made first: duniya-/);
  assert.equal(await dec.deliverUpdateReport(), false);
  assert.equal((await t.api(owner, 'GET', '/api/updates')).body.decision, null, 'nothing waiting any more');
});

test('045: panel confirm (no backup when unticked); pre-update backups keep the last N', async () => {
  const app = u.updateRoot();
  git(app, 'checkout', '-q', 'refs/tags/v1.1.0');
  u._setAppRoot(app, { running: 'v1.1.0' });
  await u.checkForUpdate();
  const restarts = t.restarts;
  const pre = backup.listPreUpdate();
  const r = await t.api(owner, 'POST', '/api/updates/apply', { breaking: true, backup: false });
  assert.equal(r.body.started, true);
  await t.waitFor(() => t.restarts > restarts, 20000);
  assert.equal(appVersion(app), '2.0.0');
  assert.deepEqual(backup.listPreUpdate(), pre, 'no backup when unticked');
  assert.ok(t.db.listActivity({ limit: 50 }).some((a) => /confirmed by admin.*without a backup/.test(a.summary)));

  // retention: keepPreUpdate = 2
  for (let i = 0; i < 2; i++) await u.preUpdateBackup({ target: 'vX' });
  const kept = backup.listPreUpdate();
  assert.equal(kept.length, 2);
  assert.ok(!existsSync(join(backup.LOCAL_DIR, pre[0])), 'oldest pre-update backup removed');
  assert.ok(backup.listLocal().filter((b) => b.preUpdate).length === 2);
  // admin MCP tool: apply_update previews the safe target / refuses without breaking
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  assert.ok(TOOLS.find((x) => x.name === 'snooze_update_decision'));
  assert.ok(TOOLS.find((x) => x.name === 'apply_update').input.breaking);
});
