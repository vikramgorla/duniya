// Scale measurement (069): the real core + panel against a large seeded data directory, through the test fakes
// (fake WhatsApp channel with 3 numbers, fake Claude API). No network beyond 127.0.0.1. Dev only.
//
//   npm run measure:scale                  → seed, then measure; prints one table per part
//   node scripts/measure-scale.mjs --small → a smaller fixture (CI smoke run, ~10 s)
//
// Fixture: scripts/scale-fixture.mjs (300 chats, 200k messages, 5k people …). Parts: startup in a fresh process on 1 CPU
// (taskset) with a 700 MB heap cap, RSS, panel API latencies (median / p95 of 15), live stream fan-out to 20 panels,
// router throughput, retention, database size. Query plans and time budgets that CI enforces: scripts/check-perf.mjs.
import { spawn } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setup } from '../test/harness.js';
import { FULL, SMALL as SMALL_FIXTURE, seedScale, personId, phoneOf } from './scale-fixture.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SMALL = process.argv.includes('--small');
const N = SMALL ? SMALL_FIXTURE : FULL;
const mb = (b) => Math.round(b / 1048576);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))];

// ---------- startup child: open the seeded data dir, load agents, start the panel, answer one status ----------
if (process.argv[2] === '--startup') {
  const t0 = performance.now();
  const { loadAgents } = await import('../src/core/agents.js');
  await loadAgents();
  const fake = { id: 'whatsapp', status: async () => ({ status: 'open', numbers: [] }), listChats: async () => [] };
  const { startPanel } = await import('../src/panel/server.js');
  const panel = startPanel({ channel: fake });
  await new Promise((r) => (panel.listening ? r() : panel.once('listening', r)));
  const ready = performance.now() - t0;
  const { startScheduler } = await import('../src/core/scheduler.js');
  void startScheduler; // imported like src/app.js does; not started (no timers in a measurement)
  process.stdout.write(JSON.stringify({ readyMs: Math.round(ready), rssMb: mb(process.memoryUsage().rss) }));
  process.exit(0);
}

const t = await setup({ env: { MEMORY_RETENTION_DAYS: '90' } });
const { db } = t.db;
// ---------- seed (scripts/scale-fixture.mjs, shared with scripts/check-perf.mjs) ----------
const seed0 = performance.now();
const { chats } = await seedScale(t, N);
const seedMs = performance.now() - seed0;

// ---------- panel API latencies ----------
const cookie = await t.login();
const midAct = db.prepare('SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET ?').get(Math.floor(N.activity / 2))?.id || 0;
const someChat = chats[1];
const paths = [
  ['status', '/api/status'], ['chats', '/api/chats'], ['agents', '/api/agents'],
  ['activity (first page)', '/api/activity?limit=200'], ['activity (older page)', `/api/activity?limit=200&before=${midAct}`],
  ['activity (one agent)', '/api/activity?limit=200&agent=agent-7'], ['activity (one chat)', `/api/activity?limit=200&chat=${encodeURIComponent(chats[3])}`],
  ['usage (30 days by agent)', '/api/usage?period=30d&groupBy=agent'], ['usage (all, by day)', '/api/usage?period=all&groupBy=day'], ['usage summary', '/api/usage/summary'],
  ['people (first page)', '/api/people'], ['people (search)', '/api/people?q=contact%2012'], ['people summary', '/api/people/summary'], ['person page', `/api/people/${personId(12)}`],
  ['chat messages', `/api/chats/${encodeURIComponent(someChat)}/messages?limit=50`], ['silences (7 days)', '/api/silences?days=7'],
  ['server health', '/api/server/health'],
  ['search messages (one hit)', '/api/search/messages?q=123456'], ['search messages (every message matches)', '/api/search/messages?q=station'],
  ['agent review', '/api/agents/agent-1/review'],
];
const api = [];
for (const [name, path] of paths) {
  const ms = []; let bytes = 0; let status = 0;
  for (let i = 0; i < 17; i++) {
    const s = performance.now();
    const r = await fetch(t.base + path, { headers: { cookie } });
    const body = await r.arrayBuffer();
    if (i >= 2) ms.push(performance.now() - s);
    bytes = body.byteLength; status = r.status;
  }
  api.push({ endpoint: name, status, 'median ms': +median(ms).toFixed(1), 'p95 ms': +p95(ms).toFixed(1), kB: Math.round(bytes / 1024) });
}
// Find anything: the palette's data (agents + chats) together
{ const ms = []; for (let i = 0; i < 12; i++) { const s = performance.now(); await Promise.all(['/api/agents', '/api/chats'].map((p) => fetch(t.base + p, { headers: { cookie } }).then((r) => r.arrayBuffer()))); if (i >= 2) ms.push(performance.now() - s); }
  api.push({ endpoint: 'find (agents + chats)', status: 200, 'median ms': +median(ms).toFixed(1), 'p95 ms': +p95(ms).toFixed(1), kB: 0 }); }

