// 035: global tool services — defined once, used by every agent (opt-out per agent), per-role rules still apply,
// OAuth sign-ins per service, owner-only local services, admin MCP tools.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setup } from './harness.js';
import { TOOLS } from '../src/panel/admin-tools.js';

// ---------- fake OAuth-protected tool service (dynamic registration, PKCE) ----------
const as = { valid: new Set(), codes: new Map(), registered: 0, bearers: [] };
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let BASE = '';
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  let raw = ''; for await (const c of req) raw += c;
  const json = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: `${BASE}/mcp`, authorization_servers: [BASE] });
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.startsWith('/.well-known/openid-configuration')) {
    return json(200, { issuer: BASE, authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token`, registration_endpoint: `${BASE}/register`,
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
  }
  if (url.pathname === '/register') { as.registered++; return json(201, { ...JSON.parse(raw), client_id: `gclient-${as.registered}` }); }
  if (url.pathname === '/token') {
    const f = new URLSearchParams(raw);
    const c = as.codes.get(f.get('code'));
    if (!c || b64url(createHash('sha256').update(f.get('code_verifier') || '').digest()) !== c) return json(400, { error: 'invalid_grant' });
    as.valid.add('gat1');
    return json(200, { access_token: 'gat1', token_type: 'Bearer', expires_in: 3600 });
  }
  if (url.pathname === '/mcp') {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!as.valid.has(bearer)) return json(401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"` });
    as.bearers.push(bearer);
    const s = new Server({ name: 'cal', version: '1' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'cal_list', description: 'calendar', inputSchema: { type: 'object', properties: {} } }] }));
    s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'Mon: puja' }] }));
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(tr);
    return tr.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  }
  res.writeHead(404); res.end();
}).listen(0);
await new Promise((r) => fake.once('listening', r));
BASE = `http://127.0.0.1:${fake.address().port}`;

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100', DUNIYA_TEST_ALLOW_FILE_SPECS: '1' } });
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
const admin = await t.login('ada', 'admin password 123');
t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 1' });
const viewer = await t.login('vic', 'viewer password 1');
after(() => { fake.close(); t.close(); });

