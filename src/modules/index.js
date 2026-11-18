// @ts-check
// Modules (081, People step 3b): built-in features that hang off People. Each module lives in src/modules/<id>/ and
// is loaded with import() only when the owner switches it on (Settings → Modules); switching it off drops it from the
// agents' tools, the panel and the upkeep tick, and keeps its data. Built-in modules only.
//
// The catalogue below knows, without loading a module, where its rows name a person or a household (`refs`), and which
// tables hang off those rows (`children`). That is enough for People to merge, undo, export and erase module rows
// generically — also while a module is off. A loaded module's manifest (its index.js `manifest`) adds:
//   tools        agent tools { name, description, input_schema, roles, participantDefault?, confirm?, run(args, ctx) }
//                ("<module>:<tool>" rules; organizers get all, participants the participantDefault ones by default)
//   apply        apply(action, agent): a change an organizer confirmed ("confirm XXXX", the runner's confirm gate)
//   person       person(id) / household(id) → page sections [{ title, rows: [{ name, sub?, href? }] }]
//   upkeep       upkeep(now): a bounded amount of background work on the scheduler's tick
//   on           { <signal>: fn } — signals other modules send (emit), e.g. events → orders: 'registration'
// Timeline entries are written with People's addEvent() when something happens to a person.
import { db } from '../core/db.js';
import { fail } from '../core/config.js';
import { TENANT, getSetting, updateSettings } from '../core/store.js';
import { activity, bus } from '../core/events.js';

const MB = 1048576;
/** @type {Array<{ id: string, label: string, line: string, refs: { person: string[][], household: string[][] }, children: string[][], load: () => Promise<any> }>} */
export const MODULES = [
  { id: 'events', label: 'Events', line: 'Events with registrations, a waiting list and duties; agents register people',
    refs: { person: [['ev_registrations', 'person'], ['ev_duty_people', 'person'], ['ev_attendance', 'person']], household: [['ev_registrations', 'household']] },
    children: [], load: () => import('./events/index.js') },
  { id: 'orders', label: 'Orders and payments', line: 'What people owe and paid, with price lists per event; records payments, never takes money',
    refs: { person: [['ord_orders', 'person']], household: [['ord_orders', 'household']] },
    children: [['ord_lines', 'ord', 'ord_orders'], ['ord_payments', 'ord', 'ord_orders']], load: () => import('./orders/index.js') },
];
const info = (id) => MODULES.find((m) => m.id === id) || null;
/** @type {Map<string, { manifest: any, costMb: number }>} */
const live = new Map();

const onList = () => { const l = getSetting('modulesOn', []); return Array.isArray(l) ? l.filter((id) => info(id)) : []; };
/** Is a module switched on (and loaded)? */
export const moduleOn = (id) => live.has(id);
/** The manifests of the modules that are on. */
export const liveModules = () => [...live.values()].map((l) => l.manifest);

async function load(id) {
  if (live.has(id)) return live.get(id).manifest;
  const before = process.memoryUsage().rss;
  const { manifest } = await info(id).load();
  live.set(id, { manifest, costMb: Math.max(0, Math.round((process.memoryUsage().rss - before) / MB)) });
  return manifest;
}
/** Startup: load the modules that are on. */
export async function startModules() {
  for (const id of onList()) await load(id).catch((e) => activity('error', { summary: `Module ${info(id).label} did not start: ${e.message}` }));
}
/** The module's code (namespace) when it is on; 409 with the reason when it is off. Panel routes use this. */
export async function need(id) {
  if (!info(id)) throw fail('Unknown module', 404);
  if (!live.has(id)) throw fail(`${info(id).label} is switched off (Settings → Modules)`, 409);
  return info(id).load();
}

/** Settings → Modules: one row per module. */
export const moduleRows = () => MODULES.map((m) => ({ id: m.id, label: m.label, line: m.line, on: live.has(m.id), memoryMb: live.get(m.id)?.costMb ?? null }));
/** Switch a module on (loaded now) or off (its tools, pages and upkeep stop; data kept). */
export async function setModuleOn(id, on, by = '') {
  const m = info(id);
  if (!m) throw fail('Unknown module', 404);
  updateSettings({ modulesOn: on ? [...new Set([...onList(), id])] : onList().filter((x) => x !== id) });
  if (on) await load(id); else live.delete(id);
  activity('config', { summary: `${m.label} switched ${on ? 'on' : 'off'}${on ? '' : ' (data kept)'}${by ? ` (${by})` : ''}` });
  bus.emit('status');
  return moduleRows();
}

/** A signal from one module to the others that are on (e.g. events → orders: a registration changed). */
export function emit(signal, payload) {
  for (const m of liveModules()) { try { m.on?.[signal]?.(payload); } catch (e) { activity('error', { summary: `${m.id}: ${e.message}` }); } }
}

