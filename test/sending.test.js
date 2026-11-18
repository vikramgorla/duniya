// 082: People step 4a — Lists and sending: audiences, consent checked in code before every message, per-person wording
// that keeps every fact, Telegram vs WhatsApp, one message per household, the pace on a fake clock (gaps, never wrote
// slower, sending hours, daily cap, warm-up via the cap), stop signals (stop word, no answers, failures, logged out),
// a message cut off by a restart is never sent twice, the confirm gate for agents, payment reminders and admin MCP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } });
const owner = await t.login();
after(() => t.close());
const { TOOLS } = await import('../src/panel/admin-tools.js');
const { upkeepTick } = await import('../src/core/upkeep.js');
const { localParts, env } = t.config;
const api = async (m, p, b) => { const r = await t.api(owner, m, p, b); if (r.status >= 400) throw Object.assign(new Error(r.body.error || r.body), { status: r.status, field: r.body.field }); return r.body; };
const x = { call: (m, p, b) => api(m, p, b) };
const tool = (n) => TOOLS.find((y) => y.name === n);
const jid = (phone) => `${phone}@s.whatsapp.net`;
const say = (chat, phone, text, o = {}) => t.route(t.msg({ chat, phone, senderJid: jid(phone), senderName: o.name || `P${phone.slice(-3)}`, isGroup: chat.endsWith('@g.us'), text, ...o }));
const ORG = '41790000001'; const ANU = '41790000002'; const RAVI = '41790000003'; const GITA = '41790000004'; const HARI = '41790000005';

// the fake clock: a day after today, at a given hour in the owner's time zone
const tz = env.timezone;
const dayStart = Date.parse(`${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}T00:00:00Z`);
const at = (hhmm, plusDays = 0) => { for (let m = -720; m < 2160; m++) { const ts = dayStart + plusDays * 86400000 + m * 60000; const l = localParts(tz, ts); if (l.hhmm === hhmm && l.date === localParts(tz, dayStart + plusDays * 86400000 + 43200000).date) return ts; } throw new Error('no time'); };
const typed = [];
t.channel.typing = async (chat) => { typed.push(chat); };
const sent = (chat) => t.sent.filter((m) => m.chat === chat);
/** One upkeep tick at `now`; waits until its send (if any) settled. */
async function tick(now) {
  const before = t.sent.length;
  await upkeepTick(t.channel, now);
  await new Promise((r) => setTimeout(r, 30));
  for (let i = 0; i < 40 && (await api('GET', '/api/sending')).runs.some((r) => r.counts.sending); i++) await new Promise((r) => setTimeout(r, 25));
  return t.sent.length - before;
}
const run = (id) => api('GET', `/api/sending/runs/${id}`);

const person = (name, phone = '', birthday = '') => api('POST', '/api/people', { name, phone, birthday });
const consent = (p, purpose = 'updates', value = 'yes') => api('PUT', `/api/people/${p.id}/consents`, { purpose, value });
const anu = await person('Anu Chary', ANU); const ravi = await person('Ravi Chary', RAVI); const gita = await person('Gita Rao', GITA); const hari = await person('Hari', HARI);
const vedika = await person('Vedika', '', '2020-06-01');
const chary = await api('POST', '/api/households', { name: 'Chary family' });
for (const [p, role] of [[anu, 'adult'], [ravi, 'adult'], [vedika, 'kid']]) await api('PUT', `/api/households/${chary.id}/members/${p.id}`, { role });
const committee = await api('POST', '/api/lists', { name: 'Committee' });
for (const p of [anu, ravi, gita, hari, vedika]) await api('PUT', `/api/lists/${committee.id}/members/${p.id}`);
await consent(anu); await consent(gita); await consent(hari); await consent(ravi, 'updates', 'no');
await api('PUT', `/api/people/${hari.id}/hidden`, { hidden: true });
// Anu wrote to the agent before (her direct chat is on); Gita uses Telegram with this server
t.agents.bindChat(jid(ANU), 'panduga');
t.script.push([{ type: 'text', text: 'Hi Anu!' }]);
await say(jid(ANU), ANU, 'hello');
await t.waitFor(() => t.sent.length);
t.sent.length = 0;
const access = await import('../src/core/people-access.js');
const TG = 'tg:777#4242';
access.notePersonChat(gita.id, TG, 'wrote');
t.channel.channels = async () => [{ id: 'whatsapp', state: 'on' }, { id: 'telegram', state: 'on' }];
let first;

