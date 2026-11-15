// Web address & access (031): custom domain with automatic HTTPS, and an IP allow-list for the panel/origin
// ("Only Cloudflare" preset with daily refreshed ranges, own CIDRs, always allow my IP). The app only writes a JSON
// request; the root helper validates it again with its own copy of webconfig.mjs, renders the Caddyfile, reloads
// Caddy and rolls back if HTTPS does not come up.
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { readFileSync, existsSync } from 'node:fs';
import { env } from './config.js';
import { getSetting, updateSettings } from './store.js';
import { activity } from './events.js';
import { OPS_STATE_DIR, OPS_WEBCONFIG, opsAvailable, opsStatus, requestOp } from './system.js';
import {
  normalizeDomain, parseCidr, ipInRanges, validateWebConfig, renderCaddyfile, CLOUDFLARE_V4, CLOUDFLARE_V6, isIp,
} from '../../deploy/ops/webconfig.mjs';

export { normalizeDomain, parseCidr, ipInRanges };
const CF_URLS = { v4: process.env.CLOUDFLARE_IPS_V4_URL || 'https://www.cloudflare.com/ips-v4', v6: process.env.CLOUDFLARE_IPS_V6_URL || 'https://www.cloudflare.com/ips-v6' };
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

// ---------- settings ----------
const DEFAULTS = { cloudflareOnly: false, allow: [], alwaysAllowMine: true, cf: null, lastRequest: null, history: [] };
export const webSettings = () => ({ ...DEFAULTS, ...(getSetting('webAccess', {}) || {}) });
const saveWeb = (patch) => updateSettings({ webAccess: { ...webSettings(), ...patch } });

export function cloudflareRanges() {
  const cf = webSettings().cf;
  return cf?.v4?.length && cf?.v6?.length ? [...cf.v4, ...cf.v6] : [...CLOUDFLARE_V4, ...CLOUDFLARE_V6];
}
export const isCloudflareIp = (ip) => ipInRanges(ip, cloudflareRanges());

// ---------- where are we ----------
export const exposure = () => process.env.DUNIYA_EXPOSURE || (/\.sslip\.io$/.test(currentHost()) ? 'ip' : currentHost() ? 'domain' : 'local');
export function currentHost() {
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
  if (ex === 'tunnel') return { ok: false, reason: 'tunnel', text: 'This panel is reached through a Cloudflare Tunnel: the address is set in Cloudflare (Zero Trust → Networks → Tunnels → Public hostname), and no ports are open, so no allow-list is needed.' };
  if (ex === 'local') return { ok: false, reason: 'local', text: 'This panel is only reachable on the server itself. Re-run the installer with --ip-https or --domain to put it online first.' };
  if (!opsAvailable()) return { ok: false, reason: 'helper', text: 'Server maintenance is not set up on this install. Re-run the installer once (or redeploy) to enable it.' };
  if (!existsSync(OPS_WEBCONFIG)) return { ok: false, reason: 'helper-old', text: 'This server needs a one-time update to change its address from here: re-run the installer once (it keeps your data and settings).' };
  return { ok: true };
}

// ---------- DNS check ----------
async function resolveAll(domain) {
  if (process.env.DUNIYA_FAKE_DNS) return JSON.parse(process.env.DUNIYA_FAKE_DNS)[domain] || []; // tests only
  const [v4, v6] = await Promise.all([dns.resolve4(domain).catch(() => []), dns.resolve6(domain).catch(() => [])]);
  return [...v4, ...v6];
}
/** Does `domain` point to this server (or go through Cloudflare)? Returns what to create when it does not. */
export async function checkDomain(input) {
  const domain = normalizeDomain(input);
  const ip = await publicIp().catch(() => '');
  const addresses = await resolveAll(domain);
  const record = { type: ip.includes(':') ? 'AAAA' : 'A', name: domain, value: ip || 'this server\'s public IP' };
  const proxied = addresses.length > 0 && addresses.every((a) => isCloudflareIp(a));
  let state; let text;
  if (!addresses.length) { state = 'missing'; text = `${domain} does not exist in DNS yet. Create this record at your DNS provider, wait a minute, then check again.`; }
  else if (ip && addresses.includes(ip)) { state = 'ok'; text = `${domain} points to this server.`; }
  else if (proxied) { state = 'proxied'; text = `${domain} goes through Cloudflare (orange cloud). If the certificate does not come up, set the record to “DNS only” until it works, then turn the proxy back on (SSL mode: Full (strict)).`; }
  else { state = 'wrong'; text = `${domain} points to ${addresses.join(', ')}, not to this server${ip ? ` (${ip})` : ''}. Change the record and check again.`; }
  return { domain, ok: state === 'ok' || state === 'proxied', state, text, addresses, serverIp: ip, record };
}

