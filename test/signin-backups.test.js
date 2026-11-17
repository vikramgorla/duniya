// Feature 019: Sign in with Google (OIDC + PKCE, invites, linking), one-click GitHub App for backups (manifest
// flow, installation tokens), download/upload restore incl. restore on a fresh install. Fakes for Google and GitHub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, generateKeyPairSync, createSign, createVerify, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { setup } from './harness.js';

const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
function signJwt(claims, privateKey, kid = 'k1') {
  const data = `${b64u({ alg: 'RS256', kid, typ: 'JWT' })}.${b64u(claims)}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url')}`;
}

// ---------- fake Google (OIDC issuer + JWKS + token endpoint) ----------
const gKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CLIENT_ID = '123456789-abcdef.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-test-secret';
const g = { codes: new Map(), tokenCalls: 0 };
const gHttp = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  const base = `http://127.0.0.1:${gHttp.address().port}`;
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, base);
  if (u.pathname === '/.well-known/openid-configuration') {
    return json(200, { issuer: base, authorization_endpoint: `${base}/o/oauth2/v2/auth`, token_endpoint: `${base}/token`, jwks_uri: `${base}/certs` });
  }
  if (u.pathname === '/certs') return json(200, { keys: [{ ...gKey.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] });
  if (u.pathname === '/token' && req.method === 'POST') {
    g.tokenCalls++;
    const f = Object.fromEntries(new URLSearchParams(d));
    if (f.client_id !== CLIENT_ID || f.client_secret !== CLIENT_SECRET) return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
    const c = g.codes.get(f.code); g.codes.delete(f.code);
    if (!c) return json(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });
    if (f.redirect_uri !== c.redirectUri) return json(400, { error: 'redirect_uri_mismatch' });
    if (createHash('sha256').update(f.code_verifier || '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'Missing code verifier.' });
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: base, aud: CLIENT_ID, sub: c.identity.sub, email: c.identity.email, email_verified: c.identity.email_verified ?? true, nonce: c.tamper.nonce || c.nonce, iat: now, exp: now + 3600 };
    return json(200, { access_token: 'ya29.x', token_type: 'Bearer', expires_in: 3599, id_token: signJwt(claims, (c.tamper.otherKey ? otherKey : gKey).privateKey) });
  }
  json(404, { error: 'not_found' });
}).listen(0);