test('Lists and sending is a module: off by default, then its tools by role', async () => {
  assert.equal((await t.api(owner, 'GET', '/api/sending')).status, 409);
  await api('PUT', '/api/modules/sending', { on: true });
  const tools = (await api('GET', '/api/modules/tools')).find((g) => g.id === 'sending').tools;
  assert.deepEqual(tools.map((y) => [y.name, y.organizerOnly, y.participantDefault]), [['stop_messages', false, true], ['sending_status', true, false], ['send_to_list', true, false]]);
});

test('the preview: who gets it on which app, who is skipped and why (consent, hidden, no app), samples; nothing is sent', async () => {
  const bad = await t.api(owner, 'POST', '/api/sending/preview', { audience: { kind: 'list', list: committee.id }, template: 'You owe {amount}' });
  assert.deepEqual([bad.status, bad.body.field], [400, 'template']);
  const before = t.sent.length;
  const p = await api('POST', '/api/sending/preview', { title: 'Committee meeting', audience: { kind: 'list', list: committee.id }, purpose: 'updates', agent: 'panduga',
    template: 'Hi {first_name}, the committee meets on Friday at 19:00.' });
  first = p.run.id;
  assert.equal(p.run.status, 'draft');
  assert.deepEqual(p.to, { total: 2, whatsapp: 1, telegram: 1, neverWrote: 0 });
  assert.deepEqual(p.skipped.map((s) => [s.name, s.reason]).sort(), [['Hari', 'Hidden in People'], ['Ravi Chary', 'Said no to updates']]);
  assert.equal(p.samples.length, 2);
  assert.match(p.samples.find((y) => y.to.startsWith('Anu')).text, /^Hi Anu, the committee meets on Friday at 19:00\.$/, 'the model reply lost the facts, so the filled template is used');
  assert.ok(p.estimate.minutes >= 0);
  assert.equal(t.sent.length, before, 'a preview sends nothing');
  assert.ok(!(await api('GET', '/api/sending')).runs.some((r) => r.id === first), 'drafts are not in the history');
});

test('confirmed: one message per tick, Telegram fast, WhatsApp after the chat is read and typed, consent checked again', async () => {
  await api('POST', `/api/sending/runs/${first}/start`);
  assert.equal((await t.api(owner, 'POST', `/api/sending/runs/${first}/start`)).status, 409, 'confirmed once');
  const now = at('10:00');
  assert.equal(await tick(at('07:00')), 0, 'before the sending hours nothing goes out');
  assert.equal((await run(first)).run.wait, 'hours');
  assert.equal(await tick(now), 1);
  // the other one a few seconds later: Telegram has no WhatsApp gap, and a WhatsApp message after Telegram waits for none
  assert.equal(await tick(now + 10000), 1);
  assert.equal(sent(jid(ANU)).length, 1);
  assert.ok(typed.includes(jid(ANU)), 'typing shown before the message');
  assert.match(sent(jid(ANU))[0].text, /^Hi Anu, the committee meets/);
  assert.equal(sent(TG).length, 1);
  assert.equal(await tick(now + 20000), 0);
  const r = await run(first);
  assert.equal(r.run.status, 'done');
  assert.deepEqual([r.run.counts.sent, r.run.counts.skipped], [2, 2]);
  assert.ok(t.chatPrefs.isChatEnabled(TG), 'the chat it wrote to is on, so replies reach the agent');
  assert.ok((await api('GET', `/api/people/${anu.id}`)).modules.some((s) => s.title === 'Messages from lists'));
});

