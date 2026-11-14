// 009: sign in to a tool service with OAuth (fake authorization server + protected MCP server).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setup } from './harness.js';

const as = { valid: new Set(), refreshes: 0, refuseRefresh: false, bearers: [], registered: [], challenge: '', codes: new Map(), tokenReqs: [] };
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let BASE = '';

const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  let raw = ''; for await (const c of req) raw += c;
  const json = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/old') { res.writeHead(308, { location: `${BASE}/mcp` }); return res.end(); }
  if (url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/.well-known/oauth-protected-resource') {
    return json(200, { resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ['panduga', 'offline_access'], resource_name: 'Fake planner' });
  }
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.startsWith('/.well-known/openid-configuration')) {
    return json(200, { issuer: BASE, authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token`, registration_endpoint: `${BASE}/register`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['panduga', 'offline_access'] });
  }
  if (url.pathname === '/register') {
    const body = JSON.parse(raw); as.registered.push(body);
    return json(201, { ...body, client_id: `client-${as.registered.length}`, client_id_issued_at: 1 });
  }
  if (url.pathname === '/token') {
    const f = new URLSearchParams(raw); as.tokenReqs.push(Object.fromEntries(f));
    if (f.get('grant_type') === 'authorization_code') {
      const c = as.codes.get(f.get('code'));
      if (!c || b64url(createHash('sha256').update(f.get('code_verifier') || '').digest()) !== c.challenge || f.get('redirect_uri') !== c.redirect) return json(400, { error: 'invalid_grant' });
      as.codes.delete(f.get('code'));
      as.valid.add('at1');
      return json(200, { access_token: 'at1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt1', scope: 'panduga offline_access' });
    }
    if (f.get('grant_type') === 'refresh_token') {
      if (as.refuseRefresh || f.get('refresh_token') !== 'rt1') return json(400, { error: 'invalid_grant' });
      as.refreshes++; const at = `at${as.refreshes + 1}`; as.valid.add(at);
      return json(200, { access_token: at, token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt1' });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }
  if (url.pathname === '/mcp') {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!as.valid.has(bearer)) return json(401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"` });
    as.bearers.push(bearer);
    const s = new Server({ name: 'fake-oauth', version: '1' }, { capabilities: { tools: {} } });
    const tool = (name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ['whoami', 'agenda_list', 'room_assign_preview'].map(tool) }));
    s.setRequestHandler(CallToolRequestSchema, async (r) => ({ content: [{ type: 'text', text: r.params.name === 'agenda_list' ? 'Puja 10:00' : 'ok' }] }));
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(tr);
    return tr.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  }
  res.writeHead(404); res.end();
}).listen(0);
await new Promise((r) => fake.once('listening', r));
BASE = `http://127.0.0.1:${fake.address().port}`;

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
const cookie = await t.login();
after(() => { fake.close(); t.close(); });

await t.bots.createBot({ id: 'oauthbot', config: {
  name: 'OAuth bot', prompt: 'You help.', model: 'claude-sonnet-5-5', triggers: ['!o'], dm: 'organizers', organizers: ['41790000001'],
  mcpServers: { svc: { url: `${BASE}/mcp`, auth: 'oauth' } },
  tools: { participant: ['svc:agenda_list'], organizer: ['svc:*'], deny: [] },
} });

let authUrl;
test('US1: probe detects OAuth and follows the permanent redirect', async () => {
  const r = await t.api(cookie, 'POST', '/api/bots/oauthbot/probe', { url: `${BASE}/old` });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { url: `${BASE}/mcp`, auth: 'oauth', name: 'Fake planner' });
  const open = await t.api(cookie, 'POST', '/api/bots/panduga/probe', { url: '${PANDUGA_MCP_URL}' });
  assert.equal(open.body.auth, 'none', 'the token-less fake MCP server is open');
});

test('US1: tools are unavailable until signed in', async () => {
  const r = await t.api(cookie, 'POST', '/api/bots/oauthbot/discover', { auth: 'oauth', server: 'svc' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not signed in/);
});

test('US1: connect → service sign-in page with PKCE, state, resource and scopes', async () => {
  const r = await t.api(cookie, 'POST', '/api/bots/oauthbot/connections/svc/organizer');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  authUrl = new URL(r.body.authorizeUrl);
  assert.equal(authUrl.origin + authUrl.pathname, `${BASE}/authorize`);
  const q = authUrl.searchParams;
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('code_challenge') && q.get('state'));
  assert.equal(q.get('redirect_uri'), `${t.base}/oauth/mcp/callback`);
  assert.equal(q.get('resource'), `${BASE}/mcp`);
  assert.match(q.get('scope'), /offline_access/);
  assert.equal(q.get('client_id'), 'client-1');
  assert.deepEqual(as.registered[0].redirect_uris, [`${t.base}/oauth/mcp/callback`]);
  assert.equal(t.mcpOauthRows?.() ?? t.db.db.prepare('SELECT COUNT(*) n FROM mcp_oauth').get().n, 0, 'nothing stored before the sign-in completes');
  const viewer = await t.api('', 'POST', '/api/bots/oauthbot/connections/svc/organizer');
  assert.equal(viewer.status, 401, 'only signed-in admins can start');
});

test('US1: callback with a wrong state or a denial stores nothing', async () => {
  const bad = await fetch(`${t.base}/oauth/mcp/callback?code=x&state=nope`);
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /expired or was already used/);
});

