// @ts-check
// Panel routes: session, first-run setup, sign-in and sign-out, own password, users (owner).
import { activity } from '../../core/events.js';
import { passwordLoginAllowed } from '../../core/google-signin.js';
import { authenticate, countUsers, createUser, deleteSession, deleteUser, listUsers, updateUser } from '../../core/store.js';
import { checkSetupCode, clientIp, cookie, limiter, requestUser, setSessionCookie, setSetupCode } from '../http.js';
import { googleReady } from './google.js';
import { statusFor } from './status.js';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, DATA_DIR } from '../../core/config.js';
import { humanCode } from '../../core/crypto.js';

const loginLimit = limiter(5);
const rateLimitLogin = (ip) => loginLimit(ip);
const SETUP_FILE = resolve(DATA_DIR, 'setup-code.txt');

// ---------- first owner ----------
export function bootstrapAuth() {
  if (countUsers() > 0) { rmSync(SETUP_FILE, { force: true }); return; }
  if (env.adminPassword) {
    try {
      createUser({ username: 'admin', role: 'owner', password: env.adminPassword });
      activity('system', { summary: 'Owner "admin" created from ADMIN_PASSWORD' });
      return;
    } catch (e) {
      console.error(`ADMIN_PASSWORD not usable (${e.message}); falling back to a setup code`);
    }
  }
  // Create the code file only if it does not exist yet ('wx'), then read whatever is there (no check-then-write race).
  try { writeFileSync(SETUP_FILE, humanCode(10), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const setupCode = readFileSync(SETUP_FILE, 'utf8').trim();
  setSetupCode(setupCode);
  console.log(`\n  First-run setup code: ${setupCode}\n  Open the admin panel and enter it to create the owner account.\n`);
}

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function authRoutes(route, { channel } = {}) {
  // ---------- session / setup ----------
  // 063: ?status=1 adds the status for a signed-in user, so the panel's first screen needs one round trip, not two
  route('GET', '/api/session', async (req, res, body, q) => {
    const user = requestUser(req);
    return { authed: !!user, user, needsSetup: countUsers() === 0, google: googleReady(), passwordLogin: passwordLoginAllowed(),
      ...(user && q.get('status') === '1' ? { status: await statusFor(user, channel) } : {}) };
  }, { public: true });
  route('POST', '/api/setup', async (req, res, body) => {
    if (countUsers() > 0) return [409, { error: 'Already set up' }];
    if (rateLimitLogin(clientIp(req))) return [429, { error: 'Too many attempts, wait a minute' }];
    if (!checkSetupCode(body.code)) return [403, { error: 'Wrong setup code (see the server log or installer output)' }];
    const user = createUser({ username: body.username || 'admin', email: body.email, role: 'owner', password: body.password });
    rmSync(SETUP_FILE, { force: true }); setSetupCode(null);
    activity('system', { summary: `Owner "${user.username}" created via setup` });
    setSessionCookie(req, res, user.id);
    return { ok: true, user };
  }, { public: true });
  route('POST', '/api/login', async (req, res, body) => {
    const ip = clientIp(req);
    if (rateLimitLogin(ip)) return [429, { error: 'Too many attempts, wait a minute' }];
    if (!passwordLoginAllowed()) { activity('system', { summary: `Password sign-in refused for "${body.username || 'admin'}" from ${ip} (only Google allowed)` }); return [403, { error: 'Password sign-in is switched off. Use Sign in with Google.' }]; }
    const user = authenticate(body.username || 'admin', String(body.password || ''));
    if (!user) { activity('system', { summary: `Panel login failed for "${body.username || 'admin'}" from ${ip}` }); return [401, { error: 'Wrong username or password' }]; }
    setSessionCookie(req, res, user.id);
    activity('system', { summary: `Panel login: ${user.username} from ${ip}` });
    return { ok: true, user };
  }, { public: true });
  route('POST', '/api/logout', async (req, res) => {
    deleteSession(cookie(req, 'duniya_session'));
    res.setHeader('set-cookie', 'duniya_session=; Path=/; Max-Age=0');
    return { ok: true };
  }, { role: 'viewer' });
  route('POST', '/api/password', async (req, res, body, q, p, user) => {
    // Accounts created from a Google invite have no password yet: they may set one (a fallback if Google is off).
    if (user.hasPassword && !authenticate(user.username, String(body.current || ''))) return [400, { error: 'Current password is wrong' }];
    updateUser(user.id, { password: String(body.next || '') });
    activity('system', { summary: `Password changed: ${user.username}` });
    return { ok: true };
  }, { role: 'viewer' });
  // ---------- users (owner) ----------
  route('GET', '/api/users', async () => listUsers(), { role: 'owner' });
  route('PUT', '/api/users/:id', async (req, res, body, q, p, user) => {
    const u = updateUser(p.id, body); activity('system', { summary: `User ${u.username} updated by ${user.username}` }); return u;
  }, { role: 'owner' });
  route('DELETE', '/api/users/:id', async (req, res, body, q, p, user) => {
    deleteUser(p.id); activity('system', { summary: `User #${p.id} removed by ${user.username}` }); return { ok: true };
  }, { role: 'owner' });
}