// ---------- live stream fan-out: 20 panels, 200 entries ----------
const CLIENTS = 20; const ENTRIES = 200;
const streams = await Promise.all(Array.from({ length: CLIENTS }, async () => {
  const ac = new AbortController();
  const r = await fetch(`${t.base}/api/events`, { headers: { cookie }, signal: ac.signal });
  const reader = r.body.getReader(); const dec = new TextDecoder();
  const st = { got: 0, status: 0, ac, done: null };
  st.done = (async () => { let buf = ''; try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); if (f.startsWith('event: status')) st.status++; else if (f.includes('"type":"scale.test"')) st.got++; } } } catch { /* aborted */ } })();
  return st;
}));
await new Promise((r) => setTimeout(r, 200));
const cpu0 = process.cpuUsage(); const f0 = performance.now();
for (let i = 0; i < ENTRIES; i++) t.events.bus.emit('activity', { id: i, ts: Date.now(), type: 'scale.test', summary: `entry ${i}` });
while (streams.some((s) => s.got < ENTRIES) && performance.now() - f0 < 20000) await new Promise((r) => setTimeout(r, 5));
const fanMs = performance.now() - f0;
await new Promise((r) => setTimeout(r, 600)); // the status pushes that follow (one per panel, debounced)
const fanCpu = process.cpuUsage(cpu0);
for (const s of streams) s.ac.abort();
const fan = { panels: CLIENTS, entries: ENTRIES, 'all delivered ms': Math.round(fanMs), 'status pushes': streams.reduce((n, s) => n + s.status, 0), 'cpu ms': Math.round((fanCpu.user + fanCpu.system) / 1000) };

// ---------- router throughput ----------
const on = chats.slice(0, N.on);
const R = 3000;
let s0 = performance.now();
for (let i = 0; i < R; i++) {
  const c = on[i % on.length];
  await t.route(t.msg({ chat: c, isGroup: c.endsWith('@g.us'), phone: phoneOf(i % 300), text: `just chatting ${i}`, msgId: `load-${i}` }));
}
const quietRate = R / ((performance.now() - s0) / 1000);
const offChat = chats[N.chats - 1];
s0 = performance.now();
for (let i = 0; i < R; i++) await t.route(t.msg({ chat: offChat, isGroup: offChat.endsWith('@g.us'), text: `off ${i}`, msgId: `off-${i}` }));
const offRate = R / ((performance.now() - s0) / 1000);
const A = 150;
const g = on.find((c) => c.endsWith('@g.us') && t.agents.listAgents().some((b) => b.chats.includes(c)));
const trig = t.agents.listAgents().find((b) => b.chats.includes(g)).triggers[0];
t.script.length = 0; for (let i = 0; i < A; i++) t.script.push([{ type: 'text', text: `Answer ${i}` }]);
s0 = performance.now();
for (let i = 0; i < A; i++) await t.route(t.msg({ chat: g, phone: phoneOf(100 + (i % 50)), text: `${trig} question ${i}`, msgId: `ask-${i}` }));
const askRate = A / ((performance.now() - s0) / 1000);
const router = { 'stored, not addressed (msg/s)': Math.round(quietRate), 'chat off (msg/s)': Math.round(offRate), 'answered by fake model (msg/s)': Math.round(askRate), replies: t.sent.length };