test('a reply is counted and reaches the agent; STOP records no, confirms once and pauses a running run; START undoes it', async () => {
  t.script.push([{ type: 'text', text: 'Great, see you Friday!' }]);
  await say(jid(ANU), ANU, 'thanks, I will come');
  assert.equal(sent(jid(ANU)).at(-1).text, 'Great, see you Friday!');
  assert.equal((await run(first)).recipients.find((y) => y.person === anu.id).status, 'replied');
  // a new run to Anu and Gita
  const p = await api('POST', '/api/sending/preview', { title: 'Picnic', audience: { kind: 'people', people: [anu.id, gita.id] }, purpose: 'updates', agent: 'panduga', template: 'Hi {first_name}, picnic on Sunday!' });
  await api('POST', `/api/sending/runs/${p.run.id}/start`);
  await tick(at('11:00'));
  const n = t.claudeReqs.length;
  await say(jid(ANU), ANU, 'STOP');
  assert.equal(t.claudeReqs.length, n, 'no model call for a stop word');
  assert.match(sent(jid(ANU)).at(-1).text, /will not get updates from us any more/);
  assert.equal((await api('GET', `/api/people/${anu.id}`)).consents.find((c) => c.purpose === 'updates').value, 'no');
  const r = await run(p.run.id);
  assert.equal(r.run.status, 'paused');
  assert.match(r.run.reason, /Anu Chary asked not to get messages/);
  const count = sent(jid(ANU)).length;
  await say(jid(ANU), ANU, 'stop!');
  assert.equal(sent(jid(ANU)).length, count, 'confirmed only once');
  await say(jid(ANU), ANU, 'Start');
  assert.match(sent(jid(ANU)).at(-1).text, /Welcome back/);
  assert.equal((await api('GET', `/api/people/${anu.id}`)).consents.find((c) => c.purpose === 'updates').value, 'yes');
  await api('PUT', `/api/sending/runs/${p.run.id}`, { action: 'stop' });
});

test('pace: never-wrote people wait twice the gap, the daily cap waits for tomorrow, then it carries on by itself', async () => {
  const pace = await import('../src/core/pace.js');
  pace.setPaceSettings({ custom: { gapMin: 60, gapMax: 60, dailyNew: 1, pauseEvery: 0, readMin: 0, readMax: 0, hoursFrom: '09:00', hoursTo: '20:00' } });
  const p1 = await person('New One', '41790000061'); const p2 = await person('New Two', '41790000062');
  await consent(p1); await consent(p2);
  const p = await api('POST', '/api/sending/preview', { title: 'Welcome', audience: { kind: 'people', people: [p1.id, p2.id] }, purpose: 'updates', agent: 'panduga', template: 'Hi {first_name}, welcome!', noReplyLimit: 0 });
  assert.deepEqual([p.to.neverWrote, p.chatsToSwitchOn], [2, 2]);
  await api('POST', `/api/sending/runs/${p.run.id}/start`);
  const now = at('12:00', 1);
  assert.equal(await tick(now), 1);
  assert.equal(await tick(now + 100000), 0, 'never wrote: 2 × 60 s gap');
  assert.equal(await tick(now + 121000), 0, 'the daily cap of one new chat is used');
  assert.equal((await run(p.run.id)).run.wait, 'cap');
  assert.equal((await run(p.run.id)).run.status, 'running');
  assert.equal(await tick(at('12:00', 2)), 1, 'the next day it carries on by itself');
  assert.equal((await run(p.run.id)).run.status, 'done');
  pace.setPaceSettings({ preset: 'normal' });
});