/** The tool rules of a role for a module: its explicit "<id>:" rules, else organizers all, participants the defaults. */
export function moduleRules(agent, role, m) {
  const mine = (agent.tools?.[role] || []).filter((r) => r.startsWith(`${m.id}:`));
  if (mine.length) return mine;
  return role === 'organizer' ? [`${m.id}:*`] : m.tools.filter((t) => t.participantDefault).map((t) => `${m.id}:${t.name}`);
}

/** A change about the sender happens now; anything else waits for an organizer's "confirm XXXX" (runner's confirm gate). */
export function changeOrHold(ctx, kind, action, summary, { self = false } = {}) {
  if (self || !ctx.hold) return live.get(kind)?.manifest.apply(action, ctx.agent);
  ctx.hold({ kind, action, summary });
  return `Held for an organizer's confirmation: ${summary}. The confirm code is added to your answer; say that it applies after confirm.`;
}
/** Apply a held module change (runner, after "confirm XXXX"). */
export function applyModuleAction(kind, action, agent) {
  const m = live.get(kind)?.manifest;
  if (!m) throw fail(`${info(kind)?.label || kind} is switched off`);
  return m.apply(action, agent);
}

/** Page sections of the modules that are on, for a person or a household page. */
export function moduleSections(kind, id) {
  const out = [];
  for (const m of liveModules()) { try { out.push(...(m[kind]?.(id) || [])); } catch (e) { activity('error', { summary: `${m.id}: ${e.message}` }); } }
  return out;
}
/** Upkeep tick: each module that is on does its bounded work. */
export async function modulesUpkeep(now = Date.now()) {
  for (const m of liveModules()) { try { await m.upkeep?.(now); } catch (e) { activity('error', { summary: `${m.id} upkeep: ${e.message}` }); } }
}

// ---------- People operations over module rows (every module, on or off: the catalogue's refs) ----------
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const refsOf = (kind) => MODULES.flatMap((m) => m.refs[kind]).filter(([t]) => hasTable(t));

/** Merge: rows naming `from` name `to`. Returns what moved ({ table: [rowids] }) for undo. Inside the caller's transaction. */
export function moveModuleRows(from, to) {
  const moved = {};
  for (const [t, col] of refsOf('person')) {
    const ids = db.prepare(`SELECT rowid AS r FROM ${t} WHERE tenant_id = ? AND ${col} = ?`).all(TENANT, from).map((x) => x.r);
    if (!ids.length) continue;
    db.prepare(`UPDATE OR IGNORE ${t} SET ${col} = ? WHERE tenant_id = ? AND ${col} = ?`).run(to, TENANT, from);
    db.prepare(`DELETE FROM ${t} WHERE tenant_id = ? AND ${col} = ?`).run(TENANT, from); // the kept person already had it
    moved[`${t}.${col}`] = ids;
  }
  return moved;
}
/** Undo a merge: the rows that moved name the restored person again. */
export function restoreModuleRows(moved = {}, kept, restored) {
  for (const [key, ids] of Object.entries(moved)) {
    const [t, col] = key.split('.');
    if (!refsOf('person').some(([a, b]) => a === t && b === col)) continue;
    const st = db.prepare(`UPDATE ${t} SET ${col} = ? WHERE tenant_id = ? AND rowid = ? AND ${col} = ?`);
    for (const r of ids) st.run(restored, TENANT, r, kept);
  }
}
/** Export: every module row naming a person (and the rows that hang off them). */
export function exportModuleRows(person) {
  const out = {};
  for (const m of MODULES) {
    for (const [t, col] of m.refs.person.filter(([x]) => hasTable(x))) {
      const rows = db.prepare(`SELECT * FROM ${t} WHERE tenant_id = ? AND ${col} = ?`).all(TENANT, person);
      if (!rows.length) continue;
      (out[m.id] ||= {})[t] = rows.map(({ tenant_id: _, ...r }) => r);
      for (const [c, fk, parent] of m.children.filter(([x, , p]) => p === t && hasTable(x))) {
        const kids = db.prepare(`SELECT * FROM ${c} WHERE tenant_id = ? AND ${fk} IN (SELECT id FROM ${t} WHERE tenant_id = ? AND ${col} = ?)`).all(TENANT, TENANT, person);
        if (kids.length) out[m.id][c] = kids.map(({ tenant_id: _, ...r }) => r);
        void parent;
      }
    }
  }
  return out;
}
/** Erase a person or delete a household: their module rows go, with the rows that hang off them. Returns the count. */
export function eraseModuleRows(kind, id) {
  let n = 0;
  for (const m of MODULES) {
    for (const [t, col] of m.refs[kind].filter(([x]) => hasTable(x))) {
      for (const [c, fk] of m.children.filter(([x, , p]) => p === t && hasTable(x))) {
        db.prepare(`DELETE FROM ${c} WHERE tenant_id = ? AND ${fk} IN (SELECT id FROM ${t} WHERE tenant_id = ? AND ${col} = ?)`).run(TENANT, TENANT, id);
      }
      n += Number(db.prepare(`DELETE FROM ${t} WHERE tenant_id = ? AND ${col} = ?`).run(TENANT, id).changes);
    }
  }
  return n;
}
