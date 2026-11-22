// Backups and restore when things go wrong: a restore interrupted at start carries on (and never keeps the app from
// starting), a scheduled backup that fails is tried again and the owner hears about it, and work files of a backup
// that was cut short are cleaned up.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './harness.js';

const t = await setup();
const owner = await t.login();
const backup = await import('../src/core/backup/index.js');
const { applyPendingRestore, takeRestoreResult } = await import('../src/core/restore-apply.js');

// ---------- a storage service that can be down ----------
const store = { down: 0, puts: [] };
// ---------- a GitHub that never answers ----------
const hung = { asked: 0 };
const silentGitHub = http.createServer(() => { hung.asked++; /* no answer */ }).listen(0);
const storage = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  if (req.method === 'PUT' && store.down > 0) { store.down--; res.writeHead(503); return res.end('<Error><Code>SlowDown</Code></Error>'); }
  if (req.method === 'PUT') { store.puts.push(decodeURIComponent(new URL(req.url, 'http://x').pathname)); res.writeHead(200); return res.end(); }
  res.writeHead(200); res.end('<ListBucketResult></ListBucketResult>');
}).listen(0);
after(() => { storage.close(); silentGitHub.closeAllConnections(); silentGitHub.close(); t.close(); });

const put = (dir, files) => { for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), text); } };
const read = (dir, name) => readFileSync(join(dir, name), 'utf8');
const FILES = ['duniya.sqlite', 'master.key', 'whatsapp-auth/creds.json'];
const OLD = { 'duniya.sqlite': 'old database', 'master.key': 'old key', 'whatsapp-auth/creds.json': 'old session' };
const NEW = { 'duniya.sqlite': 'new database', 'master.key': 'new key', 'whatsapp-auth/creds.json': 'new session' };
const dataDir = () => mkdtempSync(join(tmpdir(), 'duniya-restore-'));

test('a restore that was cut off while moving the old data aside carries on at the next start', () => {
  const dir = dataDir();
  put(dir, { 'master.key': OLD['master.key'], 'whatsapp-auth/creds.json': OLD['whatsapp-auth/creds.json'] }); // the database already moved
  put(join(dir, 'pre-restore-100'), { 'duniya.sqlite': OLD['duniya.sqlite'] });
  put(join(dir, 'restore-pending'), { ...NEW, 'manifest.json': JSON.stringify({ source: 'local:x.dbk', files: FILES, keep: 'pre-restore-100', phase: 'aside' }) });
  assert.ok(applyPendingRestore(dir));
  for (const f of FILES) { assert.equal(read(dir, f), NEW[f], `${f} is restored`); assert.equal(read(join(dir, 'pre-restore-100'), f), OLD[f], `${f} from before is kept`); }
  assert.ok(!existsSync(join(dir, 'restore-pending')));
  assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('pre-restore-')), ['pre-restore-100'], 'one folder with the previous data');
});

test('a restore that was cut off while putting files in place never moves the restored database aside', () => {
  const dir = dataDir();
  put(dir, { 'duniya.sqlite': NEW['duniya.sqlite'] }); // already in place
  put(join(dir, 'pre-restore-200'), OLD);
  put(join(dir, 'restore-pending'), { 'master.key': NEW['master.key'], 'whatsapp-auth/creds.json': NEW['whatsapp-auth/creds.json'],
    'manifest.json': JSON.stringify({ source: 'local:x.dbk', files: FILES, keep: 'pre-restore-200', phase: 'place' }) });
  assert.ok(applyPendingRestore(dir));
  for (const f of FILES) { assert.equal(read(dir, f), NEW[f]); assert.equal(read(join(dir, 'pre-restore-200'), f), OLD[f]); }
  const { at, ...result } = takeRestoreResult(dir);
  assert.deepEqual(result, { ok: true, source: 'local:x.dbk', files: 3, keep: 'pre-restore-200' });
  assert.ok(at > 0);
});

test('a staged restore that cannot be read is dropped: the app starts with its data and says what happened, once', () => {
  const dir = dataDir();
  put(dir, OLD);
  put(join(dir, 'restore-pending'), { ...NEW, 'manifest.json': '{"source":"local:x.dbk","files":["duniya.sq' });
  assert.equal(applyPendingRestore(dir), null, 'no error: the app must start');
  for (const f of FILES) assert.equal(read(dir, f), OLD[f], 'nothing changed');
  assert.ok(!existsSync(join(dir, 'restore-pending')), 'not tried again at every start');
  const r = takeRestoreResult(dir);
  assert.equal(r.ok, false); assert.ok(r.error);
  assert.equal(takeRestoreResult(dir), null, 'told once');
  assert.equal(applyPendingRestore(dir), null);
});

