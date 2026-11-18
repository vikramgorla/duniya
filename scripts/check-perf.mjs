// Performance budgets enforced by design (#174): `node scripts/check-perf.mjs` (also run by scripts/ci-checks.mjs).
// Seeds the scale fixture (scripts/scale-fixture.mjs: 200k messages, 50k activity rows, 5k people with 20k identities …)
// into a temp data directory with the real schema, then runs the hot paths through the real core and panel (test
// fakes, no network beyond 127.0.0.1) and checks two things:
//
//  1. Query plans: every SQL statement prepared while the app starts and while the workload runs (router per message,
//     agent turns with tools, panel lists and pages, search, People, the owner assistant's and admin MCP's reads) is
//     run through EXPLAIN QUERY PLAN against the seeded database. A full scan (`SCAN <table>`, with or without an
//     index) of a large table (≥ 1,000 rows in the fixture) fails, unless the statement is on ALLOW_SCANS below with
//     the reason. So a new query without an index fails CI.
//  2. Time budgets: the median of several runs of each key path stays within BUDGETS (milliseconds on a CI runner).
//
// Raising a budget or adding an allowed scan is a decision: keep the old value and say why in the comment, like the
// panel budgets in scripts/check-panel.mjs. Budgets are ~2.5× what a CI runner measured, so noise does not fail a PR.
//   node scripts/check-perf.mjs            → check (exit 1 on a problem)
//   node scripts/check-perf.mjs --verbose  → also print every checked plan
import { DatabaseSync } from 'node:sqlite';

// Budgets in ms (median of RUNS), about 2.5× what a GitHub runner measured when #174 set them (the CI value is noted).
const BUDGETS = {
  'person page': 12, // GET /api/people/:id (ties, households, timeline, tags, lists, their chats, merges); CI 4.6
  'people list': 10, // GET /api/people (first page of 100, sorted by display name); CI 3.6
  'people search': 30, // GET /api/people?q=… (names, nickname, number, tags, notes); CI 12.9
  'chat page (messages)': 5, // GET /api/chats/:chat/messages?limit=50; CI 1.0
  'search messages': 25, // GET /api/search/messages?q=… (full-text index, a word in every message); CI 10.5
  'activity (one chat)': 5, // GET /api/activity?chat=…; CI 1.4
  'router (stored, not addressed)': 2, // one group message through the router: allow-list, person, store, why-quiet; CI 0.3
  'agent context build': 3, // memory.buildContext for a busy group (recent messages, summary, notes); CI 0.6
  'sender card': 3, // 079: the People card of the sender each agent turn gets
  'people tool: find (own chats)': 15, // 079: people__find_person for an agent that sees its own chats only
};
const RUNS = 9;

// Full scans of large tables that are fine, each with its reason. `sql` is a piece of the normalized statement.
const ALLOW_SCANS = [
  // the newest page of Activity walks row ids backwards and stops after LIMIT rows (older pages start at `before`)
  { table: 'activity', sql: 'SELECT * FROM activity ORDER BY id DESC LIMIT ?', why: 'newest first, stops at LIMIT' },
  // Server → Health shows row counts: COUNT(*) walks the smallest index (a few ms at 200k rows); opened by hand
  { table: 'messages', sql: 'SELECT COUNT(*) AS n FROM messages', why: 'Server → Health row count' },
  { table: 'activity', sql: 'SELECT COUNT(*) AS n FROM activity', why: 'Server → Health row count' },
  { table: 'usage', sql: 'SELECT COUNT(*) AS n FROM usage', why: 'Server → Health row count' },
  // Getting started: "has any agent answered yet?" stops at the first reply in the partial index of agent replies
  { table: 'messages', sql: 'SELECT 1 FROM messages WHERE from_agent = 1 AND agent != ? LIMIT 1', why: 'stops at the first agent reply' },
  // People: the list sorted (and searched) by display name needs every name (marked in people.js; ~5 ms at 5k people,
  // the "people list" and "people search" budgets guard it). Filters by tag, list, household or app use their index.
  { table: 'people', sql: '/* people: every name sorts */', why: 'sort and search by display name' },
  // People summary (opened with People): counts and the tags in use, a few ms at 5k people / 10k tags
  { table: 'people', sql: 'SELECT COUNT(*) n FROM people WHERE tenant_id = ?', why: 'People summary count' },
  { table: 'households', sql: 'SELECT COUNT(*) n FROM households WHERE tenant_id = ?', why: 'People summary count' },
  { table: 'person_tags', sql: 'SELECT tag, COUNT(*) AS count FROM person_tags WHERE tenant_id = ? GROUP BY tag', why: 'People summary: tags in use' },
  { table: 'contacts', sql: "SUM(book_name <> '') book", why: 'People summary: names from the phone' },
  // 079, one time (remove with the migration): the chats people wrote in, from every stored message
  { table: 'identities', sql: 'SELECT i.tenant_id, i.person, m.chat, 1, 0, MAX(m.ts) FROM messages m JOIN identities i', why: 'one-time migration 2.40' },
  // Households: the whole list by name (an owner has dozens; 1k in the fixture)
  { table: 'households', sql: "SUM(m.role = 'adult') AS adults", why: 'all households, by name' },
];

