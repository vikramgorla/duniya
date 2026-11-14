// Minimal RS256 JWT verification with OIDC discovery + JWKS (no dependencies).
import { createPublicKey, verify } from 'node:crypto';

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const jwksCache = new Map(); // issuer -> { at, keys }

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function jwks(issuer, discoveryBase = issuer) {
  const hit = jwksCache.get(issuer);
  if (hit && Date.now() - hit.at < 3600000) return hit.keys;
  const disc = await getJson(`${discoveryBase.replace(/\/+$/, '')}/.well-known/openid-configuration`);
  if (!disc.jwks_uri) throw new Error('OIDC discovery has no jwks_uri');
  const { keys } = await getJson(disc.jwks_uri);
  jwksCache.set(issuer, { at: Date.now(), keys });
  return keys;
}

/** Verify an ID token. Returns its claims or throws. */
export async function verifyIdToken(token, { issuer, audience, nonce, discoveryBase }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('ID token is malformed');
  const header = JSON.parse(b64url(parts[0]).toString('utf8'));
  const claims = JSON.parse(b64url(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`Unsupported ID token algorithm ${header.alg}`);
  const keys = await jwks(issuer, discoveryBase);
  const jwk = keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw new Error('ID token signing key not found');
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]));
  if (!ok) throw new Error('ID token signature is invalid');
  if (claims.iss !== issuer) throw new Error('ID token issuer mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new Error('ID token audience mismatch');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 60000) throw new Error('ID token expired');
  if (nonce !== undefined && claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  return claims;
}