test('a scheduled backup whose copy off the server fails is tried again without a second backup; after three tries the owner is told', async () => {
  t.store.setSecret('BACKUP_PASSPHRASE', 'a long backup passphrase');
  t.store.setSecret('S3_ACCESS_KEY_ID', 'AKTEST'); t.store.setSecret('S3_SECRET_ACCESS_KEY', 'secret-key');
  backup.updateBackupSettings({ enabled: true, schedule: 'hourly', s3: { enabled: true, endpoint: `http://127.0.0.1:${storage.address().port}`, bucket: 'bk', prefix: 'duniya/' } });
  assert.equal((await t.api(owner, 'PUT', '/api/agents/owner-assistant', { alerts: { to: '+41 79 111 22 33' } })).status, 200);
  const local = () => readdirSync(backup.LOCAL_DIR).filter((f) => f.endsWith('.dbk'));
  const hour = 3600 * 1000; const t0 = Math.ceil(Date.now() / hour) * hour + 60000; // one minute into the next hour's slot
  store.down = 1;
  const first = await backup.backupTick({ now: t0 });
  assert.deepEqual([first.tries, first.done, first.local], [1, false, true]);
  assert.match(first.problem, /s3: S3 PUT 503/);
  assert.equal(local().length, 1);
  assert.equal(await backup.backupTick({ now: t0 + 60000 }), null, 'not again a minute later');
  const second = await backup.backupTick({ now: t0 + 11 * 60000 });
  assert.deepEqual([second.tries, second.done], [2, true], 'the copy went through on the second try');
  assert.equal(local().length, 1, 'the same backup, copied again');
  assert.deepEqual(store.puts, [`/bk/duniya/${local()[0]}`]);
  assert.equal(backup.lastBackup().results.s3, 'ok');
  assert.equal(await backup.backupTick({ now: t0 + 30 * 60000 }), null, 'done for this slot');

  // the next slot: the storage stays down for all three tries
  store.down = 99; t.sent.length = 0;
  const t1 = t0 + hour;
  for (const [i, at] of [t1, t1 + 11 * 60000, t1 + 22 * 60000].entries()) assert.equal((await backup.backupTick({ now: at })).tries, i + 1);
  assert.equal(await backup.backupTick({ now: t1 + 40 * 60000 }), null, 'three tries, then it waits for the next slot');
  await t.waitFor(() => t.sent.length);
  assert.equal(t.sent.length, 1, 'one message to the owner');
  assert.match(t.sent[0].text, /scheduled backup failed 3 times \(s3: S3 PUT 503[^)]*\)\. The copy on the server was made; the copy off the server is missing/);
  assert.equal(local().length, 2, 'one local backup per slot');
});

test('work files a backup left behind when the app was stopped are removed by the next backup', async () => {
  backup.updateBackupSettings({ s3: { enabled: false } });
  put(backup.LOCAL_DIR, { 'duniya-20200101-000000-000.dbk.part': 'half a backup', 'duniya-20200101-000000-000.dbk.snap': 'a snapshot' });
  const r = await backup.runBackup({ reason: 'manual' });
  assert.equal(r.results.local, 'ok');
  assert.deepEqual(readdirSync(backup.LOCAL_DIR).filter((f) => !f.endsWith('.dbk')), [], 'only finished backups remain');
});

test('the Backups screen never waits for GitHub: the account of a saved token is stored with it', async () => {
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${silentGitHub.address().port}`;
  t.store.setSecret('GITHUB_BACKUP_TOKEN', 'ghp_saved_earlier');
  const load = async () => { const at = Date.now(); const r = await t.api(owner, 'GET', '/api/backups'); return { ms: Date.now() - at, github: r.body.github }; };
  const first = await load();
  assert.ok(first.ms < 2000, `answered in ${first.ms} ms while GitHub is silent`);
  assert.deepEqual([first.github.connected, first.github.via, first.github.login], [true, 'token', ''], 'connected; the name is looked up in the background');
  await t.waitFor(() => hung.asked === 1); // the one look-up, in the background
  backup.updateBackupSettings({ githubLogin: 'vikramgorla' }); // as saving the token does
  const second = await load();
  assert.equal(second.github.login, 'vikramgorla');
  assert.equal(hung.asked, 1, 'a stored name is never looked up again');
});
