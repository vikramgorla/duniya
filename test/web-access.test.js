// Feature 031: web address & access. Pure validation + Caddyfile generation (deploy/ops/webconfig.mjs), the root
// helper's apply/rollback flow with stubbed systemctl/caddy/curl, and the panel API with a fake DNS + fake Cloudflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  normalizeDomain, parseCidr, ipInRanges, validateWebConfig, renderCaddyfile, envFor, caddyAtLeast, isCloudflareIp,
} from '../deploy/ops/webconfig.mjs';
import { setup } from './harness.js';

const ROOT = resolve(import.meta.dirname, '..');
const WEBCONFIG = join(ROOT, 'deploy/ops/webconfig.mjs');
const HELPER = join(ROOT, 'deploy/ops/duniya-ops');

// ---------- pure validation ----------
test('031: domains are validated strictly (no IPs, no spaces, no Caddyfile syntax)', () => {
  assert.equal(normalizeDomain(' Agents.Example.ORG. '), 'agents.example.org');
  assert.equal(normalizeDomain('141-147-1-2.sslip.io'), '141-147-1-2.sslip.io');
  assert.equal(normalizeDomain('xn--bcher-kva.ch'), 'xn--bcher-kva.ch');
  for (const bad of ['', 'localhost', 'example', '1.2.3.4', 'a..b.com', '-a.com', 'a-.com', 'ex ample.com', '*.example.com',
    'a.com {\n\trespond hi\n}', 'a.com\nimport x', 'a.com/path', 'a.com:443', 'a.example', 'panel.local', `${'a'.repeat(64)}.com`, 'a.c0m', 'http://a.com']) {
    assert.throws(() => normalizeDomain(bad), /domain|name|public/i, JSON.stringify(bad));
  }
});

