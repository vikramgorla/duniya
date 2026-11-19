// 084 (SECURITY.md): secrets read from the environment — ADMIN_PASSWORD (creates the first owner) and MASTER_KEY
// (encrypts stored secrets) — are used, but never returned by any panel API, never written to the activity log and
// never printed. The app runs with both set; every read-only panel route the admin tools use is swept.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './harness.js';

const PASSWORD = 'env-only password 4711';
const MASTER_KEY = randomBytes(32).toString('base64');
const printed = [];
const orig = { out: process.stdout.write, err: process.stderr.write, log: console.log, error: console.error, warn: console.warn, info: console.info };
const keep = (...a) => { printed.push(a.map(String).join(' ')); };
process.stdout.write = function (c, ...r) { keep(c); return orig.out.call(this, c, ...r); };
process.stderr.write = function (c, ...r) { keep(c); return orig.err.call(this, c, ...r); };
for (const k of ['log', 'error', 'warn', 'info']) console[k] = (...a) => { keep(...a); orig[k](...a); };

const t = await setup({ env: { ADMIN_PASSWORD: PASSWORD, MASTER_KEY } });
const { TOOLS } = await import('../src/panel/admin-tools.js'); // after setup: config.js reads the environment once
after(() => { Object.assign(process.stdout, { write: orig.out }); Object.assign(process.stderr, { write: orig.err }); for (const k of ['log', 'error', 'warn', 'info']) console[k] = orig[k]; t.close(); });

test('084 ADMIN_PASSWORD and MASTER_KEY: used, never returned by an API, logged or printed', async () => {
  const owner = await t.login('admin', PASSWORD); // ADMIN_PASSWORD created the owner
  // MASTER_KEY encrypts stored secrets (no master.key file is made when it is set)
  t.store.setSecret('TEST_TOKEN', 'tok-123');
  assert.equal(t.store.getSecret('TEST_TOKEN'), 'tok-123');
  assert.equal(existsSync(join(process.env.DATA_DIR, 'master.key')), false);

  const paths = [...new Set(TOOLS.flatMap((x) => x.calls).filter(([m, p]) => m === 'GET' && !/\/(x|y|1)(\/|$)/.test(p)).map(([, p]) => p))];
  assert.ok(paths.length > 40, `swept ${paths.length} routes`);
  const bodies = [];
  for (const p of paths) {
    const r = await fetch(`${t.base}${p}`, { headers: { cookie: owner } });
    bodies.push(`${p} ${await r.text()}`);
  }
  const everything = [...bodies, JSON.stringify(t.db.listActivity({ limit: 500 })), ...printed].join('\n');
  for (const [name, value] of [['ADMIN_PASSWORD', PASSWORD], ['MASTER_KEY', MASTER_KEY], ['a stored secret', 'tok-123']]) {
    assert.ok(!everything.includes(value), `${name} appears in an API answer, the activity log or the output`);
  }
});
