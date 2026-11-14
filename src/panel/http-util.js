// Small HTTP helpers shared by the panel router and the admin MCP endpoints (017).
import { env } from '../core/config.js';

// Forwarded headers are only trusted when a local proxy (Caddy, cloudflared) is configured (TRUST_PROXY=1).
export const clientIp = (req) => (env.trustProxy
  ? req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
  : req.socket.remoteAddress) || '';
export const isHttps = (req) => (env.trustProxy && (req.headers['x-forwarded-proto'] === 'https' || !!req.headers['cf-visitor']?.includes('https')))
  || !!req.socket.encrypted;
export function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Public base URL of this app: PUBLIC_URL when set, otherwise from the request (Host + scheme). */
export function baseUrl(req) {
  const fixed = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host || `127.0.0.1:${env.panelPort}`}`;
}

/** Sliding one-minute window limiter. `limit(key)` returns true when over the limit. */
export function minuteLimiter(max) {
  const hits = new Map();
  let sweptAt = Date.now();
  return (key) => {
    const now = Date.now();
    if (now - sweptAt > 60000) { for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); sweptAt = now; }
    const recent = (hits.get(key) || []).filter((t) => now - t < 60000);
    recent.push(now); hits.set(key, recent);
    return recent.length > max;
  };
}
