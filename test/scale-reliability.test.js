// 069: scalability and reliability — retention on the upkeep tick, Server → Health, disk-full handling, the clock
// guard, contacts paging, backup names, reconnect alerts, graceful shutdown and the release-notes sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { setup } from './harness.js';

const t = await setup();
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
const admin = await t.login('ada', 'admin password 123');
const { upkeepTick } = await import('../src/core/upkeep.js');
const { checkDisk } = await import('../src/core/retention.js');
const { db } = t.db;
const DAY = 86400000;
const now = Date.now();
const count = (sql, ...a) => db.prepare(sql).get(...a).n;
const health = async () => (await t.api(owner, 'GET', '/api/server/health')).body;
const acts = (re) => t.db.listActivity({ limit: 500 }).filter((a) => re.test(a.summary));

test('old data is pruned on the upkeep tick by the retention settings; summaries and notes stay', async () => {
  const ins = db.prepare('INSERT INTO messages (channel, chat, msg_id, sender, name, text, ts) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 30; i++) ins.run('whatsapp', 'g1@g.us', `old-${i}`, '41790000002', 'Anu', `old ${i}`, now - 100 * DAY);
  for (let i = 0; i < 260; i++) ins.run('whatsapp', 'g2@g.us', `new-${i}`, '41790000002', 'Anu', `new ${i}`, now - 1000 + i);
  db.prepare('INSERT INTO activity (ts, type, summary) VALUES (?, ?, ?)').run(now - 40 * DAY, 'system', 'ancient');
  db.prepare("INSERT INTO usage (ts, agent, provider, model, kind, input, output) VALUES (?, 'panduga', 'anthropic', 'm', 'reply', 1, 1)").run(now - 500 * DAY);
  db.prepare("INSERT INTO silences (chat, agent, reason, count, first_ts, last_ts) VALUES ('g1@g.us', '', 'paused', 1, ?, ?)").run(now - 100 * DAY, now - 100 * DAY);
  t.db.kvSet('sched:panduga:morning:g1@g.us:2020-01-01', '1');
  t.db.kvSet(`sched:panduga:morning:g1@g.us:${new Date().toISOString().slice(0, 10)}`, '1');
  t.db.setChatMemory('g1@g.us', 'Decisions so far', 0);
  t.db.addNote({ chat: 'g1@g.us', agent: 'panduga', text: 'Rao family arrives Saturday', author: 'x', role: 'organizer' });

  // per-chat cap through the owner's setting (and its checks)
  assert.equal((await t.api(admin, 'PUT', '/api/server/retention', { messagesPerChat: 200 })).status, 403, 'owner only');
  const bad = await t.api(owner, 'PUT', '/api/server/retention', { messagesDays: 1 });
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'messagesDays');
  const ok = await t.api(owner, 'PUT', '/api/server/retention', { messagesPerChat: 200 });
  assert.equal(ok.status, 200); assert.equal(ok.body.retention.messagesPerChat, 200); assert.equal(ok.body.retention.messagesDays, 90);

  const r = await upkeepTick(t.channel);
  assert.ok(r.prune, 'the tick pruned');
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE chat = 'g1@g.us' AND ts < ?", now - 90 * DAY), 0, 'older than 90 days: gone');
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE chat = 'g2@g.us'"), 200, 'at most 200 per chat, the newest');
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE chat = 'g2@g.us' AND msg_id = 'new-259'"), 1);
  assert.equal(count("SELECT COUNT(*) n FROM activity WHERE summary = 'ancient'"), 0, 'activity: 30 days by default');
  assert.equal(count('SELECT COUNT(*) n FROM usage WHERE ts < ?', now - 400 * DAY), 0);
  assert.equal(count("SELECT COUNT(*) n FROM silences WHERE reason = 'paused'"), 0);
  assert.equal(t.db.kvGet('sched:panduga:morning:g1@g.us:2020-01-01'), undefined, 'old schedule markers go');
  assert.ok(t.db.kvGet(`sched:panduga:morning:g1@g.us:${new Date().toISOString().slice(0, 10)}`), "today's marker stays");
  assert.equal(t.db.getChatMemory('g1@g.us').summary, 'Decisions so far');
  assert.equal(t.db.listNotes('g1@g.us').length, 1);

  const hv = await health();
  assert.ok(hv.lastPrune.removed.messages >= 90);
  assert.ok(hv.database.bytes > 0);
  assert.equal(hv.disk.writesPaused, false);
  assert.equal(hv.clock.ok, true);
  assert.equal(hv.queue.queued, 0);
  assert.ok(hv.oldest.messages >= now - 90 * DAY);
  assert.equal((await upkeepTick(t.channel)).prune, null, 'not again within the hour');
});