// ---------- record every statement the app prepares ----------
const SEEN = new Set();
let recording = true;
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function recordingPrepare(sql) { if (recording) SEEN.add(sql); return prepare.call(this, sql); };

const VERBOSE = process.argv.includes('--verbose');
const { setup } = await import('../test/harness.js');
const { FULL, seedScale, personId, phoneOf } = await import('./scale-fixture.mjs');
const t = await setup({ env: { MEMORY_RETENTION_DAYS: '90' } });
const { db } = t.db;
const seed0 = performance.now();
recording = false; // the fixture's own inserts are not the app's statements
const { chats, groups } = await seedScale(t, FULL);
recording = true;
const seedMs = Math.round(performance.now() - seed0);
const cookie = await t.login();
const get = async (path) => { const r = await fetch(t.base + path, { headers: { cookie } }); await r.arrayBuffer(); if (r.status >= 500) throw new Error(`${path}: ${r.status}`); return r.status; };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function time(fn) { await fn(); await fn(); const ms = []; for (let i = 0; i < RUNS; i++) { const s = performance.now(); await fn(); ms.push(performance.now() - s); } return median(ms); }

// ---------- the workload: hot paths, timed where they have a budget ----------
const onGroup = groups.find((g) => chats.indexOf(g) < FULL.on && t.agents.agentForChat(g));
const agent = t.agents.agentForChat(onGroup);
const enc = encodeURIComponent;
const measured = {};
let seq = 0;
measured['person page'] = await time(() => get(`/api/people/${personId(12)}`));
measured['people list'] = await time(() => get('/api/people'));
measured['people search'] = await time(() => get(`/api/people?q=${enc('contact 12')}`));
measured['chat page (messages)'] = await time(() => get(`/api/chats/${enc(onGroup)}/messages?limit=50`));
measured['search messages'] = await time(() => get(`/api/search/messages?q=${enc('station nine')}`));
measured['activity (one chat)'] = await time(() => get(`/api/activity?limit=200&chat=${enc(onGroup)}`));
measured['router (stored, not addressed)'] = await time(() => t.route(t.msg({ chat: onGroup, phone: phoneOf(seq % 300), senderJid: `${phoneOf(seq % 300)}@s.whatsapp.net`, text: `just chatting ${seq++}`, msgId: `perf-${seq}` })));
measured['agent context build'] = await time(() => t.memory.buildContext({ agent, chat: onGroup }));
const access = await import('../src/core/people-access.js');
const { peopleTools } = await import('../src/core/people-tools.js');
measured['sender card'] = await time(() => access.senderCard(personId(5), access.peopleScope(agent), 'Contact 5'));
const findTool = peopleTools.find((x) => x.name === 'find_person');
measured['people tool: find (own chats)'] = await time(() => findTool.run({ query: 'contact 1' }, { agent, role: 'organizer' }));

