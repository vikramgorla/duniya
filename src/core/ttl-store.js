// Short-lived state that must survive a restart (#64): owner-assistant and admin-MCP confirm codes, provider
// circuit-breaker pauses. One SQLite row per (kind, key) with an expiry; values are JSON, encrypted with the master key
// (confirm codes hold tool arguments). Expired rows are never returned and are swept on writes.
import { db } from './db.js';
import { TENANT } from './store.js';
import { encrypt, decrypt } from './crypto.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ttl_state (
    tenant_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, data_enc TEXT NOT NULL, expires INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, kind, key)
  );
  CREATE INDEX IF NOT EXISTS ttl_state_expires ON ttl_state(expires);
`);

const q = {
  put: db.prepare('INSERT OR REPLACE INTO ttl_state (tenant_id, kind, key, data_enc, expires) VALUES (?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT data_enc, expires FROM ttl_state WHERE tenant_id = ? AND kind = ? AND key = ?'),
  del: db.prepare('DELETE FROM ttl_state WHERE tenant_id = ? AND kind = ? AND key = ?'),
  clear: db.prepare('DELETE FROM ttl_state WHERE tenant_id = ? AND kind = ?'),
  list: db.prepare('SELECT key, data_enc, expires FROM ttl_state WHERE tenant_id = ? AND kind = ? AND expires >= ? ORDER BY expires'),
  sweep: db.prepare('DELETE FROM ttl_state WHERE expires < ?'),
};

const read = (enc) => { try { return JSON.parse(decrypt(enc)); } catch { return null; } }; // master key changed → gone

/** Store `data` under kind/key until `expires` (ms epoch). */
export function putTtl(kind, key, data, expires) {
  q.sweep.run(Date.now() - 60000); // generous margin: callers with a test clock compare with their own `now`
  q.put.run(TENANT, kind, String(key), encrypt(JSON.stringify(data)), Math.floor(expires));
}

/** The stored value, or null when missing or expired (`now` lets a test clock decide). */
export function getTtl(kind, key, now = Date.now()) {
  const r = q.get.get(TENANT, kind, String(key));
  if (!r) return null;
  if (r.expires < now) { q.del.run(TENANT, kind, String(key)); return null; }
  return read(r.data_enc);
}

/** Read and remove in one step (single-use codes). */
export function takeTtl(kind, key, now = Date.now()) {
  const v = getTtl(kind, key, now);
  q.del.run(TENANT, kind, String(key));
  return v;
}

export const deleteTtl = (kind, key) => q.del.run(TENANT, kind, String(key)).changes > 0;
export const clearTtl = (kind) => { q.clear.run(TENANT, kind); };

/** Every live entry of a kind: [{ key, data, expires }]. */
export function listTtl(kind, now = Date.now()) {
  return q.list.all(TENANT, kind, now).map((r) => ({ key: r.key, data: read(r.data_enc), expires: r.expires })).filter((r) => r.data);
}