test('stop signals: nobody answers, sends fail, WhatsApp logged out pause the run; a message cut off by a restart is not sent twice', async () => {
  const ppl = [];
  for (let i = 0; i < 4; i++) { const q = await person(`Quiet ${i}`, `4179000007${i}`); await consent(q); ppl.push(q.id); }
  const mk = async (o = {}) => { const p = await api('POST', '/api/sending/preview', { title: 'Quiet', audience: { kind: 'people', people: ppl }, purpose: 'updates', agent: 'panduga', template: 'Hi {first_name}!', ...o }); await api('POST', `/api/sending/runs/${p.run.id}/start`); return p.run.id; };
  // nobody answers: with a limit of 1, the next send after half an hour pauses
  const quiet = await mk({ noReplyLimit: 1 });
  const d = at('10:00', 3);
  assert.equal(await tick(d), 1);
  assert.equal(await tick(d + 31 * 60000), 0);
  assert.match((await run(quiet)).run.reason, /1 people in a row did not answer/);
  await api('PUT', `/api/sending/runs/${quiet}`, { action: 'stop' });
  // three failures in a row
  const fails = await mk({ noReplyLimit: 0 });
  const realSend = t.channel.send;
  t.channel.send = async () => { throw new Error('not delivered'); };
  for (let i = 0; i < 3; i++) await tick(d + (40 + i * 10) * 60000);
  t.channel.send = realSend;
  const f = await run(fails);
  assert.equal(f.run.status, 'paused');
  assert.match(f.run.reason, /3 messages in a row could not be sent/);
  // logged out
  await api('PUT', `/api/sending/runs/${fails}`, { action: 'resume' });
  const realStatus = t.channel.status;
  t.channel.status = async () => ({ status: 'logged_out' });
  await tick(d + 90 * 60000);
  t.channel.status = realStatus;
  assert.match((await run(fails)).run.reason, /logged out/);
  // a message left "sending" by a restart is marked failed, never sent again
  t.db.db.prepare("UPDATE snd_recipients SET status = 'sending', at = ? WHERE run = ? AND status = 'waiting'").run(d, fails);
  await api('PUT', `/api/sending/runs/${fails}`, { action: 'resume' });
  const out = t.sent.length;
  await tick(d + 120 * 60000);
  assert.equal(t.sent.length, out);
  assert.ok((await run(fails)).recipients.some((y) => y.reason.startsWith('Interrupted by a restart')));
});

test('an event: one message per household (to an adult who agreed); orders: the open amount; automatic reminders', async () => {
  for (const id of ['events', 'orders']) await api('PUT', `/api/modules/${id}`, { on: true });
  const ev = (await api('POST', '/api/module/events', { name: 'Diwali 2027', starts: '2027-11-01', place: 'Aigle hall', prices: { adult: 20, kid: 10 }, payBy: '2027-10-20' })).event;
  await api('POST', `/api/module/events/${ev.id}/registrations`, { household: chary.id });
  await api('POST', `/api/module/events/${ev.id}/registrations`, { person: gita.id });
  const p = await api('POST', '/api/sending/preview', { title: 'Diwali', audience: { kind: 'event', event: ev.id }, purpose: 'updates', agent: 'panduga', template: 'Hi {first_name}, see you at {event} on {date} in {place} ({people})!' });
  assert.equal(p.to.total, 2, 'the Chary family once, Gita once');
  assert.deepEqual(p.samples.map((s) => s.to).sort(), ['Anu Chary (Chary family)', 'Gita Rao']);
  assert.match(p.samples.find((s) => s.to.startsWith('Anu')).text, /Diwali 2027 on 1 November 2027 in Aigle hall \(2 adults, 1 kid\)/);
  const rem = await api('GET', `/api/order-reminders?event=${ev.id}`);
  t.script.push([{ type: 'text', text: 'Hello Anu! Just a gentle nudge: CHF 50.00 is still open for Diwali 2027, due 20 October 2027. Pay by Cash, Bank transfer, Instant online payment. Thanks!' }]);
  const o = await api('POST', '/api/sending/preview', { title: 'Pay for Diwali', audience: { kind: 'orders', event: ev.id }, purpose: 'updates', agent: 'panduga', template: rem.template });
  const anuSample = o.samples.find((s) => s.to.startsWith('Anu'));
  assert.match(anuSample.text, /^Hello Anu! Just a gentle nudge: CHF 50\.00/, 'a rewording that keeps every fact is used');
  assert.match(o.samples.find((s) => s.to.startsWith('Gita')).text, /CHF 20\.00 is still open for Diwali 2027, due 20 October 2027/);
  // automatic reminders a few days before the due date (the owner's switch is the confirmation)
  await api('PUT', `/api/order-reminders/${ev.id}`, { on: true, days: 3, agent: 'panduga' });
  t.db.kvSet('orders.remindedOn', '');
  const before = (await api('GET', '/api/sending')).runs.length;
  await upkeepTick(t.channel, Date.parse('2027-10-18T08:00:00Z'));
  await t.waitFor(async () => (await api('GET', '/api/sending')).runs.length > before);
  const auto = (await api('GET', '/api/sending')).runs[0];
  assert.deepEqual([auto.source, auto.status, auto.title], ['auto', 'running', 'Payment reminder: Diwali 2027']);
  await api('PUT', `/api/sending/runs/${auto.id}`, { action: 'stop' });
});

