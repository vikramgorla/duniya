// Panel routes for backups (007). Owner only.
import { fail } from '../../core/config.js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  getBackupSettings, updateBackupSettings, setPassphrase, runBackup, listBackups, fetchBackup, openBackup, restoreBackup, restoreBuffer,
  lastBackup, listLocal, githubClientId, github, APP_KEY_SECRET, resetAppToken,
} from '../../core/backup/index.js';
import { getSecret, setSecret, countUsers } from '../../core/store.js';
import { activity } from '../../core/events.js';
import {
  publicBase, resultPage, esc, send, CSP, receiveUpload, uploadPath, dropUpload, limiter, clientIp, checkSetupCode, UPLOAD_MAX,
} from '../http.js';
import { baseUrl } from '../http-util.js';

const OWNER = { role: 'owner' };
const MAGIC = 'DUNIYA1\n';
let device = null; // { clientId, deviceCode, expiresAt }
const manifestStates = new Map(); // state -> { expires, by }
const setupLimit = limiter(10);

/** Read a finished upload; a missing or expired one gets a plain message. */
function readUpload(id) {
  try { return readFileSync(uploadPath(id)); } catch (e) {
    throw fail(e.status ? e.message : 'The uploaded file is no longer here (uploads are kept for one hour). Choose the file again.');
  }
}
const fileLabel = (req) => String(req.headers['x-file-name'] || 'uploaded file').replace(/[^\w.@ -]/g, '').slice(0, 80) || 'uploaded file';

/** GitHub App state for the Backups page (no GitHub calls; /check refreshes it). */
function appView() {
  const s = getBackupSettings();
  const app = s.githubApp;
  if (!app) return { app: null, newRepoUrl: github.newRepoUrl() };
  return {
    app: { id: app.id, slug: app.slug, name: app.name, owner: app.owner, htmlUrl: app.htmlUrl, createdAt: app.createdAt, settingsUrl: `${github.webBase()}/settings/apps/${app.slug}` },
    keySet: !!getSecret(APP_KEY_SECRET), installed: !!app.installationId, account: app.account || '', repos: app.repos || [],
    installUrl: github.installUrl(app.slug), newRepoUrl: github.newRepoUrl(),
  };
}

