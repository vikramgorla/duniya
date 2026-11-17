// Feature 067 (issue #135): plan usage — what each model account's provider reports about its plan, credit and rate
// limits (ChatGPT's 5-hour and weekly windows, Copilot's premium requests, OpenRouter's key and credit, API rate-limit
// headroom), shown on Models / Usage / Overview, alerted once per window, named in pauses and fallbacks, and returned by
// the admin tools. Fakes only: a fake ChatGPT backend, fake GitHub, a fake OpenRouter and the fake Claude API.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, fakeChatProvider } from './harness.js';

const orf = fakeChatProvider({ name: 'openrouter', models: ['free/model:free', 'paid/model'] });
// Fake ChatGPT backend (Responses API): headers and an optional codex.rate_limits event with every answer.
// #140: also the plan's usage endpoint (GET /backend-api/wham/usage); it refuses (404) unless a test sets cg.usage.
const cg = { headers: {}, event: null, fail: [], reqs: 0, usage: null, usageReqs: [] };
cg.server = http.createServer(async (req, res) => {
  for await (const _ of req) { /* drain the request */ }
  if (req.url === '/backend-api/wham/usage') {
    cg.usageReqs.push(req.headers);
    const u = cg.usage || { status: 404, body: { detail: 'Not Found' } };
    res.writeHead(u.status, { 'content-type': 'application/json' }); return res.end(typeof u.body === 'string' ? u.body : JSON.stringify(u.body));
  }
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ slug: 'gpt-x', display_name: 'GPT X' }] })); }
  cg.reqs++;
  const f = cg.fail.shift();
  if (f) { res.writeHead(f.status, { 'content-type': 'application/json', ...f.headers }); return res.end(JSON.stringify({ error: f.error })); }
  res.writeHead(200, { 'content-type': 'text/event-stream', ...cg.headers });
  const ev = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  if (cg.event) ev(cg.event);
  const item = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'chatgpt says hi' }] };
  ev({ type: 'response.output_item.done', item });
  ev({ type: 'response.completed', response: { output: [item], usage: { input_tokens: 5, output_tokens: 2 } } });
  res.end();
}).listen(0);
// Fake GitHub: copilot_internal/user for a token that may read it.
const gh = { reqs: [], user: null };
gh.server = http.createServer((req, res) => {
  gh.reqs.push({ url: req.url, auth: req.headers.authorization });
  if (req.url === '/copilot_internal/user' && gh.user) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(gh.user)); }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"message":"Not Found"}');
}).listen(0);

let t; let owner; let plan; let breaker; let copilot;
const H = 3600000;
const secs = (ms) => String(Math.round((Date.now() + ms) / 1000));
const prov = async (id, q = '') => (await t.api(owner, 'GET', `/api/providers${q}`)).body.find((p) => p.id === id);
const toOwner = () => t.sent.filter((m) => m.chat === '41791112233@s.whatsapp.net');
const codex = (p, w, min, resetMs) => ({ [`x-codex-${p}-used-percent`]: String(w), [`x-codex-${p}-window-minutes`]: String(min), [`x-codex-${p}-reset-at`]: secs(resetMs) });

