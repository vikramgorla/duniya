// Feature 007: encrypted scheduled backups (local, GitHub, S3) and restore.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './harness.js';

const sha = (s) => createHash('sha1').update(s).digest('hex');

// ---------- fake GitHub ----------
const gh = { polls: 0, repos: new Map(), blobs: new Map(), trees: new Map(), commits: new Map(), created: [] };
const ghHttp = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const u = new URL(req.url, 'http://x');
  const auth = req.headers.authorization || '';
  if (u.pathname === '/login/device/code') return json(200, { device_code: 'dc1', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
  if (u.pathname === '/login/oauth/access_token') {
    const f = Object.fromEntries(new URLSearchParams(d));
    if (f.client_id !== 'Iv1.testclientid' || f.device_code !== 'dc1') return json(200, { error: 'incorrect_device_code' });
    return json(200, ++gh.polls < 2 ? { error: 'authorization_pending' } : { access_token: 'gho_test', token_type: 'bearer', scope: 'repo' });
  }
  if (!['Bearer gho_test', 'Bearer ghp_pasted'].includes(auth)) return json(401, { message: 'Bad credentials' });
  if (u.pathname === '/user') return json(200, { login: 'vikramgorla' });
  if (u.pathname === '/user/repos' && req.method === 'POST') {
    const b = JSON.parse(d); gh.created.push(b);
    const full = `vikramgorla/${b.name}`;
    const tree = sha('t0'); gh.trees.set(tree, {}); const c0 = sha('c0'); gh.commits.set(c0, { tree });
    gh.repos.set(full, { head: c0, defaultBranch: 'main' });
    return json(201, { full_name: full, private: b.private });
  }
  const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  if (!m || !gh.repos.has(m[1])) return json(404, { message: 'Not Found' });
  const repo = gh.repos.get(m[1]); const rest = m[2] || '';
  const files = () => gh.trees.get(gh.commits.get(repo.head).tree);
  if (rest === '') return json(200, { default_branch: repo.defaultBranch });
  if (rest === '/git/ref/heads/main') return json(200, { object: { sha: repo.head } });
  if (rest.startsWith('/git/commits/') && req.method === 'GET') return json(200, { tree: { sha: gh.commits.get(rest.split('/').pop()).tree } });
  if (rest.startsWith('/contents/backups')) {
    const list = Object.entries(files()).filter(([p]) => p.startsWith('backups/')).map(([p, s]) => ({ type: 'file', name: p.slice(8), size: gh.blobs.get(s).length, sha: s }));
    return list.length ? json(200, list) : json(404, { message: 'Not Found' });
  }
  if (rest === '/git/blobs' && req.method === 'POST') { const b = JSON.parse(d); const s = sha(b.content); gh.blobs.set(s, Buffer.from(b.content, 'base64')); return json(201, { sha: s }); }
  if (rest.startsWith('/git/blobs/')) return json(200, { content: gh.blobs.get(rest.split('/').pop()).toString('base64'), encoding: 'base64' });
  if (rest === '/git/trees') {
    const b = JSON.parse(d); const next = { ...gh.trees.get(b.base_tree) };
    for (const e of b.tree) { if (e.sha === null) delete next[e.path]; else next[e.path] = e.sha; }
    const s = sha(JSON.stringify(next) + Math.random()); gh.trees.set(s, next); return json(201, { sha: s });
  }
  if (rest === '/git/commits') { const b = JSON.parse(d); const s = sha(d + Math.random()); gh.commits.set(s, { tree: b.tree, message: b.message, parents: b.parents }); return json(201, { sha: s }); }
  if (rest === '/git/refs/heads/main' && req.method === 'PATCH') { repo.head = JSON.parse(d).sha; return json(200, {}); }
  json(404, { message: 'Not Found' });
}).listen(0);

// ---------- fake S3 (verifies SigV4 by recomputation) ----------
const s3 = { objects: new Map(), rejected: 0 };
let signV4;
const s3Http = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = `http://127.0.0.1:${s3Http.address().port}${req.url}`;
  const amz = req.headers['x-amz-date'];
  const date = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
  const expected = signV4({ method: req.method, url, region: 'auto', accessKeyId: 'AKTEST', secretAccessKey: 'secret-key', body: req.method === 'PUT' ? body : '', date }).authorization;
  if (req.headers.authorization !== expected) { s3.rejected++; res.writeHead(403); return res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>'); }
  const u = new URL(url); const key = decodeURIComponent(u.pathname.replace(/^\/bk\/?/, ''));
  if (req.method === 'PUT') { s3.objects.set(key, body); res.writeHead(200); return res.end(); }
  if (req.method === 'DELETE') { s3.objects.delete(key); res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
    const prefix = u.searchParams.get('prefix') || '';
    const items = [...s3.objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`).join('');
    res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<ListBucketResult>${items}</ListBucketResult>`);
  }
  if (req.method === 'GET') { res.writeHead(200); return res.end(s3.objects.get(key)); }
  res.writeHead(400); res.end();
}).listen(0);