// ---------- certificate ----------
/** The certificate this server presents for `host` (asks the local web server on 443). */
export function certInfo(host, { port = Number(process.env.DUNIYA_TLS_PORT || 443), timeout = 4000 } = {}) {
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
      res(network ? { state: 'none', error: code } : { state: 'invalid', issuer: '', validTo: 0, daysLeft: null, error: String(code) });
    });
    s.on('timeout', () => { s.destroy(); res({ state: 'none', error: 'timeout' }); });
  });
}

// ---------- status of the last apply (written by the helper) ----------
export const webStatus = () => readJson(`${OPS_STATE_DIR}/web-status.json`);
export const appliedConfig = () => readJson(`${OPS_STATE_DIR}/web-applied.json`);
let syncedAt = 0;
/** After the helper applied a config, use the new address in this process too (app.env has it after a restart). */
export function syncFromHelper() {
  const st = webStatus();
  if (!st || st.state !== 'done' || !st.at || st.at <= syncedAt) return false;
  syncedAt = st.at;
  const applied = appliedConfig();
  if (!applied?.host) return false;
  try {
    const cfg = validateWebConfig(applied);
    process.env.PUBLIC_URL = `https://${cfg.host}`;
    process.env.TRUST_PROXY = cfg.access.cloudflareOnly ? 'cloudflare' : '1';
    env.trustProxy = true;
    return true;
  } catch { return false; }
}

// ---------- request a change ----------
/** The request the helper gets. Throws (400, field) when something is invalid; previews the Caddyfile. */
export async function buildRequest({ domain, cloudflareOnly, allow, alwaysAllowMine, myIp }, { by = '' } = {}) {
  const s = webSettings();
  const host = domain ? normalizeDomain(domain) : currentHost();
  if (!host) throw fail('Enter the domain for this panel', 400, { field: 'domain' });
  const list = [];
  for (const x of [].concat(allow ?? s.allow)) { if (String(x).trim()) list.push(parseCidr(x).text); }
  const mine = String(myIp || '').trim().replace(/^::ffff:(?=\d+\.)/i, '');
  const keepMine = (alwaysAllowMine ?? s.alwaysAllowMine) !== false;
  if (keepMine && list.length && isIp(mine) && !ipInRanges(mine, list)) list.push(parseCidr(mine).text);
  const old = currentHost();
  const doc = {
    version: 1, host, redirectHosts: old && old !== host ? [old] : [], serverIp: await publicIp().catch(() => null),
    port: env.panelPort >= 1024 ? env.panelPort : 8080, access: { cloudflareOnly: !!(cloudflareOnly ?? s.cloudflareOnly), allow: [...new Set(list)] },
    cloudflareRanges: (cloudflareOnly ?? s.cloudflareOnly) ? cloudflareRanges() : [], requestedBy: String(by).slice(0, 60), requestedAt: Date.now(),
  };
  if (doc.serverIp && !isIp(doc.serverIp)) doc.serverIp = null;
  const cfg = validateWebConfig(doc); // same checks the helper runs
  const preview = renderCaddyfile(doc, { caddyVersion: '2.7.0' });
  return { doc, cfg, preview };
}

/**
 * Apply from the panel. Safety: the domain must resolve here (or via Cloudflare); "Only Cloudflare" and own lists that
 * would shut out the person applying need `confirmLockout`.
 */
export async function applyWeb(body, { user, ip = '', viaCloudflare = false } = {}) {
  const av = availability();
  if (!av.ok) throw fail(av.text);
  const cur = opsStatus().status;
  if (cur?.state === 'running') throw fail(`Please wait: ${cur.action} is still running`, 409);
  const s = webSettings();
  const domain = body.domain ? normalizeDomain(body.domain) : currentHost();
  if (domain !== currentHost()) {
    const chk = await checkDomain(domain);
    if (!chk.ok) throw fail(chk.text, 400, { field: 'domain', check: chk });
  }
  const { doc, cfg } = await buildRequest({ ...body, domain, myIp: ip }, { by: user?.username });
  const warnings = [];
  if (cfg.access.cloudflareOnly && !viaCloudflare) warnings.push(`You are not using the panel through Cloudflare right now. Afterwards it only opens at https://${cfg.host} with Cloudflare’s proxy (orange cloud) on.`);
  if (cfg.access.allow.length && ip && !ipInRanges(ip, cfg.access.allow)) warnings.push(`Your current address (${ip}) is not on the list: you would lose access to the panel.`);
  if (warnings.length && !body.confirmLockout) throw fail(warnings.join(' '), 409, { needsConfirm: true, warnings });
  saveWeb({
    cloudflareOnly: cfg.access.cloudflareOnly, allow: [].concat(body.allow ?? s.allow).map((x) => String(x).trim()).filter(Boolean),
    alwaysAllowMine: body.alwaysAllowMine ?? s.alwaysAllowMine,
    lastRequest: { at: Date.now(), by: user?.username || '', host: cfg.host, cloudflareOnly: cfg.access.cloudflareOnly, allow: cfg.access.allow },
  });
  requestOp('apply-web-config', user?.username || '', { files: { 'web-config.json': JSON.stringify(doc) } });
  activity('config', { summary: `Web address & access: ${cfg.host}${cfg.access.cloudflareOnly ? ', only Cloudflare' : ''}${cfg.access.allow.length ? `, allow-list of ${cfg.access.allow.length}` : ''}${!cfg.access.cloudflareOnly && !cfg.access.allow.length ? ', open to everyone' : ''} (${user?.username || '?'})` });
  return { ok: true, host: cfg.host, warnings };
}