before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' }, beforeImport: () => {
    process.env.OPENAI_API_BASE = `http://127.0.0.1:${cg.server.address().port}/v1`;
    process.env.CHATGPT_BACKEND_BASE = `http://127.0.0.1:${cg.server.address().port}/backend-api`;
    process.env.OPENROUTER_API_BASE = orf.url();
    process.env.GITHUB_API_BASE = `http://127.0.0.1:${gh.server.address().port}`;
  } });
  owner = await t.login();
  plan = await import('../src/core/providers/plan-usage.js');
  breaker = await import('../src/core/providers/breaker.js');
  copilot = await import('../src/core/providers/copilot.js');
  t.store.setSecret('CHATGPT_CREDENTIALS', JSON.stringify({ access_token: 'cg-token', refresh_token: 'r', expires_at: Date.now() + 30 * 24 * H, email: 'me@example.org', client_id: 'c', scopes: [] }));
  await t.api(owner, 'PUT', '/api/agents/owner-assistant', { alerts: { to: '+41 79 111 22 33' } });
});
after(() => { cg.server.close(); gh.server.close(); orf.close(); t.close(); });
beforeEach(() => {
  plan.forget(); breaker.reset(); breaker.resetSwitches(); breaker.resetAllFailedAlert();
  cg.headers = {}; cg.event = null; cg.fail.length = 0; cg.usage = null; cg.usageReqs.length = 0; t.claudeHeaders = {}; t.claudeFail.length = 0; t.script.length = 0;
});

test('parsing is defensive: unknown or malformed headers show nothing; windows get plain names', () => {
  assert.deepEqual(plan.parseHeaders(new Headers({ 'x-codex-primary-used-percent': 'lots', 'x-ratelimit-limit-requests': '0', 'anthropic-ratelimit-requests-limit': '50' })), []);
  assert.deepEqual(plan.parseHeaders(null), []);
  assert.deepEqual(plan.parseCodexEvent({ type: 'codex.rate_limits', rate_limits: 'x' }), []);
  assert.equal(plan.parseOpenRouter({ nope: 1 }), null);
  assert.equal(plan.parseCopilotUser({}), null);
  assert.deepEqual([300, 10080, 1440, 120, 45].map((m) => plan.windowLabel(m)), ['5-hour limit', 'weekly limit', 'daily limit', '2-hour limit', '45-minute limit']);
  assert.deepEqual(['6m0s', '1.5s', '20ms', '2h', '12', ''].map(plan.durationMs), [360000, 1500, 20, 7200000, 12000, null]);
  // older Codex builds send reset-after-seconds; the codex.rate_limits event works the same
  const [old] = plan.parseHeaders(new Headers({ 'x-codex-primary-used-percent': '10', 'x-codex-primary-window-minutes': '300', 'x-codex-primary-reset-after-seconds': '600' }));
  assert.ok(Math.abs(old.resetAt - (Date.now() + 600000)) < 2000);
  const ev = plan.parseCodexEvent({ type: 'codex.rate_limits', rate_limits: { primary: { used_percent: 33, window_minutes: 300, reset_at: 1900000000 }, secondary: { used_percent: 5, window_minutes: 10080 } } });
  assert.deepEqual(ev.map((l) => [l.label, l.used, l.resetAt]), [['5-hour limit', 33, 1900000000000], ['weekly limit', 5, null]]);
});

