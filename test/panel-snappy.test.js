// 058: the panel shell and its scripts come from memory, compressed, with ETag/304 and versioned script links; the
// live stream pushes the status (no 5-second polling). 063: the scripts are native ES modules behind an import map.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { setup } from './harness.js';

const t = await setup();
const cookie = await t.login();
after(() => t.close());

/** Raw GET (fetch would decompress and hide the encoding). */
const get = (path, headers = {}) => new Promise((res, rej) => {
  http.get(`${t.base}${path}`, { headers }, (r) => { const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(parts) })); }).on('error', rej);
});
const shellFile = readFileSync(resolve(import.meta.dirname, '../src/panel/public/index.html'), 'utf8');

test('058: the panel shell is compressed, keeps its security headers and holds no user data', async () => {
  const br = await get('/', { 'accept-encoding': 'gzip, br' });
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.match(br.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(br.headers['x-frame-options'], 'DENY');
  assert.equal(br.headers['x-content-type-options'], 'nosniff');
  assert.equal(br.headers['cache-control'], 'no-cache');
  assert.equal(br.headers.vary, 'accept-encoding');
  const html = brotliDecompressSync(br.body).toString('utf8');
  assert.ok(br.body.length < html.length / 2, 'much smaller on the wire');
  // the same bytes as the file (nothing inlined: no user data, no secrets), except the versioned links and the module
  // list the server fills in (063: import map + modulepreload)
  const modules = html.slice(html.indexOf('<script type="importmap">'), html.lastIndexOf('<link rel="modulepreload"'));
  assert.equal(html.replace(/<script type="importmap">[\s\S]*<link rel="modulepreload" [^>]*>/, '<!--modules-->').replace(/\?v=[A-Za-z0-9_-]{16}"/g, '"'), shellFile);
  assert.ok(modules.length > 100);

  const gz = await get('/', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gz.body).toString('utf8'), html);
  const plain = await get('/');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString('utf8'), html);
});

test('058: a repeat load is a 304 without a body; a changed ETag gets the page again', async () => {
  const first = await get('/', { 'accept-encoding': 'br' });
  assert.match(first.headers.etag, /^"[A-Za-z0-9_-]{16}"$/);
  const again = await get('/', { 'accept-encoding': 'br', 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers['content-security-policy'], first.headers['content-security-policy']);
  assert.equal((await get('/', { 'if-none-match': '"other"' })).status, 200);
});

test('058/061: scripts, the web app manifest and icons are linked by version and cached for good under that version only', async () => {
  const html = (await get('/')).body.toString('utf8');
  const files = { 'app/main.js': 'text/javascript; charset=utf-8', 'app/styles.css': 'text/css; charset=utf-8', 'manifest.webmanifest': 'application/manifest+json', 'icons/apple-touch-icon.png': 'image/png' };
  for (const [name, type] of Object.entries(files)) {
    const v = html.match(new RegExp(` (?:src|href)="/${name.replace(/\./g, '\\.')}\\?v=([A-Za-z0-9_-]+)"`))?.[1];
    assert.ok(v, `${name} linked with a version`);
    const pinned = await get(`/${name}?v=${v}`, { 'accept-encoding': 'br' });
    assert.equal(pinned.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(pinned.headers['content-type'], type);
    assert.deepEqual(brotliDecompressSync(pinned.body), readFileSync(resolve(import.meta.dirname, `../src/panel/public/${name}`)));
    assert.equal((await get(`/${name}?v=old`)).headers['cache-control'], 'no-cache');
    assert.equal((await get(`/${name}`, { 'if-none-match': pinned.headers.etag })).status, 304);
  }
  assert.equal((await get('/qr.js')).status, 404, 'the mobile app QR encoder is gone');
});

test('063: modules behind an import map: every module pinned by its content hash, the first screen preloaded, strict CSP', async () => {
  const r = await get('/');
  const html = r.body.toString('utf8');
  const json = html.match(/<script type="importmap">([^<]*)<\/script>/)[1];
  const map = JSON.parse(json).imports;
  const files = readdirSync(resolve(import.meta.dirname, '../src/panel/public/app')).filter((f) => f.endsWith('.js'));
  assert.deepEqual(Object.keys(map).sort(), files.map((f) => `/app/${f}`).sort(), 'every module, nothing else');
  for (const [path, pinned] of Object.entries(map)) {
    const v = pinned.match(/^\/app\/[a-z0-9-]+\.js\?v=([A-Za-z0-9_-]{16})$/)?.[1];
    assert.ok(v && pinned.startsWith(`${path}?`), pinned);
    const got = await get(pinned, { 'accept-encoding': 'br' });
    assert.equal(got.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(got.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(createHash('sha256').update(brotliDecompressSync(got.body)).digest('base64url').slice(0, 16), v, 'the version is the content hash');
  }
  // only the import map is inline, allowed by its hash; no 'unsafe-inline' for scripts
  const csp = r.headers['content-security-policy'];
  const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
  assert.equal(scriptSrc, `'self' 'sha256-${createHash('sha256').update(json).digest('base64')}'`);
  assert.equal([...html.matchAll(/<script(?! type="importmap")[^>]*>[^<]/g)].length, 0, 'no other inline script');
  assert.match(html, new RegExp(`<script type="module" src="${map['/app/main.js'].replace(/[?.]/g, '\\$&')}"></script>`));
  // the entry and Overview with their imports are preloaded; other screens load on their first visit
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="\/app\/([a-z0-9-]+\.js)\?v=/g)].map((m) => m[1]);
  for (const f of ['main.js', 'core.js', 'login.js', 'overview.js']) assert.ok(preloaded.includes(f), f);
  for (const f of ['settings.js', 'agent-editor.js', 'models.js', 'backups.js']) assert.ok(!preloaded.includes(f), f);
  assert.equal((await get('/app/missing.js')).status, 404);
});

test('061: the panel is an installable web app: manifest, icons that exist, iOS tags, no service worker', async () => {
  const html = (await get('/')).body.toString('utf8');
  const m = JSON.parse((await get('/manifest.webmanifest')).body.toString('utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.short_name, 'Duniya');
  assert.equal(m.scope, '/');
  assert.match(m.start_url, /^\//);
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/);
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon for Android');
  for (const i of m.icons) {
    const r = await get(i.src);
    assert.equal(r.status, 200, i.src);
    assert.equal(r.body.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${r.body.readUInt32BE(16)}x${r.body.readUInt32BE(20)}`, i.sizes, `${i.src} has the size the manifest says`);
  }
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png\?v=/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /serviceWorker/, 'no service worker: nothing is cached offline');
});

/** Read server-sent events from /api/events until `until(events)` holds. */
async function events(until, act) {
  const ctl = new AbortController();
  const r = await fetch(`${t.base}/api/events`, { headers: { cookie }, signal: ctl.signal });
  const reader = r.body.getReader(); const dec = new TextDecoder();
  const got = []; let buf = '';
  await act?.();
  const deadline = Date.now() + 5000;
  while (!until(got) && Date.now() < deadline) {
    const { value, done } = await Promise.race([reader.read(), new Promise((res) => setTimeout(() => res({ value: null }), 500))]);
    if (done) break;
    if (!value) continue;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const type = block.match(/^event: (.+)$/m)?.[1] || 'message';
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (data) got.push({ type, data: JSON.parse(data) });
    }
  }
  ctl.abort();
  return got;
}

test('058: the live stream pushes the status after a change, and the activity entry with it', async () => {
  const got = await events((e) => e.some((x) => x.type === 'status' && x.data.settings.paused === true),
    () => t.api(cookie, 'POST', '/api/settings', { paused: true }));
  const st = got.find((x) => x.type === 'status' && x.data.settings.paused === true);
  assert.ok(st, 'status pushed');
  for (const k of ['channel', 'agents', 'pending', 'uptimeSec', 'memoryMb', 'version']) assert.ok(k in st.data, k);
  assert.equal(st.data.user.username, 'admin');
  assert.ok(got.some((x) => x.type === 'message' && /Settings by admin/.test(x.data.summary)), 'activity entry too');
  await t.api(cookie, 'POST', '/api/settings', { paused: false });
});

test('058: a channel state change (a new QR) pushes the status without an activity entry', async () => {
  const { bus } = await import('../src/core/events.js');
  const got = await events((e) => e.some((x) => x.type === 'status'), async () => {
    t.channel.status = async () => ({ status: 'qr', qrDataUrl: 'data:image/png;base64,AAAA' });
    bus.emit('status');
  });
  assert.equal(got.find((x) => x.type === 'status')?.data.channel.status, 'qr');
  assert.ok(!got.some((x) => x.type === 'message'));
});

test('058: the panel uses the live stream instead of polling the status', () => {
  const script = readFileSync(resolve(import.meta.dirname, '../src/panel/public/app/core.js'), 'utf8');
  assert.doesNotMatch(script, /setInterval\(refreshStatus, 5000\)/);
  assert.match(script, /addEventListener\('status'/);
  assert.match(script, /setInterval\(refreshStatus, 30000\)/, 'slow fallback while the stream is down');
});
