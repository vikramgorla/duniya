#!/usr/bin/env node
// Web address & access (031): strict validation of the web config the app asks for, and the Caddyfile made from it.
// Pure and dependency-free on purpose: install.sh copies this file to /usr/local/lib/duniya-ops/webconfig.mjs (root
// owned) and the root helper runs that copy, so nothing the app user can change is ever executed as root. The app
// imports the repository copy for checks, previews and tests.
//
//   node webconfig.mjs render <request.json> --out <Caddyfile> [--caddy-version 2.7.6] [--host H] [--server-ip IP]
//     → validates, writes the Caddyfile, prints HOST=… PUBLIC_URL=… TRUST_PROXY=… EXPOSURE=… lines; exit 2 if invalid
import { isIPv4, isIPv6 } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Cloudflare's published ranges (https://www.cloudflare.com/ips-v4, /ips-v6). Used until the app has downloaded
// the current lists; the app refreshes them daily.
export const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
export const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
export const LOOPBACK = ['127.0.0.1/8', '::1/128'];
const MAX_CIDRS = 200;

const bad = (msg, field) => Object.assign(new Error(msg), { status: 400, field, invalid: true });

// ---------- domain ----------
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
/** A public DNS name: lowercase letters, digits and hyphens, 2+ labels, a letter TLD (or xn--). Never an IP. */
export function normalizeDomain(input) {
  const d = String(input ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!d) throw bad('Enter a domain, e.g. agents.example.com', 'domain');
  if (d.length > 253 || /[^a-z0-9.-]/.test(d)) throw bad('A domain has only letters, digits, dots and hyphens (e.g. agents.example.com)', 'domain');
  if (isIPv4(d)) throw bad('Enter a name, not an IP address', 'domain');
  const labels = d.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) throw bad('That is not a valid domain (e.g. agents.example.com)', 'domain');
  const tld = labels.at(-1);
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]{2,59}$/.test(tld)) throw bad('That is not a valid domain (e.g. agents.example.com)', 'domain');
  if (['localhost', 'local', 'internal', 'test', 'invalid', 'example'].includes(tld)) throw bad('Use a public domain', 'domain');
  return d;
}

