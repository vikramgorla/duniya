// @ts-check
// Minimal S3-compatible client with AWS Signature Version 4 (path-style). Works with R2, OCI, AWS, MinIO.
import { createHash, createHmac } from 'node:crypto';

const sha256hex = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Sign a request. Returns headers to send (includes authorization, x-amz-date, x-amz-content-sha256).
 * `headers` are extra headers to sign (lower-case names).
 */
export function signV4({ method, url, region, accessKeyId, secretAccessKey, body = '', headers = {}, date = new Date(), service = 's3' }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const all = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...headers };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = names.map((k) => `${k}:${String(all[k]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri = u.pathname.split('/').map((seg) => enc(decodeURIComponent(seg))).join('/') || '/';
  const canonicalQuery = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function s3Client({ endpoint, region = 'auto', bucket, accessKeyId, secretAccessKey }) {
  const base = `${endpoint.replace(/\/+$/, '')}/${bucket}`;
  async function req(method, key = '', { body = '', query = '' } = {}) {
    const url = `${base}${key ? `/${key.split('/').map(enc).join('/')}` : ''}${query ? `?${query}` : ''}`;
    const headers = signV4({ method, url, region, accessKeyId, secretAccessKey, body });
    delete headers.host;
    const res = await fetch(url, { method, headers, body: method === 'PUT' ? body : undefined, signal: AbortSignal.timeout(300000) });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      const text = await res.text();
      const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
      throw Object.assign(new Error(`S3 ${method} ${res.status}${code ? ` ${code}` : ''}`), { status: 400 });
    }
    return res;
  }
  return {
    put: (key, buf) => req('PUT', key, { body: buf }),
    get: async (key) => Buffer.from(await (await req('GET', key)).arrayBuffer()),
    del: (key) => req('DELETE', key),
    async list(prefix = '') {
      const xml = await (await req('GET', '', { query: `list-type=2&prefix=${enc(prefix)}` })).text();
      return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => ({
        key: c.match(/<Key>([^<]+)<\/Key>/)?.[1], size: Number(c.match(/<Size>(\d+)<\/Size>/)?.[1] || 0),
      })).filter((o) => o.key);
    },
  };
}
