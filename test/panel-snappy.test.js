// 058: the panel shell and its scripts come from memory, compressed, with ETag/304 and versioned script links; the
// live stream pushes the status (no 5-second polling).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
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
  assert.ok(br.body.length < shellFile.length / 3, 'much smaller on the wire');
  assert.match(br.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(br.headers['x-frame-options'], 'DENY');
  assert.equal(br.headers['x-content-type-options'], 'nosniff');
  assert.equal(br.headers['cache-control'], 'no-cache');
  assert.equal(br.headers.vary, 'accept-encoding');
  const html = brotliDecompressSync(br.body).toString('utf8');
  // the same bytes as the file (nothing inlined: no user data, no secrets), except the versioned script links
  assert.equal(html.replace(/\.js\?v=[A-Za-z0-9_-]+"/g, '.js"'), shellFile);

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

test('058: scripts are linked by version and cached for good under that version only', async () => {
  const html = (await get('/')).body.toString('utf8');
  for (const name of ['qr.js', 'diff.js']) {
    const v = html.match(new RegExp(`<script src="/${name.replace('.', '\\.')}\\?v=([A-Za-z0-9_-]+)"></script>`))?.[1];
    assert.ok(v, `${name} linked with a version`);
    const pinned = await get(`/${name}?v=${v}`, { 'accept-encoding': 'br' });
    assert.equal(pinned.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(pinned.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(brotliDecompressSync(pinned.body).toString('utf8'), readFileSync(resolve(import.meta.dirname, `../src/panel/public/${name}`), 'utf8'));
    assert.equal((await get(`/${name}?v=old`)).headers['cache-control'], 'no-cache');
    assert.equal((await get(`/${name}`, { 'if-none-match': pinned.headers.etag })).status, 304);
  }
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
  const script = shellFile.slice(shellFile.lastIndexOf('<script>'));
  assert.doesNotMatch(script, /setInterval\(refreshStatus, 5000\)/);
  assert.match(script, /addEventListener\('status'/);
  assert.match(script, /setInterval\(refreshStatus, 30000\)/, 'slow fallback while the stream is down');
});
