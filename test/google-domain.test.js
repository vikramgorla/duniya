// #77: Google sign-in and the panel's addresses — origins without a trailing slash, every address listed, and a
// helpful page when a sign-in started at a new domain comes back to the registered (old) one. Fake Google discovery only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './harness.js';

const tokenCalls = [];
const gHttp = http.createServer(async (req, res) => {
  const base = `http://127.0.0.1:${gHttp.address().port}`;
  if (req.url === '/token') { // records what the panel sends; the code is refused (no ID token needed for these tests)
    let d = ''; for await (const c of req) d += c;
    tokenCalls.push(Object.fromEntries(new URLSearchParams(d)));
    res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_grant' }));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/o/oauth2/v2/auth`, token_endpoint: `${base}/token`, jwks_uri: `${base}/certs` }));
}).listen(0);

const opsDir = mkdtempSync(join(tmpdir(), 'duniya-gdom-'));
let t; let owner;
before(async () => {
  mkdirSync(join(opsDir, 'state')); mkdirSync(join(opsDir, 'req'));
  // the panel answers on old.example.org (main) and new.example.org (added, not confirmed yet)
  writeFileSync(join(opsDir, 'state', 'web-applied.json'), JSON.stringify({ version: 1, host: 'old.example.org', aliases: ['new.example.org'], port: 8080, access: {} }));
  t = await setup({
    env: {
      DUNIYA_OPS_STATE_DIR: join(opsDir, 'state'), DUNIYA_OPS_REQUEST_DIR: join(opsDir, 'req'), PUBLIC_URL: 'https://old.example.org',
      DUNIYA_TLS_PORT: '1', DUNIYA_PUBLIC_IP: '141.147.1.2', DUNIYA_EXPOSURE: 'domain',
    },
    beforeImport: () => { process.env.GOOGLE_OIDC_ISSUER = `http://127.0.0.1:${gHttp.address().port}`; },
  });
  owner = await t.login();
  const r = await t.api(owner, 'PUT', '/api/auth/google', { clientId: '123456789-abcdef.apps.googleusercontent.com', clientSecret: 'GOCSPX-test-secret' });
  assert.equal(r.body.ready, true);
});
after(() => { gHttp.close(); t.close(); });

/** A browser request with the Host header of the address it used (as the web server forwards it). */
const get = (path, { host, cookie = '' } = {}) => new Promise((resolve, reject) => {
  http.get(`${t.base}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } }, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, html: d }));
  }).on('error', reject);
});
const start = async (host) => {
  const s = await get('/auth/google/start', { host });
  assert.equal(s.status, 302, s.html);
  const binding = String(s.headers['set-cookie']).match(/duniya_oidc=([^;]+)/)[1];
  return { state: new URL(s.headers.location).searchParams.get('state'), binding, redirectUri: new URL(s.headers.location).searchParams.get('redirect_uri') };
};

test('#77: Authorized JavaScript origins never end with a slash; every panel address is listed', async () => {
  for (const pub of ['https://old.example.org', 'https://old.example.org/', 'https://Old.Example.org:443/']) {
    process.env.PUBLIC_URL = pub;
    const g = (await t.api(owner, 'GET', '/api/auth/google')).body;
    assert.equal(g.origin, 'https://old.example.org', pub);
    assert.equal(g.redirectUri, 'https://old.example.org/auth/google/callback', pub);
    assert.deepEqual(g.addresses.map((a) => [a.origin, a.redirectUri]), [
      ['https://old.example.org', 'https://old.example.org/auth/google/callback'],
      ['https://new.example.org', 'https://new.example.org/auth/google/callback'],
    ]);
    for (const a of g.addresses) assert.ok(!a.origin.endsWith('/'));
  }
  process.env.PUBLIC_URL = 'https://old.example.org';
});

test('#77: Web address & access tells the panel that Google sign-in needs new addresses', async () => {
  const w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.google.on, true); assert.equal(w.google.only, false);
  assert.equal(w.google.callbackPath, '/auth/google/callback');
  assert.equal(w.google.consoleUrl, 'https://console.cloud.google.com/apis/credentials');
  assert.ok(w.google.addresses.some((a) => a.origin === 'https://new.example.org'));
  assert.ok(!JSON.stringify(w).includes('GOCSPX-test-secret'), 'no secret');
});

test('#77: the redirect URI follows the panel address the sign-in starts on; unknown hosts get the main address', async () => {
  assert.equal((await start('new.example.org')).redirectUri, 'https://new.example.org/auth/google/callback');
  assert.equal((await start('old.example.org')).redirectUri, 'https://old.example.org/auth/google/callback');
  assert.equal((await start('evil.example.com')).redirectUri, 'https://old.example.org/auth/google/callback', 'unknown Host → PUBLIC_URL');
  assert.equal((await start('new.example.org.evil.com')).redirectUri, 'https://old.example.org/auth/google/callback');
  // the callback exchanges the code with exactly the redirect URI that was sent to Google
  const s = await start('new.example.org');
  tokenCalls.length = 0;
  const cb = await get(`/auth/google/callback?code=c-new&state=${encodeURIComponent(s.state)}`, { host: 'new.example.org', cookie: `duniya_oidc=${s.binding}` });
  assert.equal(cb.status, 400); assert.match(cb.html, /Google refused the sign-in/);
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].redirect_uri, 'https://new.example.org/auth/google/callback');
  assert.equal(tokenCalls[0].code, 'c-new');
});

test('#77: a sign-in started at one address that comes back to another gets a helpful page', async () => {
  const s = await start('new.example.org');
  // e.g. a sign-in started before the update, or a link opened at the other address: the binding cookie is missing
  const cb = await get(`/auth/google/callback?code=c1&state=${encodeURIComponent(s.state)}`, { host: 'old.example.org' });
  assert.equal(cb.status, 400);
  assert.match(cb.headers['content-type'], /text\/html/);
  assert.match(cb.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(cb.html, /Google sign-in needs the new address/);
  assert.match(cb.html, /You started at https:\/\/new\.example\.org, but Google sent you back to https:\/\/old\.example\.org/);
  assert.match(cb.html, /href="https:\/\/new\.example\.org\/">Start again at https:\/\/new\.example\.org/);
  assert.match(cb.html, /href="https:\/\/console\.cloud\.google\.com\/apis\/credentials"/);
  for (const v of ['https://old.example.org', 'https://new.example.org', 'https://old.example.org/auth/google/callback', 'https://new.example.org/auth/google/callback']) {
    assert.ok(cb.html.includes(`data-copy="${v}"`), v);
  }
  assert.ok(!/data-copy="https:\/\/[^"]+\/"/.test(cb.html), 'origins without a trailing slash');
  assert.match(cb.html, /href="\/">Sign in with your password/);
  assert.match(cb.html, /href="\/auth\/google\/start">Sign in with Google here/);
  assert.ok(!/href="(?!\/|https:\/\/console\.cloud\.google\.com\/|https:\/\/new\.example\.org\/")/.test(cb.html), 'only relative links, the Google console and own addresses: no open redirect');
  assert.equal(cb.headers['set-cookie'].some((c) => c.startsWith('duniya_session=')), false);
  // single use: the same state does not work a second time, even with the right cookie
  const again = await get(`/auth/google/callback?code=c1&state=${encodeURIComponent(s.state)}`, { host: 'new.example.org', cookie: `duniya_oidc=${s.binding}` });
  assert.equal(again.status, 400); assert.match(again.html, /expired or was already used/);
});

test('#77: redirect_uri_mismatch from Google and unknown hosts; untrusted input is never reflected', async () => {
  const s = await start('old.example.org');
  const mm = await get(`/auth/google/callback?error=redirect_uri_mismatch&state=${encodeURIComponent(s.state)}`, { host: 'old.example.org', cookie: `duniya_oidc=${s.binding}` });
  assert.equal(mm.status, 400); assert.match(mm.html, /Google does not know this address yet/);
  assert.ok(mm.html.includes('data-copy="https://new.example.org/auth/google/callback"'));

  // a Host that is not one of the panel's addresses is neither shown nor linked
  const evil = await start('evil.example.com');
  const cb = await get(`/auth/google/callback?code=x&state=${encodeURIComponent(evil.state)}&error=%3Cscript%3Ealert(1)%3C%2Fscript%3E`, { host: 'old.example.org' });
  assert.equal(cb.status, 400);
  assert.ok(!cb.html.includes('evil.example.com'));
  assert.ok(!cb.html.includes('<script>alert'), 'Google error text is never HTML');
  assert.match(cb.html, /another browser or at another address/);
  assert.match(cb.html, /most likely you signed in on the other address/);
  assert.ok(!/href="https:\/\/(?!console\.cloud\.google\.com\/)/.test(cb.html), 'no links to other hosts when the start address is unknown');
});

test('#77: with only Google allowed, the page points to the working address and the CLI recovery', async () => {
  t.store.updateSettings({ googleOnly: true });
  try {
    const s = await start('new.example.org');
    const cb = await get(`/auth/google/callback?code=c&state=${encodeURIComponent(s.state)}`, { host: 'old.example.org' });
    assert.match(cb.html, /Only Sign in with Google is allowed/);
    assert.match(cb.html, /sudo duniya enable-password-login/);
    assert.ok(!cb.html.includes('Sign in with your password'));
    assert.match(cb.html, /Sign in with Google here/);
    assert.equal((await t.api(owner, 'GET', '/api/web')).body.google.only, true);
  } finally { t.store.updateSettings({ googleOnly: false }); }
});