const FAKE = () => t.store.getSecret('PANDUGA_MCP_URL'); // the harness's fake MCP server
/** Tools the model is offered when `agent` answers a test message as `role`. */
async function offered(agent, role) {
  t.script.push([{ type: 'text', text: 'ok' }]);
  const n = t.claudeReqs.length;
  const r = await t.api(owner, 'POST', `/api/agents/${agent}/test`, { role, text: 'hello' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return t.toolNames(n);
}

test('a global service is added once and every agent gets its tools by the default role rules', async () => {
  t.store.setSecret('SHARED_TOKEN', 'org');
  const r = await t.api(admin, 'PUT', '/api/tool-services/shared', {
    url: FAKE(), auth: 'token', tokens: { organizer: '${SHARED_TOKEN}' }, defaults: { organizer: ['*'], participant: ['agenda_*'] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.config.tokens.organizer, '${SHARED_TOKEN}', 'secret references, never values');
  assert.deepEqual(r.body.agents.using.sort(), ['helper', 'panduga']);
  const list = await t.api(viewer, 'GET', '/api/tool-services');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((g) => g.name), ['shared']);
  assert.ok(!JSON.stringify(list.body).includes('"org"'), 'token value never returned');
  // helper has no tool services of its own: organizers get all, participants only agenda_*
  assert.deepEqual((await offered('helper', 'organizer')).filter((n) => n.startsWith('shared__')),
    ['shared__agenda_list', 'shared__confirm', 'shared__registrations_list', 'shared__room_assign_preview', 'shared__whoami']);
  assert.deepEqual((await offered('helper', 'participant')).filter((n) => n.startsWith('shared__')), ['shared__agenda_list']);
  // tool calls really go to the service
  t.script.push([{ type: 'tool_use', id: 'g1', name: 'shared__agenda_list', input: {} }], [{ type: 'text', text: 'Puja at 10' }]);
  const reply = await t.api(owner, 'POST', '/api/agents/helper/test', { role: 'participant', text: 'agenda?' });
  assert.equal(reply.body.reply, 'Puja at 10');
  assert.equal(t.mcpCalls.at(-1).name, 'agenda_list');
  const view = await t.api(owner, 'GET', '/api/agents/helper');
  assert.deepEqual(view.body.globalTools.map((g) => [g.name, g.on, g.replaced]), [['shared', true, false]]);
});

test('explicit role rules of an agent win over the defaults, and the deny list always wins', async () => {
  await t.api(owner, 'PUT', '/api/agents/helper', { tools: { participant: ['shared:whoami'], organizer: ['shared:-'], deny: ['shared:room_*'] } });
  assert.deepEqual((await offered('helper', 'participant')).filter((n) => n.startsWith('shared__')), ['shared__whoami']);
  assert.deepEqual((await offered('helper', 'organizer')).filter((n) => n.startsWith('shared__')), [], '"shared:-" = none for organizers');
  await t.api(owner, 'PUT', '/api/agents/helper', { tools: { participant: [], organizer: [], deny: ['shared:room_*'] } });
  assert.deepEqual((await offered('helper', 'organizer')).filter((n) => n.startsWith('shared__')), ['shared__agenda_list', 'shared__confirm', 'shared__registrations_list', 'shared__whoami']);
  await t.api(owner, 'PUT', '/api/agents/helper', { tools: { participant: [], organizer: [], deny: [] } });
});

test('an agent can opt out of a global service; an own service with the same name replaces it', async () => {
  const off = await t.api(admin, 'PUT', '/api/agents/helper', { globalMcp: { disabled: ['shared'] } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.deepEqual(off.body.config.globalMcp, { disabled: ['shared'] });
  assert.ok(!(await offered('helper', 'organizer')).some((n) => n.startsWith('shared__')));
  const g = (await t.api(owner, 'GET', '/api/tool-services')).body[0];
  assert.deepEqual([g.agents.using, g.agents.optedOut], [['panduga'], ['helper']]);
  await t.api(admin, 'PUT', '/api/agents/helper', { globalMcp: { disabled: [] } });
  assert.ok((await offered('helper', 'organizer')).includes('shared__whoami'));
  // own "shared" service (tools only via the agent's explicit rules) replaces the global one for this agent
  await t.api(owner, 'PUT', '/api/agents/helper', { mcpServers: { shared: { url: FAKE(), auth: 'none' } }, tools: { organizer: ['shared:whoami'], participant: [], deny: [] } });
  assert.deepEqual((await offered('helper', 'organizer')).filter((n) => n.startsWith('shared__')), ['shared__whoami']);
  assert.deepEqual((await t.api(owner, 'GET', '/api/tool-services')).body[0].agents.replacedBy, ['helper']);
  await t.api(owner, 'PUT', '/api/agents/helper', { mcpServers: {}, tools: { organizer: [], participant: [], deny: [] } });
  const bad = await t.api(owner, 'PUT', '/api/agents/helper', { globalMcp: { disabled: ['Not A Name'] } });
  assert.equal(bad.status, 400);
});

test('confirmation works through a global service (preview held, organizer confirms)', async () => {
  await t.api(owner, 'PUT', '/api/agents/helper', { confirm: { preview: 'shared:*_preview', tool: 'shared:confirm' } });
  assert.ok(!(await offered('helper', 'organizer')).includes('shared__confirm'), 'the confirm tool is never offered');
  t.script.push([{ type: 'tool_use', id: 'p1', name: 'shared__room_assign_preview', input: {} }], [{ type: 'text', text: 'Preview ready' }]);
  const r = await t.api(owner, 'POST', '/api/agents/helper/test', { role: 'organizer', text: 'assign Rao room 4' });
  const code = r.body.reply.match(/confirm ([A-Z0-9]{4})/)[1];
  assert.ok(!JSON.stringify(t.claudeReqs.at(-1)).includes('cf_SECRET123'), 'confirm id hidden from the model');
  const done = await t.api(owner, 'POST', '/api/agents/helper/test', { role: 'organizer', text: `confirm ${code}` });
  assert.match(done.body.reply, /Done/);
  assert.deepEqual(t.mcpCalls.at(-1), { name: 'confirm', arguments: { confirm_id: 'cf_SECRET123' } });
  await t.api(owner, 'PUT', '/api/agents/helper', { confirm: null });
});

test('validation: reserved and invalid names, bad defaults, viewers cannot change anything', async () => {
  for (const name of ['memory', 'whatsapp', 'Bad-Name']) assert.equal((await t.api(owner, 'PUT', `/api/tool-services/${name}`, { url: FAKE() })).status, 400, name);
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/x1', { url: FAKE(), defaults: { participant: ['a b'] } })).status, 400);
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/x1', { url: 'ftp://nope' })).status, 400);
  assert.equal((await t.api(viewer, 'PUT', '/api/tool-services/x1', { url: FAKE() })).status, 403);
  assert.equal((await t.api(viewer, 'DELETE', '/api/tool-services/shared')).status, 403);
  assert.equal((await t.api(owner, 'DELETE', '/api/tool-services/nothing')).status, 404);
});

test('local global services are owner-only', async () => {
  const local = { type: 'local', package: `file:${resolve(import.meta.dirname, 'fixtures/tiny-mcp')}` };
  const denied = await t.api(admin, 'PUT', '/api/tool-services/tiny', local);
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /Only the owner/);
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/tiny', local)).status, 201);
  assert.equal((await t.api(admin, 'PUT', '/api/tool-services/tiny', { url: FAKE() })).status, 403, 'an admin cannot turn a local service into something else');
  assert.equal((await t.api(admin, 'POST', '/api/tool-services/local/tiny/install', {})).status, 403);
  assert.equal((await t.api(admin, 'DELETE', '/api/tool-services/tiny')).status, 403);
  assert.deepEqual((await t.api(admin, 'GET', '/api/tool-services/local')).body.map((l) => [l.server, l.installed]), [['tiny', null]]);
  assert.equal((await t.api(owner, 'DELETE', '/api/tool-services/tiny')).status, 200);
});

test('OAuth sign-in of a global service is per service (shared by all agents), not per agent', async () => {
  const add = await t.api(admin, 'PUT', '/api/tool-services/cal', { url: `${BASE}/mcp`, auth: 'oauth', defaults: { organizer: ['*'], participant: ['*'] } });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const start = await t.api(admin, 'POST', '/api/tool-services/connections/cal/organizer');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const q = new URL(start.body.authorizeUrl).searchParams;
  as.codes.set('gcode', q.get('code_challenge'));
  const cb = await fetch(`${t.base}/oauth/mcp/callback?code=gcode&state=${q.get('state')}`);
  const html = await cb.text();
  assert.equal(cb.status, 200, html);
  assert.match(html, /#settings/);
  const conns = await t.api(owner, 'GET', '/api/tool-services/connections');
  assert.deepEqual(conns.body.map((c) => [c.server, c.role, c.status]), [['cal', 'organizer', 'connected']]);
  assert.equal(t.db.db.prepare("SELECT COUNT(*) n FROM mcp_oauth WHERE agent_id != '*'").get().n, 0, 'no per-agent rows');
  assert.ok(!JSON.stringify(conns.body).includes('gat1'), 'tokens never exposed');
  // both agents use the one sign-in (participants fall back to the organizer sign-in, tools limited by role)
  const before = as.bearers.length;
  assert.ok((await offered('helper', 'participant')).includes('cal__cal_list'));
  assert.ok((await offered('panduga', 'organizer')).includes('cal__cal_list'));
  assert.ok(as.bearers.length > before && as.bearers.slice(before).every((b) => b === 'gat1'));
  // removing the service deletes its sign-ins and forgets the agents' opt-outs
  await t.api(admin, 'PUT', '/api/agents/panduga', { globalMcp: { disabled: ['cal'] } });
  assert.equal((await t.api(admin, 'DELETE', '/api/tool-services/cal')).status, 200);
  assert.equal((await t.api(owner, 'GET', '/api/tool-services/connections')).body.length, 0);
  assert.deepEqual(t.agents.getAgent('panduga').globalMcp.disabled, []);
  assert.ok(!(await offered('helper', 'organizer')).some((n) => n.startsWith('cal__')));
});

test('secrets of global services are listed as needed', async () => {
  await t.api(owner, 'PUT', '/api/tool-services/needy', { url: FAKE(), auth: 'token', tokens: { organizer: '${NEEDY_TOKEN}' }, defaults: { organizer: [] } });
  const sec = (await t.api(owner, 'GET', '/api/secrets')).body.find((s) => s.name === 'NEEDY_TOKEN');
  assert.deepEqual(sec, { name: 'NEEDY_TOKEN', set: false, usedByAgents: true });
  assert.deepEqual((await t.api(owner, 'GET', '/api/tool-services')).body.find((g) => g.name === 'needy').needs, ['NEEDY_TOKEN']);
  // with no tool allowed for any role, the service is not even contacted
  assert.ok(!(await offered('helper', 'organizer')).some((n) => n.startsWith('needy__')));
  await t.api(owner, 'DELETE', '/api/tool-services/needy');
});

test('admin MCP tools list, add and remove global services (same routes and role gates)', async () => {
  const tool = (n) => TOOLS.find((x) => x.name === n);
  for (const n of ['list_global_tool_services', 'add_global_tool_service', 'remove_global_tool_service']) assert.ok(tool(n), n);
  assert.ok(tool('add_global_tool_service').risky && tool('remove_global_tool_service').risky, 'changes need confirm_action');
  const as = (cookie) => ({ call: async (method, path, body) => { const r = await t.api(cookie, method, path, body); if (r.status >= 400) throw Object.assign(new Error(r.body.error), { status: r.status }); return r.body; } });
  const x = as(admin);
  const args = { name: 'notes', config: { url: FAKE(), auth: 'none', defaults: { participant: ['whoami'] } } };
  assert.match(await tool('add_global_tool_service').preview(args, x), /Add the global tool service notes: .* available to 2 agents/);
  await tool('add_global_tool_service').run(args, x);
  const listed = await tool('list_global_tool_services').run({}, as(viewer));
  assert.deepEqual(listed.find((g) => g.name === 'notes').config.defaults, { organizer: ['*'], participant: ['whoami'] });
  await assert.rejects(tool('add_global_tool_service').run({ name: 'loc', config: { type: 'local', package: 'some-mcp@1.0.0' } }, x), /Only the owner/);
  assert.match(await tool('remove_global_tool_service').preview({ name: 'notes' }, x), /2 agents \((helper, panduga|panduga, helper)\) lose its tools/);
  await tool('remove_global_tool_service').run({ name: 'notes' }, x);
  await assert.rejects(tool('remove_global_tool_service').preview({ name: 'notes' }, x), /No global tool service/);
});

test('backups made by Duniya 1.x are refused with a plain message', async () => {
  const { encryptBundle, decryptBundle } = await import('../src/core/backup/bundle.js');
  const old = encryptBundle({ format: 'duniya-backup', version: 1, app: { version: 'v1.14.0' }, files: {} }, 'passphrase-123');
  assert.throws(() => decryptBundle(old, 'passphrase-123'), /made by Duniya v1\.14\.0 and cannot be restored into Duniya 2/);
});