// Everything else on a hot path, for the query-plan check (not timed).
const activityMid = db.prepare('SELECT id FROM activity WHERE id > ? ORDER BY id LIMIT 1').get(FULL.activity / 2)?.id || 1;
const someChat = chats[1]; const direct = chats.find((c) => c.endsWith('@s.whatsapp.net'));
for (const path of ['/api/status', '/api/checklist', '/api/chats', '/api/agents', `/api/agents/${agent.id}`, `/api/agents/${agent.id}/review`, `/api/agents/${agent.id}/memory`,
  `/api/agents/${agent.id}/people`, `/api/agents/${agent.id}/test-tools`, '/api/activity?limit=200', `/api/activity?limit=200&before=${activityMid}`, `/api/activity?limit=200&agent=${agent.id}`,
  '/api/usage?period=30d&groupBy=agent', '/api/usage?period=all&groupBy=day', '/api/usage/summary', '/api/silences?days=7', '/api/server/health', '/api/pending', '/api/direct-chats',
  `/api/chats/${enc(someChat)}/messages?limit=50`, `/api/chats/${enc(onGroup)}/memory`, `/api/chats/${enc(onGroup)}/whatsapp`, `/api/chats/${enc(direct)}/messages?limit=50`,
  `/api/search/messages?q=${enc('message 123456')}`, `/api/search/messages?q=${enc('station')}&chat=${enc(onGroup)}`,
  '/api/people/summary', '/api/people?tag=badminton', `/api/people?list=${enc('l_000000000003')}`, `/api/people?household=${enc('h_000000000004')}`, '/api/people?app=telegram',
  `/api/people?q=${enc(phoneOf(42).slice(-6))}`, '/api/people?offset=4000', `/api/people/${phoneOf(77)}`, `/api/people/${personId(4321)}`, `/api/people/${personId(12)}/export`,
  '/api/households', '/api/households/h_000000000004', '/api/lists', '/api/lists/l_000000000003', '/api/budget', '/api/owner-assistant', '/api/owner-assistant/weekly-preview', '/api/models',
]) await get(path);
// router: a direct message, a chat that is off, an answered turn (fake model) with a tool round; a member joining
const off = chats[FULL.chats - 1];
await t.route(t.msg({ chat: off, isGroup: off.endsWith('@g.us'), text: 'off chat', msgId: `perf-off-${seq++}` }));
await t.route(t.msg({ chat: direct, isGroup: false, phone: phoneOf(3), senderJid: `${phoneOf(3)}@s.whatsapp.net`, text: 'hello there', msgId: `perf-dm-${seq++}` }));
t.script.push([{ type: 'tool_use', id: 'tu1', name: 'memory__search_history', input: { query: 'station' } }], [{ type: 'text', text: 'Nine at the station.' }]);
await t.route(t.msg({ chat: onGroup, phone: phoneOf(5), senderJid: `${phoneOf(5)}@s.whatsapp.net`, text: `${agent.triggers[0]} when do we meet?`, msgId: `perf-ask-${seq++}` }));
await t.onJoin({ chat: onGroup, participants: [{ jid: `${phoneOf(4999)}@s.whatsapp.net`, phone: phoneOf(4999) }] });
// 079: an agent turn with the people tools (scoped), shared lists and Everyone, a change held for confirm
t.script.push([{ type: 'tool_use', id: 'tu2', name: 'people__find_person', input: { query: 'contact 2' } }, { type: 'tool_use', id: 'tu3', name: 'people__get_person', input: { person: personId(5) } }],
  [{ type: 'tool_use', id: 'tu4', name: 'people__add_note', input: { person: personId(7), text: 'Brings the speakers' } }], [{ type: 'text', text: 'Done.' }]);
await t.agents.updateAgent(agent.id, { organizers: [phoneOf(5)], peopleLists: ['l_000000000003'] });
await t.route(t.msg({ chat: onGroup, phone: phoneOf(5), senderJid: `${phoneOf(5)}@s.whatsapp.net`, text: `${agent.triggers[0]} who is contact 2?`, msgId: `perf-ask2-${seq++}` }));
await t.agents.updateAgent(agent.id, { peopleAccess: 'everyone' });
await findTool.run({ query: 'contact 3' }, { agent: t.agents.getAgent(agent.id), role: 'participant' });
for (const [m, path, body] of [['PUT', `/api/people/${personId(8)}/hidden`, { hidden: true }], ['PUT', `/api/people/${personId(8)}/hidden`, { hidden: false }],
  ['PUT', `/api/people/${personId(8)}/consents`, { purpose: 'updates', value: 'yes' }], ['GET', '/api/people?source=phone'], ['GET', '/api/people?hidden=1'],
  ['GET', `/api/agents/${agent.id}/people`]]) await t.api(cookie, m, path, body);
