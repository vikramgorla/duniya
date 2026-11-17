// 065 (#131): release notes — changes per version, the range between two versions, "What's new" once per person after
// an update, and the admin MCP catalog. The installed notes are the repository's own releases.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup();
after(() => t.close());
const u = await import('../src/core/updates.js');
const rel = await import('../src/core/releases.js');
const owner = await t.login();

test('065: changes are normalised and a range is listed newest first', () => {
  const r = rel.normalizeReleases({ versions: {
    '1.0.0': { title: 'One', changes: [{ type: 'new', text: ' Polls ' }, { type: 'odd', text: 'Kept as improved' }, { text: '' }, 'not an object', { type: 'fixed' }] },
    '1.1.0': { title: 'Two', changes: [{ type: 'removed', text: 'Old switch' }] },
    '1.2.0': { title: 'Three' },
  } });
  assert.deepEqual(r['1.0.0'].changes, [{ type: 'new', text: 'Polls' }, { type: 'improved', text: 'Kept as improved' }]);
  assert.deepEqual(r['1.2.0'].changes, []);
  assert.deepEqual(rel.releaseRange(r, 'v1.0.0', 'v1.2.0').map((x) => x.version), ['1.2.0', '1.1.0']);
  assert.deepEqual(rel.releaseRange(r, '', '').map((x) => x.version), ['1.2.0', '1.1.0', '1.0.0'], 'no bounds: everything');
  assert.deepEqual(rel.releaseRange(r, 'v1.2.0', 'v1.2.0'), []);
  assert.equal(rel.releaseRange(r, 'v1.0.0', 'v1.1.0')[0].title, 'Two');
});

test('065: every version in releases.json lists its changes with a known kind', () => {
  const own = u.installedReleases();
  assert.ok(Object.keys(own).length >= 40);
  for (const [v, e] of Object.entries(own)) {
    assert.ok(e.title, `${v} has a title`);
    assert.ok(e.changes.length, `${v} lists its changes`);
    for (const c of e.changes) assert.ok(c.type in rel.CHANGE_TYPES && c.text.length < 300, `${v}: ${c.text}`);
  }
});

test('065: GET /api/releases — all notes, or a range; any signed-in user', async () => {
  u._setAppRoot(null, { running: 'v2.26.0' });
  const all = (await t.api(owner, 'GET', '/api/releases')).body;
  assert.equal(all.running, 'v2.26.0');
  assert.equal(all.versions[0].version, '2.26.0');
  assert.ok(all.versions.some((v) => v.version === '2.0.0' && v.breaking));
  const range = (await t.api(owner, 'GET', '/api/releases?from=v2.24.0&to=v2.26.0')).body;
  assert.deepEqual(range.versions.map((v) => v.version), ['2.26.0', '2.25.0']);
  assert.ok(range.versions.every((v) => v.changes.length));
  t.store.createUser({ username: 'vi', role: 'viewer', password: 'viewer password 123' });
  const viewer = await t.login('vi', 'viewer password 123');
  assert.equal((await t.api(viewer, 'GET', '/api/releases?from=v2.25.0')).status, 200);
});

test("065: What's new shows once per person after an update, from the version the update came from", async () => {
  u._setAppRoot(null, { running: 'v2.26.0' });
  // no update recorded: a person starts at the running version, nothing to show
  assert.equal((await t.api(owner, 'GET', '/api/status')).body.whatsNew, null);
  // an update from v2.24.0 just finished: a person without a record sees both versions
  t.db.kvSet('updates:status', JSON.stringify({ channel: 'stable', current: 'v2.26.0', lastResult: { ok: true, from: 'v2.24.0', target: 'v2.26.0', at: Date.now() } }));
  t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
  const ada = await t.login('ada', 'admin password 123');
  assert.deepEqual((await t.api(ada, 'GET', '/api/status')).body.whatsNew, { from: 'v2.24.0', to: 'v2.26.0' });
  assert.equal((await t.api(ada, 'GET', '/api/status')).body.whatsNew.from, 'v2.24.0', 'stays until seen');
  assert.equal((await t.api(owner, 'GET', '/api/status')).body.whatsNew, null, 'per person: the owner already saw v2.26.0');
  assert.equal((await t.api(ada, 'POST', '/api/releases/seen', {})).body.seen, 'v2.26.0');
  assert.equal((await t.api(ada, 'GET', '/api/status')).body.whatsNew, null);
  // a version without notes in between (e.g. a dev build) shows nothing
  u._setAppRoot(null, { running: 'v9.0.0' });
  assert.equal((await t.api(ada, 'GET', '/api/status')).body.whatsNew, null);
  u._setAppRoot(null, { running: 'v2.26.0' });
});

test('065: admin MCP reads release notes and the update status describes the notes', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const notes = TOOLS.find((x) => x.name === 'get_release_notes');
  assert.ok(notes?.readOnly);
  assert.deepEqual(notes.calls, [['GET', '/api/releases']]);
  let called = '';
  const r = await notes.run({ from: 'v2.24.0' }, { call: async (m, p) => { called = `${m} ${p}`; return (await t.api(owner, m, p)).body; } });
  assert.equal(called, 'GET /api/releases?from=v2.24.0&to=');
  assert.deepEqual(r.versions.map((v) => v.version), ['2.26.0', '2.25.0']);
  assert.match(TOOLS.find((x) => x.name === 'get_update_status').description, /status\.notes/);
});
