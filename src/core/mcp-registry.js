// Browse tool services (052, issue #99): search the official MCP Registry (registry.modelcontextprotocol.io, API v0.1)
// and turn one of its entries into a tool-service config this app already runs: a hosted (remote, streamable HTTP)
// service with no auth, a token, headers or an OAuth sign-in (009), or a local npm package run over stdio (010).
// Everything else (PyPI, Docker/OCI, NuGet, MCPB bundles, SSE-only hosts) is shown with "not supported here" and why.
//
// Safety: requests go only to the configured registry host (https, or http on this machine for a private registry),
// never follow redirects, carry no cookies or credentials, time out after 8 s and stop reading after 1 MB. Answers are
// cached briefly in memory (small, bounded). Registry text is data: the panel renders it as text, links only http(s).
import { fail } from './config.js';
import { getSetting, updateSettings, getSecret } from './store.js';
import { SERVER_KEY_RE, RESERVED_SERVER_KEYS } from './schema.js';
import { validPackageSpec, localServiceCheck } from './mcp-local.js';

const REGISTRY_DEFAULT = 'https://registry.modelcontextprotocol.io';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX = 50;
const NPM_HOSTS = ['registry.npmjs.org', 'registry.npmjs.com'];

const clip = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isLoopback = (host) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);

// ---------- settings ----------
/** { enabled, baseUrl (empty = the official registry), effective } */
export function registrySettings() {
  const s = getSetting('mcpRegistry', {}) || {};
  const baseUrl = typeof s.baseUrl === 'string' ? s.baseUrl : '';
  return { enabled: s.enabled !== false, baseUrl, effective: baseUrl || REGISTRY_DEFAULT, official: !baseUrl };
}