let t; let owner;
before(async () => {
  t = await setup({
    beforeImport: () => {
      process.env.GITHUB_API_BASE = `http://127.0.0.1:${ghHttp.address().port}`;
      process.env.GITHUB_WEB_BASE = `http://127.0.0.1:${ghHttp.address().port}`;
    },
  });
  ({ signV4 } = await import('../src/core/backup/s3.js'));
  owner = await t.login();
  mkdirSync(join(t.tmp, 'data', 'whatsapp-auth'), { recursive: true });
  writeFileSync(join(t.tmp, 'data', 'whatsapp-auth', 'creds.json'), '{"me":"linked-session"}');
});
after(() => { ghHttp.close(); s3Http.close(); t.close(); });

test('US1: owner only; passphrase required; encrypted file; local retention', async () => {
  await t.api(owner, 'POST', '/api/users', { username: 'adm', role: 'admin', password: 'admin-password-12' });
  const adm = await t.login('adm', 'admin-password-12');
  assert.equal((await t.api(adm, 'GET', '/api/backups')).status, 403);
  assert.equal((await t.api(owner, 'PUT', '/api/backups/settings', { enabled: true })).body.field, 'enabled');
  assert.equal((await t.api(owner, 'PUT', '/api/backups/passphrase', { passphrase: 'short' })).status, 400);
  assert.equal((await t.api(owner, 'PUT', '/api/backups/passphrase', { passphrase: 'correct horse battery staple' })).status, 200);
  assert.equal((await t.api(owner, 'PUT', '/api/backups/settings', { enabled: true, keep: 2, schedule: 'daily', at: '03:30' })).status, 200);

  for (let i = 0; i < 3; i++) { assert.equal((await t.api(owner, 'POST', '/api/backups/run')).status, 200); }
  const local = (await t.api(owner, 'GET', '/api/backups/list?source=local')).body;
  assert.equal(local.length, 2, 'keeps 2');
  const buf = readFileSync(join(t.tmp, 'data', 'backups', local[0].file));
  assert.equal(buf.subarray(0, 8).toString(), 'DUNIYA1\n');
  for (const needle of ['Panduga', 'linked-session', 'event assistant']) assert.ok(!buf.includes(needle), `${needle} must not be readable`);
});

test('US2: GitHub device login, private repo creation, commits with pruning', async () => {
  assert.equal((await t.api(owner, 'POST', '/api/backups/github/device')).status, 400, 'needs a client id');
  await t.api(owner, 'PUT', '/api/backups/github/client-id', { clientId: 'Iv1.testclientid' });
  const dev = (await t.api(owner, 'POST', '/api/backups/github/device')).body;
  assert.equal(dev.userCode, 'WDJB-MJHT');
  assert.equal((await t.api(owner, 'POST', '/api/backups/github/poll')).body.status, 'pending');
  const done = (await t.api(owner, 'POST', '/api/backups/github/poll')).body;
  assert.deepEqual(done, { status: 'connected', login: 'vikramgorla' });
  const repo = (await t.api(owner, 'POST', '/api/backups/github/create-repo', {})).body.repo;
  assert.equal(repo, 'vikramgorla/duniya-backups');
  assert.equal(gh.created[0].private, true);
  for (let i = 0; i < 3; i++) { const r = (await t.api(owner, 'POST', '/api/backups/run')).body; assert.match(r.results.github, /^ok/); }
  const files = (await t.api(owner, 'GET', '/api/backups/list?source=github')).body;
  assert.equal(files.length, 2);
  const head = gh.commits.get(gh.repos.get(repo).head);
  assert.match(head.message, /pruned 1/);
  assert.equal((await t.api(owner, 'PUT', '/api/backups/github/token', { token: 'nope' })).status, 400);
  const st = (await t.api(owner, 'GET', '/api/backups')).body;
  assert.equal(st.github.login, 'vikramgorla');
  assert.equal(st.github.signupUrl, 'https://github.com/signup');
});