test('031: CIDRs are parsed and written back in canonical form; anything else is refused', () => {
  assert.equal(parseCidr('203.0.113.7').text, '203.0.113.7/32');
  assert.equal(parseCidr('192.168.1.77/24').text, '192.168.1.0/24');
  assert.equal(parseCidr('0.0.0.0/0').text, '0.0.0.0/0');
  assert.equal(parseCidr('2001:DB8::1/32').text, '2001:db8::/32');
  assert.equal(parseCidr('2a06:98c0::/29').text, '2a06:98c0::/29');
  assert.equal(parseCidr('::1').text, '::1/128');
  assert.equal(parseCidr('2001:db8:0:0:1:0:0:1').text, '2001:db8::1:0:0:1/128');
  for (const bad of ['1.2.3.256', '1.2.3', '01.2.3.4', '1.2.3.4/33', '1.2.3.4/', '1.2.3.4/024', '::1/129', 'fe80::1%eth0', '1.2.3.4 }', '1.2.3.4/24\nimport x', 'example.com', '', '1.2.3.4/8/8']) {
    assert.throws(() => parseCidr(bad), /IP address|range|after \//, JSON.stringify(bad));
  }
  assert.ok(ipInRanges('203.0.113.9', ['203.0.113.0/24']));
  assert.ok(!ipInRanges('203.0.114.9', ['203.0.113.0/24']));
  assert.ok(ipInRanges('::ffff:203.0.113.9', ['203.0.113.0/24']), 'IPv4-mapped addresses count');
  assert.ok(ipInRanges('2a06:98c7::1', ['2a06:98c0::/29']));
  assert.ok(isCloudflareIp('104.16.1.1')); assert.ok(!isCloudflareIp('8.8.8.8'));
  assert.ok(caddyAtLeast('v2.10.2', '2.7.0')); assert.ok(!caddyAtLeast('2.6.2', '2.7.0'));
});

test('031: the request is refused on unknown keys, bad types, bad ports and oversized lists', () => {
  const ok = { host: 'agents.example.org', port: 8080, access: {} };
  assert.equal(validateWebConfig(ok).host, 'agents.example.org');
  assert.throws(() => validateWebConfig({ ...ok, extra: 'x' }), /Unknown setting/);
  assert.throws(() => validateWebConfig({ ...ok, access: { cloudflareOnly: 'yes' } }), /true or false/);
  assert.throws(() => validateWebConfig({ ...ok, access: { allow: '1.2.3.4' } }), /list/);
  assert.throws(() => validateWebConfig({ ...ok, access: { allow: [], evil: 1 } }), /Unknown access setting/);
  assert.throws(() => validateWebConfig({ ...ok, port: 80 }), /port/);
  assert.throws(() => validateWebConfig({ ...ok, port: '8080' }), /port/);
  assert.throws(() => validateWebConfig({ ...ok, serverIp: '1.2.3.4; rm -rf /' }), /server IP/);
  assert.throws(() => validateWebConfig({ ...ok, access: { allow: Array.from({ length: 201 }, (_, i) => `10.0.${i >> 8}.${i & 255}`) } }), /At most 200/);
  assert.throws(() => validateWebConfig([ok]), /Invalid/);
  assert.deepEqual(validateWebConfig({ ...ok, access: { allow: ['10.0.0.1', '10.0.0.1/32', '10.0.0.0/8'] } }).access.allow, ['10.0.0.1/32', '10.0.0.0/8'], 'duplicates dropped');
  // Only Cloudflare without a downloaded list falls back to the built-in ranges
  assert.ok(validateWebConfig({ ...ok, access: { cloudflareOnly: true } }).cloudflareRanges.includes('173.245.48.0/20'));
});

test('031: Caddyfile generation for open / only Cloudflare / own list / both, per Caddy version', () => {
  const base = { host: 'agents.example.org', redirectHosts: ['141-147-1-2.sslip.io'], serverIp: '141.147.1.2', port: 8080 };
  const open = renderCaddyfile({ ...base, access: {} });
  assert.match(open, /^agents\.example\.org \{\n\tencode gzip\n\treverse_proxy 127\.0\.0\.1:8080\n\}$/m);
  assert.match(open, /141-147-1-2\.sslip\.io \{\n\tredir https:\/\/agents\.example\.org\{uri\} 308\n\}/);
  assert.match(open, /http:\/\/141\.147\.1\.2 \{\n\tredir https:\/\/agents\.example\.org\{uri\} 302/);
  assert.doesNotMatch(open, /remote_ip|client_ip|trusted_proxies/);

  const cf26 = renderCaddyfile({ ...base, access: { cloudflareOnly: true } }, { caddyVersion: '2.6.2' });
  assert.match(cf26, /@not_cloudflare not remote_ip 173\.245\.48\.0\/20 .* 2c0f:f248::\/32 127\.0\.0\.1\/8 ::1\/128\n\trespond @not_cloudflare .* 403/);
  assert.doesNotMatch(cf26, /trusted_proxies/, 'Caddy 2.6 has no trusted_proxies');
  const cf27 = renderCaddyfile({ ...base, access: { cloudflareOnly: true } }, { caddyVersion: '2.10.2' });
  assert.match(cf27, /^\{\n\tservers \{\n\t\ttrusted_proxies static 173\.245\.48\.0\/20 [^\n]*\n\t\tclient_ip_headers CF-Connecting-IP X-Forwarded-For\n\t\}\n\}/m);

  const list = renderCaddyfile({ ...base, access: { allow: ['203.0.113.7', '2001:db8::/32'] } }, { caddyVersion: '2.6.2' });
  assert.match(list, /@not_allowed not remote_ip 203\.0\.113\.7\/32 2001:db8::\/32 127\.0\.0\.1\/8 ::1\/128/);

  const both = renderCaddyfile({ ...base, access: { cloudflareOnly: true, allow: ['203.0.113.0/24'] } }, { caddyVersion: '2.8.4' });
  assert.match(both, /@not_cloudflare not remote_ip/);
  assert.match(both, /@not_allowed not client_ip 203\.0\.113\.0\/24 127\.0\.0\.1\/8 ::1\/128/, 'behind Cloudflare the visitor address is client_ip');
  assert.throws(() => renderCaddyfile({ ...base, access: { cloudflareOnly: true, allow: ['203.0.113.0/24'] } }, { caddyVersion: '2.6.2' }), /Caddy 2\.7/);

  assert.deepEqual(envFor({ ...base, access: { cloudflareOnly: true } }), { HOST: 'agents.example.org', PUBLIC_URL: 'https://agents.example.org', TRUST_PROXY: 'cloudflare', EXPOSURE: 'domain' });
  assert.equal(envFor({ ...base, host: '141-147-1-2.sslip.io', access: {} }).EXPOSURE, 'ip');
});

test('031: generated Caddyfiles are accepted by the installed Caddy (skipped when caddy is not installed)', (tt) => {
  let ver = '';
  try { ver = execFileSync('caddy', ['version'], { encoding: 'utf8' }).split(/\s/)[0]; } catch { return tt.skip('caddy not installed'); }
  const dir = mkdtempSync(join(tmpdir(), 'caddyfile-'));
  const base = { host: 'agents.example.org', redirectHosts: ['141-147-1-2.sslip.io'], serverIp: '141.147.1.2', port: 8080 };
  const variants = [{}, { cloudflareOnly: true }, { allow: ['203.0.113.7', '2001:db8::/32'] }];
  if (caddyAtLeast(ver, '2.7.0')) variants.push({ cloudflareOnly: true, allow: ['203.0.113.0/24'] });
  for (const access of variants) {
    const f = join(dir, 'Caddyfile');
    writeFileSync(f, renderCaddyfile({ ...base, access }, { caddyVersion: ver }));
    execFileSync('caddy', ['adapt', '--adapter', 'caddyfile', '--config', f], { stdio: 'pipe' });
  }
});

test('031: webconfig.mjs command line: render writes the Caddyfile and prints validated env lines; invalid → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webcfg-'));
  writeFileSync(join(dir, 'req.json'), JSON.stringify({ host: 'agents.example.org', port: 8080, access: { cloudflareOnly: true } }));
  const out = execFileSync(process.execPath, [WEBCONFIG, 'render', join(dir, 'req.json'), '--out', join(dir, 'Caddyfile'), '--caddy-version', '2.6.2'], { encoding: 'utf8' });
  assert.equal(out, 'HOST=agents.example.org\nPUBLIC_URL=https://agents.example.org\nTRUST_PROXY=cloudflare\nEXPOSURE=domain\n');
  assert.match(readFileSync(join(dir, 'Caddyfile'), 'utf8'), /^agents\.example\.org \{/m);
  // installer re-run: same access rules for the address chosen now
  execFileSync(process.execPath, [WEBCONFIG, 'render', join(dir, 'req.json'), '--out', join(dir, 'C2'), '--host', '141-147-1-2.sslip.io', '--server-ip', ''], { encoding: 'utf8' });
  assert.match(readFileSync(join(dir, 'C2'), 'utf8'), /^141-147-1-2\.sslip\.io \{[\s\S]*not_cloudflare/m);
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ host: 'a.com {\n}', access: {} }));
  assert.throws(() => execFileSync(process.execPath, [WEBCONFIG, 'render', join(dir, 'bad.json'), '--out', join(dir, 'C3')], { stdio: 'pipe' }), (e) => e.status === 2 && /invalid web config/.test(String(e.stderr)));
  assert.ok(!existsSync(join(dir, 'C3')));
});

