// 017: admin MCP server — OAuth (metadata, registration, consent, PKCE, refresh rotation, revocation) and tools via the SDK client.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, registerClient, startAuthorization,
  exchangeAuthorization, refreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { setup } from './harness.js';

delete process.env.PUBLIC_URL;
const t = await setup();
after(() => t.close());
const owner = await t.login();
const MCP = `${t.base}/mcp`;
const REDIRECT = 'http://localhost:7777/callback';

let metadata;
const form = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)));
const post = (path, body, headers = {}) => fetch(t.base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(body), redirect: 'manual' });

/** Register a client and run the browser part of the sign-in with a panel session. Returns everything a client keeps. */
async function signIn(cookie, { name = 'Test assistant', redirect = REDIRECT, resource = MCP } = {}) {
  const clientInformation = await registerClient(t.base, { metadata, clientMetadata: { client_name: name, redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' } });
  const { authorizationUrl, codeVerifier } = await startAuthorization(t.base, { metadata, clientInformation, redirectUrl: redirect, scope: 'duniya', state: 'st4te', resource: new URL(resource) });
  const page = await fetch(authorizationUrl, { headers: { cookie } });
  const html = await page.text();
  assert.equal(page.status, 200, html);
  const csrf = /name=csrf value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'consent page shown');
  const r = await post('/oauth/authorize', { ...Object.fromEntries(authorizationUrl.searchParams), action: 'approve', csrf }, { cookie });
  assert.equal(r.status, 302);
  const back = new URL(r.headers.get('location'));
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get('state'), 'st4te');
  assert.equal(back.searchParams.get('iss'), t.base);
  return { clientInformation, codeVerifier, code: back.searchParams.get('code'), html };
}
async function tokensFor(cookie, opts) {
  const s = await signIn(cookie, opts);
  const tokens = await exchangeAuthorization(t.base, { metadata, clientInformation: s.clientInformation, authorizationCode: s.code, codeVerifier: s.codeVerifier, redirectUri: REDIRECT, resource: new URL(MCP) });
  return { ...s, tokens };
}
async function mcpClient(accessToken) {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
  return c;
}
const text = (r) => r.content.map((c) => c.text).join('');
const rawMcp = (token, body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }, host) => new Promise((resolve, reject) => {
  const u = new URL(MCP);
  const req = http.request({ host: u.hostname, port: u.port, path: '/mcp', method: 'POST', headers: { ...(host ? { host } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
    let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
  });
  req.on('error', reject); req.end(JSON.stringify(body));
});

test('metadata: protected resource (RFC 9728) and authorization server (RFC 8414), with CORS', async () => {
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const r = await fetch(t.base + p, { headers: { origin: 'https://claude.ai' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const m = await r.json();
    assert.equal(m.resource, MCP);
    assert.deepEqual(m.authorization_servers, [t.base]);
  }
  const prm = await discoverOAuthProtectedResourceMetadata(MCP);
  metadata = await discoverAuthorizationServerMetadata(prm.authorization_servers[0]);
  assert.equal(metadata.issuer, t.base);
  assert.equal(metadata.token_endpoint, `${t.base}/oauth/token`);
  assert.equal(metadata.registration_endpoint, `${t.base}/oauth/register`);
  assert.equal(metadata.revocation_endpoint, `${t.base}/oauth/revoke`);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
  const pre = await fetch(`${t.base}/oauth/token`, { method: 'OPTIONS', headers: { origin: 'https://chatgpt.com', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const panelApi = await fetch(`${t.base}/api/status`, { headers: { origin: 'https://evil.example' } });
  assert.equal(panelApi.headers.get('access-control-allow-origin'), null, 'no CORS on panel routes');
});

test('/mcp without a valid token: 401 with WWW-Authenticate resource_metadata', async () => {
  const r = await rawMcp(null);
  assert.equal(r.status, 401);
  assert.equal(r.headers['www-authenticate'], `Bearer resource_metadata="${t.base}/.well-known/oauth-protected-resource/mcp"`);
  const bad = await rawMcp('nope');
  assert.equal(bad.status, 401);
  assert.match(bad.headers['www-authenticate'], /error="invalid_token"/);
  const get = await fetch(MCP);
  assert.equal(get.status, 401);
});

test('dynamic client registration: public clients, https or loopback redirect URIs only', async () => {
  const ok = await fetch(`${t.base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'client_secret_post' }) });
  assert.equal(ok.status, 201);
  const c = await ok.json();
  assert.match(c.client_id, /^duniya-/);
  assert.equal(c.token_endpoint_auth_method, 'none');
  assert.equal(c.client_secret, undefined);
  for (const uri of ['http://evil.example/cb', 'javascript:alert(1)', 'https://x.example/cb#frag']) {
    const bad = await fetch(`${t.base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [uri] }) });
    assert.equal(bad.status, 400, uri);
    assert.equal((await bad.json()).error, 'invalid_redirect_uri');
  }
});

test('authorize: login form without a session, then consent shows client, host and role abilities', async () => {
  const clientInformation = await registerClient(t.base, { metadata, clientMetadata: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] } });
  const { authorizationUrl } = await startAuthorization(t.base, { metadata, clientInformation, redirectUrl: 'https://claude.ai/api/mcp/auth_callback', state: 's', resource: new URL(MCP) });
  const anon = await fetch(authorizationUrl);
  const html = await anon.text();
  assert.equal(anon.status, 200);
  assert.match(html, /Sign in to connect Claude/);
  assert.match(anon.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const params = Object.fromEntries(authorizationUrl.searchParams);
  const wrong = await post('/oauth/authorize', { ...params, action: 'login', username: 'admin', password: 'nope-nope-nope' });
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /Wrong username or password/);
  const login = await post('/oauth/authorize', { ...params, action: 'login', username: 'admin', password: 'correct horse battery' });
  const consent = await login.text();
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /duniya_session=.*SameSite=Strict/);
  assert.match(consent, /Connect Claude\?/);
  assert.match(consent, /claude\.ai/);
  assert.match(consent, /Manage users, backups, updates/, 'owner abilities');
  assert.match(login.headers.get('content-security-policy'), /form-action 'self' https:\/\/claude\.ai/);
  const deny = await post('/oauth/authorize', { ...params, action: 'deny' });
  assert.equal(deny.status, 302);
  assert.equal(new URL(deny.headers.get('location')).searchParams.get('error'), 'access_denied');
  // approve without a session (cross-site POST: the SameSite=Strict cookie is not sent) is refused
  const forged = await post('/oauth/authorize', { ...params, action: 'approve', csrf: 'x' });
  assert.equal(forged.status, 401);
  // a redirect URI that was not registered is never redirected to
  const evil = new URL(authorizationUrl); evil.searchParams.set('redirect_uri', 'https://evil.example/cb');
  const e = await fetch(evil, { headers: { cookie: owner }, redirect: 'manual' });
  assert.equal(e.status, 400);
  assert.match(await e.text(), /return address/);
});

let ownerSession;
test('authorization code + PKCE: exchange works once; wrong verifier, redirect or resource are rejected', async () => {
  const s = await signIn(owner);
  assert.match(s.html, /acts as <b>admin<\/b>/);
  const base = { grant_type: 'authorization_code', client_id: s.clientInformation.client_id, code: s.code, redirect_uri: REDIRECT, code_verifier: s.codeVerifier, resource: MCP };
  const badVerifier = await post('/oauth/token', { ...base, code_verifier: 'x'.repeat(43) });
  assert.equal(badVerifier.status, 400);
  assert.equal((await badVerifier.json()).error, 'invalid_grant');
  const reused = await post('/oauth/token', base);
  assert.equal((await reused.json()).error, 'invalid_grant', 'a code is single-use, even after a failed attempt');

  const s2 = await signIn(owner);
  const badRedirect = await post('/oauth/token', { ...base, client_id: s2.clientInformation.client_id, code: s2.code, code_verifier: s2.codeVerifier, redirect_uri: 'http://localhost:7777/other' });
  assert.equal((await badRedirect.json()).error, 'invalid_grant');

  const s3 = await signIn(owner);
  const badResource = await post('/oauth/token', { ...base, client_id: s3.clientInformation.client_id, code: s3.code, code_verifier: s3.codeVerifier, resource: 'https://other.example/mcp' });
  assert.equal((await badResource.json()).error, 'invalid_target');

  ownerSession = await tokensFor(owner);
  assert.equal(ownerSession.tokens.token_type.toLowerCase(), 'bearer');
  assert.equal(ownerSession.tokens.expires_in, 3600);
  assert.ok(ownerSession.tokens.refresh_token);
  const stored = JSON.stringify(t.db.db.prepare('SELECT * FROM admin_oauth_tokens').all());
  assert.ok(!stored.includes(ownerSession.tokens.access_token) && !stored.includes(ownerSession.tokens.refresh_token), 'tokens stored hashed');
});

test('resource binding: an authorize request for another resource is refused; tokens only work for this /mcp', async () => {
  const clientInformation = await registerClient(t.base, { metadata, clientMetadata: { client_name: 'X', redirect_uris: [REDIRECT] } });
  const { authorizationUrl } = await startAuthorization(t.base, { metadata, clientInformation, redirectUrl: REDIRECT, state: 's', resource: new URL('https://other.example/mcp') });
  const r = await fetch(authorizationUrl, { headers: { cookie: owner }, redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).searchParams.get('error'), 'invalid_target');
  const elsewhere = await rawMcp(ownerSession.tokens.access_token, undefined, 'other-host.example');
  assert.equal(elsewhere.status, 401, 'token audience is this server\'s /mcp URL');
  const here = await rawMcp(ownerSession.tokens.access_token);
  assert.equal(here.status, 200);
});

test('tools via the SDK client: read and write as the approving user, logged as mcp.call', async () => {
  const c = await mcpClient(ownerSession.tokens.access_token);
  const names = (await c.listTools()).tools.map((x) => x.name);
  for (const n of ['get_overview', 'list_agents', 'create_agent', 'delete_agent', 'list_users', 'restore_backup', 'confirm_action', 'list_whatsapp_numbers', 'list_global_tool_services', 'add_global_tool_service']) assert.ok(names.includes(n), n);
  const del = (await c.listTools()).tools.find((x) => x.name === 'delete_agent');
  assert.equal(del.annotations.destructiveHint, true);

  const agents = JSON.parse(text(await c.callTool({ name: 'list_agents', arguments: {} })));
  assert.deepEqual(agents.map((b) => b.id).sort(), ['helper', 'panduga']);
  const ov = JSON.parse(text(await c.callTool({ name: 'get_overview', arguments: {} })));
  assert.equal(ov.you.username, 'admin');

  const w = await c.callTool({ name: 'set_agent_enabled', arguments: { agent_id: 'helper', enabled: false } });
  assert.ok(!w.isError, text(w));
  assert.equal(t.agents.getAgent('helper').enabled, false);
  await c.callTool({ name: 'set_agent_enabled', arguments: { agent_id: 'helper', enabled: true } });

  t.script.push([{ type: 'text', text: 'Hello from helper' }]);
  const reply = JSON.parse(text(await c.callTool({ name: 'test_agent', arguments: { agent_id: 'helper', text: 'hi', as: 'organizer' } })));
  assert.equal(reply.reply, 'Hello from helper');

  const secrets = text(await c.callTool({ name: 'list_secrets', arguments: {} }));
  assert.ok(secrets.includes('PANDUGA_TOKEN_ORGANIZER') && !secrets.includes('"org"'), 'secret names only');

  const log = t.db.listActivity({ limit: 50 }).find((a) => a.type === 'mcp.call' && a.summary.startsWith('set_agent_enabled'));
  assert.ok(log, 'tool call logged');
  assert.match(log.summary, /admin via Test assistant/);
  assert.equal(t.events.categoryOf('mcp.call'), 'mcp');
  assert.equal(t.events.LOG_CATEGORIES.mcp, 'AI assistants (MCP)');

  const filtered = JSON.parse(text(await c.callTool({ name: 'list_activity', arguments: { chat: 'panel:helper', limit: 5 } })));
  assert.ok(filtered.length && filtered.every((a) => a.chat === 'panel:helper'));
  await c.close();
});

test('risky tools need confirm_action with a single-use code bound to the user', async () => {
  const c = await mcpClient(ownerSession.tokens.access_token);
  const pre = await c.callTool({ name: 'delete_agent', arguments: { agent_id: 'helper' } });
  assert.ok(!pre.isError, text(pre));
  assert.match(text(pre), /Delete the agent "Helper"/);
  const code = pre.structuredContent.confirm_code;
  assert.ok(code);
  assert.ok(t.agents.getAgent('helper'), 'nothing deleted before confirmation');
  const wrong = await c.callTool({ name: 'confirm_action', arguments: { confirm_code: 'WRONG123' } });
  assert.ok(wrong.isError);
  const ok = await c.callTool({ name: 'confirm_action', arguments: { confirm_code: code } });
  assert.ok(!ok.isError, text(ok));
  assert.equal(t.agents.getAgent('helper'), undefined);
  const again = await c.callTool({ name: 'confirm_action', arguments: { confirm_code: code } });
  assert.ok(again.isError, 'single-use');
  const missing = await c.callTool({ name: 'erase_chat_memory', arguments: {} });
  assert.ok(missing.isError && /Missing: chat/.test(text(missing)));
  const acts = t.db.listActivity({ limit: 30 });
  assert.ok(acts.some((a) => a.type === 'confirm.created' && /Helper/.test(a.summary)));
  assert.ok(acts.some((a) => a.type === 'confirm.applied' && /Helper/.test(a.summary)));
  // set_secret previews without echoing the value
  const sp = await c.callTool({ name: 'set_secret', arguments: { name: 'NEW_KEY', value: 'sup3r-s3cret' } });
  assert.ok(!text(sp).includes('sup3r-s3cret'));
  assert.equal(t.store.getSecret('NEW_KEY'), '');
  await c.callTool({ name: 'confirm_action', arguments: { confirm_code: sp.structuredContent.confirm_code } });
  assert.equal(t.store.getSecret('NEW_KEY'), 'sup3r-s3cret');
  assert.ok(!JSON.stringify(t.db.listActivity({ limit: 30 })).includes('sup3r-s3cret'), 'secret values never logged');
  globalThis.ownerPendingCode = (await c.callTool({ name: 'delete_agent', arguments: { agent_id: 'panduga' } })).structuredContent.confirm_code;
  await c.close();
});

let viewer;
test('a viewer\'s assistant sees read tools only and cannot write or confirm', async () => {
  const u = await t.api(owner, 'POST', '/api/users', { username: 'vera', role: 'viewer', password: 'viewer password 1' });
  assert.equal(u.status, 200);
  const vcookie = await t.login('vera', 'viewer password 1');
  viewer = { id: u.body.id, ...(await tokensFor(vcookie, { name: 'Viewer GPT' })) };
  assert.match(viewer.html, /cannot change anything|read-only/i);
  const c = await mcpClient(viewer.tokens.access_token);
  const names = (await c.listTools()).tools.map((x) => x.name);
  assert.ok(names.includes('list_agents') && names.includes('list_activity'));
  for (const n of ['create_agent', 'set_agent_enabled', 'delete_agent', 'confirm_action', 'list_users', 'list_os_updates']) assert.ok(!names.includes(n), n);
  const w = await c.callTool({ name: 'set_agent_enabled', arguments: { agent_id: 'panduga', enabled: false } });
  assert.ok(w.isError);
  assert.match(text(w), /Read-only/);
  assert.equal(t.agents.getAgent('panduga').enabled, true);
  const steal = await c.callTool({ name: 'confirm_action', arguments: { confirm_code: globalThis.ownerPendingCode } });
  assert.ok(steal.isError, 'confirm codes are bound to the user');
  assert.ok(t.agents.getAgent('panduga'));
  await c.close();
});

test('refresh tokens rotate; reusing an old one revokes the whole sign-in', async () => {
  const args = { metadata, clientInformation: ownerSession.clientInformation, resource: new URL(MCP) };
  const r1 = await refreshAuthorization(t.base, { ...args, refreshToken: ownerSession.tokens.refresh_token });
  assert.notEqual(r1.refresh_token, ownerSession.tokens.refresh_token);
  assert.equal((await rawMcp(r1.access_token)).status, 200);
  const r2 = await refreshAuthorization(t.base, { ...args, refreshToken: r1.refresh_token });
  assert.equal((await rawMcp(r2.access_token)).status, 200);
  await assert.rejects(refreshAuthorization(t.base, { ...args, refreshToken: r1.refresh_token }), /already used|invalid/i);
  assert.equal((await rawMcp(r2.access_token)).status, 401, 'family revoked');
  await assert.rejects(refreshAuthorization(t.base, { ...args, refreshToken: r2.refresh_token }));
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => a.type === 'config' && /reused/.test(a.summary)));
});