test('disk almost full: messages are not stored, optional activity pauses, backups refuse, all resumes by itself', async () => {
  const GB = 1024 ** 3;
  checkDisk(Date.now(), { free: 50 * 1048576, total: 50 * GB });
  assert.equal((await health()).disk.writesPaused, true);
  assert.equal(acts(/^The server disk is almost full/).length, 1, 'recorded as an error (and the owner alert is attempted)');
  const before = count("SELECT COUNT(*) n FROM messages WHERE chat = 'g1@g.us'");
  await t.route(t.msg({ text: 'just chatting while the disk is full' }));
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE chat = 'g1@g.us'"), before, 'not stored');
  t.events.activity('tool.call', { summary: 'optional entry' });
  assert.equal(acts(/optional entry/).length, 0, 'optional activity is not written');
  t.events.activity('config', { summary: 'a change while full' });
  assert.equal(acts(/a change while full/).length, 1, 'changes are always recorded');
  t.store.setSecret('BACKUP_PASSPHRASE', 'a long test passphrase');
  const b = await t.api(owner, 'POST', '/api/backups/run');
  assert.equal(b.status, 507); assert.match(b.body.error, /disk is almost full/);

  checkDisk(Date.now(), { free: 20 * GB, total: 50 * GB });
  assert.equal((await health()).disk.writesPaused, false);
  assert.equal(acts(/Disk space is back/).length, 1);
  await t.route(t.msg({ text: 'stored again' }));
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE chat = 'g1@g.us'"), before + 1);
});

test('two backups in the same second get different names', async () => {
  const a = (await t.api(owner, 'POST', '/api/backups/run')).body;
  const b = (await t.api(owner, 'POST', '/api/backups/run')).body;
  assert.match(a.file, /^duniya-\d{8}-\d{6}-\d{3}\.dbk$/);
  assert.notEqual(a.file, b.file);
  const list = (await t.api(owner, 'GET', '/api/backups/list')).body.map((x) => x.file);
  assert.ok(list.includes(a.file) && list.includes(b.file));
});

test('People page through the server: limit and offset', async () => {
  for (let i = 0; i < 25; i++) await t.api(owner, 'POST', '/api/people', { phone: `4179555${String(i).padStart(4, '0')}`, name: `Page ${String(i).padStart(2, '0')}` });
  const p1 = (await t.api(owner, 'GET', '/api/people?q=page&limit=10&offset=0')).body;
  const p3 = (await t.api(owner, 'GET', '/api/people?q=page&limit=10&offset=20')).body;
  assert.deepEqual([p1.length, p3.length], [10, 5]);
  assert.equal(p1[0].name, 'Page 00'); assert.equal(p3[4].name, 'Page 24');
});

test('an account of any channel that is not connected for 15 minutes is reported once; one that waits for the owner is not', async () => {
  const account = (o) => ({ key: `${o.channel}:${o.label}`, lastError: '', ...o });
  let list = [account({ channel: 'whatsapp', app: 'WhatsApp', label: 'Main', status: 'reconnecting', lastError: 'Connection Failure' }),
    account({ channel: 'telegram', app: 'Telegram', label: '@family_bot', status: 'error', lastError: 'Telegram could not be reached (ENOTFOUND)' }),
    account({ channel: 'whatsapp', app: 'WhatsApp', label: 'Shop', status: 'qr' }), account({ channel: 'whatsapp', app: 'WhatsApp', label: 'Club', status: 'logged_out' })];
  const ch = { ...t.channel, accounts: async () => list };
  const t0 = Date.now();
  await upkeepTick(ch, t0);
  await upkeepTick(ch, t0 + 16 * 60000);
  await upkeepTick(ch, t0 + 20 * 60000);
  assert.equal(acts(/^WhatsApp \(Main\) has not been connected for 16 minutes: Connection Failure\. It keeps trying by itself/).length, 1);
  assert.equal(acts(/^Telegram \(@family_bot\) has not been connected for 16 minutes: Telegram could not be reached \(ENOTFOUND\)/).length, 1);
  assert.equal(acts(/^\w+ \(.+\) has not been connected/).length, 2, 'a QR code to scan and an unlinked number wait for the owner: the panel says so');
  // back, then down again: a new count
  list = list.map((a) => (a.label === 'Main' ? { ...a, status: 'open' } : a));
  await upkeepTick(ch, t0 + 21 * 60000);
  list = list.map((a) => (a.label === 'Main' ? { ...a, status: 'closed' } : a));
  await upkeepTick(ch, t0 + 22 * 60000);
  await upkeepTick(ch, t0 + 30 * 60000);
  assert.equal(acts(/^WhatsApp \(Main\) has not been connected/).length, 1, 'eight minutes are not fifteen');
  await upkeepTick(ch, t0 + 38 * 60000);
  assert.equal(acts(/^WhatsApp \(Main\) has not been connected for 16 minutes/).length, 2);
});

