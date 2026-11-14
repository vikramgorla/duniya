// Sign in with Google for the admin panel (019): OpenID Connect authorization code flow with PKCE (S256), state,
// nonce and a browser-binding cookie; the ID token is verified (RS256, Google's JWKS from discovery).
import { createHash, randomBytes } from 'node:crypto';
import { getSecret, setSecret, getSetting, updateSettings, findUserByGoogleSub, findUsersByEmail, linkGoogle, acceptInvite, getUser } from './store.js';
import { oidcDiscovery, verifyIdToken } from './providers/jwt.js';
import { sha256 } from './crypto.js';

export const GOOGLE_SECRET = 'GOOGLE_CLIENT_SECRET';
const ISSUER = () => (process.env.GOOGLE_OIDC_ISSUER || 'https://accounts.google.com').replace(/\/+$/, '');
const CLIENT_ID_RE = /^[\w.-]{6,120}\.apps\.googleusercontent\.com$/;
const PENDING_TTL = 10 * 60 * 1000;
const pending = new Map(); // state -> { mode, userId, verifier, nonce, binding, redirectUri, expires }
const b64url = (b) => Buffer.from(b).toString('base64url');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function googleConfig() {
  const s = getSetting('googleSignin', {}) || {};
  return { clientId: s.clientId || '', enabled: s.enabled !== false, secretSet: !!getSecret(GOOGLE_SECRET), lastTest: s.lastTest || null };
}
export const googleReady = () => { const c = googleConfig(); return !!(c.enabled && c.clientId && c.secretSet); };

export function saveGoogleConfig({ clientId, clientSecret, enabled }) {
  const cur = getSetting('googleSignin', {}) || {};
  const next = { ...cur };
  if (clientId !== undefined) {
    const id = String(clientId || '').trim();
    if (id && !CLIENT_ID_RE.test(id)) throw Object.assign(fail('That does not look like a Google Client ID (it ends with .apps.googleusercontent.com)'), { field: 'clientId' });
    if (id !== cur.clientId) next.lastTest = null;
    next.clientId = id;
  }
  if (clientSecret !== undefined && String(clientSecret).trim()) {
    const sec = String(clientSecret).trim();
    if (/\s/.test(sec) || sec.length < 8) throw Object.assign(fail('That does not look like a client secret'), { field: 'clientSecret' });
    setSecret(GOOGLE_SECRET, sec);
    next.lastTest = null;
  }
  if (enabled !== undefined) next.enabled = !!enabled;
  updateSettings({ googleSignin: next });
  return googleConfig();
}
export function removeGoogleConfig() {
  setSecret(GOOGLE_SECRET, '');
  updateSettings({ googleSignin: {} });
}

/**
 * Checks Google can be reached and accepts the Client ID + secret, without a person signing in: an authorization
 * code that cannot exist is exchanged; Google answers invalid_grant when the client is valid, invalid_client when not.
 */
export async function testGoogle(redirectUri) {
  const c = googleConfig();
  const checks = [];
  let ok = true;
  const add = (name, pass, detail) => { checks.push({ name, ok: pass, detail }); if (!pass) ok = false; };
  if (!c.clientId || !c.secretSet) { add('Client ID and secret saved', false, 'Paste both from step 4'); return finishTest(ok, checks); }
  let disc;
  try { disc = await oidcDiscovery(ISSUER(), { fresh: true }); add('Google reachable', true, ''); } catch (e) { add('Google reachable', false, e.message); return finishTest(ok, checks); }
  try {
    const res = await fetch(disc.token_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'duniya-connection-test', client_id: c.clientId, client_secret: getSecret(GOOGLE_SECRET), redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (j.error === 'invalid_grant') add('Client ID and secret accepted', true, '');
    else if (j.error === 'redirect_uri_mismatch') add('Redirect URI registered', false, `Add ${redirectUri} under Authorized redirect URIs (step 3)`);
    else if (j.error === 'invalid_client' || j.error === 'unauthorized_client') add('Client ID and secret accepted', false, 'Google did not accept them. Copy both again from the client you created (step 3), or create a new secret.');
    else add('Client ID and secret accepted', false, j.error_description || j.error || `Google answered ${res.status}`);
  } catch (e) { add('Client ID and secret accepted', false, e.message); }
  return finishTest(ok, checks);
}
function finishTest(ok, checks) {
  const cur = getSetting('googleSignin', {}) || {};
  const lastTest = { at: Date.now(), ok, checks };
  updateSettings({ googleSignin: { ...cur, lastTest } });
  return lastTest;
}

/** Start a sign-in. mode 'login' (from the login page) or 'link' (a signed-in user links their Google account). */
export async function startGoogle({ mode = 'login', userId = null, redirectUri }) {
  if (!googleReady()) throw fail('Sign in with Google is not set up');
  const disc = await oidcDiscovery(ISSUER());
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  if (pending.size > 500) pending.delete(pending.keys().next().value);
  const state = b64url(randomBytes(24)); const nonce = b64url(randomBytes(24)); const verifier = b64url(randomBytes(32));
  const binding = b64url(randomBytes(24)); // also set as a short-lived cookie: the callback must come back to this browser
  pending.set(state, { mode, userId, verifier, nonce, binding: sha256(binding), redirectUri, expires: now + PENDING_TTL });
  const u = new URL(disc.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: googleConfig().clientId, redirect_uri: redirectUri, scope: 'openid email profile',
    state, nonce, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    prompt: 'select_account',
  })) u.searchParams.set(k, v);
  return { url: u.toString(), binding };
}

