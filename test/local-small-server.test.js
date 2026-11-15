// 055 (#106): local (on-server, command-based) tool services are refused on small servers on every path, with the same
// message as the MCP Registry browser (052). Already-configured ones stay saved but are not started. The server size
// comes from a fake probe; nothing is installed and no package runs.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup();
const { setResourceProbe } = await import('../src/core/resources.js');
const { localServiceCheck, addedLocalServices } = await import('../src/core/mcp-local.js');
const { localRegistryCheck } = await import('../src/core/mcp-registry.js');
const { toolsFor } = await import('../src/core/tools.js');
const { getAgent } = await import('../src/core/agents.js');
const { TOOLS } = await import('../src/panel/admin-tools.js');
const owner = await t.login();
const SMALL = { totalMb: 970, cgroupLimitMb: null, availableMb: 500, cpus: 1, rssMb: 150 };
const BIG = { totalMb: 8000, cgroupLimitMb: null, availableMb: 6000, cpus: 4, rssMb: 150 };
after(() => { setResourceProbe(null); return t.close(); });
beforeEach(() => setResourceProbe(BIG));

const LOCAL = { type: 'local', package: '@acme/files-mcp@0.3.1', args: [], env: {} };
const base = { name: 'Files agent', prompt: 'Help.', tools: { organizer: ['files:*'], participant: [] } };
const isSmallRefusal = (r) => {
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'small_server');
  assert.match(r.body.error, /small server .*local tool services are not run here.*hosted tool service/);
};
const x = { call: async (method, path, body) => { const r = await t.api(owner, method, path, body); if (r.status >= 400) throw Object.assign(new Error(r.body.error), { status: r.status }); return r.body; } };
const tool = (n) => TOOLS.find((v) => v.name === n);

test('one rule: the registry check is the shared check; only new or changed local services count', () => {
  assert.equal(localRegistryCheck, localServiceCheck);
  assert.deepEqual(localServiceCheck(), { ok: true });
  setResourceProbe(SMALL);
  assert.equal(localServiceCheck().code, 'small_server');
  assert.deepEqual(addedLocalServices({ a: LOCAL }, { a: { ...LOCAL }, b: { url: 'https://x.example/mcp' } }), []);
  assert.deepEqual(addedLocalServices({ a: LOCAL }, { a: { ...LOCAL, args: ['--rw'] } }), ['a']);
  assert.deepEqual(addedLocalServices({}, { a: LOCAL }), ['a']);
});

