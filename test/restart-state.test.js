// #64: confirm codes and provider pauses survive a restart. A restart is simulated by a fresh Node process that opens
// the same data directory (nothing in memory carries over), and in-process by reloading the breaker from SQLite.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
const admin = await t.login('ada', 'admin password 123');
const ttl = await import('../src/core/ttl-store.js');
const breaker = await import('../src/core/providers/breaker.js');
const adminOauth = await import('../src/core/admin-oauth.js');
await import('../src/core/owner-assistant.js');
after(() => t.close());

/** Run `body` (ES module code; may `await import(...)` from src/core) in a new process on the same data dir. */
function freshProcess(body) {
  const code = `const core = (m) => import(new URL('../src/core/' + m, ${JSON.stringify(import.meta.url)}));\n${body}`;
  return new Promise((res, rej) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code],
    { env: process.env, timeout: 30000 }, (e, out, err) => (e ? rej(new Error(`${e.message}\n${err}`)) : res(JSON.parse(out.trim().split('\n').at(-1))))));
}

test('ttl store: expiry, single use, values encrypted at rest', () => {
  ttl.putTtl('t', 'A', { secret: 'plain-value-xyz' }, Date.now() + 60000);
  ttl.putTtl('t', 'B', { x: 1 }, Date.now() - 1);
  assert.deepEqual(ttl.getTtl('t', 'A'), { secret: 'plain-value-xyz' });
  assert.equal(ttl.getTtl('t', 'B'), null, 'expired rows are never returned');
  assert.deepEqual(ttl.listTtl('t').map((r) => r.key), ['A']);
  const raw = t.db.db.prepare("SELECT data_enc FROM ttl_state WHERE kind = 't' AND key = 'A'").get().data_enc;
  assert.ok(raw.startsWith('v1:') && !raw.includes('plain-value-xyz'), 'encrypted with the master key');
  assert.deepEqual(ttl.takeTtl('t', 'A'), { secret: 'plain-value-xyz' });
  assert.equal(ttl.takeTtl('t', 'A'), null, 'single use');
});

test('owner assistant: a confirm code given before a restart is confirmed after it', async () => {
  t.script.push([{ type: 'tool_use', id: 'r1', name: 'set_agent_enabled', input: { agent_id: 'helper', enabled: false } }], [{ type: 'text', text: 'Ready.' }]);
  const r = (await t.api(admin, 'POST', '/api/owner/ask', { question: 'turn helper off' })).body;
  const { code } = r.confirms[0];
  const seen = await freshProcess(`const s = await core('ttl-store.js'); console.log(JSON.stringify(s.getTtl('owner-confirm', ${JSON.stringify(code)})));`);
  assert.equal(seen.tool, 'set_agent_enabled', 'a new process sees the pending code');
  assert.equal(t.agents.getAgent('helper').enabled, true, 'not applied yet');
  assert.match((await t.api(admin, 'POST', '/api/owner/ask/confirm', { code })).body.reply, /^Done/);
  assert.equal(t.agents.getAgent('helper').enabled, false);
  assert.equal((await t.api(admin, 'POST', '/api/owner/ask/confirm', { code })).status, 404, 'still single use');
  await t.agents.updateAgent('helper', { enabled: true });
});

test('admin MCP: confirm codes survive a restart and stay bound to user and assistant', async () => {
  const code = adminOauth.createConfirm({ userId: 7, clientId: 'c1', tool: 'delete_agent', args: { agent_id: 'x' }, preview: 'Delete x' });
  const seen = await freshProcess(`const a = await core('admin-oauth.js'); const c = a.takeConfirm(${JSON.stringify(code)}, { userId: 7, clientId: 'c1' }); console.log(JSON.stringify({ tool: c.tool, args: c.args }));`);
  assert.deepEqual(seen, { tool: 'delete_agent', args: { agent_id: 'x' } }, 'confirmed by the restarted process');
  assert.throws(() => adminOauth.takeConfirm(code, { userId: 7, clientId: 'c1' }), /already used|unknown/);
  const other = adminOauth.createConfirm({ userId: 7, clientId: 'c1', tool: 't', args: {}, preview: 'p' });
  assert.throws(() => adminOauth.takeConfirm(other, { userId: 8, clientId: 'c1' }), /another user/);
});

test('agents: pending confirm codes (already in SQLite) are seen by a new process', async () => {
  t.script.push([{ type: 'tool_use', id: 'p1', name: 'panduga__room_assign_preview', input: {} }], [{ type: 'text', text: 'Preview ready' }]);
  await t.route(t.msg({ isGroup: true, chat: 'g1@g.us', phone: '41790000001', text: '!panduga put Rao in room 4' }));
  const code = /confirm ([A-Z0-9]{4})/.exec(t.sent.at(-1).text)[1];
  const seen = await freshProcess(`const d = await core('db.js'); console.log(JSON.stringify(d.peekPending(${JSON.stringify(code)}) ?? null));`);
  assert.equal(seen?.agent, 'panduga');
});

test('provider breaker: pause, back-off and "needs reconnect" survive a restart; the probe flag does not', async () => {
  breaker.reset();
  breaker.recordFailure('acc-a', { reason: 'rate_limit', retryAfterMs: 20 * 60000 }, { name: 'A' });
  breaker.recordFailure('acc-b', { reason: 'auth' }, { name: 'B' });
  const untilA = breaker.accountState('acc-a').until;
  const seen = await freshProcess("const b = await core('providers/breaker.js'); console.log(JSON.stringify([b.accountState('acc-a'), b.accountState('acc-b'), b.canTry('acc-a')]));");
  assert.equal(seen[0].state, 'paused');
  assert.equal(seen[0].until, untilA);
  assert.equal(seen[1].state, 'reconnect');
  assert.equal(seen[2], false, 'still skipped after the restart');

  // in-process restart: the probe flag is not stored, so the first call after the pause probes
  breaker.setClock(() => untilA + 1);
  assert.equal(breaker.canTry('acc-a'), true);
  assert.equal(breaker.canTry('acc-a'), false, 'one probe at a time');
  breaker.loadStored();
  assert.equal(breaker.accountState('acc-a').failures, 1, 'back-off count kept');
  assert.equal(breaker.canTry('acc-a'), true, 'after a restart the next call probes again');
  breaker.recordSuccess('acc-a', { name: 'A' });
  breaker.reset('acc-b');
  breaker.loadStored();
  assert.deepEqual(breaker.allStates(), {}, 'recovery and reset clear the stored state');
  breaker.setClock(null);
});
