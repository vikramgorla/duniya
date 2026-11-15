// Feature 018: guided provider setup — OpenRouter preset + free-only filter, GitHub Copilot (official SDK, faked), Test button.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup } from './harness.js';

// ---------- fake OpenRouter (OpenAI-compatible) ----------
const orr = { chatReqs: [], auths: [] };
const orHttp = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  orr.auths.push(req.headers.authorization || '');
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization === 'Bearer sk-or-bad') return json(401, { error: { message: 'No auth credentials found' } });
  if (req.method === 'GET' && req.url === '/api/v1/models') {
    return json(200, { data: [
      { id: 'meta-llama/llama-4-maverick:free', name: 'Llama 4 Maverick (free)' },
      { id: 'google/gemma-4-27b-it:free', name: 'Gemma 4 27B (free)' },
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
    ] });
  }
  if (req.url === '/api/v1/chat/completions') {
    const body = JSON.parse(d); orr.chatReqs.push(body);
    return json(200, { choices: [{ message: { content: `Hi from ${body.model}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 3 } });
  }
  json(404, { error: { message: 'not found' } });
}).listen(0);

// ---------- fake Copilot SDK client ----------
const cp = { clients: 0, started: 0, stopped: 0, sessions: [], deleted: [], tokens: [], script: [] };
function fakeCopilotFactory({ token }) {
  cp.clients++; cp.tokens.push(token);
  const bad = token.includes('BAD');
  return {
    async start() { cp.started++; },
    async stop() { cp.stopped++; return []; },
    approveAll: () => ({ kind: 'approved' }),
    rpc: {
      models: { list: async () => {
        if (bad) throw new Error('Request models.list failed with message: Authentication failed: Bad credentials');
        return { models: [
          { id: 'gpt-5-mini', name: 'GPT-5 mini', capabilities: {}, policy: { state: 'enabled' }, billing: { multiplier: 0 } },
          { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', capabilities: {}, policy: { state: 'enabled' }, billing: { multiplier: 1 } },
          { id: 'o-disabled', name: 'Disabled', capabilities: {}, policy: { state: 'disabled' } },
        ] };
      } },
      account: { getQuota: async () => ({ quotaSnapshots: { premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 50, usedRequests: 12, remainingPercentage: 76, overage: 0, usageAllowedWithExhaustedQuota: false, overageAllowedWithExhaustedQuota: false, resetDate: '2026-12-01' } } }) },
    },
    async getAuthStatus() { return { isAuthenticated: !bad, login: 'vik-gh' }; },
    async createSession(config) {
      const handlers = [];
      const s = {
        sessionId: `s${cp.sessions.length + 1}`, config, prompts: [], toolResults: [],
        on(fn) { handlers.push(fn); return () => {}; },
        emit(type, data, extra = {}) { for (const fn of handlers) fn({ type, data, ...extra }); },
        async send({ prompt }) {
          s.prompts.push(prompt);
          const steps = cp.script.shift() || [{ text: '(empty)' }];
          setImmediate(async () => {
            for (const st of steps) {
              if (st.tools) {
                const reqs = st.tools.map((tc, i) => ({ toolCallId: `tc_${s.sessionId}_${i}`, name: tc.name, arguments: tc.args }));
                s.emit('assistant.message', { messageId: 'm', content: st.text || '', toolRequests: reqs });
                const outs = await Promise.all(reqs.map((r) => config.tools.find((t) => t.name === r.name).handler(r.arguments, { toolCallId: r.toolCallId, toolName: r.name, sessionId: s.sessionId })));
                s.toolResults.push(...outs);
              } else if (st.error) {
                s.emit('session.error', { errorType: 'quota', message: st.error });
                return;
              } else {
                s.emit('assistant.message', { messageId: 'm2', content: st.text });
              }
              s.emit('assistant.usage', { model: config.model, inputTokens: 7, outputTokens: 5 });
            }
            s.emit('session.idle', {});
          });
          return 'msg-1';
        },
        async disconnect() { s.disconnected = true; },
      };
      cp.sessions.push(s);
      return s;
    },
    async deleteSession(id) { cp.deleted.push(id); },
  };
}

let t; let owner; let copilot;
before(async () => {
  t = await setup({
    env: { RATE_LIMIT_PER_MIN: '100' },
    beforeImport: () => { process.env.OPENROUTER_API_BASE = `http://127.0.0.1:${orHttp.address().port}/api/v1`; },
  });
  copilot = await import('../src/core/providers/copilot.js');
  copilot.setClientFactory(fakeCopilotFactory);
  owner = await t.login();
});
after(() => { orHttp.close(); t.close(); });

test('OpenRouter preset: one tap, key kept secret, free-only filter, auto picks a free model', async () => {
  assert.equal((await t.api(owner, 'POST', '/api/providers/openrouter', {})).status, 400, 'key needed the first time');
  const r = await t.api(owner, 'POST', '/api/providers/openrouter', { key: 'sk-or-v1-abc' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, 'openrouter'); assert.equal(r.body.connected, true);
  assert.equal(r.body.freeOnly, true, 'free models only is on by default');
  assert.equal(r.body.models, 2);
  assert.equal(r.body.baseUrl, process.env.OPENROUTER_API_BASE);
  assert.ok(orr.auths.includes('Bearer sk-or-v1-abc'));
  assert.ok(!JSON.stringify((await t.api(owner, 'GET', '/api/secrets')).body).includes('sk-or-v1-abc'), 'key never returned');

  const models = (await t.api(owner, 'GET', '/api/models?refresh=1')).body.models.filter((m) => m.provider === 'openrouter');
  assert.deepEqual(models.map((m) => m.ref).sort(), ['openrouter:google/gemma-4-27b-it:free', 'openrouter:meta-llama/llama-4-maverick:free']);

  // switch off → all models; on again (without re-entering the key)
  const off = await t.api(owner, 'POST', '/api/providers/compatible/openrouter/free-only', { on: false });
  assert.equal(off.body.freeOnly, false);
  assert.equal((await t.api(owner, 'GET', '/api/providers?refresh=1')).body.find((p) => p.id === 'openrouter').models, 3);
  const on = await t.api(owner, 'POST', '/api/providers/openrouter', { freeOnly: true });
  assert.equal(on.status, 200); assert.equal(on.body.models, 2);
  assert.ok(orr.auths.at(-1) === 'Bearer sk-or-v1-abc', 'key kept when only toggling');

  // OpenRouter as the only provider: Auto resolves to a free model
  const keepKey = t.store.getSecret('ANTHROPIC_API_KEY');
  t.store.setSecret('ANTHROPIC_API_KEY', '');
  const m = (await t.api(owner, 'GET', '/api/models')).body;
  assert.equal(m.problem, undefined, m.problem);
  assert.match(m.resolvedDefault, /^openrouter:.+:free$/);
  await t.agents.updateAgent('helper', { model: 'auto' });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help hello' }));
  assert.match(orr.chatReqs.at(-1).model, /:free$/);
  assert.match(t.sent.at(-1).text, /^Hi from .+:free$/);

  // a paid model is refused while free-only is on (fallback off: with fallback a free model answers instead, 042)
  await t.agents.updateAgent('helper', { model: 'openrouter:anthropic/claude-sonnet-5.5', fallback: { mode: 'off' } });
  const before = orr.chatReqs.length;
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help hello again' }));
  assert.equal(orr.chatReqs.length, before, 'no request for a paid model');
  assert.match(t.sent.at(-1).text, /only allows free models/);
  // with fallback on, the free Auto model answers and no paid model is requested
  await t.agents.updateAgent('helper', { fallback: { mode: 'inherit' } });
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help hello once more' }));
  assert.match(orr.chatReqs.at(-1).model, /:free$/);
  assert.ok(orr.chatReqs.slice(before).every((r) => /:free$/.test(r.model)), 'never a paid model');
  assert.match(t.sent.at(-1).text, /^Hi from .+:free$/);
  t.store.setSecret('ANTHROPIC_API_KEY', keepKey);
  await t.agents.updateAgent('helper', { model: 'claude-sonnet-5-5' });
});

test('Test button: sends "Say hi", shows reply and latency; errors are shown, not thrown', async () => {
  const r = await t.api(owner, 'POST', '/api/providers/openrouter/test', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.match(r.body.model, /^openrouter:.+:free$/);
  assert.match(r.body.reply, /^Hi from/);
  assert.equal(typeof r.body.ms, 'number');
  const req = orr.chatReqs.at(-1);
  assert.equal(req.messages.at(-1).content, 'Say hi');
  assert.equal((await t.api(owner, 'POST', '/api/providers/nope/test', {})).status, 404);
  assert.equal((await t.api(owner, 'POST', '/api/providers/chatgpt/test', {})).status, 400, 'not connected');
  await t.api(owner, 'POST', '/api/providers/compatible', { id: 'broken', baseUrl: process.env.OPENROUTER_API_BASE, key: 'sk-or-bad' });
  const bad = await t.api(owner, 'POST', '/api/providers/broken/test', {});
  assert.equal(bad.body.ok, false); assert.match(bad.body.error, /No auth credentials|No usable model/);
  await t.api(owner, 'DELETE', '/api/providers/compatible/broken');
  const acts = (await t.api(owner, 'GET', '/api/activity?limit=50')).body;
  assert.ok(acts.some((a) => /Model test openrouter:.+ ok in \d+ ms/.test(a.summary)));
});

test('GitHub Copilot: token checks, models, quota, owner only', async () => {
  assert.match((await t.api(owner, 'POST', '/api/providers/copilot', { token: 'ghp_classicclassicclassic' })).body.error, /Classic tokens/);
  assert.equal((await t.api(owner, 'POST', '/api/providers/copilot', { token: 'hello' })).status, 400);
  const bad = await t.api(owner, 'POST', '/api/providers/copilot', { token: 'github_pat_BAD_0123456789abcdef' });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Copilot requests/);
  assert.equal(t.store.getSecret('COPILOT_GITHUB_TOKEN'), '', 'a token GitHub rejects is not kept');

  const ok = await t.api(owner, 'POST', '/api/providers/copilot', { token: 'github_pat_11ABCDEFG0123456789_xyz' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.connected, true);
  assert.equal(ok.body.models, 2, 'disabled models hidden');
  assert.equal(ok.body.account, 'vik-gh');
  assert.deepEqual(ok.body.quota, { kind: 'premium_interactions', unlimited: false, used: 12, total: 50, remainingPercent: 76, resetDate: '2026-12-01' });
  assert.equal(cp.tokens.at(-1), 'github_pat_11ABCDEFG0123456789_xyz');
  assert.ok(!JSON.stringify((await t.api(owner, 'GET', '/api/secrets')).body).includes('github_pat_11'));
  const models = (await t.api(owner, 'GET', '/api/models')).body.models.filter((m) => m.provider === 'copilot');
  assert.deepEqual(models.map((m) => m.ref), ['copilot:gpt-5-mini', 'copilot:claude-sonnet-4.5']);

  await t.api(owner, 'POST', '/api/users', { username: 'adm2', role: 'admin', password: 'admin-password-12' });
  const admin = await t.login('adm2', 'admin-password-12');
  assert.equal((await t.api(admin, 'POST', '/api/providers/copilot', { token: 'github_pat_11ABCDEFG0123456789_xyz' })).status, 403);
  assert.equal((await t.api(admin, 'DELETE', '/api/providers/copilot')).status, 403);
});

test('GitHub Copilot: chat round trip with a tool call through the agent (bridge), then a plain test', async () => {
  cp.script.push([{ tools: [{ name: 'panduga__agenda_list', args: {} }] }, { text: 'Puja is at 10:00 (via Copilot).' }]);
  await t.agents.updateAgent('panduga', { model: 'copilot:claude-sonnet-4.5' });
  const sessionsBefore = cp.sessions.length;
  await t.route(t.msg({ text: '!panduga when is puja?' }));
  assert.equal(t.sent.at(-1).text, 'Puja is at 10:00 (via Copilot).');
  assert.equal(cp.sessions.length, sessionsBefore + 1, 'one SDK session for the whole tool loop');
  const s = cp.sessions.at(-1);
  assert.equal(s.config.model, 'claude-sonnet-4.5');
  assert.equal(s.config.systemMessage.mode, 'replace');
  assert.ok(s.config.systemMessage.content.length > 20);
  assert.deepEqual(s.config.availableTools, ['custom:*'], 'no built-in shell/file/web tools');
  assert.ok(s.config.tools.some((x) => x.name === 'panduga__agenda_list'));
  assert.ok(!s.config.tools.some((x) => x.name === 'panduga__confirm'), 'confirm tool never exposed');
  assert.match(s.prompts[0], /when is puja/);
  assert.match(String(s.toolResults[0]), /Puja 10:00/, 'tool result handed back to the SDK');
  assert.ok(t.mcpCalls.some((c) => c.name === 'agenda_list'));
  assert.ok(s.disconnected && cp.deleted.includes(s.sessionId), 'session cleaned up');
  const acts = (await t.api(owner, 'GET', '/api/activity?limit=50')).body;
  assert.ok(acts.some((a) => a.type === 'model.usage' && /copilot:claude-sonnet-4.5: 14 in \/ 10 out/.test(a.summary)));

  // errors reported by the runtime reach the chat as a clear message, not a crash (fallback off for this agent)
  await t.agents.updateAgent('panduga', { fallback: { mode: 'off' } });
  cp.script.push([{ error: 'You have reached your Copilot usage limit' }]);
  await t.route(t.msg({ text: '!panduga again?' }));
  assert.match(t.sent.at(-1).text, /Copilot usage limit/);
  await t.agents.updateAgent('panduga', { fallback: { mode: 'inherit' } });

  cp.script.push([{ text: 'Hi there!' }]);
  const r = await t.api(owner, 'POST', '/api/providers/copilot/test', {});
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.reply, 'Hi there!');
  assert.equal(r.body.model, 'copilot:gpt-5-mini', 'test uses the small model');
  assert.deepEqual(cp.sessions.at(-1).config.availableTools, [], 'no tools for a plain chat');

  await t.api(owner, 'DELETE', '/api/providers/copilot');
  assert.equal(t.store.getSecret('COPILOT_GITHUB_TOKEN'), '');
  assert.ok(cp.stopped >= 1, 'runtime stopped on disconnect');
  assert.equal((await t.api(owner, 'GET', '/api/providers')).body.find((p) => p.id === 'copilot').connected, false);
  await t.agents.updateAgent('panduga', { model: 'claude-sonnet-5-5' });
});

test('Copilot adapter: transcript prompt and tool name mapping', () => {
  const p = copilot.toPrompt([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'x', name: 'a', input: { q: 1 } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'done' }] },
  ]);
  assert.match(p, /User: hi/); assert.match(p, /called tool a/); assert.match(p, /Tool result: done/);
  assert.equal(copilot.toPrompt([{ role: 'user', content: 'just this' }]), 'just this');
  assert.throws(() => copilot.checkToken('ghp_abcdefabcdefabcdef'), /Classic/);
  assert.equal(copilot.checkToken(' gho_abcdefabcdefabcdef '), 'gho_abcdefabcdefabcdef');
});