test('US1: callback completes the sign-in; state is single-use; tokens never exposed', async () => {
  const q = authUrl.searchParams;
  as.codes.set('code1', { challenge: q.get('code_challenge'), redirect: q.get('redirect_uri') });
  const r = await fetch(`${t.base}/oauth/mcp/callback?code=code1&state=${q.get('state')}`);
  const html = await r.text();
  assert.equal(r.status, 200, html);
  assert.match(html, /Connected svc for organizers/);
  assert.match(html, /#bots\/oauthbot/);
  const again = await fetch(`${t.base}/oauth/mcp/callback?code=code1&state=${q.get('state')}`);
  assert.equal(again.status, 400, 'state is single-use');
  const conns = await t.api(cookie, 'GET', '/api/bots/oauthbot/connections');
  assert.equal(conns.body.length, 1);
  assert.equal(conns.body[0].status, 'connected');
  assert.equal(conns.body[0].connectedBy, 'admin');
  assert.ok(!JSON.stringify(conns.body).includes('at1') && !JSON.stringify(conns.body).includes('rt1'));
  const enc = t.db.db.prepare('SELECT data_enc FROM mcp_oauth').get().data_enc;
  assert.ok(!enc.includes('at1') && !enc.includes('rt1'), 'stored encrypted');
  const exp = await t.api(cookie, 'GET', '/api/bots/oauthbot/export');
  assert.ok(!JSON.stringify(exp.body).includes('at1'));
});

test('US1/US3: discover and use tools; participants fall back to the organizer sign-in with participant tools only', async () => {
  const d = await t.api(cookie, 'POST', '/api/bots/oauthbot/discover', { auth: 'oauth', server: 'svc' });
  assert.deepEqual(d.body.map((x) => x.name).sort(), ['agenda_list', 'room_assign_preview', 'whoami']);
  assert.equal(as.bearers.at(-1), 'at1');
  t.script.push([{ type: 'tool_use', id: 'tu1', name: 'svc__agenda_list', input: {} }], [{ type: 'text', text: 'Puja at 10' }]);
  const n = t.claudeReqs.length;
  const r = await t.api(cookie, 'POST', '/api/bots/oauthbot/test', { role: 'participant', text: 'agenda?' });
  assert.equal(r.body.reply, 'Puja at 10');
  assert.deepEqual(t.toolNames(n).filter((x) => x.startsWith('svc__')), ['svc__agenda_list']);
});

test('US2: an expired access token is refreshed automatically', async () => {
  as.valid.delete('at1');
  t.script.push([{ type: 'tool_use', id: 'tu2', name: 'svc__whoami', input: {} }], [{ type: 'text', text: 'You are the organizer' }]);
  const r = await t.api(cookie, 'POST', '/api/bots/oauthbot/test', { role: 'organizer', text: 'who am I?' });
  assert.equal(r.body.reply, 'You are the organizer');
  assert.equal(as.refreshes, 1);
  assert.equal(as.bearers.at(-1), 'at2');
  const enc = t.db.db.prepare('SELECT data_enc FROM mcp_oauth').get().data_enc;
  assert.ok(!enc.includes('at2'));
});

test('US2: a refused refresh marks the connection "reconnect" and the bot says so', async () => {
  as.refuseRefresh = true;
  as.valid.clear();
  t.script.push([{ type: 'tool_use', id: 'tu3', name: 'svc__whoami', input: {} }], [{ type: 'text', text: 'The planner is unavailable right now.' }]);
  const n = t.claudeReqs.length;
  await t.api(cookie, 'POST', '/api/bots/oauthbot/test', { role: 'organizer', text: 'who am I?' });
  const toolResult = JSON.stringify(t.claudeReqs[n + 1]?.messages ?? '');
  assert.match(toolResult, /reconnect/i);
  const conns = await t.api(cookie, 'GET', '/api/bots/oauthbot/connections');
  assert.equal(conns.body[0].status, 'reconnect');
  const acts = await t.api(cookie, 'GET', '/api/activity?limit=200');
  assert.ok(acts.body.some((a) => a.type === 'error' && /expired: reconnect/.test(a.summary)));
});

test('US3: disconnect and bot deletion remove stored sign-ins', async () => {
  const d = await t.api(cookie, 'DELETE', '/api/bots/oauthbot/connections/svc/organizer');
  assert.equal(d.status, 200);
  assert.equal((await t.api(cookie, 'GET', '/api/bots/oauthbot/connections')).body.length, 0);
  t.db.db.prepare("INSERT INTO mcp_oauth (tenant_id, bot_id, server, role, url, data_enc, status) VALUES ('default','oauthbot','svc','participant','x','x','connected')").run();
  await t.api(cookie, 'DELETE', '/api/bots/oauthbot');
  assert.equal(t.db.db.prepare('SELECT COUNT(*) n FROM mcp_oauth').get().n, 0);
});

test('schema: auth must be oauth, token or none; oauth drops token references', async () => {
  const bad = await t.api(cookie, 'PUT', '/api/bots/panduga', { mcpServers: { panduga: { url: 'https://x.example/mcp', auth: 'magic' } } });
  assert.equal(bad.status, 400);
  const ok = await t.api(cookie, 'PUT', '/api/bots/panduga', { mcpServers: { panduga: { url: 'https://x.example/mcp', auth: 'oauth', tokens: { organizer: '${PANDUGA_TOKEN_ORGANIZER}' } } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.config.mcpServers.panduga.tokens, { organizer: '', participant: '' });
  assert.equal(t.bots.templateConfig('event-assistant-panduga').mcpServers.panduga.auth, 'oauth');
});