// ---------- the root helper, with stubbed system tools ----------
function helperSandbox() {
  const d = mkdtempSync(join(tmpdir(), 'duniya-ops-'));
  for (const sub of ['req', 'state', 'etc', 'bin']) mkdirSync(join(d, sub));
  const stub = (name, body) => { writeFileSync(join(d, 'bin', name), `#!/bin/bash\n${body}\n`); chmodSync(join(d, 'bin', name), 0o755); };
  stub('systemctl', `echo "systemctl $*" >> "${d}/calls"`);
  stub('journalctl', 'true');
  stub('caddy', `case "$1" in version) echo "v2.10.2 h1:x" ;; validate) grep -q FAIL_VALIDATE "$5" && exit 1; echo "validate $5" >> "${d}/calls" ;; esac`);
  stub('curl', `echo "curl $*" >> "${d}/calls"; [ -f "${d}/https-ok" ]`);
  writeFileSync(join(d, 'etc', 'Caddyfile'), 'old.sslip.io {\n\treverse_proxy 127.0.0.1:8080\n}\n');
  writeFileSync(join(d, 'etc', 'app.env'), 'NODE_ENV=production\nPUBLIC_URL=https://old.sslip.io\nTRUST_PROXY=1\n');
  writeFileSync(join(d, 'etc', 'install.conf'), "REPO='x'\nEXPOSURE='ip'\nDOMAIN=''\n");
  const env = {
    ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}`, DUNIYA_OPS_REQUEST_DIR: join(d, 'req'), DUNIYA_OPS_STATE_DIR: join(d, 'state'),
    DUNIYA_OPS_WEBCONFIG: WEBCONFIG, DUNIYA_OPS_CADDYFILE: join(d, 'etc', 'Caddyfile'), DUNIYA_OPS_APP_ENV: join(d, 'etc', 'app.env'),
    DUNIYA_OPS_INSTALL_CONF: join(d, 'etc', 'install.conf'), DUNIYA_HTTPS_WAIT: '1', DUNIYA_HTTPS_POLL: '1',
  };
  const run = (action, request) => {
    if (request !== undefined) writeFileSync(join(d, 'req', 'web-config.json'), typeof request === 'string' ? request : JSON.stringify(request));
    writeFileSync(join(d, 'req', 'request'), `${action}\n`);
    execFileSync('bash', [HELPER], { env, stdio: 'pipe' });
    const j = (f) => { try { return JSON.parse(readFileSync(join(d, 'state', f), 'utf8')); } catch { return null; } };
    return { status: j('status.json'), web: j('web-status.json'), log: readFileSync(join(d, 'state', 'last.log'), 'utf8') };
  };
  const read = (...p) => readFileSync(join(d, ...p), 'utf8');
  return { d, run, read };
}

test('031 helper: apply-web-config validates, reloads Caddy, waits for HTTPS, then updates PUBLIC_URL/TRUST_PROXY', () => {
  const s = helperSandbox();
  writeFileSync(join(s.d, 'https-ok'), '');
  const r = s.run('apply-web-config', { host: 'Agents.Example.org', redirectHosts: ['old.sslip.io'], port: 8080, access: { cloudflareOnly: true } });
  assert.equal(r.status.state, 'done', r.log);
  assert.equal(r.web.state, 'done'); assert.equal(r.web.host, 'agents.example.org'); assert.match(r.web.message, /Live at https:\/\/agents\.example\.org/);
  const caddy = s.read('etc', 'Caddyfile');
  assert.match(caddy, /^agents\.example\.org \{$/m);
  assert.match(caddy, /trusted_proxies/);
  assert.match(s.read('etc', 'app.env'), /^PUBLIC_URL=https:\/\/agents\.example\.org$/m);
  assert.match(s.read('etc', 'app.env'), /^TRUST_PROXY=cloudflare$/m);
  assert.match(s.read('etc', 'app.env'), /^DUNIYA_EXPOSURE=domain$/m);
  assert.match(s.read('etc', 'install.conf'), /^EXPOSURE='domain'$/m); assert.match(s.read('etc', 'install.conf'), /^DOMAIN='agents\.example\.org'$/m);
  assert.match(s.read('state', 'Caddyfile.prev'), /^(?:http:\/\/)?old\.sslip\.io\b/m, 'the previous config is kept');
  assert.equal(s.read('state', 'Caddyfile.last-good'), s.read('etc', 'Caddyfile'));
  assert.equal(JSON.parse(s.read('state', 'web-applied.json')).host, 'Agents.Example.org');
  const calls = s.read('calls');
  assert.match(calls, /validate .*Caddyfile/); assert.match(calls, /systemctl reload caddy/);
  assert.match(calls, /curl .*--resolve agents\.example\.org:443:127\.0\.0\.1 https:\/\/agents\.example\.org\/healthz/);
  assert.ok(!existsSync(join(s.d, 'req', 'web-config.json')), 'the request file is consumed');
});

test('031 helper: no HTTPS in time → previous Caddyfile restored; invalid or unknown requests change nothing', () => {
  const s = helperSandbox();
  const before = s.read('etc', 'Caddyfile');
  const r = s.run('apply-web-config', { host: 'agents.example.org', port: 8080, access: {} });
  assert.equal(r.status.state, 'failed');
  assert.equal(r.web.state, 'rolled-back'); assert.match(r.web.message, /previous address was restored/);
  assert.equal(s.read('etc', 'Caddyfile'), before);
  assert.match(s.read('etc', 'app.env'), /PUBLIC_URL=https:\/\/old\.sslip\.io/, 'address unchanged');

  const inj = s.run('apply-web-config', '{"host":"a.com {\\n\\timport /etc/passwd\\n}","access":{}}');
  assert.equal(inj.web.state, 'failed'); assert.match(inj.web.message, /refused/);
  assert.equal(s.read('etc', 'Caddyfile'), before);
  const extra = s.run('apply-web-config', { host: 'agents.example.org', access: {}, caddyfile: 'respond 200' });
  assert.equal(extra.web.state, 'failed'); assert.doesNotMatch(JSON.stringify(extra.web), /respond 200/);
  const json = s.run('apply-web-config', 'not json');
  assert.equal(json.web.state, 'failed');
  writeFileSync(join(s.d, 'https-ok'), '');
  const fv = s.run('apply-web-config', { host: 'agents.example.org', access: { allow: ['10.0.0.0/8'] } });
  assert.equal(fv.web.state, 'done', fv.log);
  rmSync(join(s.d, 'state', 'status.json'));
  writeFileSync(join(s.d, 'req', 'request'), 'rm-rf\n');
  execFileSync('bash', [HELPER], { env: { ...process.env, DUNIYA_OPS_REQUEST_DIR: join(s.d, 'req'), DUNIYA_OPS_STATE_DIR: join(s.d, 'state') } });
  assert.ok(!existsSync(join(s.d, 'state', 'status.json')), 'unknown actions do nothing');
});

// ---------- panel API ----------
const cf = { v4: '173.245.48.0/20\n103.21.244.0/22\n103.22.200.0/22\n103.31.4.0/22\n141.101.64.0/18\n198.51.100.0/24\n', v6: '2400:cb00::/32\n2606:4700::/32\n2803:f800::/32\n' };
const cfHttp = http.createServer((req, res) => { res.end(req.url.endsWith('v6') ? cf.v6 : cf.v4); }).listen(0);
let t; let owner; let ops;
const opsDir = mkdtempSync(join(tmpdir(), 'duniya-web-'));
before(async () => {
  ops = { req: join(opsDir, 'req'), state: join(opsDir, 'state') };
  mkdirSync(ops.req); mkdirSync(ops.state);
  writeFileSync(join(opsDir, 'duniya-ops'), '#!/bin/sh\n');
  t = await setup({
    env: {
      DUNIYA_OPS_REQUEST_DIR: ops.req, DUNIYA_OPS_STATE_DIR: ops.state, DUNIYA_OPS_HELPER: join(opsDir, 'duniya-ops'), DUNIYA_OPS_WEBCONFIG: WEBCONFIG,
      DUNIYA_EXPOSURE: 'ip', PUBLIC_URL: 'https://141-147-1-2.sslip.io', DUNIYA_TLS_PORT: '1',
      DUNIYA_FAKE_DNS: JSON.stringify({ 'agents.example.org': ['141.147.1.2'], 'wrong.example.org': ['9.9.9.9'], 'cf.example.org': ['104.16.5.5', '2606:4700::1'] }),
      CLOUDFLARE_IPS_V4_URL: `http://127.0.0.1:${cfHttp.address().port}/ips-v4`, CLOUDFLARE_IPS_V6_URL: `http://127.0.0.1:${cfHttp.address().port}/ips-v6`,
    },
  });
  owner = await t.login();
});
after(() => { cfHttp.close(); t.close(); });
const request = () => ({ action: readFileSync(join(ops.req, 'request'), 'utf8').trim(), config: JSON.parse(readFileSync(join(ops.req, 'web-config.json'), 'utf8')) });
const clearOps = () => { for (const f of ['request', 'web-config.json']) rmSync(join(ops.req, f), { force: true }); rmSync(join(ops.state, 'status.json'), { force: true }); };

