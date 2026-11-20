// 090: the owner's morning brief (sections, quiet hours, nothing → no message, once a day), suggested next steps with
// confirm codes and in the panel (approve opens the preview, dismiss sticks), ask-your-data tools across events, and
// group catch-up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner; let oa; let config;
const G = 'g4@g.us';
const OWNER_PHONE = '41790000005';
const OWNER_CHAT = `${OWNER_PHONE}@s.whatsapp.net`;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login();
  oa = await import('../src/core/owner-assistant.js'); config = t.config;
  t.db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, linked_at) SELECT 'default', id, ?, 'linked', ? FROM users WHERE username = 'admin'").run(OWNER_PHONE, Date.now());
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Raju', triggers: ['raju'], groupReplies: 'wake', organizers: ['+41 79 000 00 01'] } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'raju' });
});
after(() => t.close());

/** The next moment (from now, minute by minute) when the owner's clock shows hh:mm. */
function momentAt(hhmm) {
  const tz = t.agents.getAgent('owner-assistant').timezone || config.env.timezone;
  let at = Date.now() - (Date.now() % 60000) + 1000;
  for (let i = 0; i < 1500 && config.localParts(tz, at).hhmm !== hhmm; i++) at += 60000;
  return at;
}

test('nothing to report → no brief; settings validate; the time waits for the sending hours', async () => {
  const p = await t.api(owner, 'GET', '/api/owner-assistant/brief/preview');
  assert.equal(p.body.text, '', 'nothing yet');
  assert.equal((await t.api(owner, 'PUT', '/api/owner-assistant/brief', { at: '25:00' })).status, 400);
  const s = (await t.api(owner, 'PUT', '/api/owner-assistant/brief', { at: '06:30' })).body;
  assert.equal(s.sendsAt, '09:00', '06:30 is before the sending hours (09:00–20:00): it waits for them');
  const s2 = (await t.api(owner, 'PUT', '/api/owner-assistant/brief', { at: '08:00' })).body;
  assert.equal(s2.sendsAt, '09:00');
  await t.api(owner, 'PUT', '/api/owner-assistant/brief', { at: '10:15' });
  const n = t.sent.length;
  assert.equal(await oa.runMorningBrief(momentAt('10:15')), 0, 'nothing to report: no message');
  assert.equal(t.sent.length, n);
});

