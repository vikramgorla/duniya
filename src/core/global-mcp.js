// Global tool services (035): MCP servers defined once and available to every agent. Each agent can opt out per
// service (config.globalMcp.disabled); an agent's own tool service with the same name replaces the global one for
// that agent. Tool permissions still come from the agent's per-role rules; the service's `defaults` (tool-name globs
// per role) apply where a role has no explicit "<name>:" rule.
import { db } from './db.js';
import { TENANT } from './store.js';
import { validateGlobalServer } from './schema.js';
import { activity } from './events.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS global_mcp (
    tenant_id TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, created_at INTEGER, updated_at INTEGER,
    created_by TEXT, updated_by TEXT, PRIMARY KEY (tenant_id, name)
  );
`);

let cache = null;
const listeners = new Set();
/** Called after a global tool service is added, changed or removed. */
export const onGlobalMcpChange = (fn) => listeners.add(fn);
const changed = () => { cache = null; for (const fn of listeners) { try { fn(); } catch { /* ignore */ } } };

function load() {
  cache = new Map();
  for (const r of db.prepare('SELECT * FROM global_mcp WHERE tenant_id = ? ORDER BY name').all(TENANT)) {
    try { cache.set(r.name, { config: JSON.parse(r.config), createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by || '', updatedBy: r.updated_by || '' }); } catch { /* skip */ }
  }
  return cache;
}

/** { name: config } of all global tool services. */
export function globalServers() {
  return Object.fromEntries([...(cache || load())].map(([name, r]) => [name, r.config]));
}
export const getGlobalServer = (name) => (cache || load()).get(name)?.config || null;
/** Rows with metadata, for the panel. */
export const listGlobalRows = () => [...(cache || load())].map(([name, r]) => ({ name, ...r }));

/** Add or replace a global tool service. Returns { config, created }. */
export function saveGlobalServer(name, input, by = '') {
  const config = validateGlobalServer(String(name || ''), input);
  const now = Date.now();
  const prev = getGlobalServer(name);
  if (prev) {
    db.prepare('UPDATE global_mcp SET config = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND name = ?').run(JSON.stringify(config), now, by, TENANT, name);
  } else {
    db.prepare('INSERT INTO global_mcp (tenant_id, name, config, created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(TENANT, name, JSON.stringify(config), now, now, by, by);
  }
  const what = config.type === 'local' ? `local package ${config.package}` : config.url;
  activity('config', { summary: `Global tool service ${name} ${prev ? 'changed' : 'added'} (${what})${by ? ` by ${by}` : ''}` });
  changed();
  return { config, created: !prev };
}

export function removeGlobalServer(name, by = '') {
  const n = db.prepare('DELETE FROM global_mcp WHERE tenant_id = ? AND name = ?').run(TENANT, name).changes;
  if (!n) throw Object.assign(new Error(`No global tool service named ${name}`), { status: 404 });
  activity('config', { summary: `Global tool service ${name} removed${by ? ` by ${by}` : ''}` });
  changed();
}