/** A registry base URL: https (any host) or http on this machine; no user, password, query or fragment. */
export function cleanBaseUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw fail('Registry address must be a full URL like https://registry.example.com', 400, { field: 'baseUrl' }); }
  if (u.username || u.password) throw fail('Registry address must not contain a user name or password', 400, { field: 'baseUrl' });
  if (u.search || u.hash) throw fail('Registry address must not contain ? or #', 400, { field: 'baseUrl' });
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname))) {
    throw fail('Registry address must use https (http only for a registry on this server)', 400, { field: 'baseUrl' });
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export function saveRegistrySettings({ enabled, baseUrl } = {}) {
  const cur = registrySettings();
  const next = { enabled: enabled === undefined ? cur.enabled : !!enabled, baseUrl: baseUrl === undefined ? cur.baseUrl : cleanBaseUrl(baseUrl) };
  updateSettings({ mcpRegistry: next });
  cache.clear();
  return registrySettings();
}

// ---------- fetching ----------
const cache = new Map(); // url → { at, data }

async function readCapped(res) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw fail('The registry answer is too large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } throw fail('The registry answer is too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function registryGet(path, params = {}) {
  const set = registrySettings();
  if (!set.enabled) throw fail('Browsing the MCP Registry is switched off (Settings → Tool services)', 403, { code: 'registry_off' });
  const base = new URL(`${set.effective}/`);
  const url = new URL(path.replace(/^\//, ''), base);
  if (url.origin !== base.origin) throw fail('Refused: not the registry host'); // never leave the registry host
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  let res;
  try {
    res = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': 'duniya' } });
  } catch (e) {
    throw fail(e?.name === 'TimeoutError' ? 'The MCP Registry did not answer in time; try again' : `Could not reach the MCP Registry (${url.host})`, 502);
  }
  if (res.status === 404) { await readCapped(res).catch(() => ''); throw fail('Not found in the MCP Registry', 404); }
  if (!res.ok) { await readCapped(res).catch(() => ''); throw fail(`The MCP Registry answered ${res.status}`, 502); }
  let data;
  try { data = JSON.parse(await readCapped(res)); } catch (e) { throw e.status ? e : fail('The MCP Registry sent something that is not JSON', 502); }
  cache.set(key, { at: Date.now(), data });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return data;
}

// ---------- normalising server.json ----------
const httpUrl = (v) => {
  try { const u = new URL(String(v)); return ['https:', 'http:'].includes(u.protocol) ? u.toString() : ''; } catch { return ''; }
};
function input(x, kind) {
  if (!x || typeof x !== 'object') return null;
  const name = clip(x.name, 100);
  return {
    kind, name, type: x.type === 'named' || x.type === 'positional' ? x.type : undefined,
    description: clip(x.description, 300), required: !!x.isRequired, secret: !!x.isSecret,
    value: typeof x.value === 'string' ? x.value.slice(0, 500) : '', default: typeof x.default === 'string' ? x.default.slice(0, 500) : '',
    format: ['string', 'number', 'boolean', 'filepath'].includes(x.format) ? x.format : 'string',
    choices: Array.isArray(x.choices) ? x.choices.slice(0, 30).map((c) => clip(String(c), 100)) : [],
    placeholder: clip(x.placeholder || x.valueHint, 100),
  };
}
const inputs = (arr, kind) => (Array.isArray(arr) ? arr.slice(0, 40).map((x) => input(x, kind)).filter(Boolean) : []);

/** Who published it, from the namespace (the registry checks it: GitHub sign-in or a DNS/HTTP proof of the domain). */
export function publisherOf(name) {
  const ns = String(name || '').split('/')[0];
  const gh = ns.match(/^io\.github\.([A-Za-z0-9-]{1,39})$/);
  if (gh) return { kind: 'github', id: gh[1], label: `GitHub: ${gh[1]}` };
  const parts = ns.split('.');
  if (parts.length >= 2 && parts.every((p) => /^[a-z0-9-]{1,63}$/i.test(p))) {
    const domain = parts.reverse().join('.').toLowerCase();
    return { kind: 'domain', id: domain, label: domain };
  }
  return { kind: 'unknown', id: ns, label: ns || 'unknown' };
}

const repoOwner = (url) => (url.match(/^https:\/\/github\.com\/([^/]+)\//i) || [])[1]?.toLowerCase() || '';

function trustOf(s, publisher, repository, remotes, status) {
  const hints = []; const warnings = [];
  if (publisher.kind === 'github') hints.push(`Publisher signed in to the registry as the GitHub account ${publisher.id}`);
  else if (publisher.kind === 'domain') hints.push(`Publisher proved they control ${publisher.id}`);
  else warnings.push('The publisher name is not in a verified form');
  if (repository) {
    hints.push('Source code is linked');
    if (publisher.kind === 'github' && repoOwner(repository.url) && repoOwner(repository.url) !== publisher.id.toLowerCase()) {
      warnings.push(`The source code is under another GitHub account (${repoOwner(repository.url)})`);
    }
  }
  const hosted = remotes.filter((r) => r.url);
  if (publisher.kind === 'domain' && hosted.length && hosted.every((r) => { try { const h = new URL(r.url).hostname; return h === publisher.id || h.endsWith(`.${publisher.id}`); } catch { return false; } })) {
    hints.push('Hosted on the publisher’s own domain');
  }
  if (hosted.length && !s.packages?.length && !repository) warnings.push('Hosted service with no source code linked: you trust the publisher with what your agents send it');
  if (status && status !== 'active') warnings.push(`Marked ${status} in the registry`);
  const level = warnings.length ? 'warn' : publisher.kind !== 'unknown' && repository ? 'good' : 'ok';
  return { level, hints, warnings };
}

function remoteOf(r) {
  const type = String(r?.type || '');
  const url = clip(r?.url, 500);
  const variables = Object.entries(r?.variables && typeof r.variables === 'object' ? r.variables : {}).slice(0, 20).map(([k, v]) => input({ ...v, name: k }, 'var'));
  const supported = type === 'streamable-http' && /^https?:\/\//.test(url);
  return {
    type, url, headers: inputs(r?.headers, 'header'), variables, supported,
    reason: supported ? '' : type === 'sse' ? 'Uses the older SSE connection, which this app does not use; pick a streamable HTTP address if the publisher offers one' : `Connection type "${type || 'unknown'}" is not supported here`,
  };
}

function packageOf(p) {
  const registryType = String(p?.registryType || '');
  const identifier = clip(p?.identifier, 200);
  const version = clip(p?.version, 60);
  const transport = String(p?.transport?.type || '');
  const base = clip(p?.registryBaseUrl, 200);
  let reason = '';
  let spec = '';
  if (registryType === 'npm') {
    spec = version && !['latest', '*'].includes(version) ? `${identifier}@${version}` : identifier;
    let host;
    try { host = base ? new URL(base).hostname : ''; } catch { host = '?'; }
    if (transport !== 'stdio') reason = `This package starts its own web server (${transport}); only packages that talk over stdio run here`;
    else if (host && !NPM_HOSTS.includes(host)) reason = `Comes from another npm registry (${host}); only the public npm registry is used here`;
    else if (!validPackageSpec(spec)) reason = 'The package name or version is not in a form this app installs';
  } else {
    reason = {
      pypi: 'A Python package: this app runs only Node.js (npm) packages, so a 1 GB server does not need Python tooling',
      oci: 'A Docker image: this app does not run containers for tool services',
      nuget: 'A .NET package: this app runs only Node.js (npm) packages',
      mcpb: 'An MCP bundle (.mcpb, for desktop apps): not supported on a server',
    }[registryType] || `Package type "${registryType || 'unknown'}" is not supported here`;
  }
  return {
    registryType, identifier, version, transport, runtimeHint: clip(p?.runtimeHint, 40), spec: reason ? '' : spec,
    env: inputs(p?.environmentVariables, 'env'), args: inputs(p?.packageArguments, 'arg'), supported: !reason, reason,
  };
}

/** One registry entry ({ server, _meta } or a bare server.json) in the shape the panel and admin tools use. */
export function normalise(entry) {
  const s = entry?.server && typeof entry.server === 'object' ? entry.server : entry || {};
  const meta = entry?._meta?.['io.modelcontextprotocol.registry/official'] || s._meta?.['io.modelcontextprotocol.registry/official'] || null;
  const name = clip(s.name, 200);
  const publisher = publisherOf(name);
  const repoUrl = httpUrl(s.repository?.url);
  const repository = repoUrl ? { url: repoUrl.replace(/\.git$/, ''), subfolder: clip(s.repository?.subfolder, 200) } : null;
  const remotes = (Array.isArray(s.remotes) ? s.remotes.slice(0, 10) : []).map(remoteOf);
  const packages = (Array.isArray(s.packages) ? s.packages.slice(0, 10) : []).map(packageOf);
  const status = clip(meta?.status, 30) || '';
  const remote = remotes.findIndex((r) => r.supported);
  const local = packages.findIndex((p) => p.supported);
  const notes = [...remotes.filter((r) => !r.supported).map((r) => r.reason), ...packages.filter((p) => !p.supported).map((p) => p.reason)];
  return {
    name, namespace: name.split('/')[0] || '', short: name.split('/').slice(1).join('/') || name,
    title: clip(s.title, 120) || name.split('/').pop() || name, description: clip(s.description, 500), version: clip(s.version, 60),
    websiteUrl: httpUrl(s.websiteUrl), repository, publisher, remotes, packages,
    status, publishedAt: clip(meta?.publishedAt, 40), updatedAt: clip(meta?.updatedAt, 40), official: !!meta,
    trust: trustOf(s, publisher, repository, remotes, status),
    can: { remote: remote >= 0 ? remote : null, local: local >= 0 ? local : null, any: remote >= 0 || local >= 0,
      reason: remote >= 0 || local >= 0 ? '' : [...new Set(notes)].join('. ') || 'Nothing in this entry can be run here' },
    auth: authHint(remotes[remote] || null, packages[local] || null),
  };
}

function authHint(remote, pkg) {
  const secrets = [...(remote?.headers || []), ...(remote?.variables || []), ...(pkg?.env || []), ...(pkg?.args || [])].filter((i) => i.secret || /authorization|token|key|secret|password/i.test(i.name));
  if (secrets.length) return { needed: true, how: 'key', text: `Needs ${secrets.map((i) => i.name).slice(0, 3).join(', ')}` };
  if (remote) return { needed: null, how: 'check', text: 'Sign-in checked when added' };
  return { needed: false, how: 'none', text: 'No keys needed' };
}

// ---------- search ----------
/** { items, nextCursor } — latest versions matching `q` (name substring, as the registry searches). */
export async function searchRegistry({ q = '', limit = 20, cursor = '' } = {}) {
  const n = Math.max(1, Math.min(50, Math.round(Number(limit)) || 20));
  const data = await registryGet('/v0.1/servers', { search: String(q || '').trim().slice(0, 100), version: 'latest', limit: n, cursor: String(cursor || '').slice(0, 300) });
  const items = (Array.isArray(data?.servers) ? data.servers : []).map(normalise).filter((x) => x.name);
  return { items, nextCursor: clip(data?.metadata?.nextCursor, 300) || null, registry: registrySettings().effective };
}

/** One entry by its registry name (latest version, or `version`). */
export async function getRegistryServer(name, version = 'latest') {
  const n = String(name || '').trim();
  if (!/^[A-Za-z0-9.-]{1,120}\/[A-Za-z0-9._-]{1,120}$/.test(n)) throw fail('Registry name must look like io.github.owner/server');
  const v = String(version || 'latest').trim();
  if (!/^[A-Za-z0-9.+_-]{1,60}$/.test(v)) throw fail('Version is not valid');
  return normalise(await registryGet(`/v0.1/servers/${encodeURIComponent(n)}/versions/${encodeURIComponent(v)}`));
}

// ---------- add: registry entry → tool-service config ----------
/** A tool-service name from the registry name: lowercase letters, digits and _, not a built-in name. */
export function suggestKey(name) {
  let k = String(name || '').split('/').pop().toLowerCase().replace(/(^|[-_.])(mcp|server)(?=$|[-_.])/g, '$1').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(k)) k = `mcp_${k}`;
  k = k.slice(0, 31).replace(/_+$/, '') || 'mcp';
  if (RESERVED_SERVER_KEYS.includes(k)) k = `${k}_mcp`;
  return k;
}
const secretName = (key, field) => `${key}_${field}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^[^A-Z]+/, '').replace(/_+$/, '').slice(0, 64) || 'MCP_SECRET';
const fieldId = (i) => `${i.kind}:${i.name}`;
const placeholders = (s) => [...String(s || '').matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((m) => m[1]);

/**
 * The fields the owner fills in for one way of running an entry. Each: { id, kind, name, label, description, required,
 * secret, default, choices, secretName }. Secret values are stored as secrets; the config only references them.
 */
export function addFields(entry, kind, key) {
  const out = [];
  const push = (i, extra = {}) => out.push({ id: fieldId(i), kind: i.kind, name: i.name, label: i.name, description: i.description, required: i.required,
    secret: i.secret, default: i.default, choices: i.choices, format: i.format, placeholder: i.placeholder, ...(i.secret ? { secretName: secretName(key, i.name) } : {}), ...extra });
  if (kind === 'remote') {
    const r = entry.remotes[entry.can.remote];
    for (const v of r.variables) push(v);
    for (const h of r.headers) {
      const holes = placeholders(h.value);
      // A fixed header value ("X-Client: duniya") needs nothing from the owner.
      if (h.value && !holes.length) continue;
      push(h, { template: h.value || '', secret: h.secret || /^authorization$/i.test(h.name), ...(h.secret || /^authorization$/i.test(h.name) ? { secretName: secretName(key, h.name) } : {}) });
    }
  } else {
    const p = entry.packages[entry.can.local];
    for (const e of p.env) { if (e.value && !placeholders(e.value).length) continue; push(e); }
    for (const a of p.args) { if (a.value && !placeholders(a.value).length) continue; if (!a.name && a.type !== 'positional') continue; push(a.name ? a : { ...a, name: `arg${p.args.indexOf(a) + 1}` }); }
  }
  return out;
}

/** May a local package from the registry be added here? The same rule as every other path (055). */
export const localRegistryCheck = localServiceCheck;

/**
 * Build the tool-service config for `entry` run as `kind` ('remote' | 'local') under the name `key`.
 * values: { [field id]: text } from the owner. Returns { config, secrets: [{ name, value }], missing: [labels], warnings }.
 * Secret values are only ever returned in `secrets` (to store); the config holds ${NAME} references.
 */
export function buildConfig(entry, kind, key, values = {}) {
  if (kind !== 'remote' && kind !== 'local') throw fail('Choose hosted (remote) or local');
  const idx = kind === 'remote' ? entry.can.remote : entry.can.local;
  if (idx === null || idx === undefined) {
    throw fail(kind === 'remote' ? 'This entry has no hosted address this app can use' : `This entry has no package this app can run here${entry.can.reason ? `: ${entry.can.reason}` : ''}`);
  }
  const fields = addFields(entry, kind, key);
  const secrets = []; const missing = []; const warnings = [];
  const val = (f) => {
    const v = values?.[f.id];
    const s = v === undefined || v === null ? '' : String(v).trim();
    if (s.length > 4000) throw fail(`${f.label}: too long`);
    if (/[\r\n]/.test(s) && f.kind === 'header') throw fail(`${f.label}: must be one line`);
    return s;
  };
  /** The text to use for a field: a ${SECRET} reference for secrets, else the plain value (or its default). */
  const resolve = (f, render = (s) => s) => {
    const given = val(f);
    if (f.secret) {
      if (given) { secrets.push({ name: f.secretName, value: render(given) }); return `\${${f.secretName}}`; }
      if (getSecret(f.secretName)) return `\${${f.secretName}}`; // already stored (added before)
      if (f.required) missing.push(f.label);
      return '';
    }
    const v = given || f.default || '';
    if (!v && f.required) missing.push(f.label);
    return v ? render(v) : '';
  };

  if (kind === 'remote') {
    const r = entry.remotes[idx];
    const byId = new Map(fields.map((f) => [f.id, f]));
    let url = r.url;
    for (const v of r.variables) {
      const got = resolve(byId.get(fieldId(v)));
      url = url.split(`{${v.name}}`).join(got && !got.startsWith('${') ? encodeURIComponent(got) : got);
    }
    if (/\{[^}]+\}/.test(url) && !missing.length) missing.push(...placeholders(url));
    const headers = {};
    let auth = 'none'; let token = '';
    for (const h of r.headers) {
      const f = byId.get(fieldId(h));
      const template = h.value || '';
      if (!f) { if (!/^authorization$/i.test(h.name)) headers[h.name] = template; continue; }
      const fill = (x) => (template ? template.replace(/\{[A-Za-z0-9_.-]+\}/g, x) : x);
      if (/^authorization$/i.test(h.name)) {
        // The app sends "Authorization: Bearer <token>" itself: store only the token part.
        if (template && !/^bearer\s+\{[^}]+\}$/i.test(template)) { warnings.push(`The ${h.name} header has a form this app does not send (${template}); ask the publisher for a Bearer token`); continue; }
        const ref = resolve(f, (x) => x.replace(/^bearer\s+/i, ''));
        if (ref) { auth = 'token'; token = ref; }
        continue;
      }
      const ref = resolve(f, fill);
      if (ref) headers[h.name] = ref;
    }
    return { config: { type: 'remote', url, auth, tokens: { organizer: token, participant: '' }, headers }, secrets, missing, warnings, fields };
  }

  const p = entry.packages[idx];
  const byId = new Map(fields.map((f) => [f.id, f]));
  const env = {};
  for (const e of p.env) {
    const f = byId.get(fieldId(e));
    const v = f ? resolve(f) : e.value;
    if (v) env[e.name] = v;
  }
  const args = [];
  p.args.forEach((a, i) => {
    const f = byId.get(fieldId(a.name ? a : { ...a, name: `arg${i + 1}` }));
    const v = f ? resolve(f) : a.value;
    if (a.type === 'named') {
      const flag = a.name.startsWith('-') ? a.name : `--${a.name}`;
      if (a.format === 'boolean') { if (/^(true|yes|1|on)$/i.test(v)) args.push(flag); } else if (v) args.push(flag, v);
    } else if (v) args.push(v);
  });
  return { config: { type: 'local', package: p.spec, args, env, allowScripts: false }, secrets, missing, warnings, fields };
}

// ---------- after adding: tool defaults ----------
const RISKY_VERB = /(^|[_.-])(delete|remove|drop|destroy|purge|erase|send|pay|charge|purchase|buy|transfer|refund|write|update|create|edit|set|put|post|publish|invite|cancel|move|rename|upload|execute|exec|run|kill|merge|push|deploy|book|assign|approve|reject|revoke|grant)([_.-]|$)/i;
/** Does a tool change things? MCP annotations first (destructive / read-only), else its name. */
export function isRisky(t) {
  const a = t?.annotations || {};
  if (a.destructiveHint === true) return true;
  if (a.readOnlyHint === true) return false;
  return RISKY_VERB.test(String(t?.name || ''));
}
/** The preview → confirm pattern of 010/the confirm gate: "<key>:*_preview" tools plus a "confirm" tool. */
export function confirmGateFor(key, tools) {
  const names = tools.map((t) => t.name);
  return names.some((n) => /_preview$/.test(n)) && names.includes('confirm') ? { preview: `${key}:*_preview`, tool: `${key}:confirm` } : null;
}
export const validKey = (k) => SERVER_KEY_RE.test(k) && !RESERVED_SERVER_KEYS.includes(k);
