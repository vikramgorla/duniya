// Panel routes for backups (007). Owner only.
import {
  getBackupSettings, updateBackupSettings, setPassphrase, runBackup, listBackups, fetchBackup, restoreBackup,
  lastBackup, listLocal, githubClientId, github,
} from '../../core/backup/index.js';
import { getSecret, setSecret } from '../../core/store.js';
import { activity } from '../../core/events.js';

const OWNER = { role: 'owner' };
let device = null; // { clientId, deviceCode, expiresAt }

export function backupRoutes(route, { restart = () => setTimeout(() => process.exit(0), 500) } = {}) {
  route('GET', '/api/backups', async () => {
    const token = getSecret('GITHUB_BACKUP_TOKEN');
    let login = '';
    if (token) { try { login = await github.whoami(token); } catch { login = ''; } }
    return {
      settings: getBackupSettings(), passphraseSet: !!getSecret('BACKUP_PASSPHRASE'), last: lastBackup(), local: listLocal(),
      github: { connected: !!token, login, clientIdSet: !!githubClientId(), signupUrl: 'https://github.com/signup' },
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
  route('POST', '/api/backups/restore', async (req, res, body, q, p, user) => {
    const r = await restoreBackup({ source: body.source, file: body.file, passphrase: String(body.passphrase || '') });
    activity('backup.restore', { summary: `Restore started by ${user.username}` });
    restart();
    return { ok: true, restarting: true, ...r };
  }, OWNER);

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
    updateBackupSettings({ github: { enabled: false } });
    return { ok: true };
  }, OWNER);
  route('PUT', '/api/backups/github/client-id', async (req, res, body) => {
    const id = String(body.clientId || '').trim();
    if (id && !/^[\w.-]{10,60}$/.test(id)) return [400, { error: 'Invalid client id', field: 'clientId' }];
    updateBackupSettings({ githubClientId: id });
    return { ok: true };
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
