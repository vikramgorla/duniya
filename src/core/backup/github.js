// GitHub destination: device-flow login, private repo creation, Git Data API upload with pruning.
// 019: every call takes `token` as a string or as an async token provider (a GitHub App installation token).
import { fail } from '../config.js';
import { createSign } from 'node:crypto';
const API = () => (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const WEB = () => (process.env.GITHUB_WEB_BASE || 'https://github.com').replace(/\/+$/, '');

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(json.error_description || json.message || `GitHub ${res.status}`);
  return json;
}

export async function deviceStart(clientId) {
  const r = await form(`${WEB()}/login/device/code`, { client_id: clientId, scope: 'repo' });
  if (r.error) throw fail(r.error_description || r.error);
  return { deviceCode: r.device_code, userCode: r.user_code, verificationUri: r.verification_uri, expiresIn: r.expires_in, interval: r.interval || 5 };
}

/** Returns { token } or { status: 'pending'|'slow_down'|'expired'|'denied' } */
export async function devicePoll(clientId, deviceCode) {
  const r = await form(`${WEB()}/login/oauth/access_token`, {
    client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (r.access_token) return { token: r.access_token };
  return { status: { authorization_pending: 'pending', slow_down: 'pending', expired_token: 'expired', access_denied: 'denied' }[r.error] || 'error', error: r.error_description };
}

async function api(token, method, path, body) {
  const tok = typeof token === 'function' ? await token() : token;
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: {
      ...(tok ? { authorization: `Bearer ${tok}` } : {}), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
      'user-agent': 'duniya', ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 404 && method === 'GET') return null;
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw fail(`GitHub: ${json.message || res.status}`, res.status >= 500 ? 502 : 400, { httpStatus: res.status });
  return json;
}

export const whoami = async (token) => (await api(token, 'GET', '/user'))?.login;

export async function createRepo(token, name = 'duniya-backups') {
  const r = await api(token, 'POST', '/user/repos', {
    name, private: true, auto_init: true, description: 'Encrypted backups from Duniya (do not make public)',
  });
  return r.full_name;
}

async function branchOf(token, repo, branch) {
  if (branch) return branch;
  return (await api(token, 'GET', `/repos/${repo}`))?.default_branch || 'main';
}

export async function list(token, { repo, branch, path = 'backups' }) {
  const b = await branchOf(token, repo, branch);
  const items = await api(token, 'GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(b)}`);
  return (Array.isArray(items) ? items : []).filter((i) => i.type === 'file' && i.name.endsWith('.dbk'))
    .map((i) => ({ file: i.name, size: i.size, sha: i.sha })).sort((a, z) => z.file.localeCompare(a.file));
}

/** One commit: add the new backup and delete those beyond `keep`. */
export async function upload(token, { repo, branch, path = 'backups' }, file, buf, keep) {
  if (buf.length > 90 * 1024 * 1024) throw fail('Backup is larger than 90 MB; use S3 for large backups');
  const b = await branchOf(token, repo, branch);
  // an empty repository answers 409 "Git Repository is empty."
  const getRef = () => api(token, 'GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(b)}`).catch((e) => { if (e.httpStatus === 409) return null; throw e; });
  let ref = await getRef();
  if (!ref && !branch) {
    // A repository created empty (github.com/new) has no commit yet and the Git Data API refuses empty
    // repositories: create a first commit with the contents API, then continue.
    await api(token, 'PUT', `/repos/${repo}/contents/README.md`, {
      message: 'Duniya backups', content: Buffer.from('Encrypted backups from Duniya. Keep this repository private.\n').toString('base64'),
    });
    ref = await getRef();
  }
  if (!ref) throw fail(`Branch ${b} not found in ${repo}`);
  const parent = ref.object.sha;
  const commit = await api(token, 'GET', `/repos/${repo}/git/commits/${parent}`);
  const existing = await list(token, { repo, branch: b, path });
  const prune = existing.filter((e) => e.file !== file).slice(Math.max(0, keep - 1));
  const blob = await api(token, 'POST', `/repos/${repo}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
  const tree = await api(token, 'POST', `/repos/${repo}/git/trees`, {
    base_tree: commit.tree.sha,
    tree: [
      { path: `${path}/${file}`, mode: '100644', type: 'blob', sha: blob.sha },
      ...prune.map((p) => ({ path: `${path}/${p.file}`, mode: '100644', type: 'blob', sha: null })),
    ],
  });
  const next = await api(token, 'POST', `/repos/${repo}/git/commits`, {
    message: `backup ${file}${prune.length ? ` (pruned ${prune.length})` : ''}`, tree: tree.sha, parents: [parent],
  });
  await api(token, 'PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(b)}`, { sha: next.sha });
  return { pruned: prune.map((p) => p.file) };
}

export async function download(token, target, file) {
  const entry = (await list(token, target)).find((e) => e.file === file);
  if (!entry) throw fail('Backup not found on GitHub', 404);
  const blob = await api(token, 'GET', `/repos/${target.repo}/git/blobs/${entry.sha}`);
  return Buffer.from(blob.content, 'base64');
}

// ---------- GitHub App (019): created from a manifest, installed on one repository ----------
export const webBase = WEB;

/** The manifest the panel posts to github.com/settings/apps/new (no webhook, contents write on chosen repos). */
export function appManifest({ name, baseUrl }) {
  return {
    name, url: baseUrl, description: 'Encrypted backups from a Duniya server. Install it only on the private backup repository.',
    redirect_url: `${baseUrl}/backups/github-app/callback`, setup_url: `${baseUrl}/backups/github-app/installed`,
    public: false, default_permissions: { contents: 'write', metadata: 'read' },
  };
}
export const manifestFormUrl = (state, org = '') => `${WEB()}/${org ? `organizations/${encodeURIComponent(org)}/` : ''}settings/apps/new?state=${encodeURIComponent(state)}`;
export const installUrl = (slug) => `${WEB()}/apps/${encodeURIComponent(slug)}/installations/new`;
export const newRepoUrl = (name = 'duniya-backup') => `${WEB()}/new?name=${encodeURIComponent(name)}&visibility=private&owner=@me`;

/** Exchange the one-hour manifest code for the app's id, slug and private key. */
export async function convertManifest(code) {
  if (!/^[\w-]{4,100}$/.test(String(code || ''))) throw fail('GitHub sent no valid code');
  const r = await api(null, 'POST', `/app-manifests/${encodeURIComponent(code)}/conversions`);
  if (!r?.id || !r?.pem) throw fail('GitHub did not return the app credentials (the code is valid for one hour; start again)');
  const name = r.name || '';
  const slug = r.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { id: r.id, slug, name, owner: r.owner?.login || '', htmlUrl: r.html_url || (slug ? `${WEB()}/apps/${slug}` : ''), clientId: r.client_id || '', pem: r.pem };
}

/** A short-lived app JWT (RS256), as GitHub requires for /app endpoints. */
export function appJwt(appId, pem, now = Math.floor(Date.now() / 1000)) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now - 60, exp: now + 540, iss: String(appId) })}`;
  const sig = createSign('RSA-SHA256').update(data).sign(pem).toString('base64url');
  return `${data}.${sig}`;
}
export const listInstallations = async (jwt) => (await api(jwt, 'GET', '/app/installations')) || [];
export async function installationToken(jwt, installationId) {
  const r = await api(jwt, 'POST', `/app/installations/${Number(installationId)}/access_tokens`);
  return { token: r.token, expiresAt: Date.parse(r.expires_at) || Date.now() + 3600000 };
}
export async function installationRepos(token) {
  const r = await api(token, 'GET', '/installation/repositories?per_page=100');
  return (r?.repositories || []).map((x) => ({ fullName: x.full_name, private: !!x.private }));
}
