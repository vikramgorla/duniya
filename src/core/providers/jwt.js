// @ts-check
// Minimal RS256 JWT verification with OIDC discovery + JWKS (no dependencies).
import { createPublicKey, verify } from 'node:crypto';

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const jwksCache = new Map(); // issuer -> { at, keys }
const discoCache = new Map(); // base -> { at, doc }

/** @returns {Promise<any>} */
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/** OIDC discovery document for `base` (cached for an hour). */
export async function oidcDiscovery(base, { fresh = false } = {}) {
  const key = base.replace(/\/+$/, '');
  const hit = discoCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 3600000) return hit.doc;
  const doc = await getJson(`${key}/.well-known/openid-configuration`);
  discoCache.set(key, { at: Date.now(), doc });
  return doc;
}

async function jwks(issuer, discoveryBase = issuer, fresh = false) {
  const hit = jwksCache.get(issuer);
  if (!fresh && hit && Date.now() - hit.at < 3600000) return hit.keys;
  const disc = await oidcDiscovery(discoveryBase, { fresh });
  if (!disc.jwks_uri) throw new Error('OIDC discovery has no jwks_uri');
  const { keys } = await getJson(disc.jwks_uri);
  jwksCache.set(issuer, { at: Date.now(), keys });
  return keys;
}

/**
 * Verify an ID token. Returns its claims or throws.
 * `issuers` (optional) lists other accepted `iss` values (Google uses both https://accounts.google.com and accounts.google.com).
 */
export async function verifyIdToken(token, { issuer, issuers = [], audience, nonce, discoveryBase }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('ID token is malformed');
  const header = JSON.parse(b64url(parts[0]).toString('utf8'));
  const claims = JSON.parse(b64url(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`Unsupported ID token algorithm ${header.alg}`);
  const pick = (keys) => keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  let jwk = pick(await jwks(issuer, discoveryBase));
  if (!jwk) jwk = pick(await jwks(issuer, discoveryBase, true)); // keys rotate: refetch once
  if (!jwk) throw new Error('ID token signing key not found');
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]));
  if (!ok) throw new Error('ID token signature is invalid');
  if (![issuer, ...issuers].includes(claims.iss)) throw new Error('ID token issuer mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new Error('ID token audience mismatch');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 60000) throw new Error('ID token expired');
  if (claims.iat && claims.iat * 1000 > Date.now() + 5 * 60000) throw new Error('ID token issued in the future');
  if (nonce !== undefined && claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  return claims;
}
