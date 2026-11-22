// How failures are handled: a programming error in a panel route is a 500 that is kept in Activity (never a 400 with
// its internals), a body that is not JSON or too large says so, and a tool call that timed out is not sent again.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ extend: [(route) => {
  route('GET', '/api/test/bug', async () => { const nothing = null; return nothing.name; });
  route('GET', '/api/test/refused', async () => { throw new Error('Choose a chat first'); });
}] });
const owner = await t.login();
after(() => t.close());

test('a programming error is a 500 without internals and is kept in Activity; a refused request stays a 400', async () => {
  const bug = await t.api(owner, 'GET', '/api/test/bug');
  assert.equal(bug.status, 500);
  assert.match(bug.body.error, /Something went wrong on the server/);
  assert.ok(!/null|undefined|properties/.test(bug.body.error), 'no internals');
  const logged = (await t.api(owner, 'GET', '/api/activity?type=error')).body[0];
  assert.match(logged.summary, /The panel hit an error on GET \/api\/test\/bug/);
  const refused = await t.api(owner, 'GET', '/api/test/refused');
  assert.deepEqual([refused.status, refused.body.error], [400, 'Choose a chat first']);
});

test('a body that is not JSON, or too large, is refused in plain words', async () => {
  const post = (body) => fetch(`${t.base}/api/settings`, { method: 'POST', headers: { cookie: owner, 'content-type': 'application/json' }, body });
  const broken = await post('{"paused": tru');
  assert.equal(broken.status, 400);
  assert.match((await broken.json()).error, /not valid JSON/);
  const huge = await post(JSON.stringify({ paused: false, pad: 'x'.repeat(2.1e6) }));
  assert.equal(huge.status, 413);
});

test('a tool call that timed out is not sent again (the service may still be doing it); a dropped connection is', async () => {
  const { mcpConnection } = await import('../src/core/mcp.js');
  const conn = mcpConnection('http://127.0.0.1:9/mcp', 'failures-test');
  let calls = 0;
  const stub = (error) => ({ callTool: async () => { calls++; throw error; }, close: async () => {} });
  conn.connect = async function connect() { this.client = stub(this.next); };
  conn.next = Object.assign(new Error('Request timed out'), { code: -32001 });
  const late = await conn.call('book_room', {});
  assert.deepEqual([late.isError, calls], [true, 1]);
  calls = 0; conn.next = new Error('fetch failed');
  await conn.call('book_room', {});
  assert.equal(calls, 2, 'one more try on a fresh connection');
});

test('work nobody waits for keeps its failure: a courtesy message that cannot be sent is in Activity, in plain words', async () => {
  const queue = await import('../src/core/media-queue.js');
  queue.registerJobHandler('test-broken', { async run() { throw Object.assign(new Error('the picture service is down'), { permanent: true }); },
    async failed(p, job) { throw new Error(`could not tell ${job.chat}`); } });
  queue.startQueue();
  queue.enqueue({ kind: 'test-broken', chat: 'g1@g.us', payload: {} });
  await queue.drain();
  const errors = (await t.api(owner, 'GET', '/api/activity?type=error')).body.map((a) => a.summary);
  assert.ok(errors.some((x) => /^Media job test-broken failed: the picture service is down/.test(x)), 'the job');
  assert.ok(errors.some((x) => x === 'The apology after a failed request failed: could not tell g1@g.us'), 'and the apology that could not be sent');
});
