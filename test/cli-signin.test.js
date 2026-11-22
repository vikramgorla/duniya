// Features 028 (only Sign in with Google) and 029 (the `duniya` command line tool). The CLI runs as a real child
// process against the same DATA_DIR while the app (panel) has the database open — like on a live server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverAuthorizationServerMetadata, registerClient, startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { setup } from './harness.js';

const CLI = resolve(import.meta.dirname, '..', 'bin', 'duniya.js');
const CLIENT_ID = '123456789-abcdef.apps.googleusercontent.com';
let t; let owner;

/** Run `duniya …` like an operator would. Resolves { code, out, err }. */
function duniya(args, env = {}, input) {
  return new Promise((res) => {
    const p = execFile(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], {
      env: { ...process.env, PANEL_PORT: String(t?.panel?.address().port || 8080), NO_COLOR: '1', ...env }, timeout: 30000,
    }, (e, out, err) => res({ code: e ? (e.code ?? 1) : 0, out: String(out), err: String(err) }));
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}
const log = async () => (await t.api(owner, 'GET', '/api/activity?limit=100')).body.map((a) => a.summary).join('\n');
const login = (username, password) => fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });

before(async () => {
  t = await setup();
  owner = await t.login();
  const { startRuntimeFile } = await import('../src/core/runtime.js');
  t.channel.accounts = async () => [{ key: 'whatsapp:main', channel: 'whatsapp', app: 'WhatsApp', label: 'Main', status: 'open', lastError: '', me: '41790000099:1@s.whatsapp.net' },
    { key: 'telegram:77', channel: 'telegram', app: 'Telegram', label: '@duniya_bot', status: 'connecting', lastError: 'not reachable', me: '' }];
  await startRuntimeFile(t.channel).write();
});
after(() => t.close());

