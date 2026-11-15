// 010: local (stdio) tool services from a package, extra headers, and a pre-registered OAuth app.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setup } from './harness.js';

const FIXTURE = `file:${resolve(import.meta.dirname, 'fixtures/tiny-mcp')}`;
const seen = { headers: [], tokenAuth: [], registerCalls: 0 };
let BASE = '';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const codes = new Map();

const mcpHandler = async (req, res, raw) => {
  const s = new Server({ name: 'hdr', version: '1' }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'ping_me', description: 'p', inputSchema: { type: 'object', properties: {} } }] }));
  s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
  const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await s.connect(tr);
  return tr.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
};

const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  let raw = ''; for await (const c of req) raw += c;
  const json = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  // header-protected server
  if (url.pathname === '/keyed') {
    seen.headers.push(req.headers['x-api-key']);
    if (req.headers['x-api-key'] !== 'k-123') return json(403, { error: 'bad key' });
    return mcpHandler(req, res, raw);
  }
  // OAuth server WITHOUT dynamic registration (needs a pre-registered app)
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: `${BASE}/secure`, authorization_servers: [BASE] });
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.startsWith('/.well-known/openid-configuration')) {
    return json(200, { issuer: BASE, authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token`, response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'] });
  }
  if (url.pathname === '/register') { seen.registerCalls++; return json(404, {}); }
  if (url.pathname === '/token') {
    const f = new URLSearchParams(raw);
    seen.tokenAuth.push(req.headers.authorization || `post:${f.get('client_id')}:${f.get('client_secret')}`);
    const c = codes.get(f.get('code'));
    if (!c || b64url(createHash('sha256').update(f.get('code_verifier') || '').digest()) !== c) return json(400, { error: 'invalid_grant' });
    return json(200, { access_token: 'own-at', token_type: 'Bearer', expires_in: 3600 });
  }
  if (url.pathname === '/secure') {
    if (req.headers.authorization !== 'Bearer own-at') return json(401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/secure"` });
    return mcpHandler(req, res, raw);
  }
  res.writeHead(404); res.end();
}).listen(0);
await new Promise((r) => fake.once('listening', r));
BASE = `http://127.0.0.1:${fake.address().port}`;

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100', DUNIYA_TEST_ALLOW_FILE_SPECS: '1', SECRET_LEAK_CHECK: 'should-not-leak' } });
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
const admin = await t.login('ada', 'admin password 123');
t.store.setSecret('TINY_GREETING', 'namaste');
t.store.setSecret('KEYED_API_KEY', 'k-123');
t.store.setSecret('OWN_CLIENT_SECRET', 's3cret');
after(() => { fake.close(); t.close(); });

const base = { name: 'More', prompt: 'You help.', model: 'claude-sonnet-5-5', triggers: ['!m'], dm: 'organizers', organizers: ['41790000001'],
  tools: { participant: ['tiny:echo'], organizer: ['tiny:*', 'keyed:*', 'secure:*'], deny: [] } };
const localSrv = { type: 'local', package: FIXTURE, args: ['--hello'], env: { GREETING: '${TINY_GREETING}' } };

