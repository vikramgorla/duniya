// Web address & access (031, 036). The app only writes a JSON request; the root helper validates it again with its own
// copy of webconfig.mjs, renders the Caddyfile, reloads Caddy and rolls back if HTTPS does not come up.
//
// 036:
// - A domain "leads here" when DNS points straight to this server, or when a one-time proof served by this app at
//   /.well-known/duniya-check/<token> can be fetched through the public domain (any proxy/CDN). DNS is only a hint.
// - Addresses behind a proxy get Let's Encrypt through the proxy with Caddy's internal CA as fallback. A proxy that
//   talks plain HTTP to this server ("Flexible") is detected and reported as a blocking error; it is never supported.
// - Safe switching: a new domain is added next to the current address; the owner confirms from the new address, then
//   may turn the old one off. Restricting access is a trial that reverts by itself unless the owner confirms it
//   through the new rule within 10 minutes.
// - Origin lock-down to a proxy/CDN's published address list (Bunny CDN, Cloudflare, Amazon CloudFront, Fastly,
//   Gcore, or own ranges), refreshed daily.
import dns from 'node:dns/promises';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { env, fail } from './config.js';
import { getSetting, updateSettings } from './store.js';
import { activity, recordFailure } from './events.js';
import { OPS_STATE_DIR, OPS_WEBCONFIG, opsAvailable, opsStatus, requestOp } from './system.js';
import {
  normalizeDomain, parseCidr, ipInRanges, validateWebConfig, renderCaddyfile, CLOUDFLARE_V4, CLOUDFLARE_V6, isIp, PROVIDERS,
} from '../../deploy/ops/webconfig.mjs';

export { PROVIDERS };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const TRIAL_MS = Number(process.env.DUNIYA_ACCESS_TRIAL_MS || 10 * 60000);

// ---------- settings ----------
// ranges: { <provider>: { list, at } } downloaded address lists; customRanges: the owner's own proxy ranges;
// switch: { phase: added|confirmed, newHost, oldHost, applying, requestedAt }; trial: { revert, requestedAt, until }.
const DEFAULTS = { proxy: null, allow: [], alwaysAllowMine: true, customRanges: [], ranges: {}, switch: null, trial: null, lastRevert: null, lastRequest: null };
export const webSettings = () => ({ ...DEFAULTS, ...(getSetting('webAccess', {}) || {}) });
const saveWeb = (patch) => updateSettings({ webAccess: { ...webSettings(), ...patch } });

// ---------- proxy / CDN address lists ----------
const envUrl = (k, d) => process.env[k] || d;
const RANGE_SOURCES = {
  // Official lists (checked November 2026): see specs/036-proxies-and-safe-switching/research.md
  bunny: async (get) => [...await get(envUrl('DUNIYA_RANGES_BUNNY_V4', 'https://bunnycdn.com/api/system/edgeserverlist'), 'json'),
    ...await get(envUrl('DUNIYA_RANGES_BUNNY_V6', 'https://bunnycdn.com/api/system/edgeserverlist/IPv6'), 'json')],
  cloudflare: async (get) => [...await get(envUrl('DUNIYA_RANGES_CLOUDFLARE_V4', 'https://www.cloudflare.com/ips-v4'), 'text'),
    ...await get(envUrl('DUNIYA_RANGES_CLOUDFLARE_V6', 'https://www.cloudflare.com/ips-v6'), 'text')],
  cloudfront: async (get) => {
    const j = await get(envUrl('DUNIYA_RANGES_CLOUDFRONT', 'https://ip-ranges.amazonaws.com/ip-ranges.json'), 'raw');
    return [...(j.prefixes || []).filter((p) => p.service === 'CLOUDFRONT').map((p) => p.ip_prefix),
      ...(j.ipv6_prefixes || []).filter((p) => p.service === 'CLOUDFRONT').map((p) => p.ipv6_prefix)];
  },
  fastly: async (get) => { const j = await get(envUrl('DUNIYA_RANGES_FASTLY', 'https://api.fastly.com/public-ip-list'), 'raw'); return [...(j.addresses || []), ...(j.ipv6_addresses || [])]; },
  gcore: async (get) => { const j = await get(envUrl('DUNIYA_RANGES_GCORE', 'https://api.gcore.com/cdn/public-net-list'), 'raw'); return [...(j.addresses || []), ...(j.addresses_v6 || [])]; },
};
async function download(u, kind) {
  const r = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { accept: kind === 'text' ? 'text/plain' : 'application/json' } });
  if (!r.ok) throw new Error(`${new URL(u).host} answered ${r.status}`);
  if (kind === 'text') return (await r.text()).split(/\s+/).filter(Boolean);
  const j = await r.json();
  if (kind === 'json' && !Array.isArray(j)) throw new Error('unexpected list');
  return j;
}
/** The address list for a provider: downloaded (daily), Cloudflare's built-in until then, or the owner's own. */
function proxyRanges(id) {
  const s = webSettings();
  if (id === 'custom') return s.customRanges || [];
  const r = s.ranges?.[id]?.list;
  if (r?.length) return r;
  return id === 'cloudflare' ? [...CLOUDFLARE_V4, ...CLOUDFLARE_V6] : [];
}
export async function refreshRanges(id) {
  if (!RANGE_SOURCES[id]) throw fail('Choose a proxy / CDN that publishes its addresses', 400, { field: 'proxy' });
  const raw = await RANGE_SOURCES[id](download);
  const list = [];
  for (const x of raw) { const c = parseCidr(x).text; if (!list.includes(c)) list.push(c); }
  if (list.length < 3) throw fail(`${PROVIDERS[id].name} returned an unexpected list`);
  const before = proxyRanges(id).join(' ');
  saveWeb({ ranges: { ...webSettings().ranges, [id]: { list, at: Date.now() } } });
  const changed = before !== list.join(' ');
  const applied = appliedConfig();
  if (changed && applied?.access?.proxy === id && availability().ok && !webSettings().trial) {
    try {
      requestOp('apply-web-config', `daily ${PROVIDERS[id].name} update`, { files: { 'web-config.json': JSON.stringify(makeDoc(current(), { by: `daily ${PROVIDERS[id].name} update` })) } });
      activity('config', { summary: `${PROVIDERS[id].name} published new addresses (${list.length}): web server updated` });
    } catch { /* busy: next day */ }
  }
  return { count: list.length, changed };
}
/** Which provider's published addresses contain `ip` (Cloudflare always known; others once downloaded). */
export function providerOf(ip) {
  for (const id of Object.keys(PROVIDERS)) { const r = proxyRanges(id); if (r.length && ipInRanges(ip, r)) return id; }
  return null;
}

