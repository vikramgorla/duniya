// Feature 042 (issue #43): automatic provider fallback, circuit breaker per account, several accounts per provider.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fakeChatProvider } from './harness.js';

const oa = fakeChatProvider({ name: 'openai', models: ['fake-large', 'fake-mini'] });
const alpha = fakeChatProvider({ name: 'alpha' });
const beta = fakeChatProvider({ name: 'beta' });

let t; let owner; let breaker; let providers; let usage;
const last = () => t.sent.at(-1)?.text;
const acts = (type) => t.db.listActivity({ limit: 200 }).filter((a) => a.type === type);
const health = async (id) => (await t.api(owner, 'GET', '/api/providers')).body.find((p) => p.id === id)?.health;
let now = Date.now();
const tick = (ms) => { now += ms; };

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' }, beforeImport: () => { process.env.OPENAI_API_BASE = oa.url(); } });
  owner = await t.login();
  breaker = await import('../src/core/providers/breaker.js');
  providers = await import('../src/core/providers/index.js');
  usage = await import('../src/core/usage.js');
  for (const [id, f, key] of [['alpha', alpha, 'ka'], ['beta', beta, 'kb']]) {
    const r = await t.api(owner, 'POST', '/api/providers/compatible', { id, name: id, baseUrl: f.url(), key });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await t.api(owner, 'GET', '/api/providers?refresh=1');
});
after(() => { oa.close(); alpha.close(); beta.close(); t.close(); });
beforeEach(() => {
  breaker.reset(); breaker.resetSwitches(); breaker.resetAllFailedAlert();
  now = Date.now(); breaker.setClock(() => now);
  t.claudeFail.length = 0; t.script.length = 0;
  for (const f of [oa, alpha, beta]) { f.fail = {}; f.script.length = 0; }
});

test('classification: what moves on, what trips the breaker, Retry-After', async () => {
  const { classify, retryAfterMs } = await import('../src/core/providers/errors.js');
  const h = (o) => ({ get: (k) => o[k] });
  const c429 = classify({ status: 429, message: 'Too many requests', headers: h({ 'retry-after': '120' }) });
  assert.deepEqual([c429.reason, c429.next, c429.breaker, c429.retryAfterMs], ['rate_limit', true, true, 120000]);
  assert.equal(classify({ status: 429, message: 'You exceeded your current quota' }).reason, 'quota');
  assert.equal(classify({ status: 400, message: 'Your credit balance is too low to access the Anthropic API' }).reason, 'quota');
  assert.equal(classify({ status: 402, message: 'Insufficient credits' }).reason, 'quota');
  assert.equal(classify({ code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' }).reason, 'quota');
  assert.equal(classify({ code: 'copilot_limit', message: 'GitHub Copilot usage limit reached' }).reason, 'quota');
  for (const st of [500, 502, 503, 529]) assert.equal(classify({ status: st, message: 'x' }).reason, 'server');
  assert.equal(classify({ status: 401, message: 'Incorrect API key' }).reason, 'auth');
  assert.equal(classify({ code: 'signin_expired', message: 'ChatGPT sign-in expired' }).reason, 'auth');
  assert.equal(classify(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })).reason, 'network');
  assert.equal(classify(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })).reason, 'timeout');
  const nf = classify({ status: 404, message: 'model: nope not found' });
  assert.deepEqual([nf.reason, nf.next, nf.breaker], ['model_not_found', true, false]);
  for (const e of [{ status: 400, message: 'messages: field required' }, { status: 400, message: 'Your request was rejected by our content policy' }, { status: 422, message: 'bad' }]) {
    const c = classify(e);
    assert.deepEqual([c.reason, c.next, c.breaker], ['bad_request', false, false], e.message);
  }
  assert.equal(retryAfterMs({ error: { error: { resets_in_seconds: 300 } } }), 300000);
  assert.equal(retryAfterMs({ message: 'Rate limit reached. Please try again in 20s.' }), 20000);
});