/** Recovery (CLI `duniya open-access`): keep the address, drop every IP restriction. */
export async function openAccess(by = 'server command line') {
  saveWeb({ cloudflareOnly: false, allow: [] });
  const av = availability();
  if (!av.ok) return { requested: false, message: `No restrictions are stored any more. ${av.text}` };
  const host = appliedConfig()?.host || currentHost();
  if (!host) return { requested: false, message: 'No public address is set up, so there was nothing to open.' };
  const { doc } = await buildRequest({ domain: host, cloudflareOnly: false, allow: [] }, { by });
  requestOp('apply-web-config', by, { files: { 'web-config.json': JSON.stringify(doc) } });
  activity('config', { summary: `Web access opened to everyone (IP allow-list removed) from the ${by}` });
  return { requested: true, host };
}

// ---------- Cloudflare ranges (daily) ----------
export async function refreshCloudflareRanges() {
  const get = async (u) => (await (await fetch(u, { signal: AbortSignal.timeout(15000) })).text()).split(/\s+/).filter(Boolean);
  const [r4, r6] = await Promise.all([get(CF_URLS.v4), get(CF_URLS.v6)]);
  const v4 = []; const v6 = [];
  for (const x of r4) { const c = parseCidr(x); if (c.family === 4) v4.push(c.text); }
  for (const x of r6) { const c = parseCidr(x); if (c.family === 6) v6.push(c.text); }
  if (v4.length < 5 || v6.length < 3) throw new Error('Cloudflare returned an unexpected list');
  const before = cloudflareRanges().join(' ');
  saveWeb({ cf: { v4, v6, at: Date.now() } });
  const changed = before !== [...v4, ...v6].join(' ');
  if (changed && webSettings().cloudflareOnly && availability().ok && appliedConfig()?.access?.cloudflareOnly) {
    const { doc } = await buildRequest({ domain: appliedConfig().host }, { by: 'daily Cloudflare update' });
    try { requestOp('apply-web-config', 'daily Cloudflare update', { files: { 'web-config.json': JSON.stringify(doc) } }); } catch { /* busy: next day */ }
    activity('config', { summary: `Cloudflare published new IP ranges (${v4.length} IPv4, ${v6.length} IPv6): web server updated` });
  }
  return { v4, v6, changed };
}

export function startWebAccess() {
  syncFromHelper();
  setInterval(syncFromHelper, 15000).unref();
  const daily = async () => {
    if (!webSettings().cloudflareOnly) return;
    try { await refreshCloudflareRanges(); } catch (e) { activity('error', { summary: `Could not refresh Cloudflare's IP ranges: ${e.message}` }); }
  };
  setTimeout(daily, 60000).unref();
  setInterval(daily, 24 * 3600000).unref();
}

/** Did this request come through Cloudflare's proxy? (Caddy puts the edge address first in X-Forwarded-For.) */
export function requestViaCloudflare(req) {
  if (!req.headers['cf-connecting-ip']) return false;
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (hops.some((h) => isCloudflareIp(h))) return true;
  return !!appliedConfig()?.access?.cloudflareOnly; // the web server only lets Cloudflare in
}

/** Everything the "Web address & access" card shows. */
export async function webState(req, { clientIp }) {
  syncFromHelper();
  const s = webSettings();
  const host = currentHost();
  const ip = clientIp(req);
  const st = webStatus();
  const ops = opsStatus().status;
  const pending = ops?.action === 'apply-web-config' && ops.state === 'running' ? (st?.state === 'waiting' ? 'waiting' : 'running') : null;
  const applied = appliedConfig();
  return {
    availability: availability(), exposure: exposure(),
    current: { url: process.env.PUBLIC_URL || '', host }, cert: await certInfo(host),
    serverIp: await publicIp().catch(() => ''),
    you: { ip, viaCloudflare: requestViaCloudflare(req) },
    settings: { cloudflareOnly: s.cloudflareOnly, allow: s.allow, alwaysAllowMine: s.alwaysAllowMine },
    applied: applied ? { host: applied.host, cloudflareOnly: !!applied.access?.cloudflareOnly, allow: applied.access?.allow || [] } : null,
    restricted: !!(applied && (applied.access?.cloudflareOnly || applied.access?.allow?.length)),
    cloudflare: { ranges: cloudflareRanges().length, updatedAt: s.cf?.at || null },
    pending, last: st, lastRequest: s.lastRequest,
  };
}
