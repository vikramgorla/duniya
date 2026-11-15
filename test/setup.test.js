// Feature 005: first-run setup code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './harness.js';

let t;
before(async () => {
  t = await setup({
    env: { ADMIN_PASSWORD: '' },
    seed: false,
  });
});
after(() => t.close());

test('US4: first owner needs the setup code', async () => {
  const s = await t.api('', 'GET', '/api/session');
  assert.equal(s.body.needsSetup, true);
  const code = readFileSync(join(t.tmp, 'data', 'setup-code.txt'), 'utf8').trim();
  assert.equal((await t.api('', 'POST', '/api/setup', { code: 'WRONGCODE1', username: 'vik', password: 'a-strong-password' })).status, 403);
  const ok = await fetch(`${t.base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.toLowerCase(), username: 'vik', password: 'a-strong-password' }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await t.api(cookie, 'GET', '/api/users')).body[0].role, 'owner');
  assert.ok(!existsSync(join(t.tmp, 'data', 'setup-code.txt')), 'setup code removed');
  assert.equal((await t.api('', 'POST', '/api/setup', { code, username: 'x', password: 'another-password' })).status, 409);
});