// ---------- where are we ----------
const exposure = () => process.env.DUNIYA_EXPOSURE || (/\.sslip\.io$/.test(currentHost()) ? 'ip' : currentHost() ? 'domain' : 'local');
function currentHost() {
  try { return new URL(String(process.env.PUBLIC_URL || '')).hostname; } catch { return ''; }
}
let ipCache = null;
/** This server's public IPv4: DUNIYA_PUBLIC_IP, the sslip.io name, or a lookup (cached for an hour). */
export async function publicIp() {
  if (process.env.DUNIYA_PUBLIC_IP) return process.env.DUNIYA_PUBLIC_IP;
  const m = currentHost().match(/^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.sslip\.io$/);
  if (m) return m.slice(1).join('.');
  if (ipCache && Date.now() - ipCache.at < 3600000) return ipCache.ip;
  for (const u of ['https://api.ipify.org', 'https://ifconfig.me/ip']) {
    try {
      const ip = (await (await fetch(u, { signal: AbortSignal.timeout(5000) })).text()).trim();
      if (isIp(ip)) { ipCache = { ip, at: Date.now() }; return ip; }
    } catch { /* next */ }
  }
  throw fail('Could not find this server\'s public IP address');
}

/** Can this install change its address from the panel? */
export function availability() {
  const ex = exposure();
  if (process.env.DUNIYA_INSTALL === 'docker') return { ok: false, reason: 'docker', text: 'In Docker, set DOMAIN in the .env file and start the https profile (see docs/deploy/docker.md).' };
  if (ex === 'tailscale') return { ok: false, reason: 'tailscale', text: `This panel is reached through Tailscale${currentHost() ? ` at https://${currentHost()}` : ''}: only devices signed in to your tailnet can open it, and no ports are open, so no domain or allow-list is needed. To use a public domain instead, re-run the installer with --domain or --ip-https.` };
  if (ex === 'tunnel') return { ok: false, reason: 'tunnel', text: 'This panel is reached through a Cloudflare Tunnel: the address is set in Cloudflare (Zero Trust → Networks → Tunnels → Public hostname), and no ports are open, so no allow-list is needed.' };
  if (ex === 'local') return { ok: false, reason: 'local', text: 'This panel is only reachable on the server itself. Re-run the installer with --ip-https or --domain to put it online first.' };
  if (!opsAvailable()) return { ok: false, reason: 'helper', text: 'Server maintenance is not set up on this install. Re-run the installer once (or redeploy) to enable it.' };
  if (!existsSync(OPS_WEBCONFIG)) return { ok: false, reason: 'helper-old', text: 'This server needs a one-time update to change its address from here: re-run the installer once (it keeps your data and settings).' };
  return { ok: true };
}

// ---------- DNS ----------
async function resolveAll(domain) {
  if (process.env.DUNIYA_FAKE_DNS) return JSON.parse(process.env.DUNIYA_FAKE_DNS)[domain] || []; // tests only
  const [v4, v6] = await Promise.all([dns.resolve4(domain).catch(() => []), dns.resolve6(domain).catch(() => [])]);
  return [...v4, ...v6];
}

// ---------- reachability check ----------
const checks = new Map(); // token → { proof, host, exp, scheme }
/** Answers /.well-known/duniya-check/<token> (the proof) and Caddy's on-demand "ask" for the domain being checked. */
export function domainCheckResponse(url, req) {
  const now = Date.now();
  for (const [k, v] of checks) if (v.exp < now) checks.delete(k);
  if (url.pathname === '/.well-known/duniya-check-ask') {
    // Only Caddy on this machine asks (directly, not proxied); only for a domain being checked right now.
    const d = String(url.searchParams.get('domain') || '').toLowerCase();
    const local = !req.headers['x-forwarded-for'] && !req.headers['x-duniya-client-ip'] && /^(127\.|::1$|::ffff:127\.)/.test(req.socket?.remoteAddress || '');
    return local && [...checks.values()].some((c) => c.host === d) ? { status: 200, body: 'ok' } : { status: 403, body: 'no' };
  }
  const m = url.pathname.match(/^\/\.well-known\/duniya-check\/([a-f0-9]{32})$/);
  const c = m && checks.get(m[1]);
  if (!c) return { status: 404, body: 'not found' };
  c.scheme = String(req.headers['x-duniya-origin-scheme'] || '');
  return { status: 200, body: c.proof };
}

function fetchOnce(url) {
  // Tests map a domain to a local address (DUNIYA_FAKE_ROUTES); the Host header and SNI stay the domain.
  const routes = process.env.DUNIYA_FAKE_ROUTES ? JSON.parse(process.env.DUNIYA_FAKE_ROUTES) : null;
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  const opts = { method: 'GET', timeout: 10000, headers: { 'user-agent': 'duniya-domain-check', accept: 'text/plain' } };
  let target = url;
  if (routes) {
    const to = routes[`${u.protocol}//${u.hostname}`] || (u.protocol === 'http:' ? routes[u.hostname] : null);
    if (!to) return Promise.resolve({ error: 'ECONNREFUSED' });
    const [h, p] = to.split(':');
    Object.assign(opts, { headers: { ...opts.headers, host: u.host }, servername: u.hostname, ...(process.env.DUNIYA_FAKE_CA ? { ca: readFileSync(process.env.DUNIYA_FAKE_CA) } : {}) });
    target = `${u.protocol}//${h}:${p}${u.pathname}`;
  }
  return new Promise((res) => {
    const req = lib.request(target, opts, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { if (body.length < 4096) body += d; });
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => res({ error: e.code || e.message }));
    req.end();
  });
}