test('chain order: a rate-limited model is paused and the next connected provider answers; usage and activity say so', async () => {
  const claude = t.claudeReqs.length; const a = alpha.reqs.length;
  t.claudeFail.push({ status: 429, retryAfter: 120, message: 'rate limited' });
  await t.route(t.msg({ text: '!panduga hello?' }));
  assert.equal(t.claudeReqs.length, claude + 1, 'the chosen model was tried first');
  assert.equal(alpha.reqs.length, a + 1, 'then the next connected provider (Auto)');
  assert.equal(alpha.reqs.at(-1).body.model, 'fake-large');
  assert.equal(last(), 'alpha (ka) says hi');
  assert.equal(beta.reqs.length, 0, 'later providers are not asked');

  const st = await health('anthropic');
  assert.equal(st.state, 'paused');
  assert.match(st.text, /^Paused until \d\d:\d\d — rate limit$/);
  assert.ok(Math.abs(st.until - (now + 120000)) < 2000, 'Retry-After respected');
  const sw = acts('model.fallback');
  assert.equal(sw.length, 1);
  assert.match(sw[0].summary, /Answered by alpha after Claude failed \(rate limit\)/);
  assert.ok(acts('model.usage').some((x) => /alpha:fake-large: .* \(after Claude: rate limit\)/.test(x.summary)));
  const fbRows = usage.usageReport({ groupBy: 'fallback' }).rows;
  assert.ok(fbRows.some((r) => r.key === 'fallback' && r.calls >= 1));
  assert.ok(usage.usageReport({ groupBy: 'account' }).rows.some((r) => r.key === 'alpha'));

  // while paused, the account is skipped (no request) and the switch is not logged again
  await t.route(t.msg({ text: '!panduga again?' }));
  assert.equal(t.claudeReqs.length, claude + 1, 'paused account skipped');
  assert.equal(last(), 'alpha (ka) says hi');
  assert.equal(acts('model.fallback').length, 1, 'switch entries are deduplicated');

  // the test console shows who answered and why
  const r = await t.api(owner, 'POST', '/api/agents/panduga/test', { text: 'hi', role: 'participant' });
  assert.equal(r.body.answeredBy, 'alpha');
  assert.equal(r.body.fallback.failed[0].name, 'Claude');
  assert.equal(r.body.fallback.failed[0].reason, 'rate_limit');

  // Models page data: the paused account and its status line
  const fb = (await t.api(owner, 'GET', '/api/fallback')).body;
  assert.equal(fb.enabled, true);
  assert.equal(fb.health.anthropic.state, 'paused');
});

test('no retry on a refused request (400); model not found moves on without pausing', async () => {
  const a = alpha.reqs.length;
  t.claudeFail.push({ status: 400, message: 'messages: field required' });
  await t.route(t.msg({ text: '!panduga bad?' }));
  assert.equal(alpha.reqs.length, a, 'a 400 is never sent to another provider');
  assert.match(last(), /Sorry, I hit an error/);
  assert.equal((await health('anthropic')).state, 'ok', 'a refused request does not pause the account');

  t.claudeFail.push({ status: 404, message: 'model: claude-sonnet-5-5 not found' });
  await t.route(t.msg({ text: '!panduga where?' }));
  assert.equal(alpha.reqs.length, a + 1, 'model not found → next');
  assert.equal(last(), 'alpha (ka) says hi');
  assert.equal((await health('anthropic')).state, 'ok', 'model not found does not pause the account');
});

test('breaker: cooldown 1 min then doubling; skipped while cooling; one probe; recovery', async () => {
  const claude = t.claudeReqs.length;
  t.claudeFail.push({ status: 500, message: 'boom' });
  await t.route(t.msg({ text: '!panduga one' }));
  assert.equal(last(), 'alpha (ka) says hi');
  let st = await health('anthropic');
  assert.equal(st.until, now + 60000, 'first pause: 1 minute');

  tick(30000);
  await t.route(t.msg({ text: '!panduga two' }));
  assert.equal(t.claudeReqs.length, claude + 1, 'skipped while cooling');

  tick(31000); // pause over: the next call probes, and it fails again → 2 minutes
  t.claudeFail.push({ status: 503, message: 'still down' });
  await t.route(t.msg({ text: '!panduga three' }));
  assert.equal(t.claudeReqs.length, claude + 2, 'probed once after the pause');
  st = await health('anthropic');
  assert.equal(st.until, now + 120000, 'second pause: 2 minutes');
  assert.equal(st.failures, 2);

  tick(121000);
  t.script.push([{ type: 'text', text: 'Claude is back' }]);
  await t.route(t.msg({ text: '!panduga four' }));
  assert.equal(last(), 'Claude is back');
  assert.equal((await health('anthropic')).state, 'ok', 'success closes the breaker');
  assert.ok(acts('model.provider').some((x) => /Claude is answering again/.test(x.summary)));

  // cap at 30 minutes
  const cls = { reason: 'server' };
  for (let i = 0; i < 8; i++) breaker.recordFailure('x-test', cls, { name: 'X' });
  assert.equal(breaker.accountState('x-test').until - now, 30 * 60000);
  breaker.reset('x-test');

  // the only provider paused for an outage is still tried as a last resort (nobody else to ask)
  await t.agents.updateAgent('helper', { fallback: { mode: 'off' } });
  t.claudeFail.push({ status: 500, message: 'blip' });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help first' }));
  t.script.push([{ type: 'text', text: 'last resort works' }]);
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help second' }));
  assert.equal(last(), 'last resort works');
  await t.agents.updateAgent('helper', { fallback: { mode: 'inherit' } });
});

