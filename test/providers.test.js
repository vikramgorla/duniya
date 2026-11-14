// Feature 006: model providers (OpenAI-compatible, auto resolution, Sign in with ChatGPT).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';
import { setup } from './harness.js';

// ---------- fake OpenAI API ----------
const oa = { chatReqs: [], chatScript: [], respReqs: [], respScript: [], respFail: null, auths: [] };
const openaiHttp = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  const auth = req.headers.authorization || '';
  oa.auths.push(auth);
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (auth === 'Bearer bad') return json(401, { error: { message: 'Incorrect API key' } });
  if (req.method === 'GET' && req.url === '/v1/models') {
    if (auth.startsWith('Bearer chatgpt-access')) return json(200, { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' }, { slug: 'internal', visibility: 'hide' }] });
    return json(200, { data: [{ id: 'gpt-x' }, { id: 'gpt-x-mini' }] });
  }
  if (req.url === '/v1/chat/completions') {
    oa.chatReqs.push(JSON.parse(d));
    return json(200, oa.chatScript.shift() || { choices: [{ message: { content: '(empty)' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  }
  if (req.url === '/v1/responses') {
    oa.respReqs.push({ body: JSON.parse(d), auth });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
    if (oa.respFail) { ev({ type: 'response.failed', response: { error: { code: oa.respFail, message: 'limit' } } }); return res.end(); }
    const items = oa.respScript.shift() || [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '(empty)' }] }];
    for (const item of items) ev({ type: 'response.output_item.done', item });
    ev({ type: 'response.completed', response: { output: items, usage: { input_tokens: 5, output_tokens: 3 } } });
    return res.end();
  }
  json(404, { error: { message: 'not found' } });
}).listen(0);

// ---------- fake OpenAI auth (OIDC discovery + JWKS + token) ----------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = (claims) => {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })); const p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url')}`;
};
const au = { tokenReqs: [], revoked: [], noPlan: false, badNonce: false, challenge: null, nonce: null, expiresIn: 3600 };
const authHttp = http.createServer(async (req, res) => {
  let d = ''; for await (const c of req) d += c;
  const base = `http://127.0.0.1:${authHttp.address().port}`;
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/.well-known/openid-configuration') return json(200, { issuer: 'https://auth.openai.com', jwks_uri: `${base}/jwks`, revocation_endpoint: `${base}/revoke` });
  if (req.url === '/jwks') return json(200, { keys: [jwk] });
  if (req.url === '/revoke') { au.revoked.push(Object.fromEntries(new URLSearchParams(d))); return json(200, {}); }
  if (req.url === '/api/accounts/oauth/token') {
    const f = Object.fromEntries(new URLSearchParams(d));
    au.tokenReqs.push(f);
    if (f.grant_type === 'authorization_code') {
      const ok = f.code === 'good-code' && f.client_id === 'oaiapp_123' && f.redirect_uri === 'http://127.0.0.1:1455/auth/callback'
        && f.resource === 'https://api.openai.com/v1' && createHash('sha256').update(f.code_verifier).digest('base64url') === au.challenge;
      if (!ok) return json(400, { error: 'invalid_grant' });
      return json(200, {
        id_token: sign({ iss: 'https://auth.openai.com', aud: 'oaiapp_123', sub: 'user-1', email: 'vik@example.com', exp: Math.floor(Date.now() / 1000) + 3600, nonce: au.badNonce ? 'nope' : au.nonce }),
        access_token: 'chatgpt-access-1', refresh_token: 'r1', token_type: 'Bearer', expires_in: au.expiresIn,
        scope: au.noPlan ? 'openid profile email offline_access' : 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      });
    }
    if (f.grant_type === 'refresh_token' && f.refresh_token === 'r1' && f.client_id === 'oaiapp_123') {
      return json(200, { access_token: 'chatgpt-access-2', refresh_token: 'r2', expires_in: 3600, scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' });
    }
    return json(400, { error: 'invalid_grant' });
  }
  json(404, {});
}).listen(0);

let t; let owner;
before(async () => {
  t = await setup({
    env: { RATE_LIMIT_PER_MIN: '100' },
    beforeImport: () => {
      process.env.OPENAI_API_BASE = `http://127.0.0.1:${openaiHttp.address().port}/v1`;
      process.env.OPENAI_AUTH_BASE = `http://127.0.0.1:${authHttp.address().port}`;
      process.env.OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
    },
  });
  owner = await t.login();
});
after(() => { openaiHttp.close(); authHttp.close(); t.close(); });

test('US1: OpenAI-compatible providers: models listed, bad key isolated', async () => {
  const added = await t.api(owner, 'POST', '/api/providers/compatible', { id: 'ollama', name: 'Local LLM', baseUrl: process.env.OPENAI_API_BASE, key: 'k' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  await t.api(owner, 'POST', '/api/providers/compatible', { id: 'broken', baseUrl: process.env.OPENAI_API_BASE, key: 'bad' });
  assert.equal((await t.api(owner, 'POST', '/api/providers/compatible', { id: 'openai', baseUrl: 'https://x' })).status, 400, 'reserved id');
  const st = (await t.api(owner, 'GET', '/api/providers?refresh=1')).body;
  const by = Object.fromEntries(st.map((p) => [p.id, p]));
  assert.equal(by.ollama.connected, true); assert.equal(by.ollama.models, 2);
  assert.equal(by.broken.connected, false); assert.match(by.broken.error, /Incorrect API key/);
  assert.equal(by.anthropic.connected, true); assert.equal(by.chatgpt.connected, false);
  assert.ok(!JSON.stringify(await t.api(owner, 'GET', '/api/secrets')).includes('"k"'));
});

test('US2: a bot on a Chat Completions model uses tools and the confirm gate', async () => {
  await t.bots.updateBot('panduga', { model: 'ollama:gpt-x' });
  oa.chatScript.push(
    { choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'panduga__room_assign_preview', arguments: '{"family":"Rao"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    { choices: [{ message: { content: 'Preview ready.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
  );
  t.sent.length = 0; t.mcpCalls.length = 0;
  await t.route(t.msg({ phone: '41790000001', senderName: 'Vik', text: '!panduga put Rao in room 4' }));
  const [r1, r2] = oa.chatReqs.slice(-2);
  assert.equal(r1.model, 'gpt-x');
  assert.equal(r1.messages[0].role, 'system');
  assert.ok(r1.tools.some((x) => x.function.name === 'panduga__room_assign_preview'));
  assert.ok(!r1.tools.some((x) => x.function.name === 'panduga__confirm'));
  const toolMsg = r2.messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'call_1');
  assert.ok(!toolMsg.content.includes('cf_SECRET123'));
  const code = t.sent.at(-1).text.match(/confirm ([A-Z0-9]{4})/)[1];
  await t.route(t.msg({ phone: '41790000001', text: `confirm ${code}` }));
  assert.equal(t.mcpCalls.filter((c) => c.name === 'confirm').length, 1);
  const acts = (await t.api(owner, 'GET', '/api/activity?limit=200')).body;
  assert.ok(acts.some((a) => a.type === 'model.usage' && /ollama:gpt-x: 22 in \/ 8 out/.test(a.summary)));
});

test('US2: auto resolution, defaults and background model', async () => {
  let m = (await t.api(owner, 'GET', '/api/models')).body;
  assert.equal(m.resolvedDefault, 'anthropic:claude-sonnet-5-5');
  assert.equal(m.resolvedBackground, 'anthropic:claude-haiku-5-5');
  assert.ok(m.models.some((x) => x.ref === 'ollama:gpt-x'));
  assert.equal((await t.api(owner, 'POST', '/api/models/defaults', { defaultModel: 'not a ref' })).status, 400);
  await t.api(owner, 'POST', '/api/models/defaults', { defaultModel: 'ollama:gpt-x-mini' });
  m = (await t.api(owner, 'GET', '/api/models')).body;
  assert.equal(m.resolvedDefault, 'ollama:gpt-x-mini');
  await t.bots.updateBot('panduga', { model: 'auto' });
  oa.chatScript.push({ choices: [{ message: { content: 'via auto' }, finish_reason: 'stop' }] });
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.equal(oa.chatReqs.at(-1).model, 'gpt-x-mini');
  assert.equal(t.sent.at(-1).text, 'via auto');
  await t.api(owner, 'POST', '/api/models/defaults', { defaultModel: 'auto' });
});

test('US3: Sign in with ChatGPT — validation failures are rejected', async () => {
  const start = async () => {
    const r = (await t.api(owner, 'POST', '/api/providers/chatgpt/start')).body;
    const u = new URL(r.authorizeUrl);
    au.challenge = u.searchParams.get('code_challenge'); au.nonce = u.searchParams.get('nonce');
    return u;
  };
  const cb = (u, extra = {}) => `http://127.0.0.1:1455/auth/callback?${new URLSearchParams({ code: 'good-code', state: u.searchParams.get('state'), client_id: 'oaiapp_123', ...extra })}`;
  let u = await start();
  assert.equal((await t.api(owner, 'POST', '/api/providers/chatgpt/complete', { callbackUrl: cb(u, { state: 'tampered' }) })).status, 400);
  u = await start();
  assert.match((await t.api(owner, 'POST', '/api/providers/chatgpt/complete', { callbackUrl: `http://127.0.0.1:1455/auth/callback?error=access_denied&state=${u.searchParams.get('state')}` })).body.error, /declined|cancelled/);
  u = await start(); au.noPlan = true;
  assert.match((await t.api(owner, 'POST', '/api/providers/chatgpt/complete', { callbackUrl: cb(u) })).body.error, /plan usage was not granted/);
  au.noPlan = false; u = await start(); au.badNonce = true;
  assert.match((await t.api(owner, 'POST', '/api/providers/chatgpt/complete', { callbackUrl: cb(u) })).body.error, /nonce/);
  au.badNonce = false;
  const viewer = await (async () => { await t.api(owner, 'POST', '/api/users', { username: 'adm', role: 'admin', password: 'admin-password-12' }); return t.login('adm', 'admin-password-12'); })();
  assert.equal((await t.api(viewer, 'POST', '/api/providers/chatgpt/start')).status, 403, 'owner only');
});

test('US3: Sign in with ChatGPT — connect, list plan models, tool call over Responses SSE, refresh, limits, disconnect', async () => {
  const s = (await t.api(owner, 'POST', '/api/providers/chatgpt/start')).body;
  const u = new URL(s.authorizeUrl);
  const qp = Object.fromEntries(u.searchParams);
  assert.equal(u.origin + u.pathname, `${process.env.OPENAI_AUTH_BASE}/api/accounts/authorize`);
  assert.equal(qp.client_id, 'dynamic_agent_client');
  assert.equal(qp.agent_name_hint, 'whatsapp-agent-duniya');
  assert.match(qp.ext_agent_host_id, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(qp.redirect_uri, 'http://127.0.0.1:1455/auth/callback');
  assert.equal(qp.scope, 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
  assert.equal(qp.resource, 'https://api.openai.com/v1');
  assert.equal(qp.code_challenge_method, 'S256');
  au.challenge = qp.code_challenge; au.nonce = qp.nonce; au.expiresIn = 60; // expires soon → refresh on first use
  const done = await t.api(owner, 'POST', '/api/providers/chatgpt/complete', { callbackUrl: `http://127.0.0.1:1455/auth/callback?code=good-code&state=${qp.state}&client_id=oaiapp_123` });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.email, 'vik@example.com');
  assert.equal(done.body.models, 1, 'hidden models filtered');
  const creds = JSON.parse(t.store.getSecret('CHATGPT_CREDENTIALS'));
  assert.equal(creds.client_id, 'oaiapp_123');
  assert.ok(!JSON.stringify((await t.api(owner, 'GET', '/api/secrets')).body).includes('chatgpt-access'));

  await t.bots.updateBot('panduga', { model: 'chatgpt:gpt-6.1-sol' });
  oa.respScript.push(
    [{ type: 'function_call', call_id: 'fc_1', name: 'panduga__agenda_list', arguments: '{}' }],
    [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Puja at 10:00 (via ChatGPT).' }] }],
  );
  await t.route(t.msg({ text: '!panduga when is puja?' }));
  assert.equal(t.sent.at(-1).text, 'Puja at 10:00 (via ChatGPT).');
  const [q1, q2] = oa.respReqs.slice(-2).map((r) => r.body);
  assert.equal(q1.model, 'gpt-6.1-sol');
  assert.equal(q1.store, false); assert.equal(q1.stream, true);
  assert.ok(q1.instructions.length > 20);
  for (const k of ['temperature', 'max_output_tokens', 'metadata', 'previous_response_id']) assert.ok(!(k in q1), `${k} must be omitted`);
  assert.ok(!q1.input.some((i) => i.role === 'system'), 'no system role items');
  assert.ok(q1.tools.some((x) => x.type === 'function' && x.name === 'panduga__agenda_list'));
  assert.ok(q2.input.some((i) => i.type === 'function_call' && i.call_id === 'fc_1'));
  assert.ok(q2.input.some((i) => i.type === 'function_call_output' && i.call_id === 'fc_1' && /Puja 10:00/.test(i.output)));
  assert.ok(au.tokenReqs.some((f) => f.grant_type === 'refresh_token'), 'token refreshed');
  assert.equal(oa.respReqs.at(-1).auth, 'Bearer chatgpt-access-2');

  oa.respFail = 'subscription_sharing_usage_limit_exceeded';
  await t.route(t.msg({ text: '!panduga again?' }));
  assert.match(t.sent.at(-1).text, /usage limit/);
  oa.respFail = null;

  await t.api(owner, 'DELETE', '/api/providers/chatgpt');
  assert.equal(au.revoked.at(-1).token, 'r2');
  assert.equal(t.store.getSecret('CHATGPT_CREDENTIALS'), '');
  await t.bots.updateBot('panduga', { model: 'claude-sonnet-5-5' });
});
