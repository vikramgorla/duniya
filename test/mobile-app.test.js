// 027: mobile app — built-in OAuth client (duniya://oauth, Expo Go exp://…/--/oauth), tokens bound to <base>/api,
// Bearer access to /api/* with the panel role gates, Settings → Mobile app, and the panel's client-side QR encoder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import QRCode from 'qrcode';
import { setup } from './harness.js';

delete process.env.PUBLIC_URL;
const t = await setup();
after(() => t.close());
const owner = await t.login();
const API = `${t.base}/api`;
const CLIENT = 'duniya-mobile';
const APP_REDIRECT = 'duniya://oauth';

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkce = () => { const verifier = b64url(randomBytes(48)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };
const form = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)));
const post = (path, body, headers = {}) => fetch(t.base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(body), redirect: 'manual' });
const authUrl = (p) => `${t.base}/oauth/authorize?${form({ response_type: 'code', client_id: CLIENT, code_challenge_method: 'S256', state: 'st', ...p })}`;
const bearer = (token, method, path, body) => fetch(t.base + path, {
  method, headers: { authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
  body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
});

/** The app's sign-in: consent page in the system browser (with a panel session), approve, exchange the code. */
async function appSignIn(cookie, { redirect = APP_REDIRECT, resource = API } = {}) {
  const { verifier, challenge } = pkce();
  const params = { redirect_uri: redirect, code_challenge: challenge, resource };
  const page = await fetch(authUrl(params), { headers: { cookie } });
  const html = await page.text();
  assert.equal(page.status, 200, html);
  const csrf = /name=csrf value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'consent page shown');
  const r = await post('/oauth/authorize', { response_type: 'code', client_id: CLIENT, code_challenge_method: 'S256', state: 'st', ...params, action: 'approve', csrf }, { cookie });
  assert.equal(r.status, 302);
  const back = r.headers.get('location');
  assert.ok(back.startsWith(`${redirect}?`), back);
  const q = new URL(back).searchParams;
  assert.equal(q.get('state'), 'st');
  const tok = await post('/oauth/token', { grant_type: 'authorization_code', client_id: CLIENT, code: q.get('code'), redirect_uri: redirect, code_verifier: verifier, resource });
  assert.equal(tok.status, 200);
  return { html, csp: page.headers.get('content-security-policy'), tokens: await tok.json() };
}
async function userCookie(username, role) {
  const r = await t.api(owner, 'POST', '/api/users', { username, role, password: 'a long enough password' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.id, cookie: await t.login(username, 'a long enough password') };
}

test('metadata: /.well-known/oauth-protected-resource/api names the /api resource and the built-in client', async () => {
  const r = await fetch(`${t.base}/.well-known/oauth-protected-resource/api`);
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.resource, API);
  assert.deepEqual(m.authorization_servers, [t.base]);
  assert.equal(m.mobile_client_id, CLIENT);
});

test('built-in client: duniya://oauth sign-in shows the phone consent, lists the scheme in CSP and returns a code', async () => {
  const { html, csp, tokens } = await appSignIn(owner);
  assert.match(html, /Sign in the Duniya app on your phone/);
  assert.match(html, /Everything an admin can do/); // owner abilities
  assert.match(csp, /form-action 'self' duniya:/);
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.access_token && tokens.refresh_token);
  assert.ok(t.db.listActivity({ limit: 10 }).some((a) => a.type === 'config' && /Mobile app signed in by admin/.test(a.summary)));
});