const FLEXIBLE = 'Your proxy talks to this server without encryption (plain HTTP, e.g. Cloudflare SSL mode “Flexible”). That is not supported: set the proxy’s SSL/TLS mode to “Full (strict)” (or “Full” until the real certificate is issued), then check again.';
/** Follow one probe from `start` (http or https). */
async function follow(start, token, proof) {
  let url = start; const seen = new Set();
  for (let i = 0; i < 6; i++) {
    if (seen.has(url)) return { ok: false, flexible: true, error: `Redirect loop at ${url}. ${FLEXIBLE}` };
    seen.add(url);
    const r = await fetchOnce(url);
    if (r.error) return { ok: false, network: true, error: `could not connect to ${new URL(url).origin} (${r.error})` };
    const cdn = /cloudflare/i.test(String(r.headers.server || '')) || !!r.headers['cf-ray'];
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) { url = new URL(r.headers.location, url).href; continue; }
    if (r.status === 200 && r.body.trim() === proof) {
      const scheme = checks.get(token)?.scheme;
      // The visitor side was https but the request reached this server over plain http: the proxy does not encrypt.
      if (url.startsWith('https:') && scheme === 'http') return { ok: false, flexible: true, error: FLEXIBLE };
      return { ok: true, scheme: url.startsWith('https:') ? 'https' : 'http' };
    }
    if (cdn && [525, 526].includes(r.status)) return { ok: false, code: r.status, error: `Cloudflare could not open a secure connection to this server (error ${r.status}). Choose SSL/TLS mode “Full” for now (“Full (strict)” once the real certificate is issued), then check again.` };
    if ([521, 522, 523].includes(r.status)) return { ok: false, code: r.status, error: `The proxy cannot reach this server (error ${r.status}): check that its origin points to this server and that ports 80 and 443 are open.` };
    if (r.status === 403) return { ok: false, code: 403, error: 'The proxy blocked the check (a firewall or bot rule). Allow the path /.well-known/ for this domain in the proxy’s security settings, then check again.' };
    return { ok: false, code: r.status, error: `${new URL(url).origin} answered ${r.status}, not this server.` };
  }
  return { ok: false, error: 'too many redirects' };
}
/** Does the public domain lead to this server, whatever DNS says? Tries https first (to spot an unencrypted proxy). */
async function reachability(domain) {
  const token = randomBytes(16).toString('hex');
  const proof = randomBytes(24).toString('hex');
  checks.set(token, { proof, host: domain, exp: Date.now() + 60000 });
  try {
    const viaHttps = await follow(`https://${domain}/.well-known/duniya-check/${token}`, token, proof);
    if (viaHttps.ok || viaHttps.flexible) return viaHttps;
    const viaHttp = await follow(`http://${domain}/.well-known/duniya-check/${token}`, token, proof);
    return viaHttp.ok || viaHttp.flexible ? viaHttp : { ...viaHttp, httpsError: viaHttps.error };
  } finally { checks.delete(token); }
}

/**
 * Does `domain` lead to this server? DNS straight here is enough (as before); otherwise the reachability check decides.
 * dns hint: direct | proxy (with `provider` when the address is in a known list) | other | missing.
 */