test('031 API: the card shows address, certificate state and access; owner only', async () => {
  const w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.availability.ok, true, JSON.stringify(w.availability));
  assert.equal(w.current.host, '141-147-1-2.sslip.io'); assert.equal(w.serverIp, '141.147.1.2', 'from the sslip.io name');
  assert.equal(w.cert.state, 'none'); assert.equal(w.restricted, false); assert.equal(w.pending, null);
  await t.api(owner, 'POST', '/api/users', { username: 'adm2', role: 'admin', password: 'admin-password-12' });
  const adm = await t.login('adm2', 'admin-password-12');
  assert.equal((await t.api(adm, 'GET', '/api/web')).status, 403);
  assert.equal((await t.api(adm, 'PUT', '/api/web', { domain: 'agents.example.org' })).status, 403);
});

test('031 API: DNS check says what record to create, accepts this server or Cloudflare', async () => {
  const miss = (await t.api(owner, 'POST', '/api/web/check', { domain: 'new.example.org' })).body;
  assert.equal(miss.state, 'missing'); assert.deepEqual(miss.record, { type: 'A', name: 'new.example.org', value: '141.147.1.2' });
  assert.equal((await t.api(owner, 'POST', '/api/web/check', { domain: 'wrong.example.org' })).body.state, 'wrong');
  assert.equal((await t.api(owner, 'POST', '/api/web/check', { domain: 'Agents.Example.org' })).body.state, 'ok');
  const prox = (await t.api(owner, 'POST', '/api/web/check', { domain: 'cf.example.org' })).body;
  assert.equal(prox.state, 'proxied'); assert.equal(prox.ok, true); assert.match(prox.text, /DNS only/);
  assert.equal((await t.api(owner, 'POST', '/api/web/check', { domain: '1.2.3.4' })).body.field, 'domain');
});