export function backupRoutes(route, { restart = () => setTimeout(() => process.exit(0), 500) } = {}) {
  route('GET', '/api/backups', async () => {
    const token = getSecret('GITHUB_BACKUP_TOKEN');
    const app = appView();
    let login = '';
    if (token) { try { login = await github.whoami(token); } catch { login = ''; } }
    const via = app.installed && app.keySet ? 'app' : token ? 'token' : null;
    return {
      settings: getBackupSettings(), passphraseSet: !!getSecret('BACKUP_PASSPHRASE'), last: lastBackup(), local: listLocal(),
      uploadMaxMb: Math.round(UPLOAD_MAX / 1048576),
      github: { connected: !!via, via, login: via === 'app' ? app.account : login, tokenSet: !!token, tokenLogin: login, clientIdSet: !!githubClientId(), signupUrl: 'https://github.com/signup', app },
      s3: { keysSet: !!(getSecret('S3_ACCESS_KEY_ID') && getSecret('S3_SECRET_ACCESS_KEY')) },
    };
  }, OWNER);
  route('PUT', '/api/backups/settings', async (req, res, body, q, p, user) => {
    const s = updateBackupSettings(body);
    activity('backup.settings', { summary: `Backup settings updated by ${user.username}` });
    return s;
  }, OWNER);
  route('PUT', '/api/backups/passphrase', async (req, res, body) => { setPassphrase(body.passphrase); return { ok: true }; }, OWNER);
  route('POST', '/api/backups/run', async () => runBackup({ reason: 'manual' }), OWNER);
  route('GET', '/api/backups/list', async (req, res, body, q) => listBackups(q.get('source') || 'local'), OWNER);
  route('GET', '/api/backups/download/:file', async (req, res, body, q, p) => {
    const buf = await fetchBackup('local', p.file);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${p.file}"`, 'cache-control': 'no-store' });
    res.end(buf);
    return null;
  }, OWNER);
  // 060: without a passphrase the server's stored one is used (the owner assistant and AI assistants never see one);
  // check: true only opens the backup (the restore preview). A backup that does not open points to the Backups page.
  route('POST', '/api/backups/restore', async (req, res, body, q, p, user) => {
    const stored = !body.passphrase;
    const passphrase = String(body.passphrase || '') || getSecret('BACKUP_PASSPHRASE');
    const panel = `${baseUrl(req)}/#backups`;
    if (!passphrase) return [400, { error: `No backup passphrase is stored on this server. Restore it in the panel with the passphrase it was made with: ${panel}` }];
    const wrong = (e) => (stored && e.status === 400 && /passphrase/i.test(e.message)
      ? fail(`This backup does not open with this server's backup passphrase (made on another server or with an earlier passphrase). Restore it in the panel with its passphrase: ${panel}`) : e);
    if (body.check) return openBackup({ source: body.source, file: body.file, passphrase }).catch((e) => { throw wrong(e); });
    let r;
    try {
      if (body.source === 'upload') {
        r = restoreBuffer(readUpload(body.upload), passphrase, { source: 'upload', file: String(body.name || 'uploaded file').slice(0, 80) });
        dropUpload(body.upload);
      } else {
        r = await restoreBackup({ source: body.source, file: body.file, passphrase });
      }
    } catch (e) { throw wrong(e); }
    activity('backup.restore', { summary: `Restore started by ${user.username}` });
    restart();
    return { ok: true, restarting: true, ...r };
  }, OWNER);
  // 019: restore from a file on the owner's computer. The file is streamed to disk (max BACKUP_UPLOAD_MAX_MB);
  // the passphrase is sent separately with /api/backups/restore { source: 'upload', upload }.
  route('POST', '/api/backups/upload', async (req, res, body, q, p, user) => {
    const r = await receiveUpload(req, { magic: MAGIC });
    activity('backup.settings', { summary: `Backup file "${fileLabel(req)}" uploaded (${Math.round(r.size / 1024)} KB) by ${user.username}` });
    return r;
  }, { ...OWNER, raw: true });

  // ---------- fresh install: restore instead of creating an owner (019) ----------
  // Only while no account exists, and only with the one-time setup code from the installer/server log.
  route('POST', '/api/setup/upload', async (req) => {
    if (countUsers() > 0) { req.resume(); return [409, { error: 'This server is already set up. Sign in and use Backups → Restore.' }]; }
    if (setupLimit(clientIp(req))) { req.resume(); return [429, { error: 'Too many attempts, wait a minute' }]; }
    if (!checkSetupCode(req.headers['x-setup-code'])) { req.resume(); return [403, { error: 'Wrong setup code (see the installer output or the server log)' }]; }
    return receiveUpload(req, { magic: MAGIC });
  }, { public: true, raw: true });
  route('POST', '/api/setup/restore', async (req, res, body) => {
    if (countUsers() > 0) return [409, { error: 'This server is already set up. Sign in and use Backups → Restore.' }];
    if (setupLimit(clientIp(req))) return [429, { error: 'Too many attempts, wait a minute' }];
    if (!checkSetupCode(body.code)) return [403, { error: 'Wrong setup code (see the installer output or the server log)' }];
    const r = restoreBuffer(readUpload(body.upload), String(body.passphrase || ''), { source: 'upload (first-run setup)', file: String(body.name || 'uploaded file').slice(0, 80) });
    dropUpload(body.upload);
    restart();
    return { ok: true, restarting: true, ...r };
  }, { public: true });

  // GitHub
  route('POST', '/api/backups/github/device', async () => {
    const clientId = githubClientId();
    if (!clientId) return [400, { error: 'No GitHub OAuth client id configured. Paste a token instead, or set one under Backups → GitHub app.' }];
    const d = await github.deviceStart(clientId);
    device = { clientId, deviceCode: d.deviceCode, expiresAt: Date.now() + d.expiresIn * 1000 };
    return { userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn, interval: d.interval };
  }, OWNER);
  route('POST', '/api/backups/github/poll', async (req, res, body, q, p, user) => {
    if (!device || Date.now() > device.expiresAt) return { status: 'expired' };
    const r = await github.devicePoll(device.clientId, device.deviceCode);
    if (!r.token) return { status: r.status };
    device = null;
    setSecret('GITHUB_BACKUP_TOKEN', r.token);
    const login = await github.whoami(r.token);
    activity('backup.settings', { summary: `GitHub connected for backups as ${login} by ${user.username}` });
    return { status: 'connected', login };
  }, OWNER);
  route('PUT', '/api/backups/github/token', async (req, res, body, q, p, user) => {
    const token = String(body.token || '').trim();
    const login = await github.whoami(token);
    if (!login) return [400, { error: 'Token rejected by GitHub' }];
    setSecret('GITHUB_BACKUP_TOKEN', token);
    activity('backup.settings', { summary: `GitHub token saved for ${login} by ${user.username}` });
    return { login };
  }, OWNER);
  route('POST', '/api/backups/github/create-repo', async (req, res, body) => {
    const token = getSecret('GITHUB_BACKUP_TOKEN');
    if (!token) return [400, { error: 'Connect GitHub first' }];
    const name = String(body.name || 'duniya-backups');
    if (!/^[\w.-]{1,100}$/.test(name)) return [400, { error: 'Invalid repository name', field: 'name' }];
    const repo = await github.createRepo(token, name);
    updateBackupSettings({ github: { enabled: true, repo, branch: '' } });
    activity('backup.settings', { summary: `Created private backup repo ${repo}` });
    return { repo };
  }, OWNER);
  route('DELETE', '/api/backups/github', async () => {
    setSecret('GITHUB_BACKUP_TOKEN', '');
    if (!getBackupSettings().githubApp?.installationId) updateBackupSettings({ github: { enabled: false } });
    return { ok: true };
  }, OWNER);
  route('PUT', '/api/backups/github/client-id', async (req, res, body) => {
    const id = String(body.clientId || '').trim();
    if (id && !/^[\w.-]{10,60}$/.test(id)) return [400, { error: 'Invalid client id', field: 'clientId' }];
    updateBackupSettings({ githubClientId: id });
    return { ok: true };
  }, OWNER);

  // ---------- GitHub App via the manifest flow (019) ----------
  // The panel opens this page in the browser; it posts the manifest to GitHub (a form POST is the only way).
  route('GET', '/backups/github-app/new', async (req, res, body, q, p, user) => {
    const base = publicBase(req);
    const state = randomBytes(18).toString('base64url');
    for (const [k, v] of manifestStates) if (v.expires < Date.now()) manifestStates.delete(k);
    manifestStates.set(state, { expires: Date.now() + 3600000, by: user.username });
    const org = String(q.get('org') || '').trim();
    if (org && !/^[a-z0-9-]{1,39}$/i.test(org)) return resultPage(res, { ok: false, title: 'Invalid organization name', message: 'Use the organization’s short name as in github.com/NAME.', back: '/#backups' });
    const manifest = github.appManifest({ name: `Duniya backups ${randomBytes(3).toString('hex')}`, baseUrl: base });
    const action = github.manifestFormUrl(state, org);
    const web = new URL(github.webBase()).origin;
    const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=color-scheme content="light dark"><title>Opening GitHub…</title>
<style>body{font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f7f3ec;color:#1c2030}.c{background:#fffdf9;border:1px solid #e6dfd3;border-radius:18px;padding:28px;max-width:440px;margin:16px;text-align:center}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:999px;border:0;background:#0b7a75;color:#fff;cursor:pointer}p{color:#6d6a73}
@media (prefers-color-scheme:dark){body{background:#11131c;color:#ece9e2}.c{background:#1a1d2a;border-color:#2a2e3e}button{background:#3cc4b7;color:#0b1a19}p{color:#9a98a3}}</style>
<body><form class=c method=post action="${esc(action)}"><h2>Opening GitHub…</h2>
<p>GitHub will show a page to create your private backup app. Click <b>Create GitHub App</b> there; you come back here automatically.</p>
<input type=hidden name=manifest value="${esc(JSON.stringify(manifest))}"><button>Continue to GitHub</button></form>
<script>document.forms[0].submit()</script>`;
    send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP.replace("form-action 'self'", `form-action ${web}`), 'x-frame-options': 'DENY' });
    return null;
  }, OWNER);
  // GitHub sends the browser back with ?code&state (cross-site: no session cookie; the single-use state proves
  // the owner started it). The code is exchanged for the app's id and private key within the hour.
  route('GET', '/backups/github-app/callback', async (req, res, body, q) => {
    const st = manifestStates.get(String(q.get('state') || ''));
    manifestStates.delete(String(q.get('state') || ''));
    if (!st || st.expires < Date.now()) return resultPage(res, { ok: false, title: 'Link expired', message: 'This GitHub app link expired or was already used. Start again from Backups.', back: '/#backups' });
    try {
      const app = await github.convertManifest(q.get('code'));
      setSecret(APP_KEY_SECRET, app.pem);
      resetAppToken();
      const { pem, ...info } = app;
      updateBackupSettings({ githubApp: { ...info, createdAt: Date.now() } });
      activity('backup.settings', { summary: `GitHub app "${app.name}" created for backups by ${st.by}` });
      return resultPage(res, { ok: true, title: 'GitHub app created', message: 'Next: create the private repository and install the app on it. Opening Backups…', back: '/#backups', autoMs: 1500 });
    } catch (e) {
      activity('error', { summary: `GitHub app creation failed: ${e.message}` });
      return resultPage(res, { ok: false, title: 'GitHub app not created', message: e.message, back: '/#backups' });
    }
  }, { public: true });
  // GitHub's "setup URL" after installing the app: just return to the panel, which checks the installation.
  route('GET', '/backups/github-app/installed', async (req, res) => resultPage(res, { ok: true, title: 'App installed', message: 'Opening Backups to finish…', back: '/#backups', autoMs: 800 }), { public: true });

  route('POST', '/api/backups/github-app/check', async (req, res, body, q, p, user) => {
    const s = getBackupSettings();
    const app = s.githubApp;
    const pem = getSecret(APP_KEY_SECRET);
    if (!app || !pem) return [400, { error: 'Create the GitHub app first' }];
    const jwt = github.appJwt(app.id, pem);
    const insts = await github.listInstallations(jwt);
    if (!insts.length) {
      if (app.installationId) { updateBackupSettings({ githubApp: { ...app, installationId: null, account: '', repos: [] } }); resetAppToken(); }
      return { ...appView(), installed: false };
    }
    const inst = insts.find((i) => i.id === app.installationId) || insts[0];
    const { token } = await github.installationToken(jwt, inst.id);
    const repos = await github.installationRepos(token);
    const next = { ...app, installationId: inst.id, account: inst.account?.login || '', repos: repos.map((r) => r.fullName) };
    const patch = { githubApp: next };
    const known = repos.map((r) => r.fullName);
    if (!s.github.repo && known.length === 1) patch.github = { enabled: true, repo: known[0], branch: '' };
    updateBackupSettings(patch);
    resetAppToken();
    if (!app.installationId || patch.github) activity('backup.settings', { summary: `GitHub app installed on ${known.join(', ') || 'no repositories'}${patch.github ? `; backing up to ${known[0]}` : ''} (${user.username})` });
    return { ...appView(), repo: getBackupSettings().github.repo, enabled: getBackupSettings().github.enabled };
  }, OWNER);
  route('PUT', '/api/backups/github-app/repo', async (req, res, body, q, p, user) => {
    const app = getBackupSettings().githubApp;
    const repo = String(body.repo || '').trim();
    if (!app?.installationId) return [400, { error: 'Install the GitHub app first' }];
    if (!(app.repos || []).includes(repo)) return [400, { error: `The app cannot see ${repo || 'that repository'}. Add it to the app's repositories on GitHub, then check again.`, field: 'repo' }];
    updateBackupSettings({ github: { enabled: true, repo, branch: '' } });
    activity('backup.settings', { summary: `Backing up to ${repo} through the GitHub app (${user.username})` });
    return { ok: true, repo };
  }, OWNER);
  route('DELETE', '/api/backups/github-app', async (req, res, body, q, p, user) => {
    const app = getBackupSettings().githubApp;
    setSecret(APP_KEY_SECRET, '');
    resetAppToken();
    const tokenLeft = !!getSecret('GITHUB_BACKUP_TOKEN');
    updateBackupSettings({ githubApp: null, ...(tokenLeft ? {} : { github: { enabled: false } }) });
    activity('backup.settings', { summary: `GitHub app ${app?.name || ''} disconnected by ${user.username}` });
    return { ok: true, deleteUrl: app?.slug ? `${github.webBase()}/settings/apps/${app.slug}/advanced` : '' };
  }, OWNER);

  // S3
  route('PUT', '/api/backups/s3/keys', async (req, res, body) => {
    setSecret('S3_ACCESS_KEY_ID', String(body.accessKeyId || ''));
    setSecret('S3_SECRET_ACCESS_KEY', String(body.secretAccessKey || ''));
    return { ok: true };
  }, OWNER);
  route('POST', '/api/backups/test/:dest', async (req, res, body, q, p) => {
    try { await listBackups(p.dest); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }, OWNER);
}