// background work on the upkeep tick (bounded batches): retention, members of groups that are on, phone contacts
const { retentionTick } = await import('../src/core/retention.js');
retentionTick(Date.now());
const { upkeepTick } = await import('../src/core/upkeep.js');
recording = false; db.prepare('UPDATE contacts SET updated_at = updated_at + 1 WHERE rowid % 10 = 0').run(); recording = true; // contacts that changed
const members = (chat) => Array.from({ length: 150 }, (_, i) => ({ phone: phoneOf((chats.indexOf(chat) * 7 + i) % FULL.people), jid: `${phoneOf((chats.indexOf(chat) * 7 + i) % FULL.people)}@s.whatsapp.net` }));
await upkeepTick({ groupMembers: async (chat) => members(chat), status: async () => ({ numbers: [] }) });
// one-time migrations of this release (checked so their plans are seen; allowed below as one-time)
access.migratePeopleChats();
await t.agents.migrateRolesToPeople();

// ---------- 1. query plans ----------
recording = false; // the checks below prepare their own statements
const big = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'").all()
  .map((r) => r.name).filter((n) => db.prepare(`SELECT COUNT(*) AS n FROM "${n}"`).get().n >= 1000));
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
const partial = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE '% WHERE %'").all().map((r) => r.name));
const KEYWORDS = new Set(['where', 'on', 'left', 'join', 'inner', 'cross', 'group', 'order', 'limit', 'set', 'using', 'natural', 'as', 'select', 'union', 'values']);
/** Alias → table of a statement ("FROM people p", "JOIN identities AS i"). */
function aliases(sql) {
  const out = new Map();
  for (const m of sql.matchAll(/\b(?:from|join|update|into)\s+([a-z_][\w]*)(?:\s+(?:as\s+)?([a-z_][\w]*))?/gi)) {
    out.set(m[1], m[1]);
    if (m[2] && !KEYWORDS.has(m[2].toLowerCase())) out.set(m[2], m[1]);
  }
  return out;
}
const problems = []; const allowedUsed = new Set(); let checked = 0;
for (const raw of SEEN) {
  const sql = norm(raw);
  if (!/^(with|select|update|delete|insert|replace)\b/i.test(sql) || /^explain/i.test(sql)) continue;
  let plan;
  try { plan = db.prepare(`EXPLAIN QUERY PLAN ${raw}`).all().map((r) => r.detail); } catch { continue; } // e.g. a table of a module the workload did not load
  checked++;
  const names = aliases(sql);
  // a SEARCH on the tenant alone ("(tenant_id=?)") reads the whole table too: every row has the same tenant
  // (a partial index holds only the rows it names, e.g. the hidden people, so reading it whole is fine)
  const scans = plan.map((d) => d.match(/^SCAN (\w+)(?!.*VIRTUAL TABLE)/)?.[1] || (!partial.has(d.match(/INDEX (\w+)/)?.[1]) && d.match(/^SEARCH (\w+) USING .*\(tenant_id=\?\)$/)?.[1])).filter(Boolean).map((a) => names.get(a) || a).filter((tb) => big.has(tb));
  if (VERBOSE) console.log(`${sql.slice(0, 160)}\n   ${plan.join(' · ')}`);
  for (const table of new Set(scans)) {
    const ok = ALLOW_SCANS.find((a) => a.table === table && sql.includes(a.sql));
    if (ok) allowedUsed.add(ok);
    else problems.push(`Full scan of ${table}: ${sql.slice(0, 220)}\n    plan: ${plan.join(' · ')}`);
  }
}
for (const a of ALLOW_SCANS) if (!allowedUsed.has(a)) console.log(`::warning::check-perf: allowed scan no longer seen (remove it from ALLOW_SCANS): ${a.table} / ${a.sql}`);

// ---------- 2. time budgets ----------
const over = Object.entries(BUDGETS).filter(([k, ms]) => !(measured[k] <= ms));
console.log(`check-perf: fixture seeded in ${seedMs} ms; ${checked} statements checked against ${[...big].length} large tables`);
console.table(Object.fromEntries(Object.entries(BUDGETS).map(([k, ms]) => [k, { 'median ms': +Number(measured[k]).toFixed(1), 'budget ms': ms }])));
for (const p of problems) console.log(`::error::check-perf: ${p}`);
for (const [k, ms] of over) console.log(`::error::check-perf: "${k}" took ${measured[k].toFixed(1)} ms (budget ${ms} ms). Add an index or a better query; raise the budget in scripts/check-perf.mjs only with a reason.`);
if (!problems.length && !over.length) console.log('check-perf: ok (no full scans of large tables, every budget met)');
process.exit(problems.length || over.length ? 1 : 0); // t.close() would exit 0