// ---------- IP addresses and CIDR ranges ----------
function v4bytes(ip) {
  const p = ip.split('.');
  if (p.length !== 4 || !p.every((x) => /^(0|[1-9]\d{0,2})$/.test(x) && Number(x) <= 255)) return null;
  return p.map(Number);
}
function v6bytes(ip) {
  if (!isIPv6(ip) || ip.includes('%')) return null;
  let s = ip.toLowerCase();
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:1.2.3.4
  if (tail) { const b = v4bytes(tail[1]); if (!b) return null; s = s.slice(0, -tail[1].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`; }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : []; const r = rest !== undefined ? (rest ? rest.split(':') : []) : null;
  const groups = r === null ? h : [...h, ...Array(8 - h.length - r.length).fill('0'), ...r];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
}
function v6text(bytes) {
  const g = []; for (let i = 0; i < 16; i += 2) g.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  let best = [-1, 0]; let cur = [-1, 0];
  g.forEach((x, i) => { if (x === '0') { cur = cur[0] < 0 ? [i, 1] : [cur[0], cur[1] + 1]; if (cur[1] > best[1]) best = [...cur]; } else cur = [-1, 0]; });
  if (best[1] < 2) return g.join(':');
  return `${g.slice(0, best[0]).join(':')}::${g.slice(best[0] + best[1]).join(':')}`;
}
/** Parse "1.2.3.4", "1.2.3.0/24", "2001:db8::/32" → { family, bytes, prefix, text } (host bits cleared) or throw. */
export function parseCidr(input) {
  const s = String(input ?? '').trim();
  if (!s || s.length > 64) throw bad(`"${s.slice(0, 40)}" is not an IP address or range`, 'allow');
  const [ip, pre, extra] = s.split('/');
  if (extra !== undefined) throw bad(`"${s}" is not an IP address or range`, 'allow');
  const b4 = v4bytes(ip); const b6 = b4 ? null : v6bytes(ip);
  if (!b4 && !b6) throw bad(`"${s}" is not an IP address or range (e.g. 203.0.113.7 or 203.0.113.0/24)`, 'allow');
  const bits = b4 ? 32 : 128;
  if (pre !== undefined && !/^(0|[1-9]\d{0,2})$/.test(pre)) throw bad(`"${s}": the part after / must be a number`, 'allow');
  const prefix = pre === undefined ? bits : Number(pre);
  if (prefix > bits) throw bad(`"${s}": the part after / can be at most ${bits}`, 'allow');
  const bytes = (b4 || b6).map((x, i) => { const keep = Math.max(0, Math.min(8, prefix - i * 8)); return x & (keep ? (0xff << (8 - keep)) & 0xff : 0); });
  const text = `${b4 ? bytes.join('.') : v6text(bytes)}/${prefix}`;
  return { family: b4 ? 4 : 6, bytes, prefix, text };
}
export const isIp = (s) => !!(v4bytes(String(s || '')) || v6bytes(String(s || '')));
/** Is `ip` inside one of `cidrs`? (IPv4-mapped IPv6 addresses count as IPv4.) */
export function ipInRanges(ip, cidrs) {
  let addr = String(ip || '').replace(/^::ffff:(?=\d+\.)/i, '');
  const b = v4bytes(addr) || v6bytes(addr);
  if (!b) return false;
  return cidrs.some((c) => {
    let r; try { r = typeof c === 'string' ? parseCidr(c) : c; } catch { return false; }
    if (r.bytes.length !== b.length) return false;
    for (let i = 0; i < r.prefix; i += 8) {
      const keep = Math.min(8, r.prefix - i); const mask = (0xff << (8 - keep)) & 0xff;
      if ((b[i / 8] & mask) !== r.bytes[i / 8]) return false;
    }
    return true;
  });
}
export const isCloudflareIp = (ip, ranges = [...CLOUDFLARE_V4, ...CLOUDFLARE_V6]) => ipInRanges(ip, ranges);

function cidrList(list, field, max = MAX_CIDRS) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw bad('Expected a list of IP addresses or ranges', field);
  if (list.length > max) throw bad(`At most ${max} entries`, field);
  const out = [];
  for (const x of list) { const t = parseCidr(x).text; if (!out.includes(t)) out.push(t); }
  return out;
}

// ---------- the request ----------
const KEYS = new Set(['version', 'host', 'redirectHosts', 'serverIp', 'port', 'access', 'cloudflareRanges', 'requestedBy', 'requestedAt']);
/**
 * Validate the JSON the app writes. Unknown keys are refused; every value that ends up in the Caddyfile is
 * re-generated from parsed data (canonical CIDR text, lowercase domain), never copied as given.
 */
export function validateWebConfig(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw bad('Invalid web config');
  for (const k of Object.keys(doc)) if (!KEYS.has(k)) throw bad(`Unknown setting "${String(k).slice(0, 30)}"`);
  if (doc.version !== undefined && doc.version !== 1) throw bad('Unsupported web config version');
  const host = normalizeDomain(doc.host);
  const redirectHosts = [];
  for (const r of [].concat(doc.redirectHosts || [])) { const d = normalizeDomain(r); if (d !== host && !redirectHosts.includes(d)) redirectHosts.push(d); }
  if (redirectHosts.length > 4) throw bad('Too many old addresses');
  let serverIp = null;
  if (doc.serverIp != null && doc.serverIp !== '') {
    const ip = String(doc.serverIp).trim();
    if (!isIp(ip)) throw bad('Invalid server IP', 'serverIp');
    serverIp = v4bytes(ip) ? ip : v6text(v6bytes(ip));
  }
  const port = doc.port === undefined ? 8080 : doc.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw bad('Invalid app port', 'port');
  const a = doc.access ?? {};
  if (typeof a !== 'object' || Array.isArray(a)) throw bad('Invalid access settings');
  for (const k of Object.keys(a)) if (!['cloudflareOnly', 'allow'].includes(k)) throw bad(`Unknown access setting "${String(k).slice(0, 30)}"`);
  if (a.cloudflareOnly !== undefined && typeof a.cloudflareOnly !== 'boolean') throw bad('cloudflareOnly must be true or false');
  const access = { cloudflareOnly: a.cloudflareOnly === true, allow: cidrList(a.allow, 'allow') };
  let cloudflareRanges = cidrList(doc.cloudflareRanges, 'cloudflareRanges', 100);
  if (access.cloudflareOnly && cloudflareRanges.length < 5) cloudflareRanges = [...CLOUDFLARE_V4, ...CLOUDFLARE_V6];
  return { version: 1, host, redirectHosts, serverIp, port, access, cloudflareRanges: access.cloudflareOnly ? cloudflareRanges : [] };
}

export const caddyAtLeast = (version, want) => {
  const p = (v) => String(v || '').replace(/^v/, '').split(/[.\s-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const a = p(version); const b = p(want);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

/** The Caddyfile for a validated config. Caddy < 2.7 has no client_ip matcher: Cloudflare + own list is refused there. */
export function renderCaddyfile(input, { caddyVersion = '2.7.0' } = {}) {
  const cfg = validateWebConfig(input);
  const modern = caddyAtLeast(caddyVersion, '2.7.0');
  const { cloudflareOnly, allow } = cfg.access;
  if (cloudflareOnly && allow.length && !modern) {
    throw bad(`"Only Cloudflare" together with your own list needs a newer web server (Caddy 2.7 or later, this server has ${caddyVersion}). Use one of the two, or update Caddy.`, 'allow');
  }
  const L = [];
  L.push('# Managed by Duniya: Settings → Web address & access. Changes made here are replaced on the next apply.');
  if (cloudflareOnly && modern) {
    // Requests come from Cloudflare: trust its edge addresses so client_ip is the visitor's real address.
    L.push('{', '\tservers {', `\t\ttrusted_proxies static ${cfg.cloudflareRanges.join(' ')}`, '\t\tclient_ip_headers CF-Connecting-IP X-Forwarded-For', '\t}', '}', '');
  }
  const rules = [];
  if (cloudflareOnly) {
    rules.push(`\t@not_cloudflare not remote_ip ${[...cfg.cloudflareRanges, ...LOOPBACK].join(' ')}`);
    rules.push('\trespond @not_cloudflare "Access denied: this site is only reachable through Cloudflare." 403');
  }
  if (allow.length) {
    rules.push(`\t@not_allowed not ${cloudflareOnly ? 'client_ip' : 'remote_ip'} ${[...allow, ...LOOPBACK].join(' ')}`);
    rules.push('\trespond @not_allowed "Access denied: your address is not on this panel\'s allow-list." 403');
  }
  L.push(`${cfg.host} {`, '\tencode gzip', ...rules, `\treverse_proxy 127.0.0.1:${cfg.port}`, '}');
  for (const old of cfg.redirectHosts) L.push('', `${old} {`, ...rules, `\tredir https://${cfg.host}{uri} 308`, '}');
  if (cfg.serverIp && !cfg.serverIp.includes(':')) L.push('', `http://${cfg.serverIp} {`, `\tredir https://${cfg.host}{uri} 302`, '}');
  return `${L.join('\n')}\n`;
}

/** What the helper writes to app.env / install.conf after a successful apply. */
export function envFor(input) {
  const cfg = validateWebConfig(input);
  return {
    HOST: cfg.host, PUBLIC_URL: `https://${cfg.host}`, TRUST_PROXY: cfg.access.cloudflareOnly ? 'cloudflare' : '1',
    EXPOSURE: /\.sslip\.io$/.test(cfg.host) ? 'ip' : 'domain',
  };
}

// ---------- command line (run by the root helper and the installer) ----------
function cli(argv) {
  const [cmd, file, ...rest] = argv;
  const opt = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd !== 'render' || !file) { process.stderr.write('usage: webconfig.mjs render <request.json> --out <Caddyfile> [--caddy-version V] [--host H] [--server-ip IP]\n'); return 64; }
  try {
    const raw = readFileSync(file, 'utf8');
    if (raw.length > 65536) throw bad('Web config too large');
    const doc = JSON.parse(raw);
    if (opt('host')) doc.host = opt('host');
    if (opt('server-ip') !== undefined) doc.serverIp = opt('server-ip') || null;
    const text = renderCaddyfile(doc, { caddyVersion: opt('caddy-version') || '2.7.0' });
    if (opt('out')) writeFileSync(opt('out'), text, { mode: 0o644 }); else process.stdout.write(text);
    const env = envFor(doc);
    if (opt('out')) process.stdout.write(Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    return 0;
  } catch (e) {
    process.stderr.write(`invalid web config: ${e.message}\n`);
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = cli(process.argv.slice(2));
