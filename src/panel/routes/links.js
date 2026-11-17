// @ts-check
// One-time links (060, #121): a signed-in owner or admin enters a secret in the panel instead of a chat, and a new
// user sets their own password. Values are saved through the existing routes (`invoke`, as the signed-in user), so
// validation, role gates and activity logging stay in one place. Values are never returned or logged.
import { activity } from '../../core/events.js';
import { SECRET_NAME_RE, getUser, createUser, updateUser, onUserDeleted } from '../../core/store.js';
import { accountById } from '../../core/providers/index.js';
import { passwordLoginAllowed } from '../../core/google-signin.js';
import { tellUser } from '../../core/owner-assistant.js';
import { createLink, peekLink, takeLink, dropLinks, linkUrl } from '../../core/one-time-links.js';
import { clientIp, limiter, setSessionCookie } from '../http.js';
import { baseUrl } from '../http-util.js';

const OWNER = { role: 'owner' };
const signupLimit = limiter(10);
const KEY_TYPES = ['anthropic', 'openai', 'openrouter', 'compatible'];
const GONE = 'This link was used or has expired. Ask for a new one.';
const NO_PASSWORDS = 'Password sign-in is switched off: invite this person with Google instead (Users → Invite).';

onUserDeleted((id) => dropLinks('signup', (d) => d.userId === id)); // ids can be reused by SQLite

/** A sign-up link for a user without a password yet (or to choose a new one); older links of that user stop working. */
function signupLink(req, user, by) {
  dropLinks('signup', (d) => d.userId === user.id);
  const { token, expiresAt } = createLink('signup', { userId: user.id, by: by.username });
  activity('system', { summary: `Sign-up link for ${user.username} (${user.role}) made by ${by.username}` });
  return { username: user.username, role: user.role, link: linkUrl(baseUrl(req), 'signup', token), expiresAt };
}
/** The user a sign-up link is for, while it may still be used. */
function signupUser(token) {
  const d = peekLink('signup', token);
  const u = d && getUser(d.userId);
  return u && !u.disabled ? u : null;
}

export function linkRoutes(route, { invoke }) {
  // ---------- enter a secret ----------
  route('POST', '/api/secret-links', async (req, res, body, q, p, user) => {
    let target;
    if (body.account) {
      const acc = accountById(String(body.account));
      if (!acc || !KEY_TYPES.includes(acc.type)) return [404, { error: 'No such API-key account (see list_model_accounts)', field: 'account' }];
      target = { account: acc.id, label: `the API key of ${acc.name}` };
    } else {
      const name = String(body.name || '').trim();
      if (!SECRET_NAME_RE.test(name)) return [400, { error: 'Secret names must be UPPER_SNAKE_CASE', field: 'name' }];
      target = { name, label: name };
    }
    // notify: tell the asker "saved" in their own owner-assistant chat (only theirs, never another chat).
    const { token, expiresAt } = createLink('secret', { ...target, by: user.id, byName: user.username, notify: !!body.notify });
    activity('system', { summary: `One-time link to enter ${target.label} made by ${user.username}` });
    return { for: target.label, link: linkUrl(baseUrl(req), 'secret', token), expiresAt };
  });
  // Tokens travel in the request body, never in a URL path (no access logs, no URL built from user input).
  route('POST', '/api/secret-links/open', async (req, res, body) => {
    const d = peekLink('secret', String(body.token || ''));
    return d ? { for: d.label, askedBy: d.byName, expiresAt: d.expiresAt } : [404, { error: GONE }];
  }, { role: 'admin' });
  route('POST', '/api/secret-links/use', async (req, res, body, q, p, user) => {
    const token = String(body.token || '');
    const d = peekLink('secret', token);
    if (!d) return [404, { error: GONE }];
    const value = String(body.value || '').trim();
    if (!value) return [400, { error: 'Paste the value first', field: 'value' }];
    if (d.account) await invoke(user, 'PUT', `/api/accounts/${encodeURIComponent(d.account)}/key`, { key: value });
    else await invoke(user, 'PUT', '/api/secrets', { name: d.name, value });
    takeLink('secret', token); // single use, after a successful save (a failed save can be tried again)
    activity('system', { summary: `${d.label} saved through a one-time link by ${user.username} (asked by ${d.byName})` });
    if (d.notify) await tellUser(d.by, `Saved ${d.label}${user.id === d.by ? '' : ` (entered by ${user.username})`}. The value never passed through this chat.`).catch(() => {});
    return { ok: true, saved: d.label };
  }, { role: 'admin' });

  // ---------- sign-up links for new users ----------
  route('POST', '/api/users', async (req, res, body, q, p, user) => {
    if (!passwordLoginAllowed()) return [400, { error: NO_PASSWORDS }];
    const noPassword = !body.password;
    const u = createUser({ username: body.username, email: body.email, role: body.role, password: body.password, noPassword });
    activity('system', { summary: `User ${u.username} (${u.role}) added by ${user.username}${noPassword ? ' (sets their own password)' : ''}` });
    return noPassword ? { ...u, signup: signupLink(req, u, user) } : u;
  }, OWNER);
  route('POST', '/api/users/:id/signup-link', async (req, res, body, q, p, user) => {
    if (!passwordLoginAllowed()) return [400, { error: NO_PASSWORDS }];
    const u = getUser(p.id);
    if (!u) return [404, { error: 'User not found' }];
    if (u.disabled) return [400, { error: `${u.username} is disabled: enable the account first` }];
    return signupLink(req, u, user);
  }, OWNER);
  route('POST', '/api/signup/open', async (req, res, body) => {
    if (signupLimit(clientIp(req))) return [429, { error: 'Too many attempts, wait a minute' }];
    const token = String(body.token || '');
    const u = signupUser(token);
    return u ? { username: u.username, role: u.role, expiresAt: peekLink('signup', token).expiresAt } : [404, { error: GONE }];
  }, { public: true });
  route('POST', '/api/signup', async (req, res, body) => {
    const token = String(body.token || '');
    if (signupLimit(clientIp(req))) return [429, { error: 'Too many attempts, wait a minute' }];
    if (!passwordLoginAllowed()) return [403, { error: 'Password sign-in is switched off. Use Sign in with Google.' }];
    const u = signupUser(token);
    if (!u) return [404, { error: GONE }];
    updateUser(u.id, { password: String(body.password || '') }); // strength checked here; the link stays usable on error
    takeLink('signup', token);
    setSessionCookie(req, res, u.id);
    activity('system', { summary: `${u.username} set their password with a sign-up link` });
    return { ok: true, user: getUser(u.id) };
  }, { public: true });
}