export async function checkDomain(input) {
  const domain = normalizeDomain(input);
  const ip = await publicIp().catch(() => '');
  const addresses = await resolveAll(domain);
  const record = { type: ip.includes(':') ? 'AAAA' : 'A', name: domain, value: ip || 'this server\'s public IP' };
  const provider = addresses.length ? providerOf(addresses[0]) : null;
  const dnsHint = !addresses.length ? 'missing' : ip && addresses.includes(ip) ? 'direct' : provider ? 'proxy' : 'other';
  const reach = dnsHint === 'missing' ? { ok: false, error: 'no DNS record' } : await reachability(domain);
  const looks = provider ? ` (looks like ${PROVIDERS[provider].name})` : '';
  let state; let text;
  if (reach.flexible) { state = 'flexible'; text = reach.error; }
  else if (dnsHint === 'direct') { state = 'ok'; text = `${domain} points straight to this server. HTTPS: a free Let’s Encrypt certificate.`; }
  else if (reach.ok) {
    state = 'proxied';
    text = `${domain} reaches this server through a proxy or CDN${looks}. HTTPS is set up automatically: the proxy can connect encrypted at once (SSL/TLS mode “Full”), and “Full (strict)” works once the real certificate is issued — the card shows when.`;
  } else if (dnsHint === 'missing') { state = 'missing'; text = `${domain} does not exist in DNS yet. Create this record at your DNS provider (or point your proxy/CDN to this server), wait a minute, then check again.`; }
  else { state = 'wrong'; text = `${domain} points to ${addresses.slice(0, 3).join(', ')}${looks}, not to this server${ip ? ` (${ip})` : ''}, and the check through the domain did not reach it: ${reach.error}`; }
  return { domain, ok: state === 'ok' || state === 'proxied', state, text, dns: dnsHint, provider, reach, addresses, serverIp: ip, record, behindProxy: state === 'proxied' };
}

// ---------- certificate ----------
/** The certificate this server presents for `host` (asks the local web server on 443). */
function certInfo(host, { port = Number(process.env.DUNIYA_TLS_PORT || 443), timeout = 4000 } = {}) {
  if (!host) return Promise.resolve({ state: 'none' });
  return new Promise((res) => {
    // Verified handshake only: a certificate that does not validate for `host` is reported as invalid with the reason.
    const s = tls.connect({ host: '127.0.0.1', port, servername: host, timeout }, () => {
      const c = s.getPeerCertificate();
      const validTo = c?.valid_to ? Date.parse(c.valid_to) : 0;
      s.end();
      res({ state: 'valid', issuer: c?.issuer?.O || c?.issuer?.CN || '', validTo, daysLeft: validTo ? Math.floor((validTo - Date.now()) / 86400000) : null, error: '' });
    });
    s.on('error', (e) => {
      const code = e.code || e.message;
      const network = ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(e.code);
      if (network) return res({ state: 'none', error: code });
      // Caddy's internal fallback (036): encrypted, but only a proxy in "Full" mode accepts it. Verified against
      // Caddy's own local root (the root helper exports its public certificate), never with validation switched off.
      let caddyRoot = null;
      try { caddyRoot = readFileSync(process.env.DUNIYA_CADDY_ROOT || `${OPS_STATE_DIR}/caddy-local-root.crt`); } catch { /* not exported (yet) */ }
      if (!caddyRoot) return res({ state: 'invalid', issuer: '', validTo: 0, daysLeft: null, error: String(code) });
      const u = tls.connect({ host: '127.0.0.1', port, servername: host, timeout, ca: caddyRoot }, () => {
        const c = u.getPeerCertificate();
        u.end();
        const validTo = c?.valid_to ? Date.parse(c.valid_to) : 0;
        res({ state: 'temporary', issuer: c?.issuer?.CN || c?.issuer?.O || 'Caddy Local Authority', validTo, daysLeft: null, error: String(code) });
      });
      u.on('error', () => res({ state: 'invalid', issuer: '', validTo: 0, daysLeft: null, error: String(code) }));
      u.on('timeout', () => { u.destroy(); res({ state: 'invalid', issuer: '', validTo: 0, daysLeft: null, error: String(code) }); });
    });
    s.on('timeout', () => { s.destroy(); res({ state: 'none', error: 'timeout' }); });
  });
}

/**
 * Why Let's Encrypt has not issued a certificate for `host` yet (behind a proxy), from the web server's log, with the
 * fix in plain words. null when the log shows no recent failure.
 */
