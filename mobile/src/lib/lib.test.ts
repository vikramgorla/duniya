/// <reference types="node" />
// Unit tests for the app's pure modules (027). Run: npm test (node --test with type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, parseScan, isInsecure } from './server-url.ts';
import { ago, bytes, compact, money, chatLabel, duration } from './format.ts';
import { headline, numberTone } from './status.ts';
import { createClient, discover, exchangeCode, ApiError, type Session } from './api-core.ts';
import type { Status } from './types.ts';

test('server address: typed input is normalised to an origin', () => {
  assert.equal(normalizeServer('duniya.example.com'), 'https://duniya.example.com');
  assert.equal(normalizeServer(' https://Duniya.Example.com/#settings '), 'https://duniya.example.com');
  assert.equal(normalizeServer('http://192.168.1.20:8080/api'), 'http://192.168.1.20:8080');
  for (const bad of ['', 'ftp://x.y', 'https://user:pw@x.y', 'javascript:alert(1)', 'https://exa mple.com']) assert.equal(normalizeServer(bad), null, bad);
  assert.equal(isInsecure('http://192.168.1.20:8080'), false);
  assert.equal(isInsecure('http://duniya.example.com'), true);
  assert.equal(isInsecure('https://duniya.example.com'), false);
});

test('QR scan: connect links (app and Expo Go) and plain addresses', () => {
  assert.equal(parseScan('duniya://connect?server=https%3A%2F%2Fduniya.example.com'), 'https://duniya.example.com');
  assert.equal(parseScan('exp://192.168.1.5:8081/--/connect?server=https%3A%2F%2Fa.b'), 'https://a.b');
  assert.equal(parseScan('https://duniya.example.com/#settings'), 'https://duniya.example.com');
  assert.equal(parseScan('duniya://connect'), null);
  assert.equal(parseScan('WIFI:S:home;T:WPA;P:secret;;'), null);
});

test('formatting helpers', () => {
  const now = 1_000_000_000;
  assert.equal(ago(now - 30_000, now), '30s');
  assert.equal(ago(now - 3 * 3600_000, now), '3h');
  assert.equal(ago(null), '—');
  assert.equal(bytes(1536), '1.5 KB');
  assert.equal(bytes(512), '512 B');
  assert.equal(compact(1234), '1.2k');
  assert.equal(compact(2_000_000), '2M');
  assert.equal(money(null), 'no price');
  assert.equal(money(0.004), '<$0.01');
  assert.equal(money(1.5), '$1.50');
  assert.equal(chatLabel('41790000001@s.whatsapp.net'), '+41790000001');
  assert.equal(chatLabel('g1@g.us', 'Carpool'), 'Carpool');
  assert.equal(duration(90_000), '1d 1h');
});

const status = (o: Partial<Status> = {}): Status => ({
  user: { id: 1, username: 'a', email: '', role: 'owner' }, channel: { id: 'main', label: 'Main', status: 'open' },
  settings: {}, version: 'v1', uptimeSec: 1, memoryMb: 1, node: 'v22', agents: [{ id: 'b', name: 'B', enabled: true, chats: 1 }], pending: 0, ...o,
});
test('status console headline follows the panel rules', () => {
  assert.deepEqual(headline(status()), { text: 'Everything is running', tone: 'ok' });
  assert.equal(headline(status({ settings: { paused: true } })).text, 'All agents are paused');
  assert.equal(headline(status({ channel: { id: 'main', label: 'Main', status: 'close' } })).tone, 'bad');
  assert.equal(headline(status({ agents: [] })).text, 'No agent is switched on yet');
  assert.equal(headline(status({ pending: 2 })).tone, 'warn');
  assert.equal(numberTone({ status: 'qr' }), 'warn');
});