// ---------- fake GitHub (manifest conversion, app installations, installation tokens, git data) ----------
const appKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const APP_PEM = appKey.privateKey.export({ type: 'pkcs1', format: 'pem' });
const gh = { installed: false, tokenMints: 0, blobs: new Map(), trees: new Map(), commits: new Map(), repo: null, conversions: [] };
function verifyAppJwt(auth) {
  const [h, p, s] = String(auth || '').replace(/^Bearer /, '').split('.');
  if (!s) return false;
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(appKey.publicKey, Buffer.from(s, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  return ok && claims.iss === '4242' && claims.exp > Date.now() / 1000;
}
const ghHttp = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x');
  const conv = u.pathname.match(/^\/app-manifests\/([^/]+)\/conversions$/);
  if (conv && req.method === 'POST') {
    gh.conversions.push(conv[1]);
    if (conv[1] !== 'manifest-code-1') return json(404, { message: 'Not Found' });
    // slug deliberately missing: the panel derives it from the name
    return json(201, { id: 4242, name: 'Duniya backups abc123', owner: { login: 'vikramgorla' }, html_url: 'https://github.com/apps/duniya-backups-abc123', client_id: 'Iv23.x', client_secret: 'cs', webhook_secret: null, pem: APP_PEM });
  }
  if (u.pathname === '/app/installations') {
    if (!verifyAppJwt(req.headers.authorization)) return json(401, { message: 'A JSON web token could not be decoded' });
    return json(200, gh.installed ? [{ id: 77, account: { login: 'vikramgorla' }, repository_selection: 'selected' }] : []);
  }
  if (u.pathname === '/app/installations/77/access_tokens' && req.method === 'POST') {
    if (!verifyAppJwt(req.headers.authorization)) return json(401, { message: 'Bad JWT' });
    gh.tokenMints++;
    return json(201, { token: 'ghs_inst1', expires_at: new Date(Date.now() + 3600000).toISOString() });
  }
  if (req.headers.authorization !== 'Bearer ghs_inst1') return json(401, { message: 'Bad credentials' });
  if (u.pathname === '/installation/repositories') return json(200, { total_count: 1, repositories: [{ full_name: 'vikramgorla/duniya-backup', private: true }] });
  const m = u.pathname.match(/^\/repos\/vikramgorla\/duniya-backup(\/.*)?$/);
  if (!m) return json(404, { message: 'Not Found' });
  const rest = m[1] || '';
  if (rest === '') return json(200, { default_branch: 'main' });
  if (rest === '/git/ref/heads/main') return gh.repo ? json(200, { object: { sha: gh.repo.head } }) : json(409, { message: 'Git Repository is empty.' });
  if (rest === '/contents/README.md' && req.method === 'PUT') { // first commit in an empty repository
    const b = JSON.parse(d); const bs = sha1(b.content); gh.blobs.set(bs, Buffer.from(b.content, 'base64'));
    const tree = sha1(`t${bs}`); gh.trees.set(tree, { 'README.md': bs });
    const c0 = sha1(`c${tree}`); gh.commits.set(c0, { tree, message: b.message }); gh.repo = { head: c0 };
    return json(201, { commit: { sha: c0 } });
  }
  const files = () => gh.trees.get(gh.commits.get(gh.repo.head).tree);
  if (rest.startsWith('/git/commits/') && req.method === 'GET') return json(200, { tree: { sha: gh.commits.get(rest.split('/').pop()).tree } });
  if (rest.startsWith('/contents/backups')) {
    if (!gh.repo) return json(404, { message: 'This repository is empty.' });
    const list = Object.entries(files()).filter(([p]) => p.startsWith('backups/')).map(([p, s]) => ({ type: 'file', name: p.slice(8), size: gh.blobs.get(s).length, sha: s }));
    return list.length ? json(200, list) : json(404, { message: 'Not Found' });
  }
  if (rest === '/git/blobs' && req.method === 'POST') { const b = JSON.parse(d); const s = sha1(b.content); gh.blobs.set(s, Buffer.from(b.content, 'base64')); return json(201, { sha: s }); }
  if (rest.startsWith('/git/blobs/')) return json(200, { content: gh.blobs.get(rest.split('/').pop()).toString('base64'), encoding: 'base64' });
  if (rest === '/git/trees') {
    const b = JSON.parse(d); const next = { ...gh.trees.get(b.base_tree) };
    for (const e of b.tree) { if (e.sha === null) delete next[e.path]; else next[e.path] = e.sha; }
    const s = sha1(JSON.stringify(next) + Math.random()); gh.trees.set(s, next); return json(201, { sha: s });
  }
  if (rest === '/git/commits') { const b = JSON.parse(d); const s = sha1(d + Math.random()); gh.commits.set(s, { tree: b.tree, message: b.message }); return json(201, { sha: s }); }
  if (rest === '/git/refs/heads/main' && req.method === 'PATCH') { gh.repo.head = JSON.parse(d).sha; return json(200, {}); }
  json(404, { message: 'Not Found' });
}).listen(0);

let t; let owner;
before(async () => {
  t = await setup({
    beforeImport: () => {
      process.env.GOOGLE_OIDC_ISSUER = `http://127.0.0.1:${gHttp.address().port}`;
      process.env.GITHUB_API_BASE = `http://127.0.0.1:${ghHttp.address().port}`;
      process.env.GITHUB_WEB_BASE = `http://127.0.0.1:${ghHttp.address().port}`;
      process.env.BACKUP_UPLOAD_MAX_MB = '5';
    },
  });
  owner = await t.login();
});
after(() => { gHttp.close(); ghHttp.close(); t.close(); });