// ---------- retention (keep 30 days of messages) and a backup ----------
let maint;
try {
  const ret = await import('../src/core/retention.js');
  ret.setRetention({ messagesDays: 30 });
  const ticks = []; let removed = 0;
  for (let i = 0; i < 100; i++) {
    const s1 = performance.now(); const r = ret.retentionTick(Date.now()); ticks.push(performance.now() - s1);
    if (!r) break;
    removed += r.removed.messages;
    if (!ret.healthView().nextPruneAt || ret.healthView().nextPruneAt > Date.now()) break;
  }
  const { runBackup } = await import('../src/core/backup/index.js');
  t.store.setSecret('BACKUP_PASSPHRASE', 'measure-only-passphrase');
  const rss0 = process.memoryUsage().rss; const b0 = performance.now();
  const b = await runBackup({ reason: 'measure' });
  maint = { 'prune ticks': ticks.length, 'messages removed': removed, 'slowest tick ms': Math.round(Math.max(...ticks)), 'backup ms': Math.round(performance.now() - b0), 'backup MB': +(b.size / 1048576).toFixed(1), 'backup RSS +MB': mb(process.memoryUsage().rss - rss0) };
} catch (e) { maint = { error: e.message }; }

// ---------- database ----------
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const file = join(process.env.DATA_DIR, 'duniya.sqlite');
const size = (f) => (existsSync(f) ? statSync(f).size : 0);
const pg = db.prepare('PRAGMA page_count').get().page_count * db.prepare('PRAGMA page_size').get().page_size;
const free = db.prepare('PRAGMA freelist_count').get().freelist_count * db.prepare('PRAGMA page_size').get().page_size;
const counts = Object.fromEntries(['messages', 'activity', 'usage', 'contacts', 'people', 'chats_seen'].map((x) => [x, db.prepare(`SELECT COUNT(*) AS n FROM ${x}`).get().n]));
const dbInfo = { 'file MB': +(size(file) / 1048576).toFixed(1), 'wal MB': +(size(`${file}-wal`) / 1048576).toFixed(1), 'pages MB': +(pg / 1048576).toFixed(1), 'free MB': +(free / 1048576).toFixed(1), ...counts };
// ---------- startup in a fresh process: 1 CPU, 700 MB heap cap ----------
const startup = await new Promise((done) => {
  const node = [`--max-old-space-size=700`, '--disable-warning=ExperimentalWarning', join(ROOT, 'scripts/measure-scale.mjs'), '--startup'];
  const taskset = existsSync('/usr/bin/taskset');
  const p = spawn(taskset ? '/usr/bin/taskset' : process.execPath, taskset ? ['-c', '0', process.execPath, ...node] : node, { env: { ...process.env, PANEL_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  p.on('close', () => { try { done({ ...JSON.parse(out.trim().split('\n').at(-1)), cpu: taskset ? '1 (taskset)' : 'all' }); } catch { done({ error: out.slice(0, 200) }); } });
});

console.log(`\nFixture: ${JSON.stringify(N)} · seeded in ${Math.round(seedMs)} ms\n`);
console.log('Startup (fresh process, 700 MB heap cap):'); console.table([startup]);
console.log('Panel API (median / p95 of 15 requests):'); console.table(api);
console.log('Live stream fan-out:'); console.table([fan]);
console.log('Router throughput (fakes):'); console.table([router]);
console.log('Retention (messages 30 days) and one backup:'); console.table([maint]);
console.log('Database (after retention):'); console.table([dbInfo]);
console.log(`RSS of the measuring process at the end: ${mb(process.memoryUsage().rss)} MB (heap ${mb(process.memoryUsage().heapUsed)} MB)`);
t.close();