test('031 API: apply a domain → validated request for the root helper; refused when DNS is wrong or busy', async () => {
  clearOps();
  const no = await t.api(owner, 'PUT', '/api/web', { domain: 'wrong.example.org' });
  assert.equal(no.status, 400); assert.equal(no.body.field, 'domain'); assert.equal(no.body.check.state, 'wrong');
  assert.ok(!existsSync(join(ops.req, 'request')));
  const ok = await t.api(owner, 'PUT', '/api/web', { domain: 'agents.example.org' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const r = request();
  assert.equal(r.action, 'apply-web-config');
  assert.equal(r.config.host, 'agents.example.org'); assert.deepEqual(r.config.redirectHosts, ['141-147-1-2.sslip.io']);
  assert.equal(r.config.serverIp, '141.147.1.2'); assert.deepEqual(r.config.access, { cloudflareOnly: false, allow: [] });
  assert.doesNotThrow(() => validateWebConfig(r.config), 'the helper accepts what the app writes');
  writeFileSync(join(ops.state, 'status.json'), JSON.stringify({ action: 'apply-web-config', state: 'running', startedAt: Date.now() }));
  writeFileSync(join(ops.state, 'web-status.json'), JSON.stringify({ state: 'waiting', host: 'agents.example.org', startedAt: Date.now() }));
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.pending, 'waiting', 'progress survives a reload (state is on the server)');
  assert.equal((await t.api(owner, 'PUT', '/api/web', { domain: 'agents.example.org' })).status, 409, 'cannot run twice');
  const log = (await t.api(owner, 'GET', '/api/activity?limit=20')).body.map((a) => a.summary).join('\n');
  assert.match(log, /Web address & access: agents\.example\.org, open to everyone \(admin\)/);
});

test('031 API: after the helper succeeded the panel uses the new address at once', async () => {
  writeFileSync(join(ops.state, 'web-applied.json'), JSON.stringify(request().config));
  writeFileSync(join(ops.state, 'status.json'), JSON.stringify({ action: 'apply-web-config', state: 'done', startedAt: Date.now() - 5000, endedAt: Date.now() }));
  writeFileSync(join(ops.state, 'web-status.json'), JSON.stringify({ state: 'done', message: 'Live at https://agents.example.org', host: 'agents.example.org', startedAt: Date.now() - 5000, endedAt: Date.now(), at: Date.now() }));
  const w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.current.url, 'https://agents.example.org'); assert.equal(w.pending, null); assert.equal(w.last.state, 'done');
  assert.equal(process.env.PUBLIC_URL, 'https://agents.example.org');
});

