// Media for WhatsApp sends (026): load from a URL or base64 with a size limit, a content-type check and an SSRF guard.
// Baileys can fetch URLs itself; we never let it, so every download goes through this guard.
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP, BlockList } from 'node:net';

export const MAX_MEDIA_BYTES = Math.max(1, Number(process.env.WA_MEDIA_MAX_MB) || 16) * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20000;

// Addresses a URL must never reach: loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved.
const blocked = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) {
  blocked.addSubnet(net, bits, 'ipv6');
}

/** True when an IP address is internal (must not be fetched). */
export function isBlockedAddress(ip) {
  const v = isIP(ip);
  if (!v) return true;
  if (v === 6) {
    const m = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (m) return blocked.check(m[1], 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return blocked.check(ip, 'ipv4');
}

/** Media kinds and the content types each accepts. */
const MEDIA_KINDS = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  gif: ['video/mp4', 'image/gif'],
  video: ['video/mp4', 'video/3gpp', 'video/quicktime'],
  sticker: ['image/webp'],
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/webm'],
  document: null, // any type except web pages
};
const NEVER = ['text/html', 'application/xhtml+xml'];

/** Content type from the first bytes (for when a server sends a vague or wrong header). */
export function sniffType(buf) {
  if (!buf || buf.length < 12) return '';
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (buf.subarray(4, 8).toString() === 'ftyp') return buf.subarray(8, 11).toString() === 'M4A' ? 'audio/mp4' : buf.subarray(8, 10).toString() === '3g' ? 'video/3gpp' : 'video/mp4';
  if (buf.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (hex.startsWith('494433') || hex.startsWith('fffb') || hex.startsWith('fff3')) return 'audio/mpeg';
  if (buf.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  return '';
}

const err = (message, status = 400) => Object.assign(new Error(message), { status });

/** Only http(s) URLs without credentials; IP literals are checked here, names at connect time. */
export function checkUrl(raw, allow = (ip) => !isBlockedAddress(ip)) {
  let u;
  try { u = new URL(String(raw)); } catch { throw err('Media URL is not a valid address'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw err('Media URL must start with http:// or https://');
  if (u.username || u.password) throw err('Media URL must not contain a user name or password');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? !allow(host) : /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw err('Media URL points to an internal address');
  return u;
}

/** dns.lookup that refuses internal addresses; used by the HTTP agent so DNS rebinding cannot slip through. */
export function guardedLookup(allow = (ip) => !isBlockedAddress(ip)) {
  return (hostname, options, cb) => {
    dnsLookup(hostname, { ...options, all: true }, (e, addrs) => {
      if (e) return cb(e);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: options?.family || 4 }];
      const ok = list.filter((a) => allow(a.address));
      if (!ok.length) return cb(err('Media URL points to an internal address'));
      if (options?.all) return cb(null, ok);
      return cb(null, ok[0].address, ok[0].family);
    });
  };
}

function download(u, { maxBytes, allow, redirects = 0 }) {
  return new Promise((resolveP, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { lookup: guardedLookup(allow), timeout: TIMEOUT_MS, headers: { 'user-agent': 'duniya-media/1', accept: '*/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(err('Media URL redirects too often'));
        let next;
        try { next = checkUrl(new URL(res.headers.location, u), allow); } catch (e) { return reject(e); }
        return download(next, { maxBytes, allow, redirects: redirects + 1 }).then(resolveP, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(err(`Media URL answered ${res.statusCode}`)); }
      const len = Number(res.headers['content-length'] || 0);
      if (len > maxBytes) { res.destroy(); return reject(err(`Media is too large (${Math.ceil(len / 1048576)} MB, limit ${Math.round(maxBytes / 1048576)} MB)`)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { res.destroy(); reject(err(`Media is too large (limit ${Math.round(maxBytes / 1048576)} MB)`)); return; }
        chunks.push(c);
      });
      res.on('end', () => resolveP({ buffer: Buffer.concat(chunks), type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), url: u }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(err('Media download timed out')));
    req.on('error', (e) => reject(e.status ? e : err(`Could not download the media: ${e.message}`)));
  });
}

/**
 * Load media for a send. src: { url } or { base64, mimetype }. Returns { buffer, mimetype, fileName }.
 * `allow(ip)` decides which resolved addresses may be fetched (tests only; default: no internal addresses).
 */
export async function loadMedia(kind, src = {}, { maxBytes = MAX_MEDIA_BYTES, allow = (ip) => !isBlockedAddress(ip) } = {}) {
  if (!(kind in MEDIA_KINDS)) throw err(`Unknown media kind "${kind}"`);
  let buffer; let type = ''; let fileName = src.fileName || '';
  if (src.base64) {
    const b64 = String(src.base64).replace(/^data:([^;,]+);base64,/, (m, t) => { type = t.toLowerCase(); return ''; });
    if (b64.length > Math.ceil(maxBytes / 3) * 4 + 8) throw err(`Media is too large (limit ${Math.round(maxBytes / 1048576)} MB)`);
    buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) throw err('base64 is empty or invalid');
    type = String(src.mimetype || type || '').toLowerCase();
  } else if (src.url) {
    const u = checkUrl(src.url, allow);
    const got = await download(u, { maxBytes, allow });
    buffer = got.buffer; type = String(src.mimetype || got.type || '').toLowerCase();
    if (!fileName) fileName = decodeURIComponent(u.pathname.split('/').pop() || '').slice(0, 120);
  } else {
    throw err('Give a media url or base64');
  }
  if (buffer.length > maxBytes) throw err(`Media is too large (limit ${Math.round(maxBytes / 1048576)} MB)`);
  const sniffed = sniffType(buffer);
  const allowed = MEDIA_KINDS[kind];
  let mimetype = type;
  if (allowed) {
    if (sniffed && allowed.includes(sniffed)) mimetype = sniffed;
    else if (!allowed.includes(type) || (sniffed && sniffed !== type)) {
      throw err(`This file is ${sniffed || type || 'of an unknown type'}; ${kind} needs ${allowed.join(', ')}`);
    }
  } else {
    if (!mimetype || mimetype === 'application/octet-stream') mimetype = sniffed || 'application/octet-stream';
    if (NEVER.includes(mimetype)) throw err('Web pages cannot be sent as documents');
  }
  return { buffer, mimetype, fileName: fileName || `file.${(mimetype.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '')}` };
}