test('agents: participants can only stop; an organizer\'s send_to_list waits for confirm with the preview; agents never send without it', async () => {
  t.script.push([{ type: 'tool_use', id: 'tu1', name: 'sending__send_to_list', input: { to: 'list', name: 'Committee', purpose: 'updates', message: 'Hi {first_name}, agenda is out.' } }], [{ type: 'text', text: 'Prepared.' }]);
  const out = t.sent.length;
  await say('g1@g.us', ORG, '!panduga tell the committee the agenda is out');
  const res = t.claudeReqs.at(-1).messages.at(-1).content[0].content;
  assert.match(res, /Held for an organizer's confirmation: Send "Hi \{first_name\}, agenda is out\." \(updates\) as Panduga to 2 people of List: Committee \(1 on WhatsApp, 1 on Telegram\)/);
  assert.match(res, /Skipped 2: Said no to updates \(1\), Hidden in People \(1\)/);
  assert.equal(t.sent.length, out + 1, 'only the answer with the confirm code');
  const code = t.sent.at(-1).text.match(/confirm ([A-Z0-9]{4})/)[1];
  await say('g1@g.us', ORG, `confirm ${code}`);
  assert.match(t.sent.at(-1).text, /started: 2 people/);
  const runs = (await api('GET', '/api/sending')).runs;
  assert.deepEqual([runs[0].source, runs[0].status], ['agent', 'running']);
  await api('PUT', `/api/sending/runs/${runs[0].id}`, { action: 'stop' });
  // a participant: no send_to_list
  t.script.push([{ type: 'text', text: 'ok' }]);
  await say('g1@g.us', ANU, '!panduga hi');
  const names = t.toolNames(t.claudeReqs.length - 1);
  assert.ok(names.includes('sending__stop_messages') && !names.includes('sending__send_to_list'));
});

test('admin MCP: send_to_people previews and needs confirm_action; list, get, pause / resume / stop', async () => {
  const send = tool('send_to_people');
  assert.ok(send.risky);
  const text = await send.preview({ audience: { kind: 'list', list: committee.id }, purpose: 'updates', template: 'Hi {first_name}, minutes attached.', title: 'Minutes' }, x);
  assert.match(text, /Send "Minutes" \(updates\) as Panduga to 2 people of List: Committee/);
  const r = await send.run({ audience: { kind: 'list', list: committee.id }, purpose: 'updates', template: 'Hi {first_name}, minutes attached.', title: 'Minutes' }, x);
  assert.equal(r.run.status, 'running');
  assert.equal((await tool('list_sends').run({}, x)).runs[0].id, r.run.id);
  assert.equal((await tool('get_send').run({ run: r.run.id }, x)).run.title, 'Minutes');
  assert.equal((await tool('control_send').run({ run: r.run.id, action: 'pause' }, x)).status, 'paused');
  assert.equal((await tool('control_send').run({ run: r.run.id, action: 'stop' }, x)).status, 'stopped');
  assert.ok(tool('set_payment_reminders').risky);
});

test('erasing a person removes their rows in runs', async () => {
  const before = (await run(first)).recipients.length;
  await api('DELETE', `/api/people/${gita.id}`);
  assert.equal((await run(first)).recipients.length, before - 1);
});