test('031 API: allow-lists — own IP kept by default, lock-out needs confirmation, injection refused, preview', async () => {
  clearOps();
  const bad = await t.api(owner, 'PUT', '/api/web', { allow: ['10.0.0.0/8 }\nimport evil'] });
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'allow');
  const lock = await t.api(owner, 'PUT', '/api/web', { allow: ['203.0.113.0/24'], alwaysAllowMine: false });
  assert.equal(lock.status, 409); assert.equal(lock.body.needsConfirm, true); assert.match(lock.body.error, /lose access/);
  assert.ok(!existsSync(join(ops.req, 'request')));
  const mine = await t.api(owner, 'PUT', '/api/web', { allow: ['203.0.113.0/24'], alwaysAllowMine: true });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.deepEqual(request().config.access.allow, ['203.0.113.0/24', '127.0.0.1/32'], 'your current address is added');
  clearOps();
  const cfOnly = await t.api(owner, 'PUT', '/api/web', { cloudflareOnly: true, allow: [] });
  assert.equal(cfOnly.status, 409, 'not using the panel through Cloudflare right now'); assert.match(cfOnly.body.error, /not using the panel through Cloudflare/);
  const sure = await t.api(owner, 'PUT', '/api/web', { cloudflareOnly: true, allow: [], confirmLockout: true });
  assert.equal(sure.status, 200);
  assert.equal(request().config.access.cloudflareOnly, true); assert.ok(request().config.cloudflareRanges.length >= 20, 'built-in ranges until downloaded');
  const pv = (await t.api(owner, 'POST', '/api/web/preview', { cloudflareOnly: false, allow: ['198.51.100.7'] })).body;
  assert.match(pv.caddyfile, /@not_allowed not remote_ip 198\.51\.100\.7\/32 127\.0\.0\.1\/32/);
});