test('agents: create, update, import and duplicate refuse a new local service on a small server', async () => {
  setResourceProbe(SMALL);
  isSmallRefusal(await t.api(owner, 'POST', '/api/agents', { id: 'files-a', config: { ...base, mcpServers: { files: LOCAL } } }));
  const plain = await t.api(owner, 'POST', '/api/agents', { id: 'files-b', config: base });
  assert.equal(plain.status, 201, 'agents without local services are fine');
  isSmallRefusal(await t.api(owner, 'PUT', '/api/agents/files-b', { mcpServers: { files: LOCAL } }));
  isSmallRefusal(await t.api(owner, 'POST', '/api/agents/import', { format: 'duniya-agent', version: 1, config: { ...base, mcpServers: { files: LOCAL } } }));
  assert.equal(getAgent('files-b').mcpServers.files, undefined);

  // Configured on a bigger server (or restored from a backup): other edits keep working, duplicating is refused.
  setResourceProbe(BIG);
  assert.equal((await t.api(owner, 'PUT', '/api/agents/files-b', { mcpServers: { files: LOCAL } })).status, 200);
  setResourceProbe(SMALL);
  const edit = await t.api(owner, 'PUT', '/api/agents/files-b', { prompt: 'Help more.', mcpServers: { ...getAgent('files-b').mcpServers } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  isSmallRefusal(await t.api(owner, 'PUT', '/api/agents/files-b', { mcpServers: { files: { ...LOCAL, package: '@acme/files-mcp@0.4.0' } } }));
  isSmallRefusal(await t.api(owner, 'POST', '/api/agents/files-b/duplicate', { id: 'files-c' }));
  assert.equal((await t.api(owner, 'PUT', '/api/agents/files-b', { mcpServers: {} })).status, 200, 'removing it is always allowed');
});

test('global tool services: adding or changing a local one is refused; remote ones are fine', async () => {
  setResourceProbe(SMALL);
  isSmallRefusal(await t.api(owner, 'PUT', '/api/tool-services/gfiles', LOCAL));
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/ghosted', { url: 'https://hosted.example/mcp' })).status, 201);
  setResourceProbe(BIG);
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/gfiles', LOCAL)).status, 201);
  setResourceProbe(SMALL);
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/gfiles', { ...LOCAL, defaults: { organizer: ['read_*'] } })).status, 200, 'same package, other defaults');
  isSmallRefusal(await t.api(owner, 'PUT', '/api/tool-services/gfiles', { ...LOCAL, env: { ROOT: '/srv' } }));
  assert.equal((await t.api(owner, 'DELETE', '/api/tool-services/gfiles')).status, 200);
  await t.api(owner, 'DELETE', '/api/tool-services/ghosted');
});

test('admin MCP and owner assistant (same tools): create_agent, update_agent and add_global_tool_service get the same refusal', async () => {
  setResourceProbe(SMALL);
  for (const [name, args] of [
    ['create_agent', { id: 'files-d', config: { ...base, mcpServers: { files: LOCAL } } }],
    ['update_agent', { agent_id: 'files-b', changes: { mcpServers: { files: LOCAL } } }],
    ['add_global_tool_service', { name: 'gfiles2', config: LOCAL }],
  ]) {
    await assert.rejects(tool(name).run(args, x), (e) => e.status === 400 && /small server/.test(e.message), name);
  }
});

test('AI helper never adds local services (unchanged, 010)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/core/ai-builder.js', import.meta.url), 'utf8');
  assert.match(src, /Local tool services run code on the server: the helper may not add or change them/);
});

test('already configured on a small server: not started, the reason is listed, install is refused, no crash', async () => {
  assert.equal((await t.api(owner, 'PUT', '/api/agents/files-b', { mcpServers: { files: LOCAL } })).status, 200);
  assert.equal((await t.api(owner, 'PUT', '/api/tool-services/gfiles', LOCAL)).status, 201);
  setResourceProbe(SMALL);
  const list = (await t.api(owner, 'GET', '/api/agents/files-b/local')).body;
  assert.match(list.find((l) => l.server === 'files').blocked, /small server/);
  assert.match((await t.api(owner, 'GET', '/api/tool-services/local')).body.find((l) => l.server === 'gfiles').blocked, /small server/);
  isSmallRefusal(await t.api(owner, 'POST', '/api/agents/files-b/local/files/install', {}));
  isSmallRefusal(await t.api(owner, 'POST', '/api/tool-services/local/gfiles/install', {}));

  const { defs, meta } = await toolsFor({ ...getAgent('files-b'), tools: { organizer: ['files:*', 'gfiles:*'], participant: [] } }, 'organizer');
  assert.equal(defs.filter((d) => /^g?files__/.test(d.name)).length, 0);
  const errors = meta.get('__errors') || [];
  assert.equal(errors.filter((e) => /Local tool service "g?files" is not started: This is a small server/.test(e)).length, 2, errors.join('\n'));
  const disc = await t.api(owner, 'POST', '/api/agents/files-b/discover', { type: 'local', server: 'files' });
  assert.equal(disc.status, 400);
  assert.match(disc.body.error, /not started/);
  const acts = (await t.api(owner, 'GET', '/api/activity?limit=200')).body;
  const rows = Array.isArray(acts) ? acts : acts.items || acts.rows || [];
  assert.ok(rows.some((a) => /Local tool service files not started/.test(a.summary || '')), 'explained once in the activity log');

  setResourceProbe(BIG);
  assert.equal((await t.api(owner, 'GET', '/api/agents/files-b/local')).body.find((l) => l.server === 'files').blocked, null);
  await t.api(owner, 'DELETE', '/api/tool-services/gfiles');
});