async function acmeProblem(host) {
  const text = process.env.DUNIYA_FAKE_CADDY_LOG !== undefined ? (() => { try { return readFileSync(process.env.DUNIYA_FAKE_CADDY_LOG, 'utf8'); } catch { return ''; } })()
    : await new Promise((res) => execFile('journalctl', ['-u', 'caddy', '-n', '400', '--since', '-6h', '--no-pager', '-o', 'cat'], { timeout: 8000, maxBuffer: 4 << 20 }, (e, out) => res(String(out || ''))));
  let last = null;
  for (const line of text.split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.identifier !== host && !(j.identifiers || []).includes(host)) continue;
    if (j.level === 'error' && /tls\.(obtain|issuance)/.test(j.logger || '') && !/internal/i.test(j.issuer || '')) last = j;
    if (/certificate obtained successfully/i.test(j.msg || '') && /acme/i.test(j.issuer || '')) last = null;
  }
  if (!last) return null;
  const err = String(last.error || last.msg || '').replace(/\s+/g, ' ');
  const at = last.ts ? Math.round(last.ts * 1000) : null;
  let kind = 'other'; let fix = 'Let’s Encrypt retries automatically about every 80 minutes. Until then Cloudflare must use SSL/TLS mode “Full”.';
  if (/acme-challenge|unauthorized|403|forbidden|Invalid response/i.test(err)) {
    kind = 'blocked';
    fix = 'Let’s Encrypt could not read /.well-known/acme-challenge/ through the proxy: a security rule probably blocks it. In Cloudflare → Security → WAF → Custom rules → Create rule: Field “URI Path”, Operator “starts with”, Value “/.well-known/acme-challenge/”, Action “Skip” (tick all remaining custom rules, and Super Bot Fight Mode / managed rules if offered), Deploy. Also turn off “I’m Under Attack” mode and make sure no redirect or Worker changes that path. The next attempt is automatic (within about 80 minutes).';
  } else if (/timeout|connection refused|connect:|no such host|NXDOMAIN|dns problem/i.test(err)) {
    kind = 'unreachable';
    fix = 'Let’s Encrypt could not reach this server through the domain. Check that the DNS record points to this server (proxied is fine) and that ports 80 and 443 are open.';
  } else if (/rateLimited|too many/i.test(err)) {
    kind = 'rate-limited';
    fix = 'Let’s Encrypt limits failed attempts per hour; the web server tries again later by itself.';
  }
  return { kind, error: err.slice(0, 300), at, fix };
}


// ---------- status of the last apply (written by the helper) ----------
const webStatus = () => readJson(`${OPS_STATE_DIR}/web-status.json`);
const appliedConfig = () => readJson(`${OPS_STATE_DIR}/web-applied.json`);
let syncedAt = 0;
/**
 * After the helper finished: use the new address in this process (app.env has it after a restart), and move the
 * domain switch / access trial on (or back, when the helper rolled back).
 */
function syncFromHelper() {
  const st = webStatus();
  if (!st?.at || st.at <= syncedAt || ['running', 'waiting'].includes(st.state)) return false;
  syncedAt = st.at;
  const s = webSettings();
  const ok = st.state === 'done';
  if (s.switch?.applying && st.at >= s.switch.requestedAt) {
    const sw = { ...s.switch, applying: null };
    const step = s.switch.applying;
    if (ok) saveWeb({ switch: step === 'finish' || step === 'cancel' ? null : { ...sw, phase: step === 'add' ? 'added' : 'confirmed' } });
    else saveWeb({ switch: step === 'add' ? null : step === 'confirm' ? { ...sw, phase: 'added' } : sw });
  }
  const t = webSettings().trial;
  if (t && !t.until && st.at >= t.requestedAt) saveWeb({ trial: ok ? { ...t, until: Date.now() + TRIAL_MS } : null });
  if (!ok) return false;
  const applied = appliedConfig();
  if (!applied?.host) return false;
  try {
    const cfg = validateWebConfig(applied);
    process.env.PUBLIC_URL = `https://${cfg.host}`;
    process.env.TRUST_PROXY = '1';
    env.trustProxy = true;
    return true;
  } catch { return false; }
}

// ---------- building requests ----------
/** What is served now (the last applied config), or the installer's address when nothing was applied yet. */
export function current() {
  const a = appliedConfig();
  if (a?.host) {
    try {
      const c = validateWebConfig(a);
      return { host: c.host, aliases: c.aliases, redirectHosts: c.redirectHosts, proxiedHosts: c.proxiedHosts, access: c.access };
    } catch { /* fall through */ }
  }
  return { host: currentHost(), aliases: [], redirectHosts: [], proxiedHosts: [], access: { proxy: null, allow: [] } };
}
/** The request for the helper from a target state. Throws (400, field) when something is invalid. */
function makeDoc(t, { by = '' } = {}) {
  const proxy = t.access?.proxy || null;
  const doc = {
    version: 1, host: t.host, aliases: t.aliases || [], redirectHosts: t.redirectHosts || [], proxiedHosts: t.proxiedHosts || [],
    serverIp: t.serverIp ?? null, port: env.panelPort >= 1024 ? env.panelPort : 8080,
    access: { proxy, allow: t.access?.allow || [] }, proxyRanges: proxy ? proxyRanges(proxy) : [],
    requestedBy: String(by).slice(0, 60), requestedAt: Date.now(),
  };
  if (doc.serverIp && !isIp(doc.serverIp)) doc.serverIp = null;
  if (proxy && !doc.proxyRanges.length) {
    throw fail(proxy === 'custom' ? 'Enter your proxy’s address ranges first' : `The address list of ${PROVIDERS[proxy].name} has not been downloaded yet: click “Update list” and try again`, 400, { field: 'proxy' });
  }
  validateWebConfig(doc); // same checks the helper runs
  return doc;
}
const send = (doc, by, summary) => {
  requestOp('apply-web-config', by || '', { files: { 'web-config.json': JSON.stringify(doc) } });
  if (summary) activity('config', { summary });
};
function ensureFree() {
  syncFromHelper();
  const av = availability();
  if (!av.ok) throw fail(av.text);
  const cur = opsStatus().status;
  if (cur?.state === 'running') throw fail(`Please wait: ${cur.action} is still running`, 409);
}
const viaCaddy = (req) => !!(env.trustProxy && req.headers['x-duniya-client-ip']);
const reqHost = (req) => String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();

