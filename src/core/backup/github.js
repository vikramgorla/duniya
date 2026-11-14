// GitHub destination: device-flow login, private repo creation, Git Data API upload with pruning.
const API = () => (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const WEB = () => (process.env.GITHUB_WEB_BASE || 'https://github.com').replace(/\/+$/, '');

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.message || `GitHub ${res.status}`), { status: 400 });
  return json;
}

export async function deviceStart(clientId) {
  const r = await form(`${WEB()}/login/device/code`, { client_id: clientId, scope: 'repo' });
  if (r.error) throw Object.assign(new Error(r.error_description || r.error), { status: 400 });
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

export async function api(token, method, path, body) {
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
      'user-agent': 'whatsapp-agent-duniya', ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 404 && method === 'GET') return null;
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`GitHub: ${json.message || res.status}`), { status: res.status >= 500 ? 502 : 400 });
  return json;
}

export const whoami = async (token) => (await api(token, 'GET', '/user'))?.login;

export async function createRepo(token, name = 'duniya-backups') {
  const r = await api(token, 'POST', '/user/repos', {
    name, private: true, auto_init: true, description: 'Encrypted backups from whatsapp-agent-duniya (do not make public)',
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
  if (buf.length > 90 * 1024 * 1024) throw Object.assign(new Error('Backup is larger than 90 MB; use S3 for large backups'), { status: 400 });
  const b = await branchOf(token, repo, branch);
  const ref = await api(token, 'GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(b)}`);
  if (!ref) throw Object.assign(new Error(`Branch ${b} not found in ${repo}`), { status: 400 });
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
  if (!entry) throw Object.assign(new Error('Backup not found on GitHub'), { status: 404 });
  const blob = await api(token, 'GET', `/repos/${target.repo}/git/blobs/${entry.sha}`);
  return Buffer.from(blob.content, 'base64');
}