test('Expo Go redirects (exp://host:port/--/oauth) work; other redirects are refused before redirecting', async () => {
  const { csp, tokens } = await appSignIn(owner, { redirect: 'exp://192.168.1.20:8081/--/oauth' });
  assert.match(csp, /form-action 'self' exp:/);
  assert.equal((await bearer(tokens.access_token, 'GET', '/api/status')).status, 200);
  for (const bad of ['duniya://other', 'exp://192.168.1.20:8081/--/elsewhere', 'https://evil.example/cb', 'myapp://oauth', 'exp://a@b/--/oauth']) {
    const r = await fetch(authUrl({ redirect_uri: bad, code_challenge: pkce().challenge, resource: API }), { headers: { cookie: owner }, redirect: 'manual' });
    assert.equal(r.status, 400, bad);
    assert.match(await r.text(), /return address/);
  }
  // Dynamic registration (AI assistants) still only takes https or loopback redirects.
  const reg = await fetch(`${t.base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: ['duniya://oauth'] }) });
  assert.equal(reg.status, 400);
});

test('resource binding: the app only gets /api tokens; /api tokens fail on /mcp and /mcp tokens fail on /api', async () => {
  const r = await fetch(authUrl({ redirect_uri: APP_REDIRECT, code_challenge: pkce().challenge, resource: `${t.base}/mcp` }), { headers: { cookie: owner }, redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).searchParams.get('error'), 'invalid_target');
  const { tokens } = await appSignIn(owner);
  const mcp = await fetch(`${t.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(mcp.status, 401);
  // an AI assistant's token (resource /mcp) is not accepted by the panel API
  const reg = await (await fetch(`${t.base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Assistant', redirect_uris: ['http://localhost:7777/cb'] }) })).json();
  const { verifier, challenge } = pkce();
  const p = { response_type: 'code', client_id: reg.client_id, redirect_uri: 'http://localhost:7777/cb', code_challenge: challenge, code_challenge_method: 'S256', resource: `${t.base}/mcp` };
  const html = await (await fetch(`${t.base}/oauth/authorize?${form(p)}`, { headers: { cookie: owner } })).text();
  const csrf = /name=csrf value="([^"]+)"/.exec(html)[1];
  const back = new URL((await post('/oauth/authorize', { ...p, action: 'approve', csrf }, { cookie: owner })).headers.get('location'));
  const at = await (await post('/oauth/token', { grant_type: 'authorization_code', client_id: reg.client_id, code: back.searchParams.get('code'), redirect_uri: p.redirect_uri, code_verifier: verifier })).json();
  const api = await bearer(at.access_token, 'GET', '/api/status');
  assert.equal(api.status, 401);
  assert.match(api.headers.get('www-authenticate'), /oauth-protected-resource\/api.*invalid_token/);
  // and an assistant cannot ask for the /api resource
  const r2 = await fetch(`${t.base}/oauth/authorize?${form({ ...p, resource: API })}`, { headers: { cookie: owner }, redirect: 'manual' });
  assert.equal(new URL(r2.headers.get('location')).searchParams.get('error'), 'invalid_target');
});

test('bearer access acts as the approving user with the same role gates as the session', async () => {
  const viewer = await userCookie('mob-viewer', 'viewer');
  const admin = await userCookie('mob-admin', 'admin');
  const v = (await appSignIn(viewer.cookie)).tokens.access_token;
  const a = (await appSignIn(admin.cookie)).tokens.access_token;
  const o = (await appSignIn(owner)).tokens.access_token;
  const st = await (await bearer(v, 'GET', '/api/status')).json();
  assert.equal(st.user.username, 'mob-viewer');
  assert.ok(Array.isArray(st.bots));
  // viewer: reads, no writes; admin: writes, not owner routes; owner: everything
  assert.equal((await bearer(v, 'GET', '/api/bots')).status, 200);
  assert.equal((await bearer(v, 'PUT', '/api/bots/helper', { enabled: false })).status, 403);
  assert.equal((await bearer(v, 'GET', '/api/chats/g1%40g.us/messages')).status, 403);
  assert.equal((await bearer(a, 'PUT', '/api/bots/helper', { enabled: false })).status, 200);
  assert.equal(t.bots.getBot('helper').enabled, false);
  assert.equal((await bearer(a, 'PUT', '/api/bots/helper', { enabled: true })).status, 200);
  assert.equal((await bearer(a, 'GET', '/api/chats/g1%40g.us/messages')).status, 200);
  assert.equal((await bearer(a, 'GET', '/api/users')).status, 403);
  assert.equal((await bearer(a, 'GET', '/api/updates')).status, 403);
  assert.equal((await bearer(o, 'GET', '/api/users')).status, 200);
  assert.equal((await bearer(o, 'GET', '/api/updates')).status, 200);
  // state-changing requests still need JSON (no form posts with a token either)
  const formPost = await fetch(`${t.base}/api/settings`, { method: 'POST', headers: { authorization: `Bearer ${o}`, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(formPost.status, 415);
  // session-only routes refuse the token
  assert.equal((await bearer(o, 'POST', '/api/password', { current: 'x', next: 'y' })).status, 403);
  // a role change applies to the next call
  await t.api(owner, 'PUT', `/api/users/${admin.id}`, { role: 'viewer' });
  assert.equal((await bearer(a, 'PUT', '/api/bots/helper', { enabled: true })).status, 403);
  // a disabled user's token stops working
  await t.api(owner, 'PUT', `/api/users/${viewer.id}`, { disabled: true });
  assert.equal((await bearer(v, 'GET', '/api/status')).status, 401);
});

test('session cookie auth is unchanged; a bad token is not rescued by a cookie; no CORS on /api', async () => {
  const s = await fetch(`${t.base}/api/status`, { headers: { cookie: owner, origin: 'https://evil.example' } });
  assert.equal(s.status, 200);
  assert.equal(s.headers.get('access-control-allow-origin'), null);
  const both = await fetch(`${t.base}/api/status`, { headers: { cookie: owner, authorization: 'Bearer nope' } });
  assert.equal(both.status, 401);
  assert.equal((await fetch(`${t.base}/api/status`)).status, 401);
  const sess = await (await bearer((await appSignIn(owner)).tokens.access_token, 'GET', '/api/session')).json();
  assert.equal(sess.authed, true);
  assert.equal(sess.user.username, 'admin');
});

test('refresh rotation and sign-out from Settings → Mobile app', async () => {
  const { tokens } = await appSignIn(owner);
  const r = await post('/oauth/token', { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: tokens.refresh_token, resource: API });
  assert.equal(r.status, 200);
  const next = await r.json();
  assert.equal((await bearer(next.access_token, 'GET', '/api/status')).status, 200);
  const m = await t.api(owner, 'GET', '/api/mobile');
  assert.equal(m.status, 200);
  assert.equal(m.body.serverUrl, t.base);
  assert.equal(m.body.connectUrl, `duniya://connect?server=${encodeURIComponent(t.base)}`);
  assert.ok(m.body.devices.some((d) => d.clientId === CLIENT && d.kind === 'app'));
  // phones are not listed among AI assistants in the panel UI, but the grant is revocable the same way
  const me = m.body.devices.find((d) => d.userId === m.body.you);
  assert.equal((await t.api(owner, 'DELETE', `/api/assistants/${me.userId}/${CLIENT}`)).status, 200);
  assert.equal((await bearer(next.access_token, 'GET', '/api/status')).status, 401);
  const again = await post('/oauth/token', { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: next.refresh_token });
  assert.equal(again.status, 400);
});

test('Expo link: owners set it (validated); others read it', async () => {
  const admin = await userCookie('mob-admin2', 'admin');
  assert.equal((await t.api(admin.cookie, 'PUT', '/api/mobile', { expoUrl: 'exp://u.expo.dev/abc' })).status, 403);
  assert.equal((await t.api(owner, 'PUT', '/api/mobile', { expoUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await t.api(owner, 'PUT', '/api/mobile', { expoUrl: 'https://evil.example/app' })).status, 400);
  for (const ok of ['exp://u.expo.dev/abc?channel-name=main', 'exp://192.168.1.20:8081', 'https://expo.dev/@vik/duniya', '']) {
    assert.equal((await t.api(owner, 'PUT', '/api/mobile', { expoUrl: ok })).status, 200, ok);
  }
  await t.api(owner, 'PUT', '/api/mobile', { expoUrl: 'exp://u.expo.dev/abc' });
  assert.equal((await t.api(admin.cookie, 'GET', '/api/mobile')).body.expoUrl, 'exp://u.expo.dev/abc');
});

test('panel QR encoder (qr.js) is served and matches the qrcode package module for module', async () => {
  const r = await fetch(`${t.base}/qr.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  const ctx = { TextEncoder };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(resolve(import.meta.dirname, '../src/panel/public/qr.js'), 'utf8'), ctx);
  let n = 0;
  for (const text of ['duniya://connect?server=https%3A%2F%2Fduniya.example.com', 'exp://192.168.1.20:8081', 'x'.repeat(150), 'é'.repeat(30)]) {
    for (const lvl of ['L', 'M', 'Q', 'H']) {
      for (let mask = 0; mask < 8; mask++) {
        let mine; try { mine = ctx.DuniyaQR.encode(text, lvl, { mask }); } catch { continue; }
        const ref = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: lvl, maskPattern: mask, version: mine.version });
        assert.equal(ref.modules.size, mine.size);
        for (let y = 0; y < mine.size; y++) for (let x = 0; x < mine.size; x++) assert.equal(!!ref.modules.get(y, x), mine.dark(x, y), `${lvl} ${mask} ${x},${y}`);
        n++;
      }
    }
  }
  assert.ok(n > 100);
  const auto = ctx.DuniyaQR.encode('duniya://connect?server=https%3A%2F%2Fduniya.example.com');
  assert.ok(auto.mask >= 0 && auto.mask < 8);
  assert.match(ctx.DuniyaQR.svgPath(auto).d, /^M\d+ \d+h1v1h-1z/);
});