// ---- API client with a fake server ----
type Res = { ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> };
const res = (status: number, body: unknown): Res => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
test('discover: endpoints from the server metadata; old servers get a clear message', async () => {
  const meta: Record<string, Res> = {
    'https://s/.well-known/oauth-protected-resource/api': res(200, { resource: 'https://s/api', mobile_client_id: 'duniya-mobile' }),
    'https://s/.well-known/oauth-authorization-server': res(200, { authorization_endpoint: 'https://s/oauth/authorize', token_endpoint: 'https://s/oauth/token' }),
  };
  const e = await discover('https://s', async (u) => meta[u] || res(404, {}));
  assert.equal(e.authorization, 'https://s/oauth/authorize');
  assert.equal(e.resource, 'https://s/api');
  const old: Record<string, Res> = { ...meta, 'https://s/.well-known/oauth-protected-resource/api': res(404, {}) };
  await assert.rejects(discover('https://s', async (u) => old[u] || res(404, {})), /too old/);
  await assert.rejects(discover('https://s', async () => { throw new Error('net'); }), (err: ApiError) => err.status === 0);
});

test('client: Bearer header, refresh once on 401 (shared), sign out when the refresh is refused', async () => {
  let now = 1000;
  let session: Session = { server: 'https://s', accessToken: 'a1', refreshToken: 'r1', expiresAt: now + 3600_000 };
  const calls: string[] = []; let refreshes = 0; let refuse = false; let signedOut = '';
  const fetchFn = async (url: string, init: any = {}) => {
    if (url.endsWith('/oauth/token')) {
      refreshes++;
      assert.match(init.body, /grant_type=refresh_token/);
      assert.match(init.body, /resource=https%3A%2F%2Fs%2Fapi/);
      return refuse ? res(400, { error: 'invalid_grant' }) : res(200, { access_token: `a${refreshes + 1}`, refresh_token: `r${refreshes + 1}`, expires_in: 3600 });
    }
    const tok = init.headers.authorization;
    calls.push(`${init.method} ${url} ${tok}`);
    return tok === 'Bearer a1' ? res(401, { error: 'expired' }) : res(200, { ok: true, url });
  };
  const api = createClient({ getSession: () => session, saveTokens: (t) => { session = { ...session, ...t }; }, onSignedOut: (r) => { signedOut = r; }, fetchFn, now: () => now });
  const [x, y] = await Promise.all([api.get<{ ok: boolean }>('/api/status'), api.get('/api/agents')]);
  assert.equal(x.ok, true);
  assert.ok(y);
  assert.equal(refreshes, 1, 'one refresh for concurrent 401s');
  assert.equal(session.refreshToken, 'r2');
  // proactive refresh when the token is about to expire
  now = session.expiresAt - 10_000;
  await api.put('/api/agents/x', { enabled: false });
  assert.equal(refreshes, 2);
  assert.ok(calls.at(-1)!.startsWith('PUT https://s/api/agents/x Bearer a3'));
  // refresh refused: signed out
  refuse = true; session = { ...session, accessToken: 'a1', expiresAt: now + 3600_000 };
  await assert.rejects(api.get('/api/status'), (e: ApiError) => e.status === 401);
  assert.match(signedOut, /Sign in again/);
});

test('client: errors carry the server message; offline is status 0', async () => {
  const session: Session = { server: 'https://s', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 };
  const api = createClient({ getSession: () => session, saveTokens: () => {}, onSignedOut: () => {}, fetchFn: async () => res(403, { error: 'Read-only account' }) });
  await assert.rejects(api.put('/api/agents/x', {}), (e: ApiError) => e.status === 403 && e.message === 'Read-only account');
  const off = createClient({ getSession: () => session, saveTokens: () => {}, onSignedOut: () => {}, fetchFn: async () => { throw new Error('x'); } });
  await assert.rejects(off.get('/api/status'), (e: ApiError) => e.status === 0);
  const t = await exchangeCode('https://s', { code: 'c', codeVerifier: 'v', redirectUri: 'duniya://oauth' }, async (_u, init: any) => {
    assert.match(init.body, /code_verifier=v/);
    assert.match(init.body, /redirect_uri=duniya%3A%2F%2Foauth/);
    return res(200, { access_token: 'A', refresh_token: 'R', expires_in: 10 });
  }, () => 0);
  assert.deepEqual(t, { accessToken: 'A', refreshToken: 'R', expiresAt: 10_000 });
});