/** Preview: the Caddyfile a target would produce. */
export async function preview(body) {
  const t = { ...current(), serverIp: await publicIp().catch(() => null) };
  if (body.proxy !== undefined || body.allow !== undefined) t.access = { proxy: body.proxy || null, allow: (body.allow || []).map((x) => parseCidr(x).text) };
  return renderCaddyfile(makeDoc(t), { caddyVersion: '2.8.0' });
}

/**
 * Step 1 of a domain change: the new domain is added next to the current address (both work). Refused while DNS /
 * reachability say it does not lead here.
 */
export async function addDomain(input, { user } = {}) {
  ensureFree();
  const s = webSettings();
  if (s.switch) throw fail(s.switch.phase === 'added' ? `Finish or cancel the switch to ${s.switch.newHost} first` : 'Turn off the old address or cancel the switch first', 409);
  const domain = normalizeDomain(input);
  const cur = current();
  if (domain === cur.host || cur.aliases.includes(domain)) throw fail(`${domain} is already in use`, 400, { field: 'domain' });
  const chk = await checkDomain(domain);
  if (!chk.ok) throw fail(chk.text, 400, { field: 'domain', check: chk });
  const t = {
    ...cur, serverIp: await publicIp().catch(() => null), aliases: [...cur.aliases, domain].slice(-4), redirectHosts: cur.redirectHosts.filter((h) => h !== domain),
    proxiedHosts: chk.behindProxy ? [...cur.proxiedHosts, domain] : cur.proxiedHosts.filter((h) => h !== domain),
  };
  const doc = makeDoc(t, { by: user?.username });
  saveWeb({ switch: { phase: 'adding', applying: 'add', newHost: domain, oldHost: cur.host, requestedAt: Date.now(), by: user?.username || '' } });
  send(doc, user?.username, `Web address: added ${domain}${chk.behindProxy ? ' (behind a proxy)' : ''} next to ${cur.host} (${user?.username || '?'})`);
  return { ok: true, host: domain, check: chk };
}
/** Step 2: confirmed from a request that really arrived through the new domain → it becomes the main address. */
export function confirmSwitch(req, { user } = {}) {
  ensureFree();
  const sw = webSettings().switch;
  if (sw?.phase !== 'added') throw fail('There is no new address waiting for confirmation', 409);
  if (reqHost(req) !== sw.newHost || !viaCaddy(req)) throw fail(`Open the panel at https://${sw.newHost} and confirm there: that proves the new address works.`, 400, { openUrl: `https://${sw.newHost}` });
  const cur = current();
  const t = { ...cur, host: sw.newHost, aliases: [sw.oldHost, ...cur.aliases.filter((h) => h !== sw.newHost && h !== sw.oldHost)].filter(Boolean) };
  const doc = makeDoc(t, { by: user?.username });
  saveWeb({ switch: { ...sw, applying: 'confirm', requestedAt: Date.now() } });
  send(doc, user?.username, `Web address: ${sw.newHost} confirmed by ${user?.username || '?'} and is now the main address (${sw.oldHost} still works)`);
  return { ok: true, host: sw.newHost };
}
/** Step 3 (optional, confirmed in the panel): the old address stops serving the panel and only forwards. */
export function finishSwitch({ user } = {}) {
  ensureFree();
  const sw = webSettings().switch;
  if (sw?.phase !== 'confirmed') throw fail('Confirm the new address first', 409);
  const cur = current();
  const t = { ...cur, aliases: cur.aliases.filter((h) => h !== sw.oldHost), redirectHosts: [...cur.redirectHosts.filter((h) => h !== sw.oldHost), sw.oldHost].filter(Boolean).slice(-4) };
  const doc = makeDoc(t, { by: user?.username });
  saveWeb({ switch: { ...sw, applying: 'finish', requestedAt: Date.now() } });
  send(doc, user?.username, `Web address: old address ${sw.oldHost} turned off (forwards to ${sw.newHost}) by ${user?.username || '?'}`);
  return { ok: true };
}
/** Go back: drop the new domain (before or after confirming) and keep the old address as the main one. */
export function cancelSwitch({ user } = {}) {
  ensureFree();
  const sw = webSettings().switch;
  if (!sw || sw.applying) throw fail('Nothing to cancel', 409);
  const cur = current();
  const t = { ...cur, host: sw.oldHost || cur.host, aliases: cur.aliases.filter((h) => h !== sw.newHost && h !== sw.oldHost), proxiedHosts: cur.proxiedHosts.filter((h) => h !== sw.newHost) };
  const doc = makeDoc(t, { by: user?.username });
  saveWeb({ switch: { ...sw, applying: 'cancel', requestedAt: Date.now() } });
  send(doc, user?.username, `Web address: switch to ${sw.newHost} cancelled by ${user?.username || '?'}; ${sw.oldHost} stays`);
  return { ok: true };
}