// ---------- 028: only Sign in with Google ----------
test('028: "Only Google" is refused until Google works and the owner linked their own Google account', async () => {
  let r = await t.api(owner, 'PUT', '/api/auth/signin', { googleOnly: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /Set up Sign in with Google first/);
  await t.api(owner, 'PUT', '/api/auth/google', { clientId: CLIENT_ID, clientSecret: 'GOCSPX-test-secret' });
  r = await t.api(owner, 'PUT', '/api/auth/signin', { googleOnly: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /Link your own Google account/);
  await t.api(owner, 'POST', '/api/users', { username: 'adm', email: 'adm@example.com', role: 'admin', password: 'admin-password-12' });
  const admin = t.store.listUsers().find((u) => u.username === 'admin');
  t.store.linkGoogle(admin.id, 'g-owner');
  const st = (await t.api(owner, 'GET', '/api/auth/signin')).body;
  assert.equal(st.canEnable, true); assert.equal(st.on, false);
  assert.deepEqual(st.withoutGoogle, ['adm'], 'the card says who would be locked out');
  // admins can't see or change it
  const adm = await t.login('adm', 'admin-password-12');
  assert.equal((await t.api(adm, 'PUT', '/api/auth/signin', { googleOnly: true })).status, 403);
});

test('028: while on, the login page has no password form and every password path refuses; invites still work', async () => {
  const on = await t.api(owner, 'PUT', '/api/auth/signin', { googleOnly: true });
  assert.equal(on.status, 200); assert.equal(on.body.active, true);
  const s = (await t.api('', 'GET', '/api/session')).body;
  assert.equal(s.passwordLogin, false); assert.equal(s.google, true);
  const r = await login('adm', 'admin-password-12');
  assert.equal(r.status, 403); assert.match((await r.json()).error, /Password sign-in is switched off/);
  assert.equal((await t.api(owner, 'GET', '/api/status')).status, 200, 'existing sessions keep working');
  const u = await t.api(owner, 'POST', '/api/users', { username: 'pw-user', role: 'viewer', password: 'viewer-password-1' });
  assert.equal(u.status, 400); assert.match(u.body.error, /invite this person with Google/);
  assert.equal((await t.api(owner, 'DELETE', '/api/me/google')).status, 400, 'unlinking would lock the owner out');
  // invites keep working: the invited person signs in with Google and gets an account
  assert.equal((await t.api(owner, 'POST', '/api/invites', { email: 'new@example.com', role: 'viewer' })).status, 201);
  const { resolveGoogleUser } = await import('../src/core/google-signin.js');
  const res = resolveGoogleUser({ sub: 'g-new', email: 'new@example.com' });
  assert.equal(res.how, 'invite'); assert.equal(res.user.role, 'viewer');
  // the AI-assistant (MCP) sign-in page offers Google instead of a password form, and refuses passwords
  const metadata = await discoverAuthorizationServerMetadata(t.base);
  const client = await registerClient(t.base, { metadata, clientMetadata: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] } });
  const { authorizationUrl } = await startAuthorization(t.base, { metadata, clientInformation: client, redirectUrl: 'https://claude.ai/api/mcp/auth_callback', state: 's', resource: new URL(`${t.base}/mcp`) });
  const page = await (await fetch(authorizationUrl)).text();
  assert.match(page, /Password sign-in is switched off/); assert.match(page, /href="\/auth\/google\/start"/);
  const mcpLogin = await fetch(`${t.base}/oauth/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual',
    body: new URLSearchParams({ ...Object.fromEntries(authorizationUrl.searchParams), action: 'login', username: 'adm', password: 'admin-password-12' }) });
  assert.equal(mcpLogin.status, 401); assert.ok(!mcpLogin.headers.get('set-cookie'));
  assert.match(await log(), /Password sign-in switched off: only Sign in with Google \(admin\)/);
  assert.match(await log(), /Password sign-in refused for "adm"/);
});

test('029+028: `duniya enable-password-login` switches passwords back on while the service runs (recovery)', async () => {
  const r = await duniya(['enable-password-login']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /Password sign-in is on again/);
  assert.equal((await t.api('', 'GET', '/api/session')).body.passwordLogin, true);
  assert.equal((await login('adm', 'admin-password-12')).status, 200);
  assert.match(await log(), /Password sign-in switched back on from the server command line/);
});

test('028: turning Google sign-in off or removing it brings passwords back automatically', async () => {
  assert.equal((await t.api(owner, 'PUT', '/api/auth/signin', { googleOnly: true })).status, 200);
  await t.api(owner, 'PUT', '/api/auth/google', { enabled: false });
  assert.equal((await t.api('', 'GET', '/api/session')).body.passwordLogin, true);
  assert.equal((await t.api(owner, 'GET', '/api/auth/signin')).body.on, false);
  assert.match(await log(), /Password sign-in switched back on because Sign in with Google was turned off/);
  await t.api(owner, 'PUT', '/api/auth/google', { enabled: true });
});

// ---------- 029: CLI ----------
test('029: help, unknown commands and usage errors', async () => {
  const h = await duniya(['help']);
  assert.equal(h.code, 0); assert.match(h.out, /reset-password <user>/); assert.match(h.out, /doctor/);
  assert.equal((await duniya([])).code, 0);
  const u = await duniya(['frobnicate']);
  assert.equal(u.code, 2); assert.match(u.err, /Unknown command "frobnicate"/);
  assert.equal((await duniya(['set-role', 'adm'])).code, 2);
  assert.match((await duniya(['--version'])).out, /^v\d+\.\d+\.\d+/);
});

test('029: create-user / list-users / set-role / remove-user against the live database', async () => {
  const c = await duniya(['create-user', 'Anu', '--role', 'viewer', '--email', 'anu@example.com']);
  assert.equal(c.code, 0, c.err);
  const pw = c.out.match(/Password: (\S+)/)[1];
  assert.ok(pw.length >= 12);
  assert.ok(t.store.authenticate('anu', pw), 'the printed password works');
  const l = await duniya(['list-users']);
  assert.match(l.out, /anu\s+viewer\s+password\s+anu@example\.com/);
  assert.match(l.out, /admin\s+owner\s+password \+ Google/);
  assert.equal((await duniya(['set-role', 'anu@example.com', 'admin'])).code, 0, 'accounts can be named by email');
  assert.equal(t.store.listUsers().find((u) => u.username === 'anu').role, 'admin');
  assert.equal((await duniya(['set-role', 'anu', 'boss'])).code, 1);
  const noYes = await duniya(['remove-user', 'anu']);
  assert.equal(noYes.code, 1); assert.match(noYes.err, /--yes/);
  assert.equal((await duniya(['remove-user', 'anu', '--yes'])).code, 0);
  assert.ok(!t.store.listUsers().some((u) => u.username === 'anu'));
  const last = await duniya(['remove-user', 'admin', '--yes']);
  assert.equal(last.code, 1); assert.match(last.err, /At least one owner must remain/);
  assert.equal((await duniya(['create-user', 'x', '--password', 'short'])).code, 1);
  assert.match(await log(), /User anu \(viewer\) added from the server command line/);
});

test('029: reset-password sets the given or a generated password and signs the account out everywhere', async () => {
  // (the panel's login rate limit is 5 a minute, so sessions/passwords are checked through the store here)
  const id = t.store.listUsers().find((u) => u.username === 'adm').id;
  const adm = `duniya_session=${t.store.createSession(id).token}`;
  assert.equal((await t.api(adm, 'GET', '/api/status')).status, 200);
  const r = await duniya(['reset-password', 'adm', '--password', 'brand-new-password-1']);
  assert.equal(r.code, 0, r.err);
  assert.equal((await t.api(adm, 'GET', '/api/status')).status, 401, 'old sessions are gone');
  assert.ok(t.store.authenticate('adm', 'brand-new-password-1'));
  const g = await duniya(['reset-password', 'adm']); // no terminal: makes one up and prints it
  const pw = g.out.match(/Password: (\S+)/)[1];
  assert.ok(t.store.authenticate('adm', pw)); assert.ok(!t.store.authenticate('adm', 'brand-new-password-1'));
  assert.equal((await duniya(['reset-password', 'nobody'])).code, 1);
  assert.match(await log(), /Password reset for adm from the server command line/);
});

test('029: status shows version, uptime, WhatsApp numbers and agents; doctor checks and suggests fixes', async () => {
  const s = await duniya(['status']);
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /Duniya v\d+\.\d+\.\d+/);
  assert.match(s.out, /running · up \d+s · pid \d+/);
  assert.match(s.out, /Channels\s+WhatsApp Main: connected as \+41790000099\n\s+Telegram @duniya_bot: connecting/, 'every channel\'s accounts');
  assert.match(s.out, /2 on, 0 off/); assert.match(s.out, /Panduga/);
  // 095: a release that did not start and was rolled back is named, while the server runs the version it went back to
  t.db.kvSet('updates:rolledBack', JSON.stringify({ ok: true, from: 'v99.0.0', to: t.config.APP_VERSION, target: 'v99.0.0', starts: 3, at: Date.now(), alerted: true }));
  assert.match((await duniya(['status'])).out, new RegExp(`Update\\s+v99\\.0\\.0 did not start here and was rolled back to ${t.config.APP_VERSION.replaceAll('.', '\\.')}`));
  t.db.kvSet('updates:rolledBack', 'null');
  assert.doesNotMatch((await duniya(['status'])).out, /did not start/);
  const d = await duniya(['doctor']);
  assert.match(d.out, /✓ Service running/);
  assert.match(d.out, /✓ Panel answers on 127\.0\.0\.1:\d+/);
  assert.match(d.out, /✓ WhatsApp Main connected\n! Telegram @duniya_bot: connecting/);
  assert.match(d.out, /! No public address[\s\S]*→ Re-run the installer/);
  assert.match(d.out, /Disk: .* free/);
  const sc = await duniya(['show-setup-code']);
  assert.equal(sc.code, 0); assert.match(sc.out, /already set up/);
});

test('029: on a fresh server show-setup-code prints the code; status says the service was not seen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duniya-cli-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'setup-code.txt'), 'ABCDE23456');
  const env = { DATA_DIR: join(dir, 'data'), ADMIN_PASSWORD: '' };
  const r = await duniya(['show-setup-code'], env);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /Setup code: ABCDE23456/);
  assert.match((await duniya(['status'], env)).out, /not seen yet/);
  assert.match((await duniya(['list-users'], env)).out, /No accounts yet/);
  const b = await duniya(['backup-now'], env);
  assert.equal(b.code, 1); assert.match(b.err, /backup passphrase/);
});

test('029: backup-now makes a backup while the service runs; Docker-only hints for logs/update', async () => {
  t.store.setSecret('BACKUP_PASSPHRASE', 'a long backup passphrase');
  const r = await duniya(['backup-now']);
  assert.equal(r.code, 0, r.err + r.out); assert.match(r.out, /✓ duniya-\d{8}-\d{6}-\d{3}\.dbk \(\d+ KB\): local ok/);
  assert.match((await duniya(['logs'], { DUNIYA_INSTALL: 'docker' })).out, /docker compose logs -f app/);
  assert.match((await duniya(['update', '--check'], { DUNIYA_INSTALL: 'docker' })).out, /docker compose pull/);
});
