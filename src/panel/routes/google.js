// Panel routes for Sign in with Google and invites (019).
import { activity } from '../../core/events.js';
import { sessionUser, listInvites, createInvite, renewInvite, revokeInvite, unlinkGoogle } from '../../core/store.js';
import {
  googleConfig, googleReady, saveGoogleConfig, removeGoogleConfig, testGoogle, startGoogle, finishGoogle, resolveGoogleUser, linkCurrentUser,
  googleOnlyState, setGoogleOnly, passwordLoginAllowed,
} from '../../core/google-signin.js';
import { current as webCurrent, webSettings } from '../../core/webaccess.js';
import { cookie, clientIp, isHttps, publicBase, setSessionCookie, limiter, resultPage, send, esc, PAGE_CSP, pageHead } from '../http.js';

export { googleReady };
const OWNER = { role: 'owner' };
const callbackLimit = limiter(20);
const startLimit = limiter(20);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
export const CALLBACK_PATH = '/auth/google/callback';
export const GOOGLE_CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials';
/** #77: Google wants the origin exactly: scheme://host[:port], never a trailing slash or a path. */
const originOf = (base) => new URL(base).origin;
const HOST_RE = /^(?:[a-z\d](?:[a-z\d-]{0,62}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,62}[a-z\d])?)*|\[[\da-f:.]+\])(?::\d{1,5})?$/;
/** The Host the browser used, lower-cased, or '' when it is not a plain host name (never shown or linked as is). */
const requestHost = (req) => { const h = String(req.headers.host || '').trim().toLowerCase(); return h.length <= 260 && HOST_RE.test(h) ? h : ''; };
const bareHost = (h) => String(h || '').replace(/:\d+$/, '');

/**
 * Every address this panel answers on (main first): its origin and redirect URI as Google needs them. Built from
 * PUBLIC_URL / the request and the applied web config only, never from anything a visitor sent.
 */
export function panelAddresses(req) {
  const main = googleUrls(req);
  const out = [{ host: new URL(main.origin).host, origin: main.origin, redirectUri: main.redirectUri, main: true }];
  let hosts = [];
  try { const c = webCurrent(); hosts = [c.host, ...c.aliases]; } catch { /* no web config */ }
  try { // the two-step switch: the new domain counts once it is added (even if the applied config lags behind)
    const sw = webSettings().switch;
    if (sw && ['added', 'confirmed'].includes(sw.phase)) hosts.push(sw.newHost, sw.oldHost);
  } catch { /* no settings */ }
  for (const h of hosts.filter(Boolean)) {
    const origin = originOf(`https://${h}`);
    if (!out.some((a) => a.origin === origin)) out.push({ host: h, origin, redirectUri: `${origin}${CALLBACK_PATH}`, main: false });
  }
  return out;
}

/**
 * #77: the redirect URI for a sign-in started by this request: the address the person is on when it is one of the
 * panel's own addresses (main, alias, or the new domain of a two-step switch), so Google returns to the browser that
 * holds the binding cookie; anything else (unknown or odd Host headers) falls back to the main address (PUBLIC_URL).
 * Only the Host header is read (as the web server forwards it); X-Forwarded-Host is never trusted here.
 */
function redirectUriFor(req) {
  const addrs = panelAddresses(req);
  const here = requestHost(req);
  const hit = here && (addrs.find((a) => a.host === here) || addrs.find((a) => !a.main && a.host === bareHost(here)));
  return (hit || addrs[0]).redirectUri;
}

/** What Google needs registered for this panel, and what would stop it working. */
function googleUrls(req) {
  const base = publicBase(req).replace(/\/+$/, '');
  const u = new URL(base);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  const warnings = [];
  if (!local && (IPV4.test(host) || host.includes(':'))) {
    warnings.push({ kind: 'ip', text: `Google does not accept a bare IP address. Open the panel with a name instead, e.g. https://${host.replace(/[.:]/g, '-')}.sslip.io (free, works with the installer's "IP with HTTPS" option) or your own domain, then come back here.` });
  } else if (u.protocol !== 'https:' && !local) {
    warnings.push({ kind: 'https', text: 'Google requires https:// for this address. Re-run the installer with --ip-https or --domain, or open the panel through its https address.' });
  }
  const path = u.pathname.replace(/\/+$/, '');
  return { origin: u.origin, redirectUri: `${u.origin}${path}${CALLBACK_PATH}`, warnings };
}