/** Finish: validate state + binding, exchange the code (with the PKCE verifier), verify the ID token. */
export async function finishGoogle({ state, code, error, binding }) {
  const p = pending.get(String(state || ''));
  if (p) pending.delete(state); // single use
  if (!p || p.expires < Date.now()) throw fail('This sign-in link expired or was already used. Start again from the panel.');
  if (!binding || sha256(binding) !== p.binding) throw fail('This sign-in was started in another browser. Start again from the panel.');
  if (error) throw Object.assign(fail(error === 'access_denied' ? 'You cancelled the Google sign-in.' : `Google said: ${error}`), { mode: p.mode });
  if (!code) throw fail('Google did not send a sign-in code.');
  const disc = await oidcDiscovery(ISSUER());
  const c = googleConfig();
  const res = await fetch(disc.token_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: p.verifier, client_id: c.clientId, client_secret: getSecret(GOOGLE_SECRET), redirect_uri: p.redirectUri }),
    signal: AbortSignal.timeout(20000),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.id_token) throw Object.assign(fail(`Google refused the sign-in (${tok.error_description || tok.error || res.status}). Check the client secret under Settings → Sign in with Google.`), { mode: p.mode });
  const issuer = ISSUER();
  const claims = await verifyIdToken(tok.id_token, {
    issuer, issuers: issuer === 'https://accounts.google.com' ? ['accounts.google.com'] : [], audience: c.clientId, nonce: p.nonce, discoveryBase: issuer,
  });
  if (!claims.sub) throw fail('Google did not identify the account.');
  if (!(claims.email_verified === true || claims.email_verified === 'true') || !claims.email) {
    throw Object.assign(fail('This Google account has no verified email address.'), { mode: p.mode });
  }
  return { claims: { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: claims.name || '' }, mode: p.mode, userId: p.userId };
}

/**
 * Who is this? 1) the account already linked to this Google id; 2) one account with this email (linked now);
 * 3) an open invite for this email (account created now). Disabled accounts never sign in.
 * Returns { user, how: 'linked'|'email'|'invite' } or throws with a message for the person.
 */
export function resolveGoogleUser({ sub, email }) {
  const bySub = findUserByGoogleSub(sub);
  if (bySub) {
    if (bySub.disabled) throw fail('This account is disabled. Ask the owner.', 403);
    return { user: bySub, how: 'linked' };
  }
  const matches = findUsersByEmail(email).filter((u) => !u.google);
  const anyLinked = findUsersByEmail(email).some((u) => u.google);
  if (matches.length === 1) {
    if (matches[0].disabled) throw fail('This account is disabled. Ask the owner.', 403);
    return { user: linkGoogle(matches[0].id, sub), how: 'email' };
  }
  if (matches.length > 1) throw fail(`More than one account uses ${email}. Ask the owner to fix the emails, or sign in with your password and link Google in Settings.`, 403);
  if (anyLinked) throw fail(`The account for ${email} is linked to a different Google account.`, 403);
  const accepted = acceptInvite(email, sub);
  if (accepted) return { user: accepted.user, how: 'invite', invite: accepted.invite };
  throw fail(`There is no account for ${email}. Ask the owner to invite this address.`, 403);
}

/** Link mode: attach this Google account to the signed-in user. */
export function linkCurrentUser(userId, { sub }) {
  const u = getUser(userId);
  if (!u || u.disabled) throw fail('Your session ended. Sign in again.', 401);
  return linkGoogle(u.id, sub);
}