test('US3: S3-compatible with SigV4, retention, failure isolated', async () => {
  await t.api(owner, 'PUT', '/api/backups/s3/keys', { accessKeyId: 'AKTEST', secretAccessKey: 'secret-key' });
  await t.api(owner, 'PUT', '/api/backups/settings', { s3: { enabled: true, endpoint: `http://127.0.0.1:${s3Http.address().port}`, region: 'auto', bucket: 'bk', prefix: 'duniya/' } });
  assert.deepEqual((await t.api(owner, 'POST', '/api/backups/test/s3')).body, { ok: true });
  for (let i = 0; i < 3; i++) { const r = (await t.api(owner, 'POST', '/api/backups/run')).body; assert.equal(r.results.s3, 'ok'); }
  assert.equal([...s3.objects.keys()].filter((k) => k.startsWith('duniya/')).length, 2);
  assert.equal(s3.rejected, 0);
  await t.api(owner, 'PUT', '/api/backups/s3/keys', { accessKeyId: 'AKTEST', secretAccessKey: 'wrong' });
  const r = (await t.api(owner, 'POST', '/api/backups/run')).body;
  assert.match(r.results.s3, /error: S3 PUT 403 SignatureDoesNotMatch/);
  assert.equal(r.results.local, 'ok'); assert.match(r.results.github, /^ok/);
  await t.api(owner, 'PUT', '/api/backups/s3/keys', { accessKeyId: 'AKTEST', secretAccessKey: 'secret-key' });
});

test('US4: restore — wrong passphrase refused; round trip into a fresh data dir', async () => {
  const file = (await t.api(owner, 'GET', '/api/backups/list?source=github')).body[0].file;
  const wrong = await t.api(owner, 'POST', '/api/backups/restore', { source: 'github', file, passphrase: 'not the passphrase' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /Wrong passphrase/);
  assert.ok(!existsSync(join(t.tmp, 'data', 'restore-pending')));

  const ok = await t.api(owner, 'POST', '/api/backups/restore', { source: 's3', file: (await t.api(owner, 'GET', '/api/backups/list?source=s3')).body[0].file, passphrase: 'correct horse battery staple' });
  assert.equal(ok.status, 200); assert.equal(ok.body.restarting, true); assert.equal(t.restarts, 1);
  const staged = join(t.tmp, 'data', 'restore-pending');
  assert.ok(existsSync(join(staged, 'manifest.json')));

  // Apply it on a brand-new data dir, like a replacement server.
  const fresh = mkdtempSync(join(tmpdir(), 'duniya-fresh-'));
  mkdirSync(join(fresh, 'restore-pending'), { recursive: true });
  for (const f of readdirSync(staged, { recursive: true })) {
    const src = join(staged, f);
    if (existsSync(src) && !readdirSync(staged, { withFileTypes: true }).find((e) => e.name === f && e.isDirectory())) {
      try { mkdirSync(join(fresh, 'restore-pending', f, '..'), { recursive: true }); writeFileSync(join(fresh, 'restore-pending', f), readFileSync(src)); } catch { /* dir */ }
    }
  }
  rmSync(staged, { recursive: true, force: true }); // don't apply in the live test dir
  const { applyPendingRestore } = await import('../src/core/restore-apply.js');
  const manifest = applyPendingRestore(fresh);
  assert.ok(manifest.files.includes('duniya.sqlite'));
  const db = new DatabaseSync(join(fresh, 'duniya.sqlite'));
  assert.ok(db.prepare("SELECT id FROM agents WHERE id = 'panduga'").get());
  assert.ok(db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get());
  const enc = db.prepare("SELECT value_enc FROM secrets WHERE name = 'PANDUGA_TOKEN_ORGANIZER'").get().value_enc;
  const { decrypt } = await import('../src/core/crypto.js');
  const key = Buffer.from(readFileSync(join(fresh, 'master.key'), 'utf8').trim(), 'base64');
  assert.equal(decrypt(enc, key), 'org', 'secrets restorable with the backed-up master key');
  assert.equal(readFileSync(join(fresh, 'whatsapp-auth', 'creds.json'), 'utf8'), '{"me":"linked-session"}');
  assert.ok(!existsSync(join(fresh, 'restore-pending')));
});

test('schedule slots', async () => {
  const { slotFor } = await import('../src/core/backup/index.js');
  const at = (iso) => new Date(iso);
  const daily = { schedule: 'daily', at: '03:30', weekday: 'sun' };
  assert.equal(slotFor(daily, at('2026-11-14T02:29:00Z'), 'Europe/Zurich'), null); // 03:29 local
  assert.equal(slotFor(daily, at('2026-11-14T02:31:00Z'), 'Europe/Zurich'), '2026-11-14');
  assert.equal(slotFor({ ...daily, schedule: 'hourly' }, at('2026-11-14T10:05:00Z'), 'UTC'), '2026-11-14T10');
  assert.equal(slotFor({ ...daily, schedule: '6h' }, at('2026-11-14T13:05:00Z'), 'UTC'), '2026-11-14/2');
  assert.equal(slotFor({ ...daily, schedule: 'weekly' }, at('2026-11-14T05:00:00Z'), 'UTC'), null, 'saturday');
  assert.equal(slotFor({ ...daily, schedule: 'weekly' }, at('2026-11-15T05:00:00Z'), 'UTC'), '2026-11-15W');
});