test('ChatGPT plan: 5-hour and weekly windows from the answer headers, on Models, Overview and the admin tools', async () => {
  await t.agents.updateAgent('panduga', { model: 'chatgpt:gpt-x' });
  cg.headers = { ...codex('primary', 62.5, 300, 2 * H), ...codex('secondary', 81, 10080, 3 * 24 * H) };
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.equal(t.sent.at(-1).text, 'chatgpt says hi');
  const p = await prov('chatgpt');
  assert.deepEqual(p.usage.limits.map((l) => [l.label, l.kind, l.used]), [['weekly limit', 'plan', 81], ['5-hour limit', 'plan', 62.5]]);
  assert.ok(p.usage.limits[0].resetAt > Date.now() + 2 * 24 * H);
  assert.ok(Date.now() - p.usage.at < 5000);
  assert.equal(p.spend, undefined, 'plan accounts have no per-use spend');
  // Overview hint at 80 %+ (the tightest limit)
  const st = (await t.api(owner, 'GET', '/api/status')).body;
  assert.equal(st.plans.length, 1);
  assert.equal(st.plans[0].account, 'chatgpt'); assert.equal(st.plans[0].used, 81);
  assert.match(st.plans[0].text, /^81% of the weekly limit used, resets /);
  // admin MCP / owner assistant: "how much ChatGPT quota is left?"
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const tool = TOOLS.find((x) => x.name === 'list_model_accounts');
  const out = await tool.run({}, { call: async (m, path, b) => (await t.api(owner, m, path, b)).body });
  const acct = out.find((a) => a.id === 'chatgpt');
  assert.deepEqual(acct.usage.limits.map((l) => [l.label, l.percent_used]), [['weekly limit', 81], ['5-hour limit', 63]]);
  assert.match(acct.usage.limits[0].resets, /^\d{4}-\d\d-\d\dT/);
  assert.ok(!JSON.stringify(out).includes('cg-token'), 'never the sign-in');
  // the stream event updates it too; the snapshot is kept for a restart
  cg.headers = {}; cg.event = { type: 'codex.rate_limits', rate_limits: { primary: { used_percent: 70, window_minutes: 300, reset_at: Number(secs(H)) } } };
  await t.route(t.msg({ text: '!panduga again' }));
  assert.equal((await prov('chatgpt')).usage.limits.find((l) => l.label === '5-hour limit').used, 70);
  const { listTtl } = await import('../src/core/ttl-store.js');
  assert.ok(listTtl('plan-usage').some((r) => r.key === 'chatgpt'), 'persisted');
});

