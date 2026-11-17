// @ts-check
// One-time links (060, #121): enter a secret in the panel (15 minutes) or set your own password as a new user
// (48 hours), so keys and passwords never pass through WhatsApp, the owner assistant or an AI assistant.
// The token is 256 bits of randomness; only its SHA-256 is stored (ttl_state, data encrypted, with an expiry), so a
// copy of the database cannot be turned into a working link. Links are single use. No timers: the TTL store drops
// expired rows. The token goes in the URL fragment (/#secret=…), which browsers never send to the server or proxies.
import { putTtl, getTtl, takeTtl, listTtl, deleteTtl } from './ttl-store.js';
import { newToken, sha256 } from './crypto.js';

const LINK_TTL = { secret: 15 * 60000, signup: 48 * 3600000 };
const TOKEN_RE = /^[a-f0-9]{64}$/;
const kindKey = (kind) => `link:${kind}`;

/** A new link of `kind` ('secret' | 'signup') carrying `data`: { token, expiresAt }. */
export function createLink(kind, data) {
  const token = newToken();
  const expiresAt = Date.now() + LINK_TTL[kind];
  putTtl(kindKey(kind), sha256(token), { ...data, expiresAt }, expiresAt);
  return { token, expiresAt };
}
/** The link's data, or null when the token is malformed, unknown, used or expired. */
export const peekLink = (kind, token) => (TOKEN_RE.test(String(token || '')) ? getTtl(kindKey(kind), sha256(token)) : null);
/** Use the link (single use): its data, or null. */
export const takeLink = (kind, token) => (TOKEN_RE.test(String(token || '')) ? takeTtl(kindKey(kind), sha256(token)) : null);
/** Drop every live link of `kind` whose data matches (e.g. older sign-up links of the same user). */
export function dropLinks(kind, match) {
  for (const r of listTtl(kindKey(kind))) if (match(r.data)) deleteTtl(kindKey(kind), r.key);
}
export const linkUrl = (base, kind, token) => `${base}/#${kind}=${token}`;