test('031 API: Cloudflare ranges are downloaded, validated, and a change re-applies the web server', async () => {
  clearOps();
  writeFileSync(join(ops.state, 'web-applied.json'), JSON.stringify({ host: 'agents.example.org', port: 8080, access: { cloudflareOnly: true, allow: [] } }));
  const r = await t.api(owner, 'POST', '/api/web/cloudflare/refresh');
  assert.deepEqual(r.body, { v4: 6, v6: 3, changed: true });
  const req = request();
  assert.equal(req.action, 'apply-web-config');
  assert.ok(req.config.cloudflareRanges.includes('198.51.100.0/24'), 'the downloaded list is used');
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.cloudflare.ranges, 9);
  clearOps();
  assert.equal((await t.api(owner, 'POST', '/api/web/cloudflare/refresh')).body.changed, false);
  assert.ok(!existsSync(join(ops.req, 'request')), 'no change, no apply');
  cf.v4 = 'not-an-ip\n';
  assert.equal((await t.api(owner, 'POST', '/api/web/cloudflare/refresh')).status, 400, 'a broken download is refused');
});

test('031 + 029: `duniya open-access` removes every restriction (recovery when locked out)', async () => {
  clearOps();
  const r = await new Promise((res) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'bin/duniya.js'), 'open-access'], { env: { ...process.env, NO_COLOR: '1' } }, (e, out, err) => res({ code: e ? e.code : 0, out, err })));
  assert.equal(r.code, 0, r.err); assert.match(r.out, /IP allow-list removed/);
  assert.deepEqual(request().config.access, { cloudflareOnly: false, allow: [] });
  assert.equal(request().config.host, 'agents.example.org');
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.settings.cloudflareOnly, false);
});

test('031 API: not offered where the panel cannot change it (tunnel, Docker, old helper)', async () => {
  const { availability } = await import('../src/core/webaccess.js');
  process.env.DUNIYA_EXPOSURE = 'tunnel'; assert.equal(availability().reason, 'tunnel');
  process.env.DUNIYA_EXPOSURE = 'ip'; process.env.DUNIYA_INSTALL = 'docker'; assert.equal(availability().reason, 'docker');
  delete process.env.DUNIYA_INSTALL;
  assert.equal(availability().ok, true);
  rmSync(join(opsDir, 'duniya-ops')); assert.equal(availability().reason, 'helper', 'no maintenance helper: re-run the installer');
  writeFileSync(join(opsDir, 'duniya-ops'), '#!/bin/sh\n');
  assert.equal((await t.api(owner, 'PUT', '/api/web', { domain: 'agents.example.org', confirmLockout: true })).status, 200);
});