test('ChatGPT plan: alert once per window at 90 %, again when used up; the pause and the fallback name the window', async () => {
  await t.agents.updateAgent('panduga', { model: 'chatgpt:gpt-x' });
  const before = toOwner().length;
  cg.headers = codex('primary', 91, 300, 2 * H);
  await t.route(t.msg({ text: '!panduga one' }));
  await t.route(t.msg({ text: '!panduga two' }));
  const alerts = toOwner().slice(before);
  assert.equal(alerts.length, 1, 'one alert per window and level');
  assert.match(alerts[0].text, /ChatGPT.* has used 91% of its 5-hour limit \(resets /);
  // used up: the backend refuses with 429 and the headers say 100 %; Claude answers; one more alert
  cg.fail.push({ status: 429, headers: codex('primary', 100, 300, 2 * H), error: { code: 'usage_limit_reached', message: 'The usage limit has been reached', type: 'usage_limit_reached' } });
  t.script.push([{ type: 'text', text: 'claude answers' }]);
  await t.route(t.msg({ text: '!panduga three' }));
  assert.equal(t.sent.at(-1).text, 'claude answers');
  const h = breaker.accountState('chatgpt');
  assert.equal(h.state, 'paused');
  assert.match(h.text, /— 5-hour limit used up, resets /);
  assert.ok(h.until > Date.now() + 1.9 * H, 'waits for the window to reset');
  const sw = t.db.listActivity({ limit: 50 }).find((a) => a.type === 'model.fallback');
  assert.match(sw.summary, /after ChatGPT.* failed \(5-hour limit used up, resets /);
  const now = toOwner().slice(before);
  assert.equal(now.length, 2);
  assert.match(now[1].text, /has used up its 5-hour limit until /);
  // a new window alerts again
  cg.headers = codex('primary', 95, 300, 7 * H); breaker.reset('chatgpt');
  await t.route(t.msg({ text: '!panduga four' }));
  assert.equal(toOwner().length - before, 3);
});

test('ChatGPT plan: 5-hour and weekly windows from the usage endpoint Codex reads (wham/usage), on Models and the tick', async () => {
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const saved = t.store.getSecret('CHATGPT_CREDENTIALS');
  t.store.setSecret('CHATGPT_CREDENTIALS', JSON.stringify({ ...JSON.parse(saved), id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' } }) }));
  const reset5h = Math.round((Date.now() + 2 * H) / 1000);
  cg.usage = { status: 200, body: { plan_type: 'plus', rate_limit: { allowed: true, limit_reached: false,
    primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 7200, reset_at: reset5h },
    secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_after_seconds: 400000, reset_at: 0 } },
    credits: { has_credits: false, unlimited: false, balance: null },
    additional_rate_limits: [{ limit_name: 'GPT-Spark', metered_feature: 'codex_spark', rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_after_seconds: 60, reset_at: reset5h } } }] } };
  const p = await prov('chatgpt');
  assert.deepEqual(p.usage.limits.map((l) => [l.label, l.used]), [['5-hour limit', 42], ['weekly limit', 12], ['GPT-Spark 5-hour limit', 5]]);
  assert.equal(p.usage.limits[0].resetAt, reset5h * 1000);
  assert.ok(Math.abs(p.usage.limits[1].resetAt - (Date.now() + 400000000)) < 5000, 'reset_after_seconds when reset_at is missing');
  assert.equal(p.usageUnavailable, undefined);
  // the same headers Codex sends: bearer, chatgpt-account-id from the ID token; we identify as ourselves
  const hd = cg.usageReqs.at(-1);
  assert.equal(hd.authorization, 'Bearer cg-token'); assert.equal(hd['chatgpt-account-id'], 'acct-123');
  assert.equal(hd.originator, 'whatsapp-agent-duniya');
  // Models open again within 10 minutes: no new request; the tick reads it at most every 30 minutes
  const n = cg.usageReqs.length;
  await prov('chatgpt');
  assert.equal(cg.usageReqs.length, n);
  const { upkeepTick, resetUpkeep } = await import('../src/core/upkeep.js');
  resetUpkeep();
  assert.equal((await upkeepTick(null)).plan, null);
  cg.usage.body.rate_limit.primary_window.used_percent = 55;
  assert.equal((await upkeepTick(null, Date.now() + 31 * 60000)).plan, 'chatgpt');
  assert.equal((await prov('chatgpt')).usage.limits[0].used, 55);
  // an answer that does carry headers: the newer reading wins, never the same window twice
  await t.agents.updateAgent('panduga', { model: 'chatgpt:gpt-x' });
  cg.headers = codex('primary', 61, 300, 2 * H);
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.deepEqual((await prov('chatgpt')).usage.limits.filter((l) => l.label === '5-hour limit').map((l) => l.used), [61]);
  // a server error or a body without windows: the last reading stays, nothing made up
  const five = async () => (await prov('chatgpt', '?refresh=1')).usage.limits.find((l) => l.label === '5-hour limit').used;
  cg.usage = { status: 502, body: 'bad gateway' };
  assert.equal(await five(), 61);
  cg.usage = { status: 200, body: '<html>not json</html>' };
  assert.equal(await five(), 61);
  t.store.setSecret('CHATGPT_CREDENTIALS', saved);
});

test('ChatGPT plan: when the usage endpoint refuses this sign-in, it says so once, quietly, and asks again only a day later', async () => {
  for (const status of [401, 403, 404]) {
    plan.forget();
    cg.usage = { status, body: { error: { code: 'subscription_sharing_route_not_supported' } } };
    const before = toOwner().length;
    const p = await prov('chatgpt');
    assert.equal(p.usage, undefined, `${status}: no numbers`);
    assert.equal(p.usageUnavailable, true);
    assert.equal(p.connected, true, 'the account itself is fine');
    assert.equal(toOwner().length, before, 'no alert');
  }
  assert.equal(cg.usageReqs.length, 3);
  assert.ok(!('chatgpt-account-id' in cg.usageReqs[0]), 'no account id header without one in the sign-in');
  await prov('chatgpt');
  const { upkeepTick, resetUpkeep } = await import('../src/core/upkeep.js');
  resetUpkeep();
  await upkeepTick(null, Date.now() + 2 * H);
  assert.equal(cg.usageReqs.length, 3, 'refused: not asked again on Models or the tick within a day');
  assert.equal((await upkeepTick(null, Date.now() + 25 * H)).plan, 'chatgpt');
  assert.equal(cg.usageReqs.length, 4);
  // the admin tool says why there is no usage
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  const out = await TOOLS.find((x) => x.name === 'list_model_accounts').run({}, { call: async (m, path, b) => (await t.api(owner, m, path, b)).body });
  assert.match(out.find((a) => a.id === 'chatgpt').usage_note, /not available for this sign-in/);
  // headers still count when the answers carry them (any Codex header family)
  await t.agents.updateAgent('panduga', { model: 'chatgpt:gpt-x' });
  cg.headers = { ...codex('primary', 20, 300, H), 'x-codex-other-primary-used-percent': '7', 'x-codex-other-primary-window-minutes': '300', 'x-codex-other-limit-name': 'GPT-Spark' };
  await t.route(t.msg({ text: '!panduga hi' }));
  const q = await prov('chatgpt');
  assert.deepEqual(q.usage.limits.map((l) => [l.label, l.used]), [['5-hour limit', 20], ['GPT-Spark 5-hour limit', 7]]);
  assert.equal(q.usageUnavailable, true);
});

test('API keys: rate-limit headroom from Anthropic and OpenAI-style headers, and this month’s spend', async () => {
  await t.agents.updateAgent('panduga', { model: 'anthropic:claude-sonnet-5-5' });
  t.store.updateSettings({ modelPrices: { 'anthropic:claude-sonnet-5-5': { in: 3, out: 15 } } });
  t.claudeHeaders = { 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '49', 'anthropic-ratelimit-requests-reset': new Date(Date.now() + 30000).toISOString(),
    'anthropic-ratelimit-input-tokens-limit': '20000', 'anthropic-ratelimit-input-tokens-remaining': '15000', 'anthropic-ratelimit-input-tokens-reset': new Date(Date.now() + 30000).toISOString() };
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(t.msg({ text: '!panduga hi' }));
  const a = await prov('anthropic');
  assert.deepEqual(a.usage.limits.map((l) => [l.label, l.kind, l.used, l.detail]), [['input tokens per minute', 'rate', 25, '15,000 of 20,000 left'], ['requests per minute', 'rate', 2, '49 of 50 left']]);
  assert.ok(a.spend.calls >= 1); assert.ok(a.spend.cost > 0);
  assert.deepEqual((await t.api(owner, 'GET', '/api/status')).body.plans, [], 'rate limits never make an Overview hint');
  // an OpenAI-compatible endpoint's x-ratelimit-* headers
  await t.api(owner, 'POST', '/api/providers/compatible', { id: 'groq', name: 'Groq', baseUrl: orf.url(), key: 'k-groq' });
  orf.headers = { 'x-ratelimit-limit-requests': '30', 'x-ratelimit-remaining-requests': '27', 'x-ratelimit-reset-requests': '2s', 'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '5400', 'x-ratelimit-reset-tokens': '6m0s' };
  const r = await t.api(owner, 'POST', '/api/providers/groq/test', {});
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const g = await prov('groq');
  assert.deepEqual(g.usage.limits.map((l) => [l.label, l.used]), [['requests per minute', 10], ['tokens per minute', 10]]);
  // a passed reset means full headroom again
  const later = plan.view('groq', Date.now() + 10 * 60000);
  assert.deepEqual(later.limits.map((l) => [l.used, l.detail]), [[0, 'full again'], [0, 'full again']]);
  orf.headers = {};
  await t.api(owner, 'DELETE', '/api/providers/compatible/groq');
  assert.equal(plan.view('groq'), null, 'forgotten with the account');
});

test('OpenRouter: key limit, free requests per day and prepaid credit; refreshed when Models opens (TTL) and on the tick', async () => {
  orf.keyInfo = { data: { label: 'x', limit: 20, limit_remaining: 4, limit_reset: 'monthly', usage: 16, is_free_tier: false, free_model_daily_requests: { used: 48, limit: 50, remaining: 2 } } };
  orf.credits = { data: { total_credits: 10, total_usage: 2.5 } };
  await t.api(owner, 'POST', '/api/providers/openrouter', { key: 'sk-or-test', freeOnly: false });
  const p = await prov('openrouter');
  assert.deepEqual(p.usage.limits.map((l) => [l.label, l.kind, l.used, l.detail]), [
    ['free requests today', 'plan', 96, '2 of 50 left'], ['monthly key limit', 'credit', 80, '$4.00 of $20 left'], ['prepaid credit', 'credit', 25, '$7.50 of $10 left']]);
  const reqs = orf.keyReqs;
  await prov('openrouter');
  assert.equal(orf.keyReqs, reqs, 'within the TTL: no new request');
  await prov('openrouter', '?refresh=1');
  assert.equal(orf.keyReqs, reqs + 1, 'refresh=1 reads it again');
  // the scheduler tick: one account at most, each at most every 30 minutes, nothing extra
  const { upkeepTick, resetUpkeep } = await import('../src/core/upkeep.js');
  resetUpkeep();
  assert.equal((await upkeepTick(null)).plan, null, 'just read: not due');
  assert.equal((await upkeepTick(null, Date.now() + 31 * 60000)).plan, 'openrouter');
  assert.equal(orf.keyReqs, reqs + 2);
  // a key without /credits access and without limits: nothing made up
  orf.keyInfo = { data: { label: 'x', limit: null, usage: 0, is_free_tier: true } }; orf.credits = null;
  assert.equal((await prov('openrouter', '?refresh=1')).usage, undefined);
  orf.keyInfo = null;
  await t.api(owner, 'DELETE', '/api/providers/compatible/openrouter');
});

test('GitHub Copilot: premium requests from copilot_internal/user; the runtime quota only as a fallback', async () => {
  copilot.setClientFactory(async () => ({ start: async () => {}, stop: async () => {}, getAuthStatus: async () => ({ login: 'vik-gh' }),
    rpc: { models: { list: async () => ({ models: [{ id: 'gpt-5-mini', name: 'GPT-5 mini' }] }) },
      account: { getQuota: async () => ({ quotaSnapshots: { premium_interactions: { entitlementRequests: 50, usedRequests: 12, remainingPercentage: 76, isUnlimitedEntitlement: false, resetDate: '2026-12-01' } } }) } } }));
  gh.user = { login: 'vik-gh', quota_reset_date_utc: '2026-12-01T00:00:00Z', quota_snapshots: {
    premium_interactions: { entitlement: 300, remaining: 27, percent_remaining: 9, unlimited: false }, chat: { unlimited: true }, completions: { unlimited: true } } };
  t.store.setSecret('COPILOT_GITHUB_TOKEN', 'github_pat_11ABCDEFG0123456789_xyz');
  const p = await prov('copilot', '?refresh=1');
  assert.deepEqual(p.usage.limits.map((l) => [l.label, l.used, l.detail, l.resetAt]), [['premium requests', 91, '27 of 300 left', Date.parse('2026-12-01T00:00:00Z')]]);
  assert.equal(gh.reqs.at(-1).auth, 'token github_pat_11ABCDEFG0123456789_xyz');
  // a token GitHub does not answer this for: the runtime's quota (the runtime runs already for the models)
  gh.user = null;
  const q = await prov('copilot', '?refresh=1');
  assert.deepEqual(q.usage.limits.map((l) => [l.label, l.used, l.detail]), [['premium requests', 24, '38 of 50 left']]);
  // the tick never starts the runtime just for this
  copilot.stopClient();
  assert.equal(await copilot.planLimits('COPILOT_GITHUB_TOKEN', { allowStart: false }), null);
  t.store.setSecret('COPILOT_GITHUB_TOKEN', ''); copilot.setClientFactory(null);
});