/** The proxy / CDN the panel is locked to (null: none) and, for a custom one, its address ranges. */
function proxyChoice(body, s) {
  const proxy = body.proxy || null;
  if (proxy !== null && !Object.hasOwn(PROVIDERS, proxy)) throw fail('Unknown proxy / CDN', 400, { field: 'proxy' });
  let customRanges = s.customRanges;
  if (proxy === 'custom' && body.customRanges !== undefined) customRanges = [...new Set([].concat(body.customRanges).map((x) => String(x).trim()).filter(Boolean).map((x) => parseCidr(x).text))];
  if (proxy === 'custom' && !customRanges.length) throw fail('Enter your proxy’s address ranges (one per line)', 400, { field: 'customRanges' });
  return { proxy, customRanges };
}
/** The addresses that may open the panel; the asker's own is added when they keep "always allow mine". */
function allowList(body, s, ip) {
  const list = [];
  for (const x of [].concat(body.allow ?? [])) { if (String(x).trim()) list.push(parseCidr(x).text); }
  const mine = String(ip || '').trim().replace(/^::ffff:(?=\d+\.)/i, '');
  const keepMine = (body.alwaysAllowMine ?? s.alwaysAllowMine) !== false;
  if (keepMine && list.length && isIp(mine) && !ipInRanges(mine, list)) list.push(parseCidr(mine).text);
  return { allow: [...new Set(list)], keepMine };
}
const THIS_SERVER = ['127.0.0.1/8', '::1/128'];
/** Would the request that makes this change still get in afterwards? The warnings to show (none: it would). */
function lockoutWarnings({ proxy, allow, proxyRanges, req, ip }) {
  const warnings = [];
  const hop = String(req?.socket?.remoteAddress || '');
  const edge = String(req?.headers?.['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean).pop() || '';
  const throughProxy = edge && ipInRanges(edge, proxyRanges);
  const onTheServer = ipInRanges(hop, THIS_SERVER) && !req?.headers?.['x-duniya-client-ip'];
  if (proxy && !throughProxy && !onTheServer) warnings.push(`You are not using the panel through ${PROVIDERS[proxy].name} right now: afterwards it only opens through ${PROVIDERS[proxy].name}.`);
  if (allow.length && ip && !ipInRanges(ip, allow)) warnings.push(`Your current address (${ip}) is not on the list: you would lose access to the panel.`);
  return warnings;
}
/** The rule in a few words, for Activity. */
const accessWords = (proxy, allow) => `${proxy ? `only ${PROVIDERS[proxy].name}` : ''}${proxy && allow.length ? ' + ' : ''}${allow.length ? `allow-list of ${allow.length}` : ''}` || 'open to everyone';

/**
 * Change who may open the panel. Anything stricter than now is a trial: it reverts by itself unless confirmed through
 * the new rule within TRIAL_MS. Rules that would shut out the current request need `confirmLockout`.
 */
/** @param {object} body  @param {{ user?: object, ip?: string, req?: object }} [o] */
export async function setAccess(body, { user, ip = '', req } = {}) {
  ensureFree();
  const s = webSettings();
  if (s.trial) throw fail('Confirm or undo the access change that is being tried first', 409);
  const { proxy, customRanges } = proxyChoice(body, s);
  const { allow, keepMine } = allowList(body, s, ip);
  saveWeb({ customRanges });
  const cur = current();
  const access = { proxy, allow };
  const doc = makeDoc({ ...cur, serverIp: await publicIp().catch(() => null), access }, { by: user?.username });
  const cfg = validateWebConfig(doc);
  const warnings = lockoutWarnings({ proxy, allow, proxyRanges: cfg.proxyRanges, req, ip });
  if (warnings.length && !body.confirmLockout) throw fail(warnings.join(' '), 409, { needsConfirm: true, warnings });
  const stricter = (proxy && proxy !== cur.access.proxy) || allow.some((c) => !cur.access.allow.includes(c));
  saveWeb({
    proxy, allow: [].concat(body.allow ?? []).map((x) => String(x).trim()).filter(Boolean), alwaysAllowMine: keepMine,
    trial: stricter ? { revert: cur.access, requestedAt: Date.now(), until: null, by: user?.username || '' } : null,
    lastRequest: { at: Date.now(), by: user?.username || '', host: cfg.host, proxy, allow },
  });
  send(doc, user?.username, `Web access: ${accessWords(proxy, allow)}${stricter ? ` (trial: reverts in ${Math.round(TRIAL_MS / 60000)} minutes unless confirmed)` : ''} (${user?.username || '?'})`);
  return { ok: true, trial: stricter, warnings };
}
/** Keep the trial: only from a request that came through the web server with the new rules in place. */
export function confirmAccess(req, { user } = {}) {
  syncFromHelper();
  const t = webSettings().trial;
  if (!t) throw fail('There is no access change to confirm', 409);
  if (!t.until) throw fail('Please wait until the new rules are active', 409);
  if (!viaCaddy(req)) throw fail('Confirm from the panel’s public address (through the new rules), not from the server itself', 400);
  saveWeb({ trial: null });
  activity('config', { summary: `Web access change confirmed by ${user?.username || '?'} from ${req.headers['x-duniya-client-ip']}` });
  return { ok: true };
}
/** Undo a trial now (or automatically when it was not confirmed in time). */
export function revertAccess(by = 'automatic undo') {
  const s = webSettings();
  if (!s.trial) return false;
  const cur = current();
  const doc = makeDoc({ ...cur, access: s.trial.revert || { proxy: null, allow: [] } }, { by });
  try { requestOp('apply-web-config', by, { files: { 'web-config.json': JSON.stringify(doc) } }); } catch { return false; } // busy: next tick
  saveWeb({ trial: null, proxy: doc.access.proxy, allow: doc.access.allow, lastRevert: { at: Date.now(), by } });
  activity('config', { summary: by === 'automatic undo' ? `Web access change was not confirmed within ${Math.round(TRIAL_MS / 60000)} minutes: the previous rules were restored` : `Web access change undone (${by})` });
  return true;
}
export function trialTick() {
  syncFromHelper();
  const t = webSettings().trial;
  if (t?.until && Date.now() > t.until && availability().ok) revertAccess();
}

/** Recovery (CLI `duniya open-access`): keep the address, drop every IP restriction and any trial. */
export async function openAccess(by = 'server command line') {
  saveWeb({ proxy: null, allow: [], trial: null });
  const av = availability();
  if (!av.ok) return { requested: false, message: `No restrictions are stored any more. ${av.text}` };
  const cur = current();
  if (!cur.host) return { requested: false, message: 'No public address is set up, so there was nothing to open.' };
  send(makeDoc({ ...cur, serverIp: await publicIp().catch(() => null), access: { proxy: null, allow: [] } }, { by }), by, `Web access opened to everyone (allow-list removed) from the ${by}`);
  return { requested: true, host: cur.host };
}

// ---------- proxy health (unencrypted proxies) ----------
const health = new Map(); // host → { ok, flexible, error, at }
async function checkProxied() {
  for (const h of current().proxiedHosts) {
    const r = await reachability(h).catch((e) => ({ ok: false, error: e.message }));
    const was = health.get(h);
    health.set(h, { ok: !!r.ok, flexible: !!r.flexible, error: r.ok ? '' : r.error, at: Date.now() });
    if (r.flexible && !was?.flexible) activity('error', { summary: `${h}: ${FLEXIBLE}` });
  }
}

export function startWebAccess() {
  syncFromHelper();
  setInterval(trialTick, 10000).unref();
  const daily = async () => {
    const p = appliedConfig()?.access?.proxy;
    if (p && RANGE_SOURCES[p]) { try { await refreshRanges(p); } catch (e) { activity('error', { summary: `Could not refresh the address list of ${PROVIDERS[p].name}: ${e.message}` }); } }
  };
  setTimeout(daily, 60000).unref();
  setInterval(daily, 24 * 3600000).unref();
  setTimeout(() => checkProxied().catch(recordFailure('Checking the web address')), 30000).unref();
  setInterval(() => checkProxied().catch(recordFailure('Checking the web address')), 10 * 60000).unref();
}

/** Did this request come through the proxy the panel is locked to (or any known proxy)? */
function requestViaProxy(req) {
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const edge = hops.at(-1);
  if (!edge) return null;
  return providerOf(edge);
}

/** Everything the "Web address & access" card shows. */
export async function webState(req, { clientIp }) {
  syncFromHelper();
  const s = webSettings();
  const host = currentHost();
  const st = webStatus();
  const ops = opsStatus().status;
  const pending = ops?.action === 'apply-web-config' && ops.state === 'running' ? (st?.state === 'waiting' ? 'waiting' : 'running') : null;
  const applied = appliedConfig();
  const cur = current();
  const hosts = await Promise.all([cur.host, ...cur.aliases].filter(Boolean).map(async (h) => {
    const cert = await certInfo(h);
    const proxied = cur.proxiedHosts.includes(h);
    return { host: h, main: h === cur.host, proxied, cert, health: health.get(h) || null, acme: proxied && cert.state !== 'valid' ? await acmeProblem(h) : null };
  }));
  const via = requestViaProxy(req);
  return {
    availability: availability(), exposure: exposure(),
    current: { url: process.env.PUBLIC_URL || '', host }, hosts, redirectHosts: cur.redirectHosts,
    serverIp: await publicIp().catch(() => ''),
    you: { ip: clientIp(req), via: via ? PROVIDERS[via].name : null, host: reqHost(req), throughWebServer: viaCaddy(req) },
    settings: { proxy: s.proxy, allow: s.allow, alwaysAllowMine: s.alwaysAllowMine, customRanges: s.customRanges },
    applied: applied ? { host: cur.host, proxy: cur.access.proxy, allow: cur.access.allow } : null,
    restricted: !!(cur.access.proxy || cur.access.allow.length),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, ranges: proxyRanges(id).length, updatedAt: s.ranges?.[id]?.at || null, published: !!RANGE_SOURCES[id] })),
    switch: s.switch, trial: s.trial ? { ...s.trial, revert: undefined, secondsLeft: s.trial.until ? Math.max(0, Math.round((s.trial.until - Date.now()) / 1000)) : null } : null,
    lastRevert: s.lastRevert, pending, last: st, lastRequest: s.lastRequest,
  };
}