test('local services: only the owner may add or change them', async () => {
  const r = await t.api(admin, 'POST', '/api/agents', { id: 'more', config: { ...base, mcpServers: { tiny: localSrv } } });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Only the owner/);
  const ok = await t.api(owner, 'POST', '/api/agents', { id: 'more', config: { ...base, mcpServers: { tiny: localSrv } } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // an admin may still edit other parts of the agent without touching the local service
  const edit = await t.api(admin, 'PUT', '/api/agents/more', { prompt: 'You help a lot.', mcpServers: ok.body.config.mcpServers });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const change = await t.api(admin, 'PUT', '/api/agents/more', { mcpServers: { tiny: { ...localSrv, args: ['--evil'] } } });
  assert.equal(change.status, 403);
  const inst = await t.api(admin, 'POST', '/api/agents/more/local/tiny/install', {});
  assert.equal(inst.status, 403);
});

test('local services: bad package specs are rejected', async () => {
  for (const pkg of ['--global evil', 'https://evil.example/x.tgz', 'a b', '../x']) {
    const r = await t.api(owner, 'PUT', '/api/agents/more', { mcpServers: { tiny: { ...localSrv, package: pkg } } });
    assert.equal(r.status, 400, pkg);
  }
});

test('local services: install, discover, run with a scrubbed environment', async () => {
  const before = await t.api(owner, 'GET', '/api/agents/more/local');
  assert.equal(before.body[0].installed, null);
  const inst = await t.api(owner, 'POST', '/api/agents/more/local/tiny/install', {});
  assert.equal(inst.status, 200, JSON.stringify(inst.body));
  assert.equal(inst.body.name, 'tiny-mcp');
  assert.equal(inst.body.version, '1.2.3');
  assert.equal((await t.api(owner, 'GET', '/api/agents/more/local')).body[0].installed.version, '1.2.3');
  const d = await t.api(owner, 'POST', '/api/agents/more/discover', { type: 'local', server: 'tiny' });
  assert.deepEqual(d.body.map((x) => x.name).sort(), ['echo', 'env_report']);
  t.script.push([{ type: 'tool_use', id: 'l1', name: 'tiny__env_report', input: {} }], [{ type: 'text', text: 'done' }]);
  const n = t.claudeReqs.length;
  await t.api(owner, 'POST', '/api/agents/more/test', { role: 'organizer', text: 'env?' });
  const report = JSON.parse(JSON.stringify(t.claudeReqs[n + 1].messages).match(/\{\\"greeting.*?\]\}/)[0].replace(/\\"/g, '"'));
  assert.equal(report.greeting, 'namaste', 'configured env (with secret) passed');
  assert.deepEqual(report.args, ['--hello']);
  for (const k of ['SECRET_LEAK_CHECK', 'ADMIN_PASSWORD', 'ANTHROPIC_BASE_URL', 'DATA_DIR']) assert.ok(!report.keys.includes(k), `${k} not passed to the local server`);
  // participants only get the tools ticked for them
  t.script.push([{ type: 'text', text: 'hi' }]);
  const m = t.claudeReqs.length;
  await t.api(owner, 'POST', '/api/agents/more/test', { role: 'participant', text: 'hello' });
  assert.deepEqual(t.toolNames(m).filter((x) => x.startsWith('tiny__')), ['tiny__echo']);
});

test('remote services: extra headers are sent (with secrets) and never returned', async () => {
  const r = await t.api(owner, 'PUT', '/api/agents/more', { mcpServers: { tiny: localSrv, keyed: { url: `${BASE}/keyed`, auth: 'none', headers: { 'X-API-Key': '${KEYED_API_KEY}' } } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes('k-123'));
  const d = await t.api(owner, 'POST', '/api/agents/more/discover', { url: `${BASE}/keyed`, headers: { 'X-API-Key': '${KEYED_API_KEY}' } });
  assert.deepEqual(d.body.map((x) => x.name), ['ping_me']);
  t.script.push([{ type: 'tool_use', id: 'h1', name: 'keyed__ping_me', input: {} }], [{ type: 'text', text: 'pong!' }]);
  assert.equal((await t.api(owner, 'POST', '/api/agents/more/test', { role: 'organizer', text: 'ping' })).body.reply, 'pong!');
  assert.ok(seen.headers.includes('k-123'));
  const bad = await t.api(owner, 'PUT', '/api/agents/more', { mcpServers: { keyed: { url: `${BASE}/keyed`, headers: { Authorization: 'x' } } } });
  assert.equal(bad.status, 400, 'reserved headers are refused');
});

test('OAuth with a pre-registered app: no registration, client secret sent to the token endpoint', async () => {
  const r = await t.api(owner, 'PUT', '/api/agents/more', { mcpServers: { tiny: localSrv,
    secure: { url: `${BASE}/secure`, auth: 'oauth', oauthClient: { id: 'my-app', secret: '${OWN_CLIENT_SECRET}' } } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const start = await t.api(owner, 'POST', '/api/agents/more/connections/secure/organizer');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const q = new URL(start.body.authorizeUrl).searchParams;
  assert.equal(q.get('client_id'), 'my-app');
  assert.equal(seen.registerCalls, 0);
  codes.set('c-own', q.get('code_challenge'));
  const cb = await fetch(`${t.base}/oauth/mcp/callback?code=c-own&state=${q.get('state')}`);
  assert.equal(cb.status, 200, await cb.text());
  const auth = seen.tokenAuth.at(-1);
  assert.ok(auth === `Basic ${Buffer.from('my-app:s3cret').toString('base64')}` || auth === 'post:my-app:s3cret', auth);
  const d = await t.api(owner, 'POST', '/api/agents/more/discover', { auth: 'oauth', server: 'secure' });
  assert.deepEqual(d.body.map((x) => x.name), ['ping_me']);
});