test('the clock guard: a clock behind the newest activity prunes nothing and Health says so', async () => {
  db.prepare('INSERT INTO activity (ts, type, summary) VALUES (?, ?, ?)').run(Date.now() + 2 * 3600000, 'system', 'from the future');
  db.prepare("INSERT INTO messages (channel, chat, msg_id, text, ts) VALUES ('whatsapp', 'g1@g.us', 'old-again', 'x', ?)").run(Date.now() - 200 * DAY);
  await t.api(owner, 'PUT', '/api/server/retention', { messagesDays: 30 }); // due on the next tick
  const r = await upkeepTick(t.channel);
  assert.deepEqual(r.prune, { skipped: 'clock' });
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE msg_id = 'old-again'"), 1, 'nothing deleted');
  const hv = await health();
  assert.equal(hv.clock.ok, false);
  assert.ok(acts(/server clock jumped/).length);
});

test('release notes sync: titles and notes from releases.json, generated part kept, idempotent, no new releases', async () => {
  const rel = [
    { id: 1, tag_name: 'v2.29.1', name: 'v2.29.1', body: "Short text\n\n## What's Changed\n* PR by someone\n\n**Full Changelog**: x...y" },
    { id: 2, tag_name: 'v0.0.1', name: 'v0.0.1', body: 'not in releases.json' },
  ];
  const calls = [];
  const gh = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    calls.push(`${req.method} ${req.url}`);
    assert.equal(req.headers.authorization, 'Bearer test-token');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.method === 'GET') return res.end(JSON.stringify(rel));
    const r = rel.find((x) => `/repos/o/r/releases/${x.id}` === req.url);
    Object.assign(r, JSON.parse(d)); res.end(JSON.stringify(r));
  }).listen(0);
  const run = () => new Promise((resolve) => execFile(process.execPath, [join(import.meta.dirname, '..', 'scripts/release-notes.mjs'), '--sync'],
    { env: { ...process.env, GITHUB_API_URL: `http://127.0.0.1:${gh.address().port}`, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'test-token' } }, (e, out, err) => resolve({ code: e?.code || 0, out, err })));
  const first = await run();
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /1 updated, 0 already up to date/);
  assert.match(rel[0].name, /^v2\.29\.1: ChatGPT plan limits/);
  assert.match(rel[0].body, /^### ChatGPT plan limits[\s\S]*\*\*Fixed\*\*[\s\S]*## What's Changed\n\* PR by someone[\s\S]*Full Changelog/);
  assert.doesNotMatch(rel[0].body, /Short text/);
  assert.equal(rel[1].body, 'not in releases.json');
  const second = await run();
  assert.match(second.out, /0 updated, 1 already up to date/);
  assert.ok(!calls.some((c) => c.startsWith('POST') || c.startsWith('DELETE')), 'never creates or deletes');
  gh.close();
});

test('graceful shutdown: running turns finish, new messages are not taken', async () => {
  const { closeRouter } = await import('../src/core/router.js');
  t.script.push([{ type: 'text', text: 'Puja is at 10:00' }]);
  const sent = t.sent.length;
  const turn = t.route(t.msg({ text: '@panduga when is the puja?', mentioned: true }));
  const closed = closeRouter(5000);
  await turn;
  assert.equal(await closed, true);
  assert.equal(t.sent.length, sent + 1, 'the running turn answered');
  const reqs = t.claudeReqs.length;
  await t.route(t.msg({ text: '@panduga and dinner?', mentioned: true }));
  assert.equal(t.claudeReqs.length, reqs, 'no new turn after closing');
  t.close();
});