/** Play the browser: start → (Google) → callback. Returns the callback result and the session cookie, if any. */
async function googleSignIn(identity, { cookie = '', mode = 'login', tamper = {}, noBinding = false, replay = false } = {}) {
  const start = await fetch(`${t.base}/auth/google/start${mode === 'link' ? '?mode=link' : ''}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  assert.equal(start.status, 302, await start.clone().text());
  const binding = start.headers.get('set-cookie').match(/duniya_oidc=([^;]+)/)[1];
  assert.match(start.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\/auth\/google/);
  const loc = new URL(start.headers.get('location'));
  const code = randomBytes(8).toString('hex');
  g.codes.set(code, { identity, tamper, challenge: loc.searchParams.get('code_challenge'), nonce: loc.searchParams.get('nonce'), redirectUri: loc.searchParams.get('redirect_uri') });
  const url = `${t.base}/auth/google/callback?code=${code}&state=${encodeURIComponent(loc.searchParams.get('state'))}`;
  const headers = { cookie: noBinding ? '' : `duniya_oidc=${binding}` };
  let cb = await fetch(url, { redirect: 'manual', headers });
  if (replay) cb = await fetch(url, { redirect: 'manual', headers });
  const session = cb.headers.getSetCookie().find((c) => c.startsWith('duniya_session='));
  return { status: cb.status, html: await cb.text(), session: session?.split(';')[0], sessionCookie: session, loc };
}

test('Google setup: the card shows the exact URLs to register, warns about IPs and http, never returns the secret', async () => {
  const cfg = (await t.api(owner, 'GET', '/api/auth/google')).body;
  assert.equal(cfg.redirectUri, `${t.base}/auth/google/callback`);
  assert.equal(cfg.origin, t.base);
  assert.deepEqual(cfg.warnings, [], 'localhost is fine for Google');
  assert.equal(cfg.ready, false);
  assert.equal((await t.api('', 'GET', '/api/session')).body.google, false);

  process.env.PUBLIC_URL = 'http://141.147.1.2';
  let w = (await t.api(owner, 'GET', '/api/auth/google')).body;
  assert.equal(w.redirectUri, 'http://141.147.1.2/auth/google/callback');
  assert.equal(w.warnings[0].kind, 'ip'); assert.match(w.warnings[0].text, /141-147-1-2\.sslip\.io/);
  process.env.PUBLIC_URL = 'http://panel.example.org';
  w = (await t.api(owner, 'GET', '/api/auth/google')).body;
  assert.equal(w.warnings[0].kind, 'https');
  process.env.PUBLIC_URL = 'https://141-147-1-2.sslip.io';
  w = (await t.api(owner, 'GET', '/api/auth/google')).body;
  assert.deepEqual(w.warnings, []);
  assert.equal(w.origin, 'https://141-147-1-2.sslip.io');
  delete process.env.PUBLIC_URL;

  assert.equal((await t.api(owner, 'PUT', '/api/auth/google', { clientId: 'not-a-client-id' })).body.field, 'clientId');
  // wrong secret first: Test says Google did not accept it
  await t.api(owner, 'PUT', '/api/auth/google', { clientId: CLIENT_ID, clientSecret: 'GOCSPX-wrong-secret' });
  let test1 = (await t.api(owner, 'POST', '/api/auth/google/test')).body;
  assert.equal(test1.ok, false);
  assert.match(test1.checks.find((c) => !c.ok).detail, /did not accept/);
  const saved = await t.api(owner, 'PUT', '/api/auth/google', { clientSecret: CLIENT_SECRET });
  assert.equal(saved.body.ready, true);
  assert.ok(!JSON.stringify(saved.body).includes(CLIENT_SECRET), 'secret never returned');
  test1 = (await t.api(owner, 'POST', '/api/auth/google/test')).body;
  assert.equal(test1.ok, true, JSON.stringify(test1));
  assert.ok(!JSON.stringify((await t.api(owner, 'GET', '/api/auth/google')).body).includes(CLIENT_SECRET));
  assert.ok(!JSON.stringify((await t.api(owner, 'GET', '/api/secrets')).body).includes(CLIENT_SECRET));
  assert.equal((await t.api('', 'GET', '/api/session')).body.google, true, 'login page offers Google');
  // admins cannot see or change it
  await t.api(owner, 'POST', '/api/users', { username: 'adm', email: 'Adm@Example.com', role: 'admin', password: 'admin-password-12' });
  const adm = await t.login('adm', 'admin-password-12');
  assert.equal((await t.api(adm, 'GET', '/api/auth/google')).status, 403);
  assert.equal((await t.api(adm, 'POST', '/api/invites', { email: 'x@y.org' })).status, 403);
});

test('Google sign-in: PKCE + nonce; existing user linked by email; session works after the same-origin hop', async () => {
  const r = await googleSignIn({ sub: 'g-adm', email: 'adm@example.com' });
  assert.equal(r.loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(r.loc.searchParams.get('scope'), 'openid email profile');
  assert.equal(r.loc.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(r.status, 200, r.html);
  assert.match(r.sessionCookie, /HttpOnly; SameSite=Strict/);
  assert.match(r.html, /<meta http-equiv=refresh content="1;url=\/">/, 'result page continues to the panel on the same origin');
  const s = (await t.api(r.session, 'GET', '/api/session')).body;
  assert.equal(s.authed, true); assert.equal(s.user.username, 'adm'); assert.equal(s.user.google, true);
  // next time the Google id is enough, even if the email changed
  const again = await googleSignIn({ sub: 'g-adm', email: 'adm.new@example.com' });
  assert.equal((await t.api(again.session, 'GET', '/api/session')).body.user.username, 'adm');
  const log = (await t.api(owner, 'GET', '/api/activity?limit=50')).body.map((a) => a.summary).join('\n');
  assert.match(log, /Panel sign-in with Google: adm <adm@example.com> \(linked by email\)/);
});

test('Google sign-in refuses: unknown email, unverified email, replayed state, other browser, bad nonce, bad signature', async () => {
  const unknown = await googleSignIn({ sub: 'g-x', email: 'stranger@example.com' });
  assert.equal(unknown.status, 403); assert.equal(unknown.session, undefined);
  assert.match(unknown.html, /no account for stranger@example.com/);
  const unverified = await googleSignIn({ sub: 'g-y', email: 'adm@example.com', email_verified: false });
  assert.equal(unverified.status, 400); assert.match(unverified.html, /no verified email/);
  const replay = await googleSignIn({ sub: 'g-adm', email: 'adm@example.com' }, { replay: true });
  assert.equal(replay.status, 400); assert.match(replay.html, /expired or was already used/);
  const otherBrowser = await googleSignIn({ sub: 'g-adm', email: 'adm@example.com' }, { noBinding: true });
  assert.equal(otherBrowser.status, 400); assert.match(otherBrowser.html, /another browser/);
  const nonce = await googleSignIn({ sub: 'g-adm', email: 'adm@example.com' }, { tamper: { nonce: 'evil' } });
  assert.equal(nonce.status, 400); assert.match(nonce.html, /nonce mismatch/);
  const sig = await googleSignIn({ sub: 'g-adm', email: 'adm@example.com' }, { tamper: { otherKey: true } });
  assert.equal(sig.status, 400); assert.match(sig.html, /signature is invalid/);
  for (const r of [unknown, unverified, replay, otherBrowser, nonce, sig]) assert.equal(r.session, undefined);
});

test('Invites: owner invites an email; first Google sign-in creates the account with that role; resend and revoke', async () => {
  const inv = await t.api(owner, 'POST', '/api/invites', { email: 'Anu.Rao+duniya@Gmail.com', role: 'viewer' });
  assert.equal(inv.status, 201); assert.equal(inv.body.email, 'anu.rao+duniya@gmail.com');
  assert.equal((await t.api(owner, 'POST', '/api/invites', { email: 'adm@example.com' })).status, 409, 'already has an account');
  assert.equal((await t.api(owner, 'POST', '/api/invites', { email: 'nope' })).body.field, 'email');
  const before = inv.body.expiresAt;
  await new Promise((r) => setTimeout(r, 5));
  const renewed = (await t.api(owner, 'POST', `/api/invites/${inv.body.id}/renew`)).body;
  assert.ok(renewed.expiresAt > before);
  const list = (await t.api(owner, 'GET', '/api/invites')).body;
  assert.equal(list.invites.length, 1); assert.equal(list.panelUrl, t.base); assert.equal(list.googleReady, true);

  const r = await googleSignIn({ sub: 'g-anu', email: 'anu.rao+duniya@gmail.com' });
  assert.equal(r.status, 200, r.html);
  const me = (await t.api(r.session, 'GET', '/api/session')).body.user;
  assert.deepEqual([me.username, me.role, me.google, me.hasPassword], ['anu.rao', 'viewer', true, false]);
  assert.equal((await t.api(owner, 'GET', '/api/invites')).body.invites.length, 0, 'invite used up');
  assert.equal((await t.api(r.session, 'GET', '/api/users')).status, 403, 'viewer');
  // a Google-only account can add a password without knowing a current one, and cannot unlink Google before that
  assert.equal((await t.api(r.session, 'DELETE', '/api/me/google')).status, 400);
  assert.equal((await t.api(r.session, 'POST', '/api/password', { next: 'anu-password-123' })).status, 200);
  assert.ok(await t.login('anu.rao', 'anu-password-123'));

  const inv2 = (await t.api(owner, 'POST', '/api/invites', { email: 'gone@example.com', role: 'admin' })).body;
  assert.equal((await t.api(owner, 'DELETE', `/api/invites/${inv2.id}`)).status, 200);
  assert.equal((await googleSignIn({ sub: 'g-gone', email: 'gone@example.com' })).status, 403, 'revoked invite no longer works');
});

test('Link mode: a signed-in user links their Google account; unlink needs a password', async () => {
  const r = await googleSignIn({ sub: 'g-owner', email: 'owner-personal@example.com' }, { mode: 'link', cookie: owner });
  assert.equal(r.status, 200, r.html); assert.match(r.html, /Google account linked/);
  assert.equal((await t.api(owner, 'GET', '/api/users')).body.find((u) => u.username === 'admin').google, true);
  const s = await googleSignIn({ sub: 'g-owner', email: 'owner-personal@example.com' });
  assert.equal((await t.api(s.session, 'GET', '/api/session')).body.user.username, 'admin');
  // the same Google account cannot be linked to a second user
  const adm = await t.login('adm', 'admin-password-12');
  const dup = await googleSignIn({ sub: 'g-owner', email: 'x@example.com' }, { mode: 'link', cookie: adm });
  assert.equal(dup.status, 400); assert.match(dup.html, /already linked to admin/);
  assert.equal((await t.api(owner, 'DELETE', '/api/me/google')).body.google, false);
  // link without a session is refused
  const anon = await fetch(`${t.base}/auth/google/start?mode=link`, { redirect: 'manual' });
  assert.equal(anon.status, 401);
});

test('GitHub App: manifest form, callback exchange, installation detection, backups with installation tokens', async () => {
  const page = await fetch(`${t.base}/backups/github-app/new`, { headers: { cookie: owner } });
  assert.equal(page.status, 200);
  const html = await page.text();
  const ghBase = process.env.GITHUB_WEB_BASE;
  assert.match(page.headers.get('content-security-policy'), new RegExp(`form-action ${ghBase.replace(/[.]/g, '\\.')}`));
  const action = html.match(/action="([^"]+)"/)[1].replace(/&#38;/g, '&');
  assert.ok(action.startsWith(`${ghBase}/settings/apps/new?state=`));
  const state = new URL(action).searchParams.get('state');
  const manifest = JSON.parse(html.match(/name=manifest value="([^"]+)"/)[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))));
  assert.equal(manifest.redirect_url, `${t.base}/backups/github-app/callback`);
  assert.equal(manifest.url, t.base);
  assert.equal(manifest.public, false);
  assert.deepEqual(manifest.default_permissions, { contents: 'write', metadata: 'read' });
  assert.equal(manifest.hook_attributes, undefined, 'no webhook');
  assert.ok(manifest.name.length <= 34);
  assert.equal((await fetch(`${t.base}/backups/github-app/new`)).status, 401, 'owner only');

  const bad = await fetch(`${t.base}/backups/github-app/callback?code=manifest-code-1&state=wrong`);
  assert.equal(bad.status, 400);
  const ok = await fetch(`${t.base}/backups/github-app/callback?code=manifest-code-1&state=${state}`);
  assert.equal(ok.status, 200, await ok.clone().text());
  const again = await fetch(`${t.base}/backups/github-app/callback?code=manifest-code-1&state=${state}`);
  assert.equal(again.status, 400, 'state is single-use');
  assert.deepEqual(gh.conversions, ['manifest-code-1']);

  let st = (await t.api(owner, 'GET', '/api/backups')).body;
  assert.equal(st.github.app.app.slug, 'duniya-backups-abc123', 'slug derived from the name when GitHub omits it');
  assert.equal(st.github.app.installed, false);
  assert.equal(st.github.app.installUrl, `${ghBase}/apps/duniya-backups-abc123/installations/new`);
  assert.equal(st.github.app.newRepoUrl, `${ghBase}/new?name=duniya-backup&visibility=private&owner=@me`);
  assert.ok(!JSON.stringify(st).includes('PRIVATE KEY'), 'private key never returned');
  assert.equal(t.store.getSecret('GITHUB_APP_PRIVATE_KEY'), APP_PEM, 'stored (encrypted) as a secret');

  let chk = (await t.api(owner, 'POST', '/api/backups/github-app/check')).body;
  assert.equal(chk.installed, false);
  gh.installed = true;
  chk = (await t.api(owner, 'POST', '/api/backups/github-app/check')).body;
  assert.equal(chk.installed, true); assert.deepEqual(chk.repos, ['vikramgorla/duniya-backup']);
  assert.equal(chk.repo, 'vikramgorla/duniya-backup', 'the only repository is chosen automatically');
  assert.equal(chk.enabled, true);
  assert.equal((await t.api(owner, 'PUT', '/api/backups/github-app/repo', { repo: 'someone/else' })).status, 400);

  await t.api(owner, 'PUT', '/api/backups/passphrase', { passphrase: 'correct horse battery staple' });
  const mintsBefore = gh.tokenMints;
  for (let i = 0; i < 2; i++) {
    const r = (await t.api(owner, 'POST', '/api/backups/run')).body;
    assert.match(r.results.github, /^ok/, JSON.stringify(r));
    await new Promise((res) => setTimeout(res, 1100));
  }
  assert.equal(gh.tokenMints - mintsBefore, 1, 'installation token reused until it nears expiry');
  const files = (await t.api(owner, 'GET', '/api/backups/list?source=github')).body;
  assert.equal(files.length, 2);
  assert.ok(Object.keys(gh.trees.get(gh.commits.get(gh.repo.head).tree)).includes('README.md'), 'empty repository initialised');
  st = (await t.api(owner, 'GET', '/api/backups')).body;
  assert.deepEqual([st.github.connected, st.github.via, st.github.login], [true, 'app', 'vikramgorla']);
});

test('Download a local backup; restore from an uploaded file (streamed, checked, CSRF-guarded)', async () => {
  const local = (await t.api(owner, 'GET', '/api/backups/list?source=local')).body;
  const file = local[0].file;
  const dl = await fetch(`${t.base}/api/backups/download/${file}`, { headers: { cookie: owner } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), new RegExp(`attachment; filename="${file}"`));
  const bytes = Buffer.from(await dl.arrayBuffer());
  assert.deepEqual(bytes, readFileSync(join(t.tmp, 'data', 'backups', file)));
  const adm = await t.login('adm', 'admin-password-12');
  assert.equal((await fetch(`${t.base}/api/backups/download/${file}`, { headers: { cookie: adm } })).status, 403);

  const up = (body, headers = {}) => fetch(`${t.base}/api/backups/upload`, { method: 'POST', body, headers: { cookie: owner, 'content-type': 'application/octet-stream', 'x-duniya-upload': '1', ...headers } });
  assert.equal((await up(bytes, { 'x-duniya-upload': '' })).status, 415, 'custom header required');
  assert.equal((await up(bytes, { 'content-type': 'application/json' })).status, 415);
  assert.equal((await up(bytes, { origin: 'https://evil.example' })).status, 415, 'cross-origin refused');
  assert.equal((await up(bytes, { cookie: adm })).status, 403, 'owner only');
  const junk = await up(Buffer.from('PK\u0003\u0004 not a backup'));
  assert.equal(junk.status, 400); assert.match((await junk.json()).error, /not a Duniya backup/);
  const big = await up(Buffer.concat([Buffer.from('DUNIYA2\n'), Buffer.alloc(6 * 1024 * 1024)]));
  assert.equal(big.status, 413);
  assert.deepEqual(readdirSync(join(t.tmp, 'data', 'uploads')).filter((f) => f.endsWith('.part')), [], 'partial files cleaned up');

  const good = await up(bytes, { origin: t.base, 'x-file-name': file });
  assert.equal(good.status, 200);
  const { upload, size } = await good.json();
  assert.equal(size, bytes.length);
  const wrong = await t.api(owner, 'POST', '/api/backups/restore', { source: 'upload', upload, passphrase: 'not the passphrase!' });
  assert.equal(wrong.status, 400); assert.match(wrong.body.error, /Wrong passphrase/);
  assert.ok(existsSync(join(t.tmp, 'data', 'uploads', `${upload}.dbk`)), 'kept so the owner can retry');
  const restarts = t.restarts;
  const ok = await t.api(owner, 'POST', '/api/backups/restore', { source: 'upload', upload, passphrase: 'correct horse battery staple', name: file });
  assert.equal(ok.status, 200); assert.equal(ok.body.restarting, true); assert.equal(t.restarts, restarts + 1);
  assert.ok(existsSync(join(t.tmp, 'data', 'restore-pending', 'manifest.json')));
  assert.ok(!existsSync(join(t.tmp, 'data', 'uploads', `${upload}.dbk`)), 'upload removed once staged');
  assert.equal((await t.api(owner, 'POST', '/api/backups/restore', { source: 'upload', upload: '../../etc/passwd', passphrase: 'x' })).status, 400);
  rmSync(join(t.tmp, 'data', 'restore-pending'), { recursive: true, force: true });
});

test('Fresh install: restore from a backup file instead of creating an owner (setup code required)', async () => {
  const file = (await t.api(owner, 'GET', '/api/backups/list?source=local')).body[0].file;
  const bytes = readFileSync(join(t.tmp, 'data', 'backups', file));
  const up = (code) => fetch(`${t.base}/api/setup/upload`, { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream', 'x-duniya-upload': '1', 'x-setup-code': code } });
  assert.equal((await up('ANYTHING00')).status, 409, 'not while accounts exist');

  // Simulate a brand-new server: no accounts yet, a setup code printed by the installer.
  t.db.db.exec('DELETE FROM sessions; DELETE FROM users;');
  const { bootstrapAuth } = await import('../src/panel/routes/auth.js');
  const saved = process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD;
  t.config.env.adminPassword = '';
  bootstrapAuth();
  process.env.ADMIN_PASSWORD = saved;
  const code = readFileSync(join(t.tmp, 'data', 'setup-code.txt'), 'utf8').trim();
  assert.equal((await t.api('', 'GET', '/api/session')).body.needsSetup, true);

  assert.equal((await up('WRONGCODE1')).status, 403);
  const r = await up(code.toLowerCase());
  assert.equal(r.status, 200);
  const { upload } = await r.json();
  const post = (body) => fetch(`${t.base}/api/setup/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ code: 'WRONGCODE1', upload, passphrase: 'correct horse battery staple' })).status, 403);
  const wrong = await post({ code, upload, passphrase: 'wrong passphrase!!' });
  assert.equal(wrong.status, 400); assert.match((await wrong.json()).error, /Wrong passphrase/);
  const restarts = t.restarts;
  const ok = await post({ code, upload, passphrase: 'correct horse battery staple', name: file });
  assert.equal(ok.status, 200, await ok.clone().text()); assert.equal((await ok.json()).restarting, true);
  assert.equal(t.restarts, restarts + 1);
  const staged = join(t.tmp, 'data', 'restore-pending');
  const manifest = JSON.parse(readFileSync(join(staged, 'manifest.json'), 'utf8'));
  assert.match(manifest.source, /first-run setup/);
  const db = new DatabaseSync(join(staged, 'duniya.sqlite'));
  assert.ok(db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get(), 'accounts come from the backup');
  assert.ok(db.prepare("SELECT 1 FROM users WHERE username = 'anu.rao' AND google_sub = 'g-anu'").get(), 'Google links travel too');
  db.close();
  rmSync(staged, { recursive: true, force: true });
});
