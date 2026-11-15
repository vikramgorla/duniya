// Features 031 + 036: web address & access. Pure validation + Caddyfile generation (deploy/ops/webconfig.mjs), the root
// helper's apply/rollback flow with stubbed systemctl/caddy/curl, and the panel API with a fake DNS + fake Cloudflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  normalizeDomain, parseCidr, ipInRanges, validateWebConfig, renderCaddyfile, envFor, caddyAtLeast, isCloudflareIp, PROVIDERS,
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

test('031/036: the request is refused on unknown keys, bad types, unknown proxies, bad ports and oversized lists', () => {
  const ok = { host: 'agents.example.org', port: 8080, access: {} };
  assert.equal(validateWebConfig(ok).host, 'agents.example.org');
  assert.throws(() => validateWebConfig({ ...ok, extra: 'x' }), /Unknown setting/);
  assert.throws(() => validateWebConfig({ ...ok, access: { cloudflareOnly: true } }), /Unknown access setting/, 'no legacy keys');
  assert.throws(() => validateWebConfig({ ...ok, access: { proxy: 'evil' } }), /Unknown proxy/);
  assert.throws(() => validateWebConfig({ ...ok, access: { proxy: 'fastly' } }), /address list of Fastly is missing/);
  assert.throws(() => validateWebConfig({ ...ok, access: { allow: '1.2.3.4' } }), /list/);
  assert.throws(() => validateWebConfig({ ...ok, port: 80 }), /port/);
  assert.throws(() => validateWebConfig({ ...ok, serverIp: '1.2.3.4; rm -rf /' }), /server IP/);
  assert.throws(() => validateWebConfig({ ...ok, aliases: ['a.com {\n}'] }), /domain/);
  assert.throws(() => validateWebConfig({ ...ok, access: { allow: Array.from({ length: 201 }, (_, i) => `10.0.${i >> 8}.${i & 255}`) } }), /At most 200/);
  assert.throws(() => validateWebConfig([ok]), /Invalid/);
  assert.deepEqual(validateWebConfig({ ...ok, access: { allow: ['10.0.0.1', '10.0.0.1/32', '10.0.0.0/8'] } }).access.allow, ['10.0.0.1/32', '10.0.0.0/8'], 'duplicates dropped');
  assert.ok(validateWebConfig({ ...ok, access: { proxy: 'cloudflare' } }).proxyRanges.includes('173.245.48.0/20'), 'Cloudflare built-in list');
  const c = validateWebConfig({ ...ok, aliases: ['new.example.org', 'agents.example.org'], proxiedHosts: ['new.example.org', 'other.example.org'] });
  assert.deepEqual(c.aliases, ['new.example.org']); assert.deepEqual(c.proxiedHosts, ['new.example.org'], 'only served addresses');
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ['bunny', 'cloudflare', 'cloudfront', 'custom', 'fastly', 'gcore']);
});