function bindingCookie(req, value, maxAge) {
  return `duniya_oidc=${value}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

export function googleRoutes(route) {
  // ---------- owner setup ----------
  route('GET', '/api/auth/google', async (req) => ({ ...googleConfig(), ready: googleReady(), ...googleUrls(req), addresses: panelAddresses(req) }), OWNER);
  route('PUT', '/api/auth/google', async (req, res, body, q, p, user) => {
    const c = saveGoogleConfig({ clientId: body.clientId, clientSecret: body.clientSecret, enabled: body.enabled });
    activity('config', { summary: `Sign in with Google ${c.enabled ? 'settings saved' : 'turned off'} by ${user.username}` });
    if (!googleReady()) setGoogleOnly(false, { by: user.username, source: 'auto' }); // never leave nobody able to sign in
    return { ...c, ready: googleReady(), ...googleUrls(req), addresses: panelAddresses(req) };
  }, OWNER);
  route('DELETE', '/api/auth/google', async (req, res, body, q, p, user) => {
    removeGoogleConfig();
    activity('config', { summary: `Sign in with Google removed by ${user.username}` });
    setGoogleOnly(false, { by: user.username, source: 'auto' });
    return { ok: true };
  }, OWNER);
  route('POST', '/api/auth/google/test', async (req) => testGoogle(googleUrls(req).redirectUri), OWNER);

  // ---------- only Google (028) ----------
  route('GET', '/api/auth/signin', async (req, res, body, q, p, user) => googleOnlyState(user), OWNER);
  route('PUT', '/api/auth/signin', async (req, res, body, q, p, user) => {
    setGoogleOnly(!!body.googleOnly, { user, source: 'panel' });
    return googleOnlyState(user);
  }, OWNER);

  // ---------- linking ----------
  const NO_UNLINK = 'Only Sign in with Google is allowed (Settings → Sign-in): unlinking would lock this account out. Switch password sign-in back on first.';
  route('DELETE', '/api/me/google', async (req, res, body, q, p, user) => {
    if (!passwordLoginAllowed()) return [400, { error: NO_UNLINK }];
    const u = unlinkGoogle(user.id);
    activity('config', { summary: `${user.username} unlinked their Google account` });
    return u;
  }, { role: 'viewer' });
  route('DELETE', '/api/users/:id/google', async (req, res, body, q, p, user) => {
    if (!passwordLoginAllowed()) return [400, { error: NO_UNLINK }];
    const u = unlinkGoogle(p.id);
    activity('config', { summary: `Google unlinked from ${u.username} by ${user.username}` });
    return u;
  }, OWNER);

  // ---------- invites ----------
  route('GET', '/api/invites', async (req) => ({ invites: listInvites(), panelUrl: publicBase(req), googleReady: googleReady() }), OWNER);
  route('POST', '/api/invites', async (req, res, body, q, p, user) => {
    const i = createInvite({ email: body.email, role: body.role || 'admin', by: user.username });
    activity('config', { summary: `Invite for ${i.email} (${i.role}) by ${user.username}` });
    return [201, i];
  }, OWNER);
  route('POST', '/api/invites/:id/renew', async (req, res, body, q, p, user) => {
    const i = renewInvite(p.id);
    activity('config', { summary: `Invite for ${i.email} renewed by ${user.username}` });
    return i;
  }, OWNER);
  route('DELETE', '/api/invites/:id', async (req, res, body, q, p, user) => {
    const i = revokeInvite(p.id);
    activity('config', { summary: `Invite for ${i.email} revoked by ${user.username}` });
    return { ok: true };
  }, OWNER);

  // ---------- the browser flow ----------
  route('GET', '/auth/google/start', async (req, res, body, q) => {
    const ip = clientIp(req);
    if (startLimit(ip)) return resultPage(res, { ok: false, status: 429, title: 'Too many attempts', message: 'Wait a minute and try again.' });
    const mode = q.get('mode') === 'link' ? 'link' : 'login';
    let userId = null;
    if (mode === 'link') {
      const me = sessionUser(cookie(req, 'duniya_session'));
      if (!me) return resultPage(res, { ok: false, status: 401, title: 'Sign in first', message: 'Sign in to the panel, then link your Google account from Settings.' });
      userId = me.id;
    }
    try {
      const { url, binding } = await startGoogle({ mode, userId, redirectUri: redirectUriFor(req), startHost: requestHost(req) });
      send(res, 302, '', { location: url, 'set-cookie': bindingCookie(req, binding, 600) });
      return null;
    } catch (e) {
      return resultPage(res, { ok: false, title: 'Sign in with Google is not available', message: e.message });
    }
  }, { public: true });

  // Google sends the browser back here (a cross-site navigation, so the SameSite=Strict session cookie is absent):
  // state + PKCE + the Lax binding cookie prove this is the sign-in we started; the session cookie set here is
  // used by the same-origin navigation the result page makes.
  route('GET', '/auth/google/callback', async (req, res, body, q) => {
    const ip = clientIp(req);
    const clear = bindingCookie(req, '', 0);
    if (callbackLimit(ip)) return resultPage(res, { ok: false, status: 429, title: 'Too many attempts', message: 'Wait a minute and try again.' });
    let mode = 'login';
    try {
      const r = await finishGoogle({ state: q.get('state'), code: q.get('code'), error: q.get('error'), binding: cookie(req, 'duniya_oidc') });
      mode = r.mode;
      if (r.mode === 'link') {
        const u = linkCurrentUser(r.userId, r.claims);
        activity('config', { summary: `${u.username} linked Google account ${r.claims.email} from ${ip}` });
        res.setHeader('set-cookie', clear);
        return resultPage(res, { ok: true, title: 'Google account linked', message: `Next time, ${u.username} can use “Sign in with Google” (${r.claims.email}).`, back: '/#settings' });
      }
      const { user, how } = resolveGoogleUser(r.claims);
      setSessionCookie(req, res, user.id);
      res.setHeader('set-cookie', [res.getHeader('set-cookie'), clear].flat());
      const note = how === 'invite' ? ' (invite accepted, account created)' : how === 'email' ? ' (linked by email)' : '';
      activity('system', { summary: `Panel sign-in with Google: ${user.username} <${r.claims.email}>${note} from ${ip}` });
      return resultPage(res, { ok: true, title: `Welcome, ${user.username}`, message: how === 'invite' ? `Your account was created as ${user.role}. Opening the panel…` : 'Opening the panel…', back: '/', autoMs: 600 });
    } catch (e) {
      mode = e.mode || mode;
      activity('system', { summary: `Panel sign-in with Google failed from ${ip}: ${e.message}` });
      res.setHeader('set-cookie', clear);
      const why = addressProblem(req, e, { googleError: q.get('error'), bindingCookie: cookie(req, 'duniya_oidc') });
      if (why) return addressHelpPage(req, res, { ...why, mode, message: e.message });
      return resultPage(res, { ok: false, status: e.status === 403 ? 403 : 400, title: mode === 'link' ? 'Linking did not complete' : 'Sign-in did not complete', message: e.message, back: mode === 'link' ? '/#settings' : '/' });
    }
  }, { public: true });
}


// ---------- #77: sign-in that came back to another address ----------
/**
 * Was this failed callback caused by the panel's addresses rather than by the person? Yes when Google says the redirect
 * URI is not registered, when the sign-in was started at another address of this panel (Google returns to the
 * registered one, where the browser-binding cookie of the other address is missing), or when that cookie is missing.
 * Returns { kind, startHost, thisHost } or null. Hosts are only kept when they are addresses of this panel.
 */
function addressProblem(req, e, { googleError, bindingCookie }) {
  const known = new Set(panelAddresses(req).map((a) => a.host));
  const thisHost = requestHost(req);
  const startHost = e.startHost && known.has(e.startHost) ? e.startHost : known.has(bareHost(e.startHost)) ? bareHost(e.startHost) : '';
  const here = known.has(thisHost) ? thisHost : known.has(bareHost(thisHost)) ? bareHost(thisHost) : '';
  if (googleError === 'redirect_uri_mismatch') return { kind: 'mismatch', startHost, thisHost: here };
  if (e.reason === 'binding' && startHost && here && startHost !== here) return { kind: 'other-address', startHost, thisHost: here };
  if (e.reason === 'binding' || (e.reason === 'state' && !bindingCookie)) return { kind: 'no-cookie', startHost: '', thisHost: here };
  return null;
}

/** The friendly page: what happened, the exact values for Google Cloud (copy buttons), and safe ways on. Text only. */
function addressHelpPage(req, res, { kind, startHost, thisHost, mode, message }) {
  const addrs = panelAddresses(req);
  const pwOk = passwordLoginAllowed();
  const link = mode === 'link';
  const title = kind === 'other-address' ? 'Google sign-in needs the new address' : kind === 'mismatch' ? 'Google does not know this address yet' : 'Sign-in did not complete';
  const what = kind === 'other-address'
    ? `You started at https://${startHost}, but Google sent you back to https://${thisHost}. A sign-in can only finish at the address where it started, so it stopped here. Your account is fine: start again at https://${startHost} (this works once that address is registered in Google Cloud, below), or sign in here.`
    : kind === 'mismatch'
      ? 'Google refused the panel’s address (redirect_uri_mismatch): it is not registered for this panel’s sign-in client yet.'
      : `${String(message || '').replace(/\s*Start again from the panel\.$/, '')} Most likely you signed in on another address of this panel (for example the old or the new domain during a domain change) or in another browser or app window. Start again from the panel address you want to use${thisHost ? `, or sign in here at https://${thisHost}` : ''}.`;
  const row = (v) => `<div class=row><code>${esc(v)}</code><button type=button data-copy="${esc(v)}">Copy</button></div>`;
  const origins = addrs.map((a) => row(a.origin)).join('');
  const redirects = addrs.map((a) => row(a.redirectUri)).join('');
  const actions = [];
  // links: relative ones, or the start address when it is one of this panel's own addresses (never anything a visitor sent)
  const startOk = kind === 'other-address' && addrs.some((a) => a.host === startHost);
  if (link) actions.push('<a class="btn primary" href="/#settings">Back to Settings</a>');
  else {
    if (startOk) actions.push(`<a class="btn primary" href="https://${esc(startHost)}/">Start again at https://${esc(startHost)}</a>`);
    if (thisHost) actions.push(`<a class="btn${startOk ? '' : ' primary'}" href="/auth/google/start">Sign in with Google here</a>`);
    if (pwOk) actions.push('<a class=btn href="/">Sign in with your password</a>');
    else if (!thisHost) actions.push('<a class=btn href="/">Back to the sign-in page</a>');
  }
  const onlyGoogle = !pwOk && !link
    ? `<div class="note warn"><b>Only Sign in with Google is allowed on this panel.</b> ${thisHost ? `Sign in at this address (https://${esc(thisHost)}) for now: it is registered, so it works.` : 'Use the panel’s previous address for now.'} Or, on the server, run <code>sudo duniya enable-password-login</code> to turn passwords back on.</div>`
    : '';
  const hereNote = thisHost && !link ? `<p class=small>Until then, sign in from <b>https://${esc(thisHost)}</b>: it works now.</p>` : '';
  const html = `${pageHead(title)}
<body><main>
<h1>${esc(title)}</h1>
<p>${esc(what)}</p>
<div class=note><b>Fix it once (owner):</b> add every address of this panel to the Google sign-in client. Until then, Google sign-in only works from the addresses already registered there.</div>
<ol>
<li>Open <a href="${GOOGLE_CREDENTIALS_URL}" target=_blank rel="noopener noreferrer">Google Cloud Console → APIs &amp; Services → Credentials ↗</a> and click your OAuth client (Web application).</li>
<li>Under <b>Authorized JavaScript origins</b>, add each of these (no slash at the end):${origins}</li>
<li>Under <b>Authorized redirect URIs</b>, add each of these exactly:${redirects}</li>
<li>Click <b>Save</b>. Google can take a few minutes to apply it; then sign in again.</li>
</ol>
${hereNote}${onlyGoogle}
<div class=actions>${actions.join('')}</div>
</main>
<script src="/page.js"></script>`;
  send(res, 400, html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY' });
  return null;
}
