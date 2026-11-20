// 040 spending caps (#35) and 041 weekly owner summary (#38); 059: the alert number and the weekly summary belong to
// the built-in owner assistant (its Alerts section and its weekly-summary schedule).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
const admin = await t.login('ada', 'admin password 123');
const usage = await import('../src/core/usage.js');
const budget = await import('../src/core/budget.js');
const weekly = await import('../src/core/weekly.js');
const stats = await import('../src/core/stats.js');
after(() => t.close());

const spend = (o) => usage.recordUsage({ provider: 'anthropic', model: 'claude-sonnet-5-5', feature: 'reply', ...o });
const toOwner = () => t.sent.filter((m) => m.chat === '41791112233@s.whatsapp.net');

test('040: months follow the server timezone', () => {
  const m = budget.monthOf(Date.UTC(2026, 10, 30, 23, 30), 'Europe/Zurich'); // 1 Dec 00:30 in Zurich
  assert.equal(m.key, '2026-12');
  assert.equal(m.from, Date.UTC(2026, 10, 30, 23, 0));
  assert.equal(budget.monthOf(Date.UTC(2026, 6, 15), 'Europe/Zurich').from, Date.UTC(2026, 5, 30, 22, 0), 'summer time');
});

test('040: caps are validated, admins set them, removing both limits removes the cap', async () => {
  assert.equal((await t.api(admin, 'PUT', '/api/budget/agent/panduga', { cost: -1 })).status, 400);
  assert.equal((await t.api(admin, 'PUT', '/api/budget/agent/panduga', { tokens: 10 })).status, 400);
  assert.equal((await t.api(admin, 'PUT', '/api/budget/agent/panduga', { tokens: 5000, fallback: 'not a model' })).status, 400);
  assert.equal((await t.api(admin, 'PUT', '/api/budget/agent/nope', { tokens: 5000 })).status, 404);
  const r = await t.api(admin, 'PUT', '/api/budget/agent/helper', { tokens: 5000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.cap.tokens, 5000);
  assert.equal(r.body.cap.state, 'ok');
  assert.equal((await t.api(admin, 'PUT', '/api/budget/agent/helper', { tokens: '', cost: '' })).body.cap, null);
  assert.equal((await t.api(owner, 'GET', '/api/budget')).body.caps.length, 0);
});

test('040: 80% alert once, 100% quiet in that chat with one alert, other chats unaffected; alerts need the owner number', async () => {
  const chat = 'g1@g.us';
  // no alert number yet: alerts are recorded only
  assert.equal((await t.api(admin, 'PUT', '/api/agents/owner-assistant', { alerts: { to: '+41 79 111 22 33' } })).status, 403, 'owner only');
  await t.api(owner, 'PUT', `/api/budget/chat/${encodeURIComponent(chat)}`, { tokens: 1000 });
  spend({ agent: 'panduga', chat, input: 850 });
  t.script.push([{ type: 'text', text: 'answer one' }]);
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.ok(t.sent.some((m) => m.text === 'answer one'), 'still answers below 100%');
  assert.ok(t.db.listActivity({ limit: 30 }).some((a) => /Owner alert not sent/.test(a.summary)), 'recorded without a number');

  assert.equal((await t.api(owner, 'PUT', '/api/agents/owner-assistant', { alerts: { to: '+41 79 111 22 33' } })).status, 200);
  assert.equal((await t.api(admin, 'PUT', '/api/agents/owner-assistant', { prompt: 'Be short.', alerts: { to: '+41 79 111 22 33' } })).status, 200, 'unchanged number: admins may save the rest');
  spend({ agent: 'panduga', chat, input: 200 });
  const before = t.claudeReqs.length;
  await t.route(t.msg({ text: '!panduga are you there?' }));
  assert.equal(t.claudeReqs.length, before, 'no model call at 100%');
  assert.equal(toOwner().length, 1);
  assert.match(toOwner()[0].text, /monthly cap reached for chat "Panduga families".*stays quiet/s);
  await t.route(t.msg({ text: '!panduga still there?' }));
  assert.equal(toOwner().length, 1, 'one alert per level and month');
  assert.ok(t.db.listActivity({ limit: 30 }).some((a) => a.detail?.silenceReason === 'budget'));

  const ov = (await t.api(owner, 'GET', '/api/budget')).body;
  const c = ov.caps.find((x) => x.id === chat);
  assert.equal(c.state, 'quiet');
  assert.equal(c.name, 'Panduga families');
  assert.ok(c.used >= 1);
  assert.equal(ov.currency, 'USD');

  // the helper agent in another chat still answers
  t.script.push([{ type: 'text', text: 'helper here' }]);
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help hi', phone: '41790000001' }));
  assert.ok(t.sent.some((m) => m.text === 'helper here'));
  await t.api(owner, 'PUT', `/api/budget/chat/${encodeURIComponent(chat)}`, { tokens: '' });
});

test('040: at 100% an agent cap with a cheaper model switches models instead of going quiet; cost caps use known prices', async () => {
  await t.api(owner, 'PUT', '/api/usage/prices', { model: 'anthropic:claude-sonnet-5-5', input: 1000, output: 1000 });
  await t.api(owner, 'PUT', '/api/budget/agent/helper', { cost: 1, fallback: 'anthropic:claude-haiku-5-5' });
  spend({ agent: 'helper', chat: 'g2@g.us', input: 900 }); // $0.90 → 90%
  let st = (await t.api(owner, 'GET', '/api/budget/agent/helper')).body.cap;
  assert.equal(st.state, 'warning');
  t.script.push([{ type: 'text', text: 'still sonnet' }]);
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help one', phone: '41790000001' }));
  assert.equal(t.claudeReqs.at(-1).model, 'claude-sonnet-5-5');
  assert.ok(toOwner().some((m) => /used 90% of its monthly cap/.test(m.text)), '80% alert');
  spend({ agent: 'helper', chat: 'g2@g.us', input: 200 });
  t.script.push([{ type: 'text', text: 'now haiku' }]);
  await t.route(t.msg({ chat: 'g2@g.us', text: '!help two', phone: '41790000001' }));
  assert.equal(t.claudeReqs.at(-1).model, 'claude-haiku-5-5');
  assert.ok(t.sent.some((m) => m.text === 'now haiku'));
  assert.ok(toOwner().some((m) => /cheaper model anthropic:claude-haiku-5-5/.test(m.text)));
  st = (await t.api(owner, 'GET', '/api/budget/agent/helper')).body.cap;
  assert.equal(st.state, 'fallback');
  await t.api(owner, 'PUT', '/api/budget/agent/helper', { cost: '' });
});

test('041/059: weekly summary — a schedule of the owner assistant, counts and costs only, sent once per day slot', async () => {
  const oa = (await t.api(owner, 'GET', '/api/agents/owner-assistant')).body;
  assert.equal(oa.builtin, true);
  assert.deepEqual(oa.config.schedules.map((x) => [x.id, x.kind, x.days, x.at, x.enabled]), [['weekly-summary', 'weekly-summary', 'mon', '09:00', true]], 'on by default, Monday 09:00');
  assert.equal(oa.config.alerts.to, '41791112233');
  assert.equal((await t.api(owner, 'PUT', '/api/agents/owner-assistant', { schedules: [{ id: 'x', kind: 'nope', at: '09:00' }] })).status, 400);
  assert.equal((await t.api(owner, 'PUT', '/api/agents/owner-assistant', { schedules: [{ id: 'w', kind: 'weekly-summary', at: '25:00' }] })).status, 400);
  // other agents never get the weekly summary or an alert number
  const h = (await t.api(owner, 'PUT', '/api/agents/helper', { schedules: [{ id: 'w', kind: 'weekly-summary', at: '09:00' }], alerts: { to: '+41 79 111 22 33' } })).body;
  assert.deepEqual([h.config.schedules, h.config.alerts.to], [[], '']);

  t.chatPrefs.setChatPrefs('g7@g.us', { enabled: false });
  await t.route(t.msg({ chat: 'g7@g.us', text: 'secret family gossip' }));
  const pre = (await t.api(admin, 'GET', '/api/owner-assistant/weekly-preview')).body;
  assert.match(pre.text, /Panduga: \d+ messages? handled/);
  assert.match(pre.text, /Helper: .*last week/);
  assert.match(pre.text, /Ignored: 1 message in 1 chat/);
  assert.doesNotMatch(pre.text, /gossip|answer one|are you there/i, 'no message contents');
  assert.equal(pre.data.agents.find((a) => a.id === 'panduga').replies >= 1, true);

  // "Run now" (run_schedule_now): nobody linked → the Alerts number
  const n = toOwner().length;
  const r = await t.api(owner, 'POST', '/api/agents/owner-assistant/schedules/weekly-summary/run');
  assert.equal(r.body.length, 1);
  assert.equal(toOwner().length, n + 1);
  assert.match(toOwner().at(-1).text, /Duniya — your week/);

  // the scheduler's run: once per day slot, also while agents are paused
  const { runSchedule } = await import('../src/core/scheduler.js');
  const agent = t.agents.getAgent('owner-assistant');
  assert.equal((await runSchedule(agent, agent.schedules[0], t.channel)).length, 0, 'already sent today by Run now');
  t.db.db.prepare("DELETE FROM kv WHERE k LIKE 'sched:owner-assistant:%'").run(); // a new day
  t.store.updateSettings({ paused: true });
  assert.equal((await runSchedule(agent, agent.schedules[0], t.channel)).length, 1);
  assert.equal((await runSchedule(agent, agent.schedules[0], t.channel)).length, 0, 'once per day slot');
  t.store.updateSettings({ paused: false });
  assert.equal(toOwner().length, n + 2);
  // the built-in cannot be deleted or bound to chats
  assert.equal((await t.api(owner, 'DELETE', '/api/agents/owner-assistant')).status, 400);
  assert.equal((await t.api(owner, 'POST', '/api/chats/bind', { chat: 'g3@g.us', agent: 'owner-assistant' })).status, 400);
});

test('041: stats are counters per day; data shows pending confirmations and backup failures', () => {
  stats.countStat('handled', { agent: 'helper' }, Date.now() - 8 * 86400000); // last week: not in this week
  t.events.activity('error', { summary: 'Backup duniya-x.dbk (1 KB): local ok, github error: boom' });
  const d = weekly.weeklyData();
  assert.equal(d.backups.failures, 1);
  assert.match(weekly.weeklyText(d), /1 backup failed/);
  assert.equal(typeof d.pending, 'number');
});

test('040/041: admin MCP tools are listed', async () => {
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  for (const n of ['get_spending_caps', 'set_spending_cap', 'preview_weekly_summary', 'run_schedule_now']) assert.ok(TOOLS.some((x) => x.name === n), n);
  for (const n of ['get_owner_alerts', 'set_owner_alerts', 'send_weekly_summary']) assert.ok(!TOOLS.some((x) => x.name === n), `${n}: folded into the owner assistant agent`);
});