test('036: Caddyfile — HTTPS only, reachability check on any host, fallback certificate behind a proxy, client IP for the app', () => {
  const base = { host: 'agents.example.org', redirectHosts: ['141-147-1-2.sslip.io'], serverIp: '141.147.1.2', port: 8080 };
  const open = renderCaddyfile({ ...base, access: {} });
  assert.match(open, /^\{\n\tskip_install_trust\n\ton_demand_tls \{\n\t\task http:\/\/127\.0\.0\.1:8080\/\.well-known\/duniya-check-ask\n\t\}\n\}/m);
  assert.match(open, /^agents\.example\.org \{\n\tencode gzip\n\treverse_proxy 127\.0\.0\.1:8080 \{\n\t\theader_up X-Duniya-Client-IP \{client_ip\}\n\t\theader_up X-Duniya-Origin-Scheme \{scheme\}\n\t\}\n\}/m);
  assert.doesNotMatch(open, /issuer internal/, 'direct: Let’s Encrypt only');
  assert.match(open, /141-147-1-2\.sslip\.io \{\n\tredir https:\/\/agents\.example\.org\{uri\} 308\n\}/);
  assert.match(open, /http:\/\/141\.147\.1\.2 \{\n\tredir https:\/\/agents\.example\.org\{uri\} 302/);
  assert.match(open, /^http:\/\/ \{\n\thandle \/\.well-known\/duniya-check\/\* \{\n\t\treverse_proxy 127\.0\.0\.1:8080 \{[\s\S]*?\thandle \{\n\t\trespond 404\n\t\}\n\}/m, 'port 80: only the check, never the panel');
  assert.match(open, /^https:\/\/ \{\n\ttls internal \{\n\t\ton_demand\n\t\}/m);
  const prox = renderCaddyfile({ ...base, aliases: ['new.example.org'], proxiedHosts: ['new.example.org'], access: {} });
  assert.match(prox, /^new\.example\.org \{\n\ttls \{\n\t\tissuer acme\n\t\tissuer internal \{\n\t\t\tlifetime 2h\n\t\t\}\n\t\}\n\tencode gzip/m);
  assert.match(prox, /^agents\.example\.org \{\n\tencode gzip/m, 'both addresses serve the panel');
  assert.match(renderCaddyfile({ ...base, access: {} }, { caddyVersion: '2.6.2' }), /header_up X-Duniya-Client-IP \{remote_host\}/);

  const cf26 = renderCaddyfile({ ...base, access: { proxy: 'cloudflare' } }, { caddyVersion: '2.6.2' });
  assert.match(cf26, /@not_proxy not remote_ip 173\.245\.48\.0\/20 .* 2c0f:f248::\/32 127\.0\.0\.1\/8 ::1\/128\n\trespond @not_proxy "Access denied: this site is only reachable through Cloudflare\." 403/);
  assert.doesNotMatch(cf26, /trusted_proxies/, 'Caddy 2.6 has no trusted_proxies');
  const cf27 = renderCaddyfile({ ...base, access: { proxy: 'cloudflare', allow: ['203.0.113.0/24'] } }, { caddyVersion: '2.7.6' });
  assert.match(cf27, /\t\ttrusted_proxies static 173\.245\.48\.0\/20 [^\n]*\n\t\tclient_ip_headers CF-Connecting-IP X-Forwarded-For\n\t\}/);
  assert.match(cf27, /@not_allowed not client_ip 203\.0\.113\.0\/24 127\.0\.0\.1\/8 ::1\/128/);
  const fastly = { ...base, access: { proxy: 'fastly', allow: ['203.0.113.0/24'] }, proxyRanges: ['23.235.32.0/20', '2a04:4e40::/32'] };
  assert.throws(() => renderCaddyfile(fastly, { caddyVersion: '2.7.6' }), /Caddy 2\.8/, 'X-Forwarded-For is only safe right-to-left (2.8+)');
  const f28 = renderCaddyfile(fastly, { caddyVersion: '2.8.4' });
  assert.match(f28, /client_ip_headers X-Forwarded-For\n\t\ttrusted_proxies_strict\n/);
  assert.match(f28, /only reachable through Fastly/);
  assert.throws(() => renderCaddyfile({ ...base, access: { proxy: 'cloudflare', allow: ['203.0.113.0/24'] } }, { caddyVersion: '2.6.2' }), /Caddy 2\.7/);

  assert.deepEqual(envFor({ ...base, aliases: ['new.example.org'], proxiedHosts: ['new.example.org'], access: { proxy: 'cloudflare' } }), {
    HOST: 'agents.example.org', PUBLIC_URL: 'https://agents.example.org', TRUST_PROXY: '1', EXPOSURE: 'domain', CHECK_STRICT: 'agents.example.org', CHECK_PROXIED: 'new.example.org',
  });
  assert.equal(envFor({ ...base, host: '141-147-1-2.sslip.io', redirectHosts: [], access: {} }).EXPOSURE, 'ip');
});

test('031/036: generated Caddyfiles are accepted by the installed Caddy (skipped when caddy is not installed)', (tt) => {
  let ver = '';
  try { ver = execFileSync('caddy', ['version'], { encoding: 'utf8' }).split(/\s/)[0]; } catch { return tt.skip('caddy not installed'); }
  const dir = mkdtempSync(join(tmpdir(), 'caddyfile-'));
  const base = { host: 'agents.example.org', aliases: ['new.example.org'], proxiedHosts: ['new.example.org'], redirectHosts: ['141-147-1-2.sslip.io'], serverIp: '141.147.1.2', port: 8080 };
  const variants = [{}, { proxy: 'cloudflare' }, { allow: ['203.0.113.7', '2001:db8::/32'] }];
  if (caddyAtLeast(ver, '2.7.0')) variants.push({ proxy: 'cloudflare', allow: ['203.0.113.0/24'] });
  for (const access of variants) {
    const f = join(dir, 'Caddyfile');
    writeFileSync(f, renderCaddyfile({ ...base, access }, { caddyVersion: ver }));
    execFileSync('caddy', ['validate', '--adapter', 'caddyfile', '--config', f], { stdio: 'pipe' });
  }
});

test('031: webconfig.mjs command line: render writes the Caddyfile and prints validated env lines; invalid → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webcfg-'));
  writeFileSync(join(dir, 'req.json'), JSON.stringify({ host: 'agents.example.org', port: 8080, access: { proxy: 'cloudflare' } }));
  const out = execFileSync(process.execPath, [WEBCONFIG, 'render', join(dir, 'req.json'), '--out', join(dir, 'Caddyfile'), '--caddy-version', '2.6.2'], { encoding: 'utf8' });
  assert.equal(out, 'HOST=agents.example.org\nPUBLIC_URL=https://agents.example.org\nTRUST_PROXY=1\nEXPOSURE=domain\nCHECK_STRICT=agents.example.org\nCHECK_PROXIED=-\n');
  assert.match(readFileSync(join(dir, 'Caddyfile'), 'utf8'), /^agents\.example\.org \{/m);
  execFileSync(process.execPath, [WEBCONFIG, 'render', join(dir, 'req.json'), '--out', join(dir, 'C2'), '--host', '141-147-1-2.sslip.io', '--server-ip', ''], { encoding: 'utf8' });
  assert.match(readFileSync(join(dir, 'C2'), 'utf8'), /^141-147-1-2\.sslip\.io \{[\s\S]*not_proxy/m, 'installer re-run keeps the rules');
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

test('031/036 helper: validates, reloads Caddy, checks every served address on 127.0.0.1 (any certificate behind a proxy), then updates PUBLIC_URL', () => {
  const s = helperSandbox();
  writeFileSync(join(s.d, 'https-ok'), '');
  const r = s.run('apply-web-config', { host: 'Agents.Example.org', aliases: ['new.example.org'], proxiedHosts: ['new.example.org'], port: 8080, access: { proxy: 'cloudflare' } });
  assert.equal(r.status.state, 'done', r.log);
  assert.equal(r.web.state, 'done'); assert.equal(r.web.host, 'agents.example.org'); assert.match(r.web.message, /Live at https:\/\/agents\.example\.org/);
  const caddy = s.read('etc', 'Caddyfile');
  assert.match(caddy, /^agents\.example\.org \{$/m); assert.match(caddy, /^new\.example\.org \{\n\ttls \{/m);
  assert.match(s.read('etc', 'app.env'), /^PUBLIC_URL=https:\/\/agents\.example\.org$/m);
  assert.match(s.read('etc', 'app.env'), /^TRUST_PROXY=1$/m);
  assert.match(s.read('etc', 'app.env'), /^DUNIYA_EXPOSURE=domain$/m);
  assert.match(s.read('etc', 'install.conf'), /^DOMAIN='agents\.example\.org'$/m);
  assert.equal(s.read('state', 'Caddyfile.last-good'), s.read('etc', 'Caddyfile'));
  const calls = s.read('calls');
  assert.match(calls, /systemctl reload caddy/);
  assert.match(calls, /curl -fsS --noproxy \* --max-time 10 -o \/dev\/null --resolve agents\.example\.org:443:127\.0\.0\.1 https:\/\/agents\.example\.org\/healthz/, 'direct: a real certificate');
  assert.match(calls, /curl -fsSk --noproxy \* --max-time 10 -o \/dev\/null --resolve new\.example\.org:443:127\.0\.0\.1 https:\/\/new\.example\.org\/healthz/, 'proxied: any certificate, still on this server');
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
  assert.equal(s.run('apply-web-config', 'not json').web.state, 'failed');
  writeFileSync(join(s.d, 'https-ok'), '');
  const fv = s.run('apply-web-config', { host: 'agents.example.org', access: { allow: ['10.0.0.0/8'] } });
  assert.equal(fv.web.state, 'done', fv.log);
  rmSync(join(s.d, 'state', 'status.json'));
  writeFileSync(join(s.d, 'req', 'request'), 'rm-rf\n');
  execFileSync('bash', [HELPER], { env: { ...process.env, DUNIYA_OPS_REQUEST_DIR: join(s.d, 'req'), DUNIYA_OPS_STATE_DIR: join(s.d, 'state') } });
  assert.ok(!existsSync(join(s.d, 'state', 'status.json')), 'unknown actions do nothing');
});

// ---------- panel API ----------
const lists = {
  cf4: '173.245.48.0/20\n103.21.244.0/22\n103.22.200.0/22\n103.31.4.0/22\n141.101.64.0/18\n198.51.100.0/24\n', cf6: '2400:cb00::/32\n2606:4700::/32\n2803:f800::/32\n',
  fastly: JSON.stringify({ addresses: ['23.235.32.0/20', '43.249.72.0/22', '151.101.0.0/16'], ipv6_addresses: ['2a04:4e40::/32'] }),
};
const listHttp = http.createServer((req, res) => {
  res.end(req.url === '/cf6' ? lists.cf6 : req.url === '/fastly' ? lists.fastly : lists.cf4);
}).listen(0);
let t; let owner; let ops; let fakeTls = null;
const opsDir = mkdtempSync(join(tmpdir(), 'duniya-web-'));
before(async () => {
  ops = { req: join(opsDir, 'req'), state: join(opsDir, 'state') };
  mkdirSync(ops.req); mkdirSync(ops.state);
  writeFileSync(join(opsDir, 'duniya-ops'), '#!/bin/sh\n');
  const L = `http://127.0.0.1:${listHttp.address().port}`;
  t = await setup({
    env: {
      DUNIYA_OPS_REQUEST_DIR: ops.req, DUNIYA_OPS_STATE_DIR: ops.state, DUNIYA_OPS_HELPER: join(opsDir, 'duniya-ops'), DUNIYA_OPS_WEBCONFIG: WEBCONFIG,
      DUNIYA_EXPOSURE: 'ip', PUBLIC_URL: 'https://141-147-1-2.sslip.io', DUNIYA_TLS_PORT: '1', TRUST_PROXY: '1', DUNIYA_PUBLIC_IP: '141.147.1.2', DUNIYA_ACCESS_TRIAL_MS: '600000',
      DUNIYA_FAKE_CADDY_LOG: join(opsDir, 'caddy.log'),
      DUNIYA_FAKE_DNS: JSON.stringify({
        'agents.example.org': ['141.147.1.2'], 'wrong.example.org': ['9.9.9.9'], 'cdn.example.org': ['104.16.5.5', '2606:4700::1'], 'flex.example.org': ['104.16.5.6'],
      }),
      DUNIYA_RANGES_CLOUDFLARE_V4: `${L}/cf4`, DUNIYA_RANGES_CLOUDFLARE_V6: `${L}/cf6`, DUNIYA_RANGES_FASTLY: `${L}/fastly`,
    },
  });
  owner = await t.login();
  // Fake routes for the reachability check: cdn.example.org reaches this app over http (a proxy/CDN in front);
  // flex.example.org is an https "proxy" that talks plain http to the server (Flexible).
  const panelPort = t.panel.address().port;
  try {
    const kd = mkdtempSync(join(tmpdir(), 'tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(kd, 'k'), '-out', join(kd, 'c'), '-days', '1', '-subj', '/CN=flex.example.org', '-addext', 'subjectAltName=DNS:flex.example.org'], { stdio: 'pipe' });
    process.env.DUNIYA_FAKE_CA = join(kd, 'c'); // the fake proxy's certificate is trusted explicitly (no unverified TLS)
    const https = await import('node:https');
    fakeTls = https.createServer({ key: readFileSync(join(kd, 'k')), cert: readFileSync(join(kd, 'c')) }, (req, res) => {
      const up = http.request({ host: '127.0.0.1', port: panelPort, path: req.url, headers: { ...req.headers, 'x-duniya-origin-scheme': 'http' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.end();
    }).listen(0);
    await new Promise((r) => fakeTls.on('listening', r));
  } catch { fakeTls = null; }
  process.env.DUNIYA_FAKE_ROUTES = JSON.stringify({ 'cdn.example.org': `127.0.0.1:${panelPort}`, ...(fakeTls ? { 'https://flex.example.org': `127.0.0.1:${fakeTls.address().port}` } : {}) });
});
after(() => { listHttp.close(); fakeTls?.close(); t.close(); });
const request = () => ({ action: readFileSync(join(ops.req, 'request'), 'utf8').trim(), config: JSON.parse(readFileSync(join(ops.req, 'web-config.json'), 'utf8')) });
const clearOps = () => { for (const f of ['request', 'web-config.json']) rmSync(join(ops.req, f), { force: true }); rmSync(join(ops.state, 'status.json'), { force: true }); };
/** The helper finished the last request (as the root helper would report it). */
const helperDone = (state = 'done') => {
  const cfg = request().config;
  if (state === 'done') writeFileSync(join(ops.state, 'web-applied.json'), JSON.stringify(cfg));
  const at = Date.now() + 5;
  writeFileSync(join(ops.state, 'status.json'), JSON.stringify({ action: 'apply-web-config', state: state === 'done' ? 'done' : 'failed', startedAt: at - 1000, endedAt: at }));
  writeFileSync(join(ops.state, 'web-status.json'), JSON.stringify({ state, message: state === 'done' ? `Live at https://${cfg.host}` : 'HTTPS did not come up', host: cfg.host, startedAt: at - 1000, endedAt: at, at }));
  clearOps();
  return cfg;
};
/** A request as Caddy forwards it: Host header of the address used, visitor IP resolved by Caddy. */
const viaWebServer = (cookie, method, path, body, { host, ip = '203.0.113.50' } = {}) => new Promise((res) => {
  const data = JSON.stringify(body ?? {});
  const r = http.request(`${t.base}${path}`, { method, headers: { cookie, host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-duniya-client-ip': ip, 'x-forwarded-for': ip } }, (x) => {
    let s = ''; x.on('data', (d) => { s += d; }); x.on('end', () => res({ status: x.statusCode, body: s ? JSON.parse(s) : null }));
  });
  r.end(data);
});

test('031 API: the card shows addresses, HTTPS state and access; owner only', async () => {
  const w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.availability.ok, true, JSON.stringify(w.availability));
  assert.equal(w.hosts[0].host, '141-147-1-2.sslip.io'); assert.equal(w.serverIp, '141.147.1.2', 'from the sslip.io name');
  assert.equal(w.hosts[0].cert.state, 'none'); assert.equal(w.restricted, false); assert.equal(w.pending, null);
  assert.deepEqual(w.providers.map((p) => p.id), ['bunny', 'cloudflare', 'cloudfront', 'custom', 'fastly', 'gcore']);
  await t.api(owner, 'POST', '/api/users', { username: 'adm2', role: 'admin', password: 'admin-password-12' });
  const adm = await t.login('adm2', 'admin-password-12');
  assert.equal((await t.api(adm, 'GET', '/api/web')).status, 403);
  assert.equal((await t.api(adm, 'POST', '/api/web/domain', { domain: 'agents.example.org' })).status, 403);
  assert.equal((await t.api(adm, 'PUT', '/api/web/access', { allow: ['1.2.3.4'] })).status, 403);
});

test('036 API: domain check — DNS is a hint, a one-time proof fetched through the domain decides; unencrypted proxies are refused', async () => {
  const miss = (await t.api(owner, 'POST', '/api/web/check', { domain: 'new.example.org' })).body;
  assert.equal(miss.state, 'missing'); assert.deepEqual(miss.record, { type: 'A', name: 'new.example.org', value: '141.147.1.2' });
  const wrong = (await t.api(owner, 'POST', '/api/web/check', { domain: 'wrong.example.org' })).body;
  assert.equal(wrong.state, 'wrong'); assert.equal(wrong.ok, false); assert.match(wrong.text, /did not reach it/);
  const direct = (await t.api(owner, 'POST', '/api/web/check', { domain: 'Agents.Example.org' })).body;
  assert.equal(direct.state, 'ok'); assert.equal(direct.dns, 'direct'); assert.equal(direct.behindProxy, false);
  const prox = (await t.api(owner, 'POST', '/api/web/check', { domain: 'cdn.example.org' })).body;
  assert.equal(prox.state, 'proxied', JSON.stringify(prox)); assert.equal(prox.ok, true); assert.equal(prox.behindProxy, true);
  assert.equal(prox.provider, 'cloudflare'); assert.match(prox.text, /proxy or CDN \(looks like Cloudflare\)/);
  if (fakeTls) {
    const flex = (await t.api(owner, 'POST', '/api/web/check', { domain: 'flex.example.org' })).body;
    assert.equal(flex.state, 'flexible'); assert.equal(flex.ok, false); assert.match(flex.text, /without encryption/); assert.match(flex.text, /Full \(strict\)/);
    assert.doesNotMatch(flex.text, /choose “Flexible”/i);
  }
  assert.equal((await t.api(owner, 'POST', '/api/web/check', { domain: '1.2.3.4' })).body.field, 'domain');
  // Unknown tokens are not answered; Caddy's on-demand "ask" is refused unless a check for that domain is running.
  assert.equal((await fetch(`${t.base}/.well-known/duniya-check/${'a'.repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${t.base}/.well-known/duniya-check-ask?domain=evil.example.org`)).status, 403);
});

test('036 API: domain change in steps — add next to the current address, confirm from the new address, then turn the old one off', async () => {
  clearOps();
  const no = await t.api(owner, 'POST', '/api/web/domain', { domain: 'wrong.example.org' });
  assert.equal(no.status, 400); assert.equal(no.body.field, 'domain'); assert.equal(no.body.check.state, 'wrong');
  assert.ok(!existsSync(join(ops.req, 'request')));
  const add = await t.api(owner, 'POST', '/api/web/domain', { domain: 'cdn.example.org' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  let r = request();
  assert.equal(r.action, 'apply-web-config');
  assert.equal(r.config.host, '141-147-1-2.sslip.io', 'the current address stays the main one');
  assert.deepEqual(r.config.aliases, ['cdn.example.org']); assert.deepEqual(r.config.proxiedHosts, ['cdn.example.org']);
  assert.doesNotThrow(() => validateWebConfig(r.config), 'the helper accepts what the app writes');
  writeFileSync(join(ops.state, 'status.json'), JSON.stringify({ action: 'apply-web-config', state: 'running', startedAt: Date.now() }));
  writeFileSync(join(ops.state, 'web-status.json'), JSON.stringify({ state: 'waiting', host: '141-147-1-2.sslip.io', startedAt: Date.now() }));
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.pending, 'waiting', 'progress survives a reload (state is on the server)');
  assert.equal((await t.api(owner, 'POST', '/api/web/domain', { domain: 'agents.example.org' })).status, 409, 'cannot run twice');
  helperDone();
  let w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.switch.phase, 'added'); assert.deepEqual(w.hosts.map((x) => x.host), ['141-147-1-2.sslip.io', 'cdn.example.org']);
  assert.equal(w.hosts[1].proxied, true);
  // Confirming from the old address (or the server itself) does not prove anything
  const fromOld = await viaWebServer(owner, 'POST', '/api/web/domain/confirm', {}, { host: '141-147-1-2.sslip.io' });
  assert.equal(fromOld.status, 400); assert.match(fromOld.body.error, /Open the panel at https:\/\/cdn\.example\.org/);
  assert.equal((await t.api(owner, 'POST', '/api/web/domain/confirm')).status, 400);
  const ok = await viaWebServer(owner, 'POST', '/api/web/domain/confirm', {}, { host: 'cdn.example.org' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  r = request();
  assert.equal(r.config.host, 'cdn.example.org'); assert.deepEqual(r.config.aliases, ['141-147-1-2.sslip.io'], 'the old address still works');
  helperDone();
  w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.switch.phase, 'confirmed'); assert.equal(process.env.PUBLIC_URL, 'https://cdn.example.org');
  assert.equal((await t.api(owner, 'POST', '/api/web/domain/finish')).status, 200);
  r = request();
  assert.deepEqual(r.config.aliases, []); assert.deepEqual(r.config.redirectHosts, ['141-147-1-2.sslip.io'], 'old address only forwards');
  helperDone();
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.switch, null);
  const log = (await t.api(owner, 'GET', '/api/activity?limit=30')).body.map((a) => a.summary).join('\n');
  assert.match(log, /added cdn\.example\.org \(behind a proxy\)/); assert.match(log, /cdn\.example\.org confirmed by admin/); assert.match(log, /old address 141-147-1-2\.sslip\.io turned off/);
});

test('036 API: a failed add removes the switch; cancel goes back', async () => {
  const first = await t.api(owner, 'POST', '/api/web/domain', { domain: 'agents.example.org' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  helperDone('rolled-back');
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.switch, null, 'rolled back by the helper');
  const again = await t.api(owner, 'POST', '/api/web/domain', { domain: 'agents.example.org' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  helperDone();
  assert.equal((await t.api(owner, 'POST', '/api/web/domain/cancel')).status, 200);
  const r = request();
  assert.equal(r.config.host, 'cdn.example.org'); assert.deepEqual(r.config.aliases, []);
  helperDone();
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.switch, null);
});

test('036 API: stricter access is a trial — confirm through the new rules, or it is undone; lock-out warnings; injection refused', async () => {
  clearOps();
  const bad = await t.api(owner, 'PUT', '/api/web/access', { allow: ['10.0.0.0/8 }\nimport evil'] });
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'allow');
  const lock = await t.api(owner, 'PUT', '/api/web/access', { allow: ['203.0.113.0/24'], alwaysAllowMine: false });
  assert.equal(lock.status, 409); assert.equal(lock.body.needsConfirm, true); assert.match(lock.body.error, /lose access/);
  const prox = await viaWebServer(owner, 'PUT', '/api/web/access', { proxy: 'cloudflare' }, { host: 'cdn.example.org' });
  assert.equal(prox.status, 409); assert.match(prox.body.error, /not using the panel through Cloudflare/);
  assert.ok(!existsSync(join(ops.req, 'request')));
  const mine = await t.api(owner, 'PUT', '/api/web/access', { allow: ['203.0.113.0/24'], alwaysAllowMine: true });
  assert.equal(mine.status, 200, JSON.stringify(mine.body)); assert.equal(mine.body.trial, true);
  assert.deepEqual(request().config.access, { proxy: null, allow: ['203.0.113.0/24', '127.0.0.1/32'] }, 'your current address is added');
  let w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.trial.secondsLeft, null, 'the countdown starts once the rules are active');
  assert.equal((await t.api(owner, 'POST', '/api/web/access/confirm')).status, 409);
  helperDone();
  w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.ok(w.trial.secondsLeft > 590 && w.trial.secondsLeft <= 600, String(w.trial.secondsLeft));
  assert.equal((await t.api(owner, 'PUT', '/api/web/access', { allow: [] })).status, 409, 'one trial at a time');
  assert.equal((await t.api(owner, 'POST', '/api/web/access/confirm')).status, 400, 'not through the web server');
  const conf = await viaWebServer(owner, 'POST', '/api/web/access/confirm', {}, { host: 'cdn.example.org', ip: '203.0.113.9' });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.trial, null);

  // Not confirmed in time → the previous rules come back by themselves (dead-man switch)
  const { trialTick, webSettings } = await import('../src/core/webaccess.js');
  assert.equal((await t.api(owner, 'PUT', '/api/web/access', { proxy: 'cloudflare', confirmLockout: true })).status, 200);
  assert.equal(request().config.access.proxy, 'cloudflare'); assert.ok(request().config.proxyRanges.length >= 20, 'built-in list until downloaded');
  helperDone();
  t.store.updateSettings({ webAccess: { ...webSettings(), trial: { ...webSettings().trial, until: Date.now() - 1 } } });
  trialTick();
  assert.deepEqual(request().config.access, { proxy: null, allow: ['203.0.113.0/24', '127.0.0.1/32'] }, 'reverted to the confirmed rules');
  helperDone();
  w = (await t.api(owner, 'GET', '/api/web')).body;
  assert.equal(w.trial, null); assert.ok(w.lastRevert);
  const log = (await t.api(owner, 'GET', '/api/activity?limit=20')).body.map((a) => a.summary).join('\n');
  assert.match(log, /not confirmed within 10 minutes: the previous rules were restored/);
  const pv = (await t.api(owner, 'POST', '/api/web/preview', { allow: ['198.51.100.7'] })).body;
  assert.match(pv.caddyfile, /@not_allowed not remote_ip 198\.51\.100\.7\/32 127\.0\.0\.1\/8/);
});

test('036 API: proxy/CDN address lists are downloaded from the provider, validated, and a change re-applies the web server', async () => {
  clearOps();
  const f = await t.api(owner, 'POST', '/api/web/ranges/refresh', { provider: 'fastly' });
  assert.deepEqual(f.body, { count: 4, changed: true });
  assert.equal((await t.api(owner, 'POST', '/api/web/ranges/refresh', { provider: 'custom' })).status, 400, 'own ranges are entered, not downloaded');
  const nope = await t.api(owner, 'PUT', '/api/web/access', { proxy: 'gcore', confirmLockout: true });
  assert.equal(nope.status, 400); assert.match(nope.body.error, /has not been downloaded yet/);
  const cust = await t.api(owner, 'PUT', '/api/web/access', { proxy: 'custom', customRanges: [], confirmLockout: true });
  assert.equal(cust.status, 400); assert.equal(cust.body.field, 'customRanges');
  writeFileSync(join(ops.state, 'web-applied.json'), JSON.stringify({ host: 'cdn.example.org', port: 8080, access: { proxy: 'cloudflare', allow: [] } }));
  const r = await t.api(owner, 'POST', '/api/web/ranges/refresh', { provider: 'cloudflare' });
  assert.deepEqual(r.body, { count: 9, changed: true });
  const req = request();
  assert.equal(req.action, 'apply-web-config'); assert.ok(req.config.proxyRanges.includes('198.51.100.0/24'), 'the downloaded list is used');
  clearOps();
  assert.equal((await t.api(owner, 'POST', '/api/web/ranges/refresh', { provider: 'cloudflare' })).body.changed, false);
  assert.ok(!existsSync(join(ops.req, 'request')), 'no change, no apply');
  lists.cf4 = 'not-an-ip\n';
  assert.equal((await t.api(owner, 'POST', '/api/web/ranges/refresh', { provider: 'cloudflare' })).status, 400, 'a broken download is refused');
});

test('036 API: behind a proxy the card explains the temporary certificate and why Let’s Encrypt failed, with the fix', async () => {
  writeFileSync(join(ops.state, 'web-applied.json'), JSON.stringify({ host: 'cdn.example.org', proxiedHosts: ['cdn.example.org'], port: 8080, access: {} }));
  writeFileSync(join(opsDir, 'caddy.log'), [
    JSON.stringify({ level: 'error', ts: 1794728585.9, logger: 'tls.obtain', msg: 'could not get certificate from issuer', identifier: 'cdn.example.org', issuer: 'acme-v02.api.letsencrypt.org-directory', error: 'HTTP 403 urn:ietf:params:acme:error:unauthorized - Invalid response from http://cdn.example.org/.well-known/acme-challenge/x: 403' }),
    'not json',
  ].join('\n'));
  const w = (await t.api(owner, 'GET', '/api/web')).body;
  const x = w.hosts.find((h) => h.host === 'cdn.example.org');
  assert.equal(x.proxied, true); assert.equal(x.acme.kind, 'blocked'); assert.match(x.acme.fix, /URI Path.*starts with.*\/\.well-known\/acme-challenge\//);
});

test('031 + 029: `duniya open-access` removes every restriction and any trial (recovery when locked out)', async () => {
  clearOps();
  writeFileSync(join(ops.state, 'web-applied.json'), JSON.stringify({ host: 'cdn.example.org', port: 8080, access: { proxy: 'cloudflare', allow: [] } }));
  const r = await new Promise((res) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'bin/duniya.js'), 'open-access'], { env: { ...process.env, NO_COLOR: '1' } }, (e, out, err) => res({ code: e ? e.code : 0, out, err })));
  assert.equal(r.code, 0, r.err); assert.match(r.out, /allow-list removed/);
  assert.deepEqual(request().config.access, { proxy: null, allow: [] });
  assert.equal(request().config.host, 'cdn.example.org');
  assert.equal((await t.api(owner, 'GET', '/api/web')).body.settings.proxy, null);
});

test('031/033 API: not offered where the panel cannot change it (tunnel, Tailscale, Docker, old helper)', async () => {
  const { availability } = await import('../src/core/webaccess.js');
  process.env.DUNIYA_EXPOSURE = 'tunnel'; assert.equal(availability().reason, 'tunnel');
  process.env.DUNIYA_EXPOSURE = 'tailscale'; assert.equal(availability().reason, 'tailscale'); assert.match(availability().text, /tailnet/);
  process.env.DUNIYA_EXPOSURE = 'ip'; process.env.DUNIYA_INSTALL = 'docker'; assert.equal(availability().reason, 'docker');
  delete process.env.DUNIYA_INSTALL;
  assert.equal(availability().ok, true);
  rmSync(join(opsDir, 'duniya-ops')); assert.equal(availability().reason, 'helper', 'no maintenance helper: re-run the installer');
  writeFileSync(join(opsDir, 'duniya-ops'), '#!/bin/sh\n');
});