test('revocation: token endpoint (RFC 7009) and Settings → Connected AI assistants', async () => {
  const s = await tokensFor(owner, { name: 'Revoke me' });
  assert.equal((await rawMcp(s.tokens.access_token)).status, 200);
  const rv = await post('/oauth/revoke', { token: s.tokens.access_token, client_id: s.clientInformation.client_id });
  assert.equal(rv.status, 200);
  assert.equal((await rawMcp(s.tokens.access_token)).status, 401);

  const s2 = await tokensFor(owner, { name: 'Panel revoke' });
  const list = await t.api(owner, 'GET', '/api/assistants');
  assert.equal(list.body.mcpUrl, MCP);
  const g = list.body.grants.find((x) => x.clientName === 'Panel revoke');
  assert.ok(g && g.username === 'admin' && g.redirectHost === 'localhost:7777');
  assert.ok(list.body.grants.some((x) => x.username === 'vera'), 'owners see everyone\'s assistants');
  const vcookie = await t.login('vera', 'viewer password 1');
  const vlist = await t.api(vcookie, 'GET', '/api/assistants');
  assert.ok(vlist.body.grants.every((x) => x.username === 'vera'), 'others see their own');
  const forbidden = await t.api(vcookie, 'DELETE', `/api/assistants/${g.userId}/${g.clientId}`);
  assert.equal(forbidden.status, 403);
  const del = await t.api(owner, 'DELETE', `/api/assistants/${g.userId}/${g.clientId}`);
  assert.equal(del.status, 200);
  assert.equal((await rawMcp(s2.tokens.access_token)).status, 401);
  await assert.rejects(refreshAuthorization(t.base, { metadata, clientInformation: s2.clientInformation, refreshToken: s2.tokens.refresh_token, resource: new URL(MCP) }));
  assert.ok(t.db.listActivity({ limit: 20 }).some((a) => a.type === 'config' && /Panel revoke.*disconnected/.test(a.summary)));
});

