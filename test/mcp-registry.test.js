// 052 (#99): browse the MCP Registry and add a tool service from it. A fake registry (same API as
// registry.modelcontextprotocol.io v0.1) — the real registry is never called.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup } from './harness.js';

let MCP = ''; // the harness's fake MCP server (base, no path)
const reg = { reqs: [], down: false };
const S = (server, meta = { status: 'active', publishedAt: '2026-10-01T00:00:00Z', isLatest: true }) => ({ server: { $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json', ...server }, _meta: { 'io.modelcontextprotocol.registry/official': meta } });
const entries = () => [
  S({ name: 'io.github.acme/notes-mcp', title: 'Acme Notes', description: 'Notes and agenda', version: '1.2.0', repository: { url: 'https://github.com/acme/notes-mcp', source: 'github' },
    remotes: [{ type: 'streamable-http', url: `${MCP}/mcp` }] }),
  S({ name: 'com.example/keyed', description: 'Needs a key', version: '2.0.0', repository: { url: 'https://github.com/example/keyed', source: 'github' },
    remotes: [{ type: 'streamable-http', url: `${MCP}/{region}/mcp`, variables: { region: { description: 'Region', isRequired: true, default: 'eu' } },
      headers: [{ name: 'Authorization', value: 'Bearer {api_key}', isRequired: true, isSecret: true, description: 'API key' }, { name: 'X-Workspace', isRequired: true, description: 'Workspace id' }] }] }),
  S({ name: 'io.github.acme/files', description: 'Local files', version: '0.3.1', repository: { url: 'https://github.com/acme/files', source: 'github' },
    packages: [{ registryType: 'npm', identifier: '@acme/files-mcp', version: '0.3.1', runtimeHint: 'npx', transport: { type: 'stdio' }, runtimeArguments: [{ type: 'positional', value: '-y' }],
      environmentVariables: [{ name: 'FILES_TOKEN', isRequired: true, isSecret: true, description: 'Token' }, { name: 'FILES_ROOT', default: '/srv/files' }],
      packageArguments: [{ type: 'named', name: 'read-only', format: 'boolean', description: 'Read only' }] },
    { registryType: 'oci', identifier: 'ghcr.io/acme/files:0.3.1', transport: { type: 'stdio' } }] }),
  S({ name: 'io.github.py/thing', description: 'Python only', version: '1.0.0', repository: { url: 'https://github.com/py/thing', source: 'github' },
    packages: [{ registryType: 'pypi', identifier: 'thing-mcp', version: '1.0.0', transport: { type: 'stdio' } }], remotes: [{ type: 'sse', url: 'https://thing.example/sse' }] }),
  S({ name: 'io.github.lone/hosted', description: 'Remote only, no source', version: '0.1.0', remotes: [{ type: 'streamable-http', url: 'https://lone.example/mcp' }] }, { status: 'deprecated' }),
];
const fakeRegistry = http.createServer((req, res) => {
  reg.reqs.push({ url: req.url, headers: req.headers });
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (reg.down) return json(500, { error: 'down' });
  if (url.pathname === '/v0.1/servers') {
    const q = (url.searchParams.get('search') || '').toLowerCase();
    const all = entries().filter((e) => e.server.name.toLowerCase().includes(q));
    const start = Number(url.searchParams.get('cursor') || 0);
    const n = Number(url.searchParams.get('limit') || 30);
    const page = all.slice(start, start + n);
    return json(200, { servers: page, metadata: { count: page.length, ...(start + n < all.length ? { nextCursor: String(start + n) } : {}) } });
  }
  const m = url.pathname.match(/^\/v0\.1\/servers\/([^/]+)\/versions\/latest$/);
  if (m) { const e = entries().find((x) => x.server.name === decodeURIComponent(m[1])); return e ? json(200, e) : json(404, { error: 'not found' }); }
  if (url.pathname === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/' }); return res.end(); }
  json(404, {});
}).listen(0);
await new Promise((r) => fakeRegistry.once('listening', r));
const REG = `http://127.0.0.1:${fakeRegistry.address().port}`;

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '200' } });
// Imported after setup(): the app's modules read DATA_DIR when first loaded.
const { TOOLS } = await import('../src/panel/admin-tools.js');
const { normalise, publisherOf, suggestKey, isRisky, cleanBaseUrl } = await import('../src/core/mcp-registry.js');
MCP = new URL(t.store.getSecret('PANDUGA_MCP_URL')).origin;
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
const admin = await t.login('ada', 'admin password 123');
t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 1' });
const viewer = await t.login('vic', 'viewer password 1');
const { setResourceProbe } = await import('../src/core/resources.js');
const BIG = { totalMb: 8192, cgroupLimitMb: null, availableMb: 6000, cpus: 4, rssMb: 100 };
const SMALL = { totalMb: 980, cgroupLimitMb: null, availableMb: 300, cpus: 1, rssMb: 120 };
setResourceProbe(BIG);
after(() => { setResourceProbe(null); fakeRegistry.close(); t.close(); });

test('registry settings: owner points it at a private registry; only https or this machine; off switch', async () => {
  assert.equal((await t.api(admin, 'PUT', '/api/tool-services/registry/settings', { baseUrl: REG })).status, 403, 'owner only');
  const bad = await t.api(owner, 'PUT', '/api/tool-services/registry/settings', { baseUrl: 'http://10.0.0.5/reg' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /https/);
  assert.throws(() => cleanBaseUrl('https://user:pw@reg.example'), /user name or password/);
  assert.equal(cleanBaseUrl('https://reg.example/base/'), 'https://reg.example/base');
  const off = await t.api(owner, 'PUT', '/api/tool-services/registry/settings', { baseUrl: REG, enabled: false });
  assert.deepEqual([off.body.enabled, off.body.baseUrl], [false, REG]);
  const n = reg.reqs.length;
  const r = await t.api(admin, 'GET', '/api/tool-services/registry?q=notes');
  assert.equal(r.status, 403);
  assert.match(r.body.error, /switched off/);
  assert.equal(reg.reqs.length, n, 'nothing fetched while off');
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/registry/settings', { enabled: true })).body.enabled, true);
  assert.equal((await t.api(viewer, 'GET', '/api/tool-services/registry/settings')).body.baseUrl, REG);
});

test('search: latest versions, name filter, pagination cursor, no credentials sent, short cache', async () => {
  assert.equal((await t.api(viewer, 'GET', '/api/tool-services/registry?q=acme')).status, 403, 'viewers cannot browse to add');
  const p1 = await t.api(admin, 'GET', '/api/tool-services/registry?q=io.github&limit=2');
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  assert.deepEqual(p1.body.items.map((i) => i.name), ['io.github.acme/notes-mcp', 'io.github.acme/files']);
  assert.equal(p1.body.nextCursor, '2');
  const last = reg.reqs.at(-1);
  const u = new URL(last.url, 'http://x');
  assert.deepEqual([u.searchParams.get('search'), u.searchParams.get('version'), u.searchParams.get('limit')], ['io.github', 'latest', '2']);
  assert.ok(!last.headers.cookie && !last.headers.authorization, 'no cookies or credentials go to the registry');
  const p2 = await t.api(admin, 'GET', `/api/tool-services/registry?q=io.github&limit=2&cursor=${p1.body.nextCursor}`);
  assert.deepEqual(p2.body.items.map((i) => i.name), ['io.github.py/thing', 'io.github.lone/hosted']);
  assert.equal(p2.body.nextCursor, null);
  const n = reg.reqs.length;
  await t.api(admin, 'GET', '/api/tool-services/registry?q=io.github&limit=2');
  assert.equal(reg.reqs.length, n, 'cached');
  reg.down = true;
  const down = await t.api(admin, 'GET', '/api/tool-services/registry?q=zzz');
  assert.equal(down.status, 502);
  reg.down = false;
});

test('normalisation: remotes, packages, unsupported types, secrets and trust hints', async () => {
  const [notes, keyed, files, py, lone] = entries().map(normalise);
  assert.equal(notes.title, 'Acme Notes');
  assert.deepEqual(notes.publisher, { kind: 'github', id: 'acme', label: 'GitHub: acme' });
  assert.equal(notes.trust.level, 'good');
  assert.equal(notes.can.remote, 0);
  assert.equal(notes.official, true);
  assert.deepEqual(publisherOf('com.example/keyed'), { kind: 'domain', id: 'example.com', label: 'example.com' });
  assert.deepEqual(keyed.remotes[0].headers.map((h) => [h.name, h.required, h.secret]), [['Authorization', true, true], ['X-Workspace', true, false]]);
  assert.equal(keyed.auth.needed, true);
  assert.equal(files.packages[0].spec, '@acme/files-mcp@0.3.1');
  assert.deepEqual(files.packages[0].env.map((e) => [e.name, e.required, e.secret]), [['FILES_TOKEN', true, true], ['FILES_ROOT', false, false]]);
  assert.equal(files.packages[1].supported, false);
  assert.match(files.packages[1].reason, /Docker image/);
  assert.equal(py.can.any, false);
  assert.match(py.can.reason, /SSE/);
  assert.match(py.can.reason, /Python package/);
  assert.equal(lone.trust.level, 'warn');
  assert.ok(lone.trust.warnings.some((w) => /no source code linked/.test(w)));
  assert.ok(lone.trust.warnings.some((w) => /deprecated/.test(w)));
  const odd = normalise({ server: { name: 'x.y/z', description: 'd', version: '1', repository: { url: 'javascript:alert(1)' }, websiteUrl: 'file:///etc/passwd' } });
  assert.equal(odd.repository, null, 'only http(s) links');
  assert.equal(odd.websiteUrl, '');
  assert.equal(suggestKey('io.github.acme/notes-mcp'), 'notes');
  assert.equal(suggestKey('com.x/memory'), 'memory_mcp', 'never a built-in name');
  assert.equal(isRisky({ name: 'delete_note' }), true);
  assert.equal(isRisky({ name: 'delete_note', annotations: { readOnlyHint: true } }), false);
  assert.equal(isRisky({ name: 'list_notes', annotations: { destructiveHint: true } }), true);
});

test('add a hosted service to one agent: tools listed, organizers on, participants off, confirm step set', async () => {
  const d = await t.api(admin, 'GET', `/api/tool-services/registry/server?name=${encodeURIComponent('io.github.acme/notes-mcp')}`);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.key, 'notes');
  assert.deepEqual(d.body.remote.fields, []);
  const r = await t.api(admin, 'POST', '/api/tool-services/registry/add', { server: 'io.github.acme/notes-mcp', target: 'helper' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.config.url, `${MCP}/mcp`);
  assert.equal(r.body.config.auth, 'none');
  assert.equal(r.body.discovery.status, 'ok');
  const byName = Object.fromEntries(r.body.discovery.tools.map((x) => [x.name, x]));
  assert.deepEqual([byName.agenda_list.organizer, byName.agenda_list.participant, byName.agenda_list.risky], [true, false, false]);
  assert.equal(byName.room_assign_preview.risky, true);
  assert.deepEqual([r.body.confirmGate.preview, r.body.confirmGate.tool, r.body.confirmGate.applied], ['notes:*_preview', 'notes:confirm', true]);
  const agent = (await t.api(admin, 'GET', '/api/agents/helper')).body;
  const cfg = agent.config || agent;
  assert.ok(cfg.tools.organizer.includes('notes:*'));
  assert.ok(!cfg.tools.participant.some((x) => x.startsWith('notes:')));
  assert.equal(cfg.confirm.tool, 'notes:confirm');
  const again = await t.api(admin, 'POST', '/api/tool-services/registry/add', { server: 'io.github.acme/notes-mcp', target: 'helper' });
  assert.equal(again.status, 409);
});

test('add for all agents with required keys: secrets stored, never returned; header and URL variable filled', async () => {
  const d = await t.api(admin, 'GET', `/api/tool-services/registry/server?name=${encodeURIComponent('com.example/keyed')}`);
  const ids = d.body.remote.fields.map((f) => [f.id, f.secret, f.required]);
  assert.deepEqual(ids, [['var:region', false, true], ['header:Authorization', true, true], ['header:X-Workspace', false, true]]);
  const miss = await t.api(admin, 'POST', '/api/tool-services/registry/add', { server: 'com.example/keyed', target: 'all', values: { 'header:X-Workspace': 'acme' } });
  assert.equal(miss.status, 400);
  assert.match(miss.body.error, /Fill in: Authorization/);
  const r = await t.api(admin, 'POST', '/api/tool-services/registry/add', { server: 'com.example/keyed', target: 'all', values: { 'header:Authorization': 'sk-live-123', 'header:X-Workspace': 'acme' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes('sk-live-123'), 'secret value never returned');
  assert.equal(r.body.config.url, `${MCP}/eu/mcp`, 'URL variable default used');
  assert.equal(r.body.config.auth, 'token');
  assert.equal(r.body.config.tokens.organizer, '${KEYED_AUTHORIZATION}');
  assert.deepEqual(r.body.config.headers, { 'X-Workspace': 'acme' });
  assert.deepEqual(r.body.config.defaults, { organizer: ['*'], participant: [] });
  assert.equal(t.store.getSecret('KEYED_AUTHORIZATION'), 'sk-live-123', 'stored without the "Bearer " the app adds itself');
  assert.equal(r.body.discovery.status, 'ok');
  assert.equal(r.body.confirmGate.applied, false, 'global: each agent chooses its confirm step');
  const list = await t.api(viewer, 'GET', '/api/tool-services');
  assert.ok(list.body.some((g) => g.name === 'keyed'));
  assert.ok(!JSON.stringify(list.body).includes('sk-live-123'));
  const acts = await t.api(owner, 'GET', '/api/activity?limit=50');
  assert.ok(!JSON.stringify(acts.body).includes('sk-live-123'), 'not in the activity log');
  assert.ok(acts.body.some((a) => /added from the MCP Registry \(com\.example\/keyed@2\.0\.0, hosted\) to all agents/.test(a.summary)));
});

test('unsupported entries are refused with the reason', async () => {
  const r = await t.api(admin, 'POST', '/api/tool-services/registry/add', { server: 'io.github.py/thing', target: 'all' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Python package/);
});

test('local npm packages: owner only, refused on small servers, saved without installing', async () => {
  const name = 'io.github.acme/files';
  const asAdmin = await t.api(admin, 'POST', '/api/tool-services/registry/add', { server: name, target: 'panduga', kind: 'local', values: { 'env:FILES_TOKEN': 'tok' } });
  assert.equal(asAdmin.status, 403);
  const d = await t.api(admin, 'GET', `/api/tool-services/registry/server?name=${encodeURIComponent(name)}`);
  assert.equal(d.body.local.allowed, false);
  setResourceProbe(SMALL);
  const small = await t.api(owner, 'POST', '/api/tool-services/registry/add', { server: name, target: 'panduga', kind: 'local', values: { 'env:FILES_TOKEN': 'tok' } });
  assert.equal(small.status, 400);
  assert.equal(small.body.code, 'small_server');
  assert.match(small.body.error, /small server/);
  assert.match((await t.api(owner, 'GET', `/api/tool-services/registry/server?name=${encodeURIComponent(name)}`)).body.local.reason, /small server/);
  setResourceProbe(BIG);
  const ok = await t.api(owner, 'POST', '/api/tool-services/registry/add', { server: name, target: 'panduga', kind: 'local', values: { 'env:FILES_TOKEN': 'tok', 'arg:read-only': 'true' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.config, { type: 'local', package: '@acme/files-mcp@0.3.1', args: ['--read-only'], env: { FILES_TOKEN: '${FILES_FILES_TOKEN}', FILES_ROOT: '/srv/files' }, allowScripts: false });
  assert.equal(ok.body.discovery.status, 'install', 'nothing installed until the owner asks');
  assert.deepEqual((await t.api(owner, 'GET', '/api/agents/panduga/local')).body.find((l) => l.server === 'files').installed, null);
});

test('admin MCP: search is read-only, adding needs confirm_action and never takes keys', async () => {
  const tool = (n) => TOOLS.find((x) => x.name === n);
  assert.ok(tool('search_mcp_registry').readOnly);
  assert.ok(tool('add_tool_service_from_registry').risky, 'adding needs confirm_action');
  const as = (cookie) => ({ call: async (method, path, body) => { const r = await t.api(cookie, method, path, body); if (r.status >= 400) throw Object.assign(new Error(r.body.error), { status: r.status }); return r.body; } });
  const x = as(admin);
  const s = await tool('search_mcp_registry').run({ query: 'lone' }, x);
  assert.deepEqual(s.servers.map((v) => [v.name, v.hosted, v.trust]), [['io.github.lone/hosted', true, 'warn']]);
  await assert.rejects(tool('add_tool_service_from_registry').preview({ server: 'com.example/keyed', target: 'panduga', name: 'keyed2', values: { 'header:Authorization': 'sk-x' } }, x), /Do not pass keys here: store KEYED2_AUTHORIZATION/);
  await assert.rejects(tool('add_tool_service_from_registry').preview({ server: 'com.example/keyed', target: 'panduga', name: 'keyed2' }, x), /Needs first: secret KEYED2_AUTHORIZATION/);
  const args = { server: 'io.github.acme/notes-mcp', target: 'panduga', name: 'notes2' };
  assert.match(await tool('add_tool_service_from_registry').preview(args, x), /Add "Acme Notes" \(io\.github\.acme\/notes-mcp 1\.2\.0, publisher GitHub: acme\) as tool service notes2 for "Panduga" \(panduga\)/);
  const out = await tool('add_tool_service_from_registry').run(args, x);
  assert.equal(out.tools.status, 'ok');
  assert.equal(out.confirm_step.applied, false, 'panduga already confirms through its own service');
  await assert.rejects(tool('add_tool_service_from_registry').preview({ server: 'io.github.acme/files', target: 'panduga', kind: 'local' }, x), /Only the owner/);
});
