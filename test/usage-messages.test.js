// 023 usage & cost; 024 stored messages for admins.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
t.store.createUser({ username: 'vic', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vic', 'viewer password 123');
after(() => t.close());

test('023: every model call is recorded per agent, chat, provider, model and kind; costs only from known prices', async () => {
  t.script.push([{ type: 'text', text: 'hello' }]);
  await t.route(t.msg({ text: '!panduga hi' }));
  let r = (await t.api(owner, 'GET', '/api/usage?groupBy=agent&period=1d')).body;
  const pd = r.rows.find((x) => x.key === 'panduga');
  assert.ok(pd && pd.calls >= 1 && pd.input >= 3 && pd.output >= 2);
  assert.equal(pd.cost, null, 'no price set → no invented cost');
  assert.ok(r.total.unpriced >= 1);
  assert.equal((await t.api(owner, 'PUT', '/api/usage/prices', { model: 'anthropic:claude-sonnet-5-5', input: 3, output: 15 })).status, 200);
  t.script.push([{ type: 'text', text: 'hello again' }]);
  await t.route(t.msg({ text: '!panduga hi again' }));
  r = (await t.api(owner, 'GET', '/api/usage?groupBy=model&period=1d')).body;
  const m = r.rows.find((x) => x.key === 'anthropic:claude-sonnet-5-5');
  assert.ok(m.cost > 0 && m.cost < 0.001, String(m.cost));
  const byChat = (await t.api(owner, 'GET', '/api/usage?groupBy=chat&period=1d')).body.rows;
  assert.ok(byChat.some((x) => x.key === 'g1@g.us'));
  const kinds = (await t.api(owner, 'GET', '/api/usage?groupBy=feature&period=all')).body.rows.map((x) => x.key);
  assert.ok(kinds.includes('reply'));
  const sum = (await t.api(viewer, 'GET', '/api/usage/summary')).body;
  assert.ok(sum.agent.panduga && sum.provider.anthropic && sum.model['anthropic:claude-sonnet-5-5']);
  assert.equal((await t.api(viewer, 'PUT', '/api/usage/prices', { model: 'anthropic:x', input: 1, output: 1 })).status, 403);
  assert.equal((await t.api(owner, 'GET', '/api/usage?groupBy=nope')).status, 400);
});

test('023: plan providers are included, free models cost nothing, published prices are used', async () => {
  const { priceFor } = await import('../src/core/usage.js');
  assert.equal(priceFor('chatgpt', 'gpt-x').source, 'plan');
  assert.equal(priceFor('copilot', 'auto').source, 'plan');
  assert.deepEqual(priceFor('openrouter', 'meta/llama:free'), { in: 0, out: 0, source: 'free' });
  assert.deepEqual(priceFor('openrouter', 'x/y', { in: 0.5, out: 1.5 }), { in: 0.5, out: 1.5, source: 'provider' });
  assert.equal(priceFor('openai', 'gpt-unknown'), null);
});

test('070: usage by day uses the owner\'s days, also across daylight-saving changes and half-hour zones', async () => {
  const { db } = await import('../src/core/db.js');
  const ins = db.prepare("INSERT INTO usage (ts, agent, chat, provider, model, kind, input, output, cost, priced, account, fallback) VALUES (?, 'dst', '', 'anthropic', 'm', 'reply', 1, 1, NULL, NULL, 'anthropic', '')");
  const base = Date.parse('2026-03-20T00:00:00Z');
  for (let i = 0; i < 24 * 30; i += 1) ins.run(base + i * 3600000 + 17 * 60000); // hourly for 30 days, across the March change
  for (const tz of ['Europe/Zurich', 'Asia/Kolkata', 'America/St_Johns']) {
    process.env.TZ = tz; // SQLite's 'localtime' below is the reference
    await t.agents.updateAgent('owner-assistant', { timezone: tz }); // the owner's clock
    const want = db.prepare("SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS key, COUNT(*) AS calls FROM usage WHERE agent = 'dst' GROUP BY 1 ORDER BY 1").all().map((r) => ({ ...r }));
    const got = (await t.api(owner, 'GET', '/api/usage?groupBy=day&period=all&agent=dst')).body.rows.map((r) => ({ key: r.key, calls: r.calls }));
    assert.deepEqual(got, want, tz);
  }
  delete process.env.TZ;
  await t.agents.updateAgent('owner-assistant', { timezone: '' });
  db.prepare("DELETE FROM usage WHERE agent = 'dst'").run();
});

test('024: admins can read stored messages (search, paging); viewers cannot; each look is logged', async () => {
  for (let i = 0; i < 3; i++) await t.route(t.msg({ text: `message number ${i} about lunch`, senderName: 'Anu' }));
  const r = await t.api(owner, 'GET', `/api/chats/${encodeURIComponent('g1@g.us')}/messages?limit=2`);
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 2);
  assert.ok(r.body[0].id > r.body[1].id, 'newest first');
  const older = await t.api(owner, 'GET', `/api/chats/${encodeURIComponent('g1@g.us')}/messages?before=${r.body[1].id}`);
  assert.ok(older.body.every((m) => m.id < r.body[1].id));
  const found = await t.api(owner, 'GET', `/api/chats/${encodeURIComponent('g1@g.us')}/messages?q=number%201`);
  assert.deepEqual(found.body.map((m) => m.text), ['message number 1 about lunch']);
  assert.ok(found.body.some((m) => m.name === 'Anu'));
  assert.ok(r.body.length && (await t.api(owner, 'GET', `/api/chats/${encodeURIComponent('g1@g.us')}/messages`)).body.some((m) => m.fromAgent), 'agent replies are included');
  assert.equal((await t.api(viewer, 'GET', `/api/chats/${encodeURIComponent('g1@g.us')}/messages`)).status, 403);
  assert.ok(t.db.listActivity({ limit: 50 }).some((a) => a.type === 'access' && /Stored messages viewed by admin/.test(a.summary)), 'who looked is recorded as such');
});