test('expired sign-in / rejected key: account needs reconnecting until its credentials change', async () => {
  t.claudeFail.push({ status: 401, message: 'invalid x-api-key' });
  await t.route(t.msg({ text: '!panduga auth?' }));
  assert.equal(last(), 'alpha (ka) says hi');
  const st = await health('anthropic');
  assert.equal(st.state, 'reconnect');
  assert.match(st.text, /reconnect this account/);
  t.store.setSecret('ANTHROPIC_API_KEY', 'test-2');
  assert.equal((await health('anthropic')).state, 'ok', 'new credentials clear the state');
  t.store.setSecret('ANTHROPIC_API_KEY', 'test');
});

test('no double tool execution: a failure after a tool ran continues on the next provider with the tool result', async () => {
  const calls = t.mcpCalls.filter((c) => c.name === 'agenda_list').length;
  t.script.push([{ type: 'tool_use', id: 'tu_1', name: 'panduga__agenda_list', input: {} }]);
  t.claudeFail.push(null, { status: 529, message: 'overloaded' }); // round 1 works (tool call), round 2 fails
  alpha.script.push({ content: 'Puja is at 10:00 (alpha).' });
  await t.route(t.msg({ text: '!panduga when is puja?' }));
  assert.equal(last(), 'Puja is at 10:00 (alpha).');
  assert.equal(t.mcpCalls.filter((c) => c.name === 'agenda_list').length, calls + 1, 'the tool ran exactly once');
  const msgs = alpha.reqs.at(-1).body.messages;
  assert.ok(msgs.some((m) => m.role === 'assistant' && m.tool_calls?.[0]?.id === 'tu_1'), 'conversation kept: the tool call');
  assert.ok(msgs.some((m) => m.role === 'tool' && m.tool_call_id === 'tu_1' && /Puja 10:00/.test(m.content)), 'and its result');
  assert.equal(t.sent.filter((m) => m.text === 'Puja is at 10:00 (alpha).').length, 1, 'one reply, sent once');
});