test('disabled and deleted users\' tokens stop working immediately', async () => {
  assert.equal((await rawMcp(viewer.tokens.access_token)).status, 200);
  await t.api(owner, 'PUT', `/api/users/${viewer.id}`, { disabled: true });
  assert.equal((await rawMcp(viewer.tokens.access_token)).status, 401);
  await assert.rejects(refreshAuthorization(t.base, { metadata, clientInformation: viewer.clientInformation, refreshToken: viewer.tokens.refresh_token, resource: new URL(MCP) }));
  await t.api(owner, 'DELETE', `/api/users/${viewer.id}`);
  assert.equal(t.db.db.prepare('SELECT COUNT(*) n FROM admin_oauth_grants WHERE user_id = ?').get(viewer.id).n, 0);
});

test('admins do not get owner-only tools; rate limit is 60 calls per minute per token', async () => {
  await t.api(owner, 'POST', '/api/users', { username: 'adam', role: 'admin', password: 'admin password 12' });
  const s = await tokensFor(await t.login('adam', 'admin password 12'), { name: 'Admin assistant' });
  const c = await mcpClient(s.tokens.access_token);
  const names = (await c.listTools()).tools.map((x) => x.name);
  assert.ok(names.includes('create_agent') && names.includes('confirm_action'));
  for (const n of ['list_users', 'restore_backup', 'apply_update', 'run_maintenance', 'add_whatsapp_number']) assert.ok(!names.includes(n), n);
  await c.close();
  let last;
  for (let i = 0; i < 62; i++) last = await rawMcp(s.tokens.access_token);
  assert.equal(last.status, 429);
});