test('the brief: payments, questions for the owner, birthdays, new people, stuck things; a confirm code per suggestion', async () => {
  for (const id of ['events', 'orders', 'sending']) await t.api(owner, 'PUT', `/api/modules/${id}`, { on: true });
  await t.api(owner, 'POST', '/api/people', { name: 'Vik Gorla', phone: OWNER_PHONE });
  const mm = day(Date.now()).slice(5);
  await t.api(owner, 'POST', '/api/people', { name: 'Vedika', birthday: `2019-${mm}` });
  const ev = (await t.api(owner, 'POST', '/api/module/events', { name: 'Sankranti', starts: day(Date.now() + 20 * 86400000), currency: 'CHF' })).body.event;
  const anu = (await t.api(owner, 'POST', '/api/people', { name: 'Anu Rao', phone: '41790000002' })).body;
  await t.api(owner, 'PUT', `/api/people/${anu.id}/consents`, { purpose: 'updates', value: 'yes' });
  await t.api(owner, 'POST', '/api/orders', { person: anu.id, event: ev.id, title: 'Sankranti', due: day(Date.now() + 86400000), lines: [{ item: 'Family', qty: 1, price: 60 }] });
  // a question to the owner in a group that is on; nobody (not the owner) answered
  await t.route(t.msg({ chat: G, text: 'Vik, can you bring the speakers on Saturday?', phone: '41790000003', senderName: 'Chary' }));
  await t.route(t.msg({ chat: G, text: 'is the hall booked?', phone: '41790000003', senderName: 'Chary' })); // not to the owner
  const n = t.sent.length;
  t.db.db.prepare("DELETE FROM kv WHERE k LIKE 'brief:%'").run(); // the test above already had today's (empty) brief
  const now = momentAt('10:15');
  assert.equal(await oa.runMorningBrief(now), 1);
  const text = t.sent.slice(n).filter((s) => s.chat === OWNER_CHAT).map((s) => s.text).join('\n');
  assert.match(text, /\*Payments\*\n- Sankranti: 1 order open, CHF 60\.00 left, due \w{3} \d{1,2} \w{3} — Anu Rao/);
  assert.match(text, /\*Questions for you\*\n- Chary in .*: “Vik, can you bring the speakers on Saturday\?”/);
  assert.doesNotMatch(text, /hall booked/);
  assert.match(text, /\*Birthdays\*\n- Vedika \(today\)/);
  assert.match(text, /\*New people\*/);
  const code = text.match(/send reminders\? — reply \*confirm ([A-Z0-9]{4})\*/)[1];
  assert.equal(await oa.runMorningBrief(now), 0, 'once a day');
  // the owner confirms from their own chat: the reminders go out through the sending module (its preview → start)
  await t.route(t.msg({ chat: OWNER_CHAT, isGroup: false, phone: OWNER_PHONE, senderJid: OWNER_CHAT, text: `confirm ${code}` }));
  assert.match(t.sent.at(-1).text, /^Done \(/);
  const runs = (await t.api(owner, 'GET', '/api/sending')).body.runs;
  assert.ok(runs.some((r) => /Payment reminder/.test(r.title) && r.status !== 'draft'), 'the run started after confirm');
  assert.equal((await t.api(owner, 'GET', '/api/suggestions')).body.some((s) => s.key.startsWith('remind:')), false, 'done: no longer suggested');
});

test('Overview → Suggested: approve opens a draft send (nothing sent); dismissed never comes back for the same thing', async () => {
  const hari = (await t.api(owner, 'POST', '/api/people', { name: 'Hari', phone: '41790000031' })).body;
  await t.api(owner, 'POST', '/api/orders', { person: hari.id, title: 'Raffle', due: day(Date.now() - 86400000), lines: [{ item: 'Ticket', qty: 2, price: 5 }] });
  t.db.kvSet('suggestions:at', '0'); // refresh now
  let list = (await t.api(owner, 'GET', '/api/suggestions')).body;
  const s = list.find((x) => x.key.startsWith('remind:none:'));
  assert.ok(s, 'unpaid orders without an event');
  const sent = t.sent.length;
  const r = (await t.api(owner, 'POST', `/api/suggestions/${encodeURIComponent(s.key)}/approve`)).body;
  assert.match(r.href, /^#people\/sending\/.+/);
  const run = (await t.api(owner, 'GET', `/api/sending/runs/${r.href.split('/').at(-1)}`)).body;
  assert.equal(run.run?.status || run.status, 'draft', 'a draft: the owner starts it from the preview');
  assert.equal(t.sent.length, sent, 'nothing sent');
  // dismiss: an update suggestion stays dismissed
  t.db.db.prepare("INSERT OR REPLACE INTO suggestions (key, title, action, status, created_at, updated_at) VALUES ('update:9.9.9', 'update 9.9.9 is ready — install it?', '{\"href\":\"#settings/updates\"}', 'open', 1, 1)").run();
  await t.api(owner, 'POST', `/api/suggestions/${encodeURIComponent('update:9.9.9')}/dismiss`);
  list = (await t.api(owner, 'GET', '/api/suggestions')).body;
  assert.ok(!list.some((x) => x.key === 'update:9.9.9'));
  t.db.db.prepare("INSERT OR IGNORE INTO suggestions (key, title, action, status, created_at, updated_at) VALUES ('update:9.9.9', 'again', '{}', 'open', 2, 2)").run();
  assert.equal(t.db.db.prepare("SELECT status FROM suggestions WHERE key = 'update:9.9.9'").get().status, 'dismissed');
  const viewer = await (async () => { await t.api(owner, 'POST', '/api/users', { username: 'vera', role: 'viewer', password: 'viewer password 1' }); return t.login('vera', 'viewer password 1'); })();
  assert.equal((await t.api(viewer, 'GET', '/api/suggestions')).status, 403);
});

test('ask your data: who came last time but has not registered, who usually volunteers for cooking (organizers only)', async () => {
  const api = (m, p, b) => t.api(owner, m, p, b).then((r) => r.body);
  const past = (await api('POST', '/api/module/events', { name: 'Diwali 2025', starts: '2025-10-20', currency: 'CHF' })).event;
  const next = (await api('POST', '/api/module/events', { name: 'Diwali 2026', starts: day(Date.now() + 40 * 86400000), currency: 'CHF' })).event;
  const people = {};
  for (const [n, ph] of [['Gita', '41790000021'], ['Ravi', '41790000011'], ['Meena', '41790000041']]) people[n] = (await api('POST', '/api/people', { name: n, phone: ph }));
  for (const n of ['Gita', 'Ravi', 'Meena']) await api('POST', `/api/module/events/${past.id}/registrations`, { person: people[n].id, adults: 1 });
  await api('POST', `/api/module/events/${next.id}/registrations`, { person: people.Ravi.id, adults: 1 });
  const cook = (await api('POST', `/api/module/events/${past.id}/duties`, { task: 'Cooking lunch', needed: 3 }));
  const dutyId = cook.duty?.id || cook.id || (await api('GET', `/api/module/events/${past.id}`)).duties.find((d) => d.task === 'Cooking lunch').id;
  for (const n of ['Gita', 'Meena']) await api('PUT', `/api/module/duties/${dutyId}/people/${people[n].id}`, {});
  const tool = async (phone, name, input) => {
    t.script.push([{ type: 'tool_use', id: `x${t.claudeReqs.length}`, name, input }], [{ type: 'text', text: 'ok' }]);
    await t.route(t.msg({ chat: G, phone, text: 'raju please look it up' }));
    return t.claudeReqs.at(-1).messages.at(-1).content[0];
  };
  const r = await tool('41790000001', 'events__compare_events', { came_to: 'Diwali 2025', not_registered_for: 'Diwali 2026' });
  const out = JSON.parse(r.content);
  assert.deepEqual(out.who.map((w) => w.who).sort(), ['Gita', 'Meena']);
  assert.equal(out.count, 2);
  const d = JSON.parse((await tool('41790000001', 'events__duty_history', { task: 'cooking' })).content);
  assert.deepEqual(d.map((x) => x.who).sort(), ['Gita', 'Meena']);
  const denied = await tool('41790000003', 'events__compare_events', { came_to: 'Diwali 2025', not_registered_for: 'Diwali 2026' });
  assert.equal(denied.is_error, true, 'participants do not get organizer read tools');
});

test('catch-up: since the owner last wrote in the group, summarised with links to the messages', async () => {
  await t.route(t.msg({ chat: G, text: 'I am in for Saturday', phone: OWNER_PHONE, senderName: 'Vik' }));
  await t.route(t.msg({ chat: G, text: 'We decided: bus at 9 from Aigle', phone: '41790000003', senderName: 'Chary' }));
  const id = t.db.db.prepare('SELECT id FROM messages WHERE chat = ? ORDER BY id DESC LIMIT 1').get(G).id;
  t.script.push([{ type: 'text', text: `*Decided*\n- Bus at 9 from Aigle [#${id}]` }]);
  const r = (await t.api(owner, 'POST', `/api/chats/${encodeURIComponent(G)}/catch-up`)).body;
  assert.match(r.text, /Bus at 9 from Aigle/);
  assert.deepEqual(r.messages.map((m) => m.id), [id]);
  const asked = JSON.parse(t.claudeReqs.at(-1).messages[0].content);
  assert.equal(asked.sinceYourLastMessage, true);
  assert.deepEqual(asked.messages.map((m) => m.text), ['We decided: bus at 9 from Aigle'], 'only what came after the owner wrote');
  assert.equal(t.db.db.prepare("SELECT kind FROM usage WHERE kind = 'catch-up'").get()?.kind, 'catch-up');
  t.chatPrefs.setChatPrefs(G, { private: true });
  assert.equal((await t.api(owner, 'POST', `/api/chats/${encodeURIComponent(G)}/catch-up`)).status, 403, 'private to members');
  t.chatPrefs.setChatPrefs(G, { private: false });
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  for (const n of ['get_morning_brief', 'set_morning_brief', 'list_suggested_steps', 'approve_suggested_step', 'dismiss_suggested_step', 'catch_up_chat']) assert.ok(TOOLS.find((x) => x.name === n), n);
});
