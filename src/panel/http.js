// Small HTTP helpers shared by the panel router and feature routes (sign-in pages, uploads).
import { createWriteStream, mkdirSync, rmSync, renameSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, DATA_DIR } from '../core/config.js';
import { createSession } from '../core/store.js';
import { newToken } from '../core/crypto.js';

export const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// Forwarded headers are only trusted when a local proxy (Caddy, cloudflared) is configured (TRUST_PROXY=1). Caddy
// (036) always sets X-Duniya-Client-IP to the visitor address it resolved (trusted proxies only), so it wins.
export const clientIp = (req) => (env.trustProxy
  ? req.headers['x-duniya-client-ip'] || req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
  : req.socket.remoteAddress) || '';
export const isHttps = (req) => (env.trustProxy && (req.headers['x-forwarded-proto'] === 'https' || !!req.headers['cf-visitor']?.includes('https')))
  || !!req.socket.encrypted;
export function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
/** The panel's public base URL: PUBLIC_URL (set by the installer) or what the browser used. */
export function publicBase(req) {
  const fixed = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
}
export function send(res, status, body, headers = {}) {
  const isObj = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
export function setSessionCookie(req, res, userId) {
  const { token, maxAge } = createSession(userId, clientIp(req));
  res.setHeader('set-cookie', `duniya_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}

/** Sliding-window limiter: returns true when `key` did more than `max` calls in the last minute. */
export function limiter(max) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60000);
    recent.push(now); hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
    return recent.length > max;
  };
}

export const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * A small standalone result page. Used where the browser arrives from another site (Google, GitHub): the
 * SameSite=Strict session cookie is not sent on that navigation, but it is on the same-origin one this page makes.
 */
export function resultPage(res, { ok, title, message, back = '/', backLabel = 'Back to the panel', autoMs = 1200, csp = CSP, extraHead = '', status }) {
  const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=color-scheme content="light dark"><title>${esc(title)}</title>${extraHead}
<style>body{font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f7f3ec;color:#1c2030}
.c{background:#fffdf9;border:1px solid #e6dfd3;border-radius:18px;padding:28px;max-width:440px;margin:16px;text-align:center;box-shadow:0 6px 24px -8px rgba(28,32,48,.1)}
p{color:#6d6a73}a{color:#0b7a75;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#11131c;color:#ece9e2}.c{background:#1a1d2a;border-color:#2a2e3e}p{color:#9a98a3}a{color:#3cc4b7}}</style>
<body><div class=c><div style="font-size:40px">${ok ? '✅' : '⚠️'}</div><h2 style="margin:8px 0">${esc(title)}</h2>
<p>${esc(message)}</p><p><a href="${esc(back)}">${esc(backLabel)}</a></p></div>
${ok && autoMs != null ? `<meta http-equiv=refresh content="${Math.max(0, Math.round(Number(autoMs) / 1000))};url=${esc(back)}">` : ''}`;
  send(res, status || (ok ? 200 : 400), html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'x-frame-options': 'DENY' });
  return null;
}

/**
 * State-changing requests must be JSON (browsers cannot send that cross-site without CORS). Uploads are the one
 * exception: they must carry `x-duniya-upload: 1` (a custom header, which also forces a CORS preflight we never
 * answer) and, when the browser sends an Origin, it must be this panel.
 */
export function uploadAllowed(req) {
  if (req.headers['x-duniya-upload'] !== '1') return false;
  if (!String(req.headers['content-type'] || '').startsWith('application/octet-stream')) return false;
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
  } else if (origin === 'null') return false;
  return true;
}

export const UPLOAD_DIR = resolve(DATA_DIR, 'uploads');
export const UPLOAD_MAX = Number(process.env.BACKUP_UPLOAD_MAX_MB || 200) * 1024 * 1024;
const UPLOAD_ID_RE = /^[a-f0-9]{32}$/;
export const uploadPath = (id) => {
  if (!UPLOAD_ID_RE.test(String(id || ''))) throw Object.assign(new Error('Upload not found — choose the file again'), { status: 400 });
  return resolve(UPLOAD_DIR, `${id}.dbk`);
};

/**
 * Stream a request body to DATA_DIR/uploads/<id>.dbk (mode 0600), at most `max` bytes, checking the first bytes
 * against `magic`. Older uploads (> 1 hour) are removed. Returns { upload, size }.
 */
export async function receiveUpload(req, { magic = '', max = UPLOAD_MAX } = {}) {
  mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  for (const f of readdirSync(UPLOAD_DIR)) {
    const p = resolve(UPLOAD_DIR, f);
    try { if (Date.now() - statSync(p).mtimeMs > 3600000) rmSync(p, { force: true }); } catch { /* gone */ }
  }
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > max) throw Object.assign(new Error(`The file is larger than ${Math.round(max / 1048576)} MB`), { status: 413 });
  const id = newToken(16);
  const part = resolve(UPLOAD_DIR, `${id}.part`);
  const out = createWriteStream(part, { mode: 0o600 });
  let size = 0; let head = Buffer.alloc(0);
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) throw Object.assign(new Error(`The file is larger than ${Math.round(max / 1048576)} MB`), { status: 413 });
      if (head.length < magic.length) {
        head = Buffer.concat([head, chunk]).subarray(0, magic.length);
        if (head.length === magic.length && head.toString() !== magic) throw Object.assign(new Error('This is not a Duniya backup file (.dbk)'), { status: 400 });
      }
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    if (size < magic.length || (magic && head.toString() !== magic)) throw Object.assign(new Error('This is not a Duniya backup file (.dbk)'), { status: 400 });
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    renameSync(part, resolve(UPLOAD_DIR, `${id}.dbk`));
    return { upload: id, size };
  } catch (e) {
    await new Promise((r) => { if (out.closed) r(); else { out.once('close', r); out.destroy(); } });
    rmSync(part, { force: true }); // after close: the file may only be created once the stream opened it
    req.resume(); // drain whatever the client still sends
    throw e;
  }
}
export const dropUpload = (id) => { try { rmSync(uploadPath(id), { force: true }); } catch { /* invalid id */ } };
export const uploadExists = (id) => { try { return existsSync(uploadPath(id)); } catch { return false; } };

// ---------- first-run setup code (shared with the restore-on-fresh-install routes) ----------
let setupCode = null;
export const getSetupCode = () => setupCode;
export const setSetupCode = (c) => { setupCode = c; };
export const checkSetupCode = (c) => !!setupCode && String(c || '').trim().toUpperCase() === setupCode;