test('several accounts per provider: labels, failover in order, spread, usage by account', async () => {
  t.store.setSecret('OPENAI_API_KEY', 'k1');
  const bad = await t.api(owner, 'POST', '/api/accounts', { type: 'openai', key: 'k2' });
  assert.equal(bad.status, 400, 'a label is needed');
  const add = await t.api(owner, 'POST', '/api/accounts', { type: 'openai', label: 'work', key: 'k2' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.id, 'openai-work');
  assert.equal(add.body.name, 'OpenAI · work');
  assert.equal(add.body.connected, true);
  assert.equal((await t.api(owner, 'POST', '/api/accounts', { type: 'openai', label: 'Work', key: 'k3' })).status, 400, 'labels are unique per provider');
  const models = (await t.api(owner, 'GET', '/api/models')).body.models;
  assert.ok(models.some((m) => m.ref === 'openai-work:fake-large' && m.label === 'OpenAI · work · Fake Large'));
  const ren = await t.api(owner, 'PUT', '/api/accounts/openai', { label: 'Vik' });
  assert.equal(ren.body.name, 'OpenAI · Vik');

  await t.agents.updateAgent('helper', { model: 'openai:fake-large' });
  // in order (default): the first account answers; on a quota error the second answers the same model
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help a' }));
  assert.equal(last(), 'openai (k1) says hi');
  oa.fail.k1 = [{ status: 429, message: 'You exceeded your current quota', code: 'insufficient_quota' }];
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help b' }));
  assert.equal(last(), 'openai (k2) says hi');
  assert.equal(oa.reqs.at(-1).body.model, 'fake-large', 'same model on the other account');
  assert.equal((await health('openai')).reason, 'quota');
  assert.equal((await health('openai')).state, 'paused');

  // spread: least recently used first
  breaker.reset();
  assert.equal((await t.api(owner, 'PUT', '/api/fallback/strategy', { group: 'openai', strategy: 'spread' })).status, 200);
  assert.equal((await t.api(owner, 'GET', '/api/providers')).body.find((p) => p.id === 'openai').strategy, 'spread');
  const before = oa.reqs.length;
  for (const x of ['c', 'd', 'e', 'f']) await t.route(t.msg({ chat: 'g2@g.us', text: `!help ${x}` }));
  const keys = oa.reqs.slice(before).map((r) => r.key);
  assert.equal(keys.length, 4);
  for (let i = 1; i < keys.length; i++) assert.notEqual(keys[i], keys[i - 1], `alternates: ${keys.join(',')}`);
  assert.equal((await t.api(owner, 'PUT', '/api/fallback/strategy', { group: 'openai', strategy: 'sideways' })).status, 400);

  // usage groups by provider and by account
  const byAcct = Object.fromEntries((await t.api(owner, 'GET', '/api/usage?groupBy=account&period=1d')).body.rows.map((r) => [r.key, r.calls]));
  const byProv = Object.fromEntries((await t.api(owner, 'GET', '/api/usage?groupBy=provider&period=1d')).body.rows.map((r) => [r.key, r.calls]));
  assert.ok(byAcct.openai >= 2 && byAcct['openai-work'] >= 2, JSON.stringify(byAcct));
  assert.equal(byProv.openai, byAcct.openai + byAcct['openai-work'], 'provider = all its accounts');

  // the Test button addresses one account and never falls back
  oa.fail.k2 = [{ status: 500 }];
  const tr = await t.api(owner, 'POST', '/api/providers/openai-work/test', {});
  assert.equal(tr.body.ok, false);

  // remove: owner only
  const admin = await (async () => { await t.api(owner, 'POST', '/api/users', { username: 'fbadmin', role: 'admin', password: 'correct horse battery' }); return t.login('fbadmin'); })();
  assert.equal((await t.api(admin, 'DELETE', '/api/accounts/openai-work')).status, 403);
  assert.equal((await t.api(owner, 'DELETE', '/api/accounts/openai-work')).status, 200);
  assert.ok(!(await t.api(owner, 'GET', '/api/providers')).body.some((p) => p.id === 'openai-work'));
  assert.ok(!t.store.getSecret('PROVIDER_OPENAI_WORK_KEY'), 'its key is deleted');
  await t.api(owner, 'PUT', '/api/fallback/strategy', { group: 'openai', strategy: 'order' });
  t.store.setSecret('OPENAI_API_KEY', '');
  await t.agents.updateAgent('helper', { model: 'anthropic:claude-sonnet-5-5' });
});

test('per agent and per chat override: off, own chain; the chat wins over the agent', async () => {
  const a = alpha.reqs.length; const b = beta.reqs.length;
  await t.agents.updateAgent('helper', { fallback: { mode: 'off' } });
  t.claudeFail.push({ status: 429, message: 'rate limited' });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help x' }));
  assert.equal(alpha.reqs.length, a, 'fallback off: no other provider');
  assert.match(last(), /isn’t available right now \(rate limit\)/);

  breaker.reset();
  await t.agents.updateAgent('helper', { fallback: { mode: 'on', chain: ['beta:auto'] } });
  t.claudeFail.push({ status: 500 });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help y' }));
  assert.equal(last(), 'beta (kb) says hi');
  assert.equal(alpha.reqs.length, a, 'own chain: alpha is not in it');
  assert.equal(beta.reqs.length, b + 1);

  breaker.reset();
  t.chatPrefs.setChatPrefs('g2@g.us', { fallback: { mode: 'off' } });
  t.claudeFail.push({ status: 500 });
  t.claudeFail.push({ status: 500 });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help z' }));
  assert.equal(beta.reqs.length, b + 1, 'the chat override wins');
  t.chatPrefs.setChatPrefs('g2@g.us', { fallback: { mode: 'inherit' } });
  await t.agents.updateAgent('helper', { fallback: { mode: 'inherit' } });

  // validation
  assert.equal((await t.api(owner, 'PUT', '/api/agents/helper', { fallback: { mode: 'maybe' } })).status, 400);
  assert.equal((await t.api(owner, 'PUT', '/api/fallback', { chain: ['not a ref'] })).status, 400);
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent('g2@g.us')}/prefs`, { fallback: { mode: 'on', chain: ['beta:auto'] } })).status, 200);
  assert.deepEqual((await t.api(owner, 'GET', '/api/chats')).body.find((c) => c.id === 'g2@g.us').fallback, { mode: 'on', chain: ['beta:auto'] });
  t.chatPrefs.setChatPrefs('g2@g.us', { fallback: { mode: 'inherit' } });

  // global switch off, then a global chain
  assert.equal((await t.api(owner, 'PUT', '/api/fallback', { enabled: false })).body.enabled, false);
  t.claudeFail.push({ status: 500 });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help w' }));
  assert.equal(alpha.reqs.length, a, 'off globally');
  breaker.reset();
  await t.api(owner, 'PUT', '/api/fallback', { enabled: true, chain: ['beta:fake-mini'] });
  t.claudeFail.push({ status: 500 });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help v' }));
  assert.equal(beta.reqs.at(-1).body.model, 'fake-mini');
  await t.api(owner, 'PUT', '/api/fallback', { enabled: true, chain: [] });
});

test('owner alerts: an account failing for more than 15 minutes, and all providers failing (deduplicated)', async () => {
  assert.equal((await t.api(owner, 'PUT', '/api/agents/owner-assistant', { alerts: { to: '+41 79 111 22 33' } })).status, 200);
  const toOwner = () => t.sent.filter((m) => m.chat === '41791112233@s.whatsapp.net');
  const n = toOwner().length;
  t.claudeFail.push({ status: 401, message: 'invalid x-api-key' });
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.equal(toOwner().length, n, 'no alert right away');
  tick(16 * 60000);
  await t.route(t.msg({ text: '!panduga hi again' }));
  await t.waitFor(() => toOwner().length === n + 1);
  assert.match(toOwner().at(-1).text, /Claude needs to be reconnected/);
  await t.route(t.msg({ text: '!panduga and again' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(toOwner().length, n + 1, 'once per episode');

  breaker.reset();
  await t.agents.updateAgent('helper', { fallback: { mode: 'on', chain: ['alpha:auto'] } });
  alpha.fail['*'] = [{ status: 500 }, { status: 500 }];
  t.claudeFail.push({ status: 500 }, { status: 500 });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help nobody?' }));
  await t.waitFor(() => toOwner().some((m) => /no AI provider could answer/.test(m.text)));
  assert.match(last(), /isn’t available right now/);
  const c = toOwner().length;
  breaker.reset();
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help still nobody?' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(toOwner().length, c, 'at most one "all failed" alert per hour');
  await t.agents.updateAgent('helper', { fallback: { mode: 'inherit' } });
  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { alerts: { to: '' } });
});

test('background summaries and the admin MCP tools use the same fallback', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  for (const name of ['list_model_accounts', 'get_model_fallback', 'set_model_fallback', 'set_account_strategy', 'retry_model_account']) assert.ok(TOOLS.some((x) => x.name === name), name);
  const x = { call: async (m, p, b) => (await t.api(owner, m, p, b)).body };
  const got = await TOOLS.find((y) => y.name === 'get_model_fallback').run({}, x);
  assert.equal(got.enabled, true);
  const accts = await TOOLS.find((y) => y.name === 'list_model_accounts').run({}, x);
  assert.ok(accts.some((a) => a.id === 'alpha' && a.health.state === 'ok'));
  breaker.recordFailure('alpha', { reason: 'quota', retryAfterMs: 3600000 }, { name: 'alpha' });
  await TOOLS.find((y) => y.name === 'retry_model_account').run({ account: 'alpha' }, x);
  assert.equal(breaker.accountState('alpha').state, 'ok');

  const res = await providers.chat({ model: 'auto', purpose: 'background', messages: [{ role: 'user', content: 'sum up' }] });
  assert.equal(res.account, 'anthropic');
  t.claudeFail.push({ status: 503 });
  const res2 = await providers.chat({ model: 'auto', purpose: 'background', messages: [{ role: 'user', content: 'sum up' }] });
  assert.notEqual(res2.account, 'anthropic', 'summaries fall back too');
  assert.equal(res2.failures[0].reason, 'server');
});
