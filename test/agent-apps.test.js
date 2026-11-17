// 074 (#156): agent apps — Claude Code and Codex run on the server as model providers with the owner's own
// subscription, downloaded on connect, one at a time on small servers, Duniya's tools through the per-turn bridge.
// Fakes only: a fake `npm` on PATH installs a fake app script (test/fixtures/agent-apps) that plays Claude Code or Codex
// and calls the bridge over 127.0.0.1 like the real apps; server size comes from a fake probe.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './harness.js';

process.env.PATH = `${join(import.meta.dirname, 'fixtures', 'agent-apps')}:${process.env.PATH}`;
const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
const { setResourceProbe, setSmallServerMode } = await import('../src/core/resources.js');
const { DATA_DIR } = await import('../src/core/config.js');
const breaker = await import('../src/core/providers/breaker.js');
const { upkeepTick } = await import('../src/core/upkeep.js');
const { chat } = await import('../src/core/providers/index.js');
const owner = await t.login();
const SMALL = { totalMb: 970, cgroupLimitMb: null, availableMb: 600, cpus: 1, rssMb: 150 };
const BIG = { totalMb: 8000, cgroupLimitMb: null, availableMb: 6000, cpus: 4, rssMb: 150 };
const TOKEN = `sk-ant-oat01-${'a'.repeat(40)}`;
const calls = (id) => { const f = join(DATA_DIR, 'apps', id, 'home', 'fake-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []; };
const provider = async (id) => (await t.api(owner, 'GET', '/api/providers')).body.find((p) => p.id === id);
const activityWith = async (re) => (await t.api(owner, 'GET', '/api/activity?limit=80')).body.find((a) => re.test(a.summary));
after(() => { setResourceProbe(null); setSmallServerMode(false); return t.close(); });
beforeEach(() => { setResourceProbe(BIG); setSmallServerMode(false); });

test('small server: agent apps are refused unless Small server mode is on, and say why', async () => {
  setResourceProbe(SMALL);
  for (const [path, body] of [['/api/providers/claudecode', { token: TOKEN }], ['/api/providers/codex/start', {}], ['/api/providers/copilot', { token: 'github_pat_11ABCDEFG0123456789_xyz' }]]) {
    const r = await t.api(owner, 'POST', path, body);
    assert.equal(r.status, 400, path);
    assert.match(r.body.error, /small server .*agent apps \(Claude Code, Codex, GitHub Copilot\).*API key or OpenRouter.*Small server mode/);
  }
  assert.equal(existsSync(join(DATA_DIR, 'apps', 'claudecode')), false, 'nothing downloaded');
});

test('Claude Code: token checks, download on connect, a turn with a tool through the bridge, owner only', async () => {
  assert.match((await t.api(owner, 'POST', '/api/providers/claudecode', { token: 'sk-ant-api03-xyz' })).body.error, /API key/);
  assert.match((await t.api(owner, 'POST', '/api/providers/claudecode', { token: 'hello' })).body.error, /sk-ant-oat01-/);
  const bad = await t.api(owner, 'POST', '/api/providers/claudecode', { token: `sk-ant-oat01-bad${'b'.repeat(30)}` });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /authenticate/);
  assert.equal(t.store.getSecret('CLAUDE_CODE_OAUTH_TOKEN'), '', 'a refused token is not kept');

  setResourceProbe(SMALL); setSmallServerMode(true); // allowed on 1 GB with the switch
  const ok = await t.api(owner, 'POST', '/api/providers/claudecode', { token: TOKEN });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.connected, true);
  assert.equal(ok.body.name, 'Claude Code');
  assert.equal(ok.body.models, 3);
  assert.equal(ok.body.app.installed, true);
  assert.ok(ok.body.app.turns >= 1 && ok.body.app.startMs >= 0, 'start time measured');
  assert.ok(!JSON.stringify((await t.api(owner, 'GET', '/api/secrets')).body).includes(TOKEN), 'token never returned');
  const admin2 = await (async () => { await t.api(owner, 'POST', '/api/users', { username: 'helper2', password: 'helper password 123', role: 'admin' }); return t.login('helper2', 'helper password 123'); })();
  assert.equal((await t.api(admin2, 'POST', '/api/providers/claudecode', { token: TOKEN })).status, 403);
  assert.equal((await t.api(admin2, 'DELETE', '/api/providers/claudecode')).status, 403);

  // an agent turn: the app calls the agent's MCP tool through Duniya's bridge; Duniya's runner runs it
  await t.agents.updateAgent('panduga', { model: 'claudecode:sonnet' });
  const before = t.mcpCalls.length;
  await t.route(t.msg({ text: '!panduga please use tool agenda_list' }));
  assert.match(t.sent.at(-1).text, /^Claude Code says: .*Puja 10:00/);
  assert.equal(t.mcpCalls.length, before + 1, 'the tool ran once, in Duniya');
  const c = calls('claudecode').at(-1);
  assert.equal(c.model, 'sonnet');
  assert.ok(c.sysFile && c.sys.length > 10, 'system prompt passed as a private file');
  for (const flag of ['--strict-mcp-config', '--setting-sources', '--tools', '--no-session-persistence', '--permission-mode', '--system-prompt-file']) assert.ok(c.args.includes(flag), flag);
  assert.deepEqual(c.env, ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN'], 'only its own token: no app secrets in its environment');
  const acts = (await t.api(owner, 'GET', '/api/activity?limit=50')).body;
  assert.ok(acts.some((a) => a.type === 'tool.call' && /agenda_list/.test(a.summary)), 'tool call recorded by Duniya');
  assert.equal(existsSync(join(DATA_DIR, 'apps', 'claudecode', 'home')) && calls('claudecode').every((x) => x.sysFile), true);
  await t.agents.updateAgent('panduga', { model: 'anthropic:claude-sonnet-5-5' });
});

test('Claude Code: a usage limit pauses the account until the reset and the next model answers', async () => {
  await t.agents.updateAgent('panduga', { model: 'claudecode:sonnet' });
  await t.route(t.msg({ text: '!panduga LIMIT please' }));
  const st = breaker.accountState('claudecode');
  assert.equal(st.state, 'paused');
  assert.equal(st.reason, 'quota');
  assert.ok(st.until - Date.now() > 50 * 60000, 'paused until the reset Claude Code reported (1 h)');
  assert.doesNotMatch(t.sent.at(-1).text, /Claude Code says/);
  assert.ok(await activityWith(/after Claude Code \(usage limit reached\)|Claude Code.*usage limit/));
  breaker.reset('claudecode');
  await t.agents.updateAgent('panduga', { model: 'anthropic:claude-sonnet-5-5' });
});

test('agent apps: not enough free memory → the next model answers, no pause; a crash is reported', async () => {
  setResourceProbe({ ...BIG, availableMb: 120 });
  const r = await chat({ model: 'claudecode:sonnet', system: 's', messages: [{ role: 'user', content: 'hi' }], fallback: { enabled: true, chain: ['anthropic:claude-sonnet-5-5'] } });
  assert.equal(r.account, 'anthropic');
  assert.equal(breaker.accountState('claudecode').state, 'ok', 'no pause for a memory refusal');
  setResourceProbe(BIG);
  await assert.rejects(chat({ model: 'claudecode:sonnet', direct: true, system: 's', messages: [{ role: 'user', content: 'CRASH' }] }), /stopped with code 3: boom: fake crash/);
  breaker.reset('claudecode');
});

test('small server: one agent app at a time — a second turn waits for the first (⏳), both answer', async () => {
  setResourceProbe(SMALL); setSmallServerMode(true);
  const tools = [{ name: 'test:slow', description: 'slow', input_schema: { type: 'object', properties: {} } }];
  const first = await chat({ model: 'claudecode:sonnet', direct: true, system: 's', tools, messages: [{ role: 'user', content: 'use tool slow' }] });
  assert.equal(first.stop_reason, 'tool_use', 'the first turn holds the slot while its tool call is open');
  let waited = 0;
  const second = chat({ model: 'claudecode:haiku', direct: true, system: 's', messages: [{ role: 'user', content: 'hello' }], onWait: () => { waited++; } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(waited, 1, 'the second turn waits for the slot');
  const call = first.content.find((b) => b.type === 'tool_use');
  const done = await chat({ model: 'claudecode:sonnet', direct: true, system: 's', tools, messages: [{ role: 'user', content: 'use tool slow' }, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'slow done' }] }] });
  assert.match(done.content[0].text, /slow done/);
  assert.match((await second).content[0].text, /Hi from fake Claude Code \(haiku/);
});

test('agent apps: the upkeep tick ends a turn whose tool call nobody answered', async () => {
  const tools = [{ name: 'test:never', description: 'never answered', input_schema: { type: 'object', properties: {} } }];
  const r = await chat({ model: 'claudecode:sonnet', direct: true, system: 's', tools, messages: [{ role: 'user', content: 'use tool never' }] });
  assert.equal(r.stop_reason, 'tool_use');
  await upkeepTick(null, Date.now() + 4 * 60000);
  // the slot is free again: a small server can start the next turn at once
  setResourceProbe(SMALL); setSmallServerMode(true);
  let waited = 0;
  const next = await chat({ model: 'claudecode:haiku', direct: true, system: 's', messages: [{ role: 'user', content: 'hi' }], onWait: () => { waited++; } });
  assert.equal(waited, 0);
  assert.match(next.content[0].text, /Hi from fake/);
});

test('Codex: device sign-in from the panel, account shown, models from its catalog, a tool turn, Disconnect', async () => {
  const start = await t.api(owner, 'POST', '/api/providers/codex/start', {});
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.url, 'https://auth.openai.com/codex/device');
  assert.equal(start.body.code, 'ABCD-EF12');
  let done = null;
  for (let i = 0; i < 50 && !done; i++) { await new Promise((r) => setTimeout(r, 50)); done = (await t.api(owner, 'GET', '/api/activity?limit=20')).body.find((a) => a.detail?.signin === 'codex'); }
  assert.equal(done?.detail.ok, true);
  assert.doesNotMatch(done.summary, /@/, 'no email in the activity log');
  const p = await provider('codex');
  assert.equal(p.connected, true);
  assert.equal(p.name, 'Codex');
  assert.equal(p.account, 'owner@example.com · Plus');
  const models = (await t.api(owner, 'GET', '/api/models?refresh=1')).body.models.filter((m) => m.provider === 'codex').map((m) => m.ref);
  assert.deepEqual(models, ['codex:gpt-6.1-sol', 'codex:gpt-5.6-luna'], 'listed models in Codex’s own order, hidden ones left out');

  await t.agents.updateAgent('panduga', { model: 'codex:auto' });
  await t.route(t.msg({ text: '!panduga use tool agenda_list' }));
  assert.match(t.sent.at(-1).text, /^Codex says: .*Puja 10:00/);
  const c = calls('codex');
  const launch = c.find((x) => x.catalog);
  assert.equal(launch.sandbox, 'read-only');
  for (const f of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'computer_use', 'browser_use']) assert.ok(launch.disabled.includes(f), f);
  assert.equal(launch.catalog.supports_search_tool, false, 'tools are not hidden behind tool search');
  assert.equal(launch.catalog.apply_patch_tool_type, undefined, 'no patch tool');
  assert.deepEqual(c.at(-1).env, ['CODEX_HOME', 'DUNIYA_TOOLS_TOKEN']);

  // a usage limit pauses Codex
  await t.route(t.msg({ text: '!panduga LIMIT' }));
  assert.equal(breaker.accountState('codex').reason, 'quota');
  breaker.reset('codex');

  await t.api(owner, 'DELETE', '/api/providers/codex');
  assert.equal(existsSync(join(DATA_DIR, 'apps', 'codex')), false, 'download and sign-in removed');
  assert.equal((await provider('codex')).connected, false);
  await t.agents.updateAgent('panduga', { model: 'anthropic:claude-sonnet-5-5' });
});

test('Codex: a sign-in that does not finish is reported, nothing connected', async () => {
  mkdirSync(join(DATA_DIR, 'apps', 'codex', 'home'), { recursive: true });
  writeFileSync(join(DATA_DIR, 'apps', 'codex', 'home', 'fail-login'), ''); // the owner never finishes in the browser
  const r = await t.api(owner, 'POST', '/api/providers/codex/start', {});
  assert.equal(r.status, 200);
  let fail = null;
  for (let i = 0; i < 50 && !fail; i++) { await new Promise((res) => setTimeout(res, 50)); fail = (await t.api(owner, 'GET', '/api/activity?limit=20')).body.find((a) => a.detail?.signin === 'codex' && a.detail.ok === false); }
  assert.match(fail.summary, /did not finish: Error: device code expired/);
  assert.equal((await provider('codex')).connected, false);
  await t.api(owner, 'DELETE', '/api/providers/codex');
});
