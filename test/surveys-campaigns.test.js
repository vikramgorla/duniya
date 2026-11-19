// 083: People step 4b — Surveys (questions of four kinds, answered in chat through agent tools or by a person's link on
// a public page: escaped, same-origin form, rate-limited; results, CSV, person page, the sender card) and Campaigns
// (steps confirmed once, waits on a fake clock, follow-ups only to people the stop rules leave in, end day,
// pause / stop), with the admin MCP tools.
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
const say = (chat, phone, text) => t.route(t.msg({ chat, phone, senderJid: jid(phone), senderName: `P${phone.slice(-3)}`, isGroup: chat.endsWith('@g.us'), text }));
const ANU = '41790000002'; const RAVI = '41790000003'; const GITA = '41790000004';
const dayStart = Date.parse(`${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}T00:00:00Z`);
const at = (hhmm, plusDays = 0) => { for (let m = -720; m < 2160; m++) { const ts = dayStart + plusDays * 86400000 + m * 60000; const l = localParts(env.timezone, ts); if (l.hhmm === hhmm && l.date === localParts(env.timezone, dayStart + plusDays * 86400000 + 43200000).date) return ts; } throw new Error('no time'); };
async function tick(now) {
  const before = t.sent.length;
  await upkeepTick(t.channel, now);
  await new Promise((r) => setTimeout(r, 40));
  for (let i = 0; i < 40 && (await api('GET', '/api/sending')).runs.some((r) => r.counts.sending); i++) await new Promise((r) => setTimeout(r, 25));
  return t.sent.length - before;
}
const person = async (name, phone) => { const p = await api('POST', '/api/people', { name, phone }); await api('PUT', `/api/people/${p.id}/consents`, { purpose: 'updates', value: 'yes' }); return p; };
const anu = await person('Anu', ANU); const ravi = await person('Ravi', RAVI); const gita = await person('Gita', GITA);
const club = await api('POST', '/api/lists', { name: 'Club' });
for (const p of [anu, ravi, gita]) await api('PUT', `/api/lists/${club.id}/members/${p.id}`);
for (const id of ['sending', 'surveys']) await api('PUT', `/api/modules/${id}`, { on: true });
let survey; let link;

test('a survey is validated; questions of four kinds; changing the kind after answers is refused', async () => {
  assert.equal((await t.api(owner, 'POST', '/api/surveys', { title: 'X', questions: [{ text: 'Pick', kind: 'single', options: ['only one'] }] })).body.field, 'questions');
  survey = await api('POST', '/api/surveys', { title: 'Picnic <b>day</b>', intro: 'Two minutes, promise.', questions: [
    { text: 'Which Sunday?', kind: 'single', options: ['14 June', '21 June'] }, { text: 'What will you bring?', kind: 'multi', options: ['Salad', 'Dessert', 'Drinks'] },
    { text: 'How many people?', kind: 'number' }, { text: 'Anything else?', kind: 'text', required: false }] });
  assert.deepEqual(survey.questions.map((q) => [q.id, q.kind, q.required]), [['q1', 'single', true], ['q2', 'multi', true], ['q3', 'number', true], ['q4', 'text', false]]);
  assert.equal((await api('GET', '/api/surveys'))[0].counts.invited, 0);
});

test('sent with a list message: each person gets their own link; the link page is escaped, same-origin, rate-limited', async () => {
  const p = await api('POST', '/api/sending/preview', { title: 'Picnic survey', audience: { kind: 'list', list: club.id }, purpose: 'updates', agent: 'panduga', survey: survey.id,
    template: 'Hi {first_name}, quick question about {survey}: answer here or at {survey_link}' });
  assert.match(p.samples[0].text, /\/s\/…$/);
  await api('POST', `/api/sending/runs/${p.run.id}/start`);
  const now = at('10:00');
  await tick(now); await tick(now + 400000); await tick(now + 800000);
  const toAnu = t.sent.find((m) => m.chat === jid(ANU));
  link = toAnu.text.match(/(http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]+)/)[1];
  const toRavi = t.sent.find((m) => m.chat === jid(RAVI)).text.match(/\/s\/([A-Za-z0-9_-]+)/)[1];
  assert.notEqual(link.split('/s/')[1], toRavi, 'one link per person');
  assert.equal((await api('GET', `/api/surveys/${survey.id}`)).counts.invited, 3);
  assert.equal((await api('GET', '/api/sending')).runs.find((r) => r.id === p.run.id).survey, survey.id, '085: the history says which survey a message carried');
  const page = await fetch(link);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(html.includes('Picnic &#60;b&#62;day&#60;/b&#62;') && !html.includes('<b>day'), 'the title is text, not HTML');
  assert.equal((await fetch(`${t.base}/s/not-a-real-token-at-all-xx`)).status, 404);
  const post = (body, origin = t.base) => fetch(link, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) }, body });
  assert.equal((await post('q1=14+June', '')).status, 403, 'no Origin: refused');
  assert.equal((await post('q1=14+June', 'https://evil.example')).status, 403, 'another site: refused');
  const half = await post('q1=14+June');
  assert.equal(half.status, 400);
  assert.match(await half.text(), /What will you bring\?.*choose one or more|Please answer|a number/s);
  const full = await post('q1=21+June&q2=Salad&q2=Drinks&q3=4&q4=');
  assert.match(await full.text(), /Thank you!/);
  const r = await api('GET', `/api/surveys/${survey.id}`);
  assert.deepEqual([r.counts.started, r.counts.done], [1, 1]);
  assert.deepEqual(r.totals[1].options, [{ option: 'Salad', count: 1 }, { option: 'Dessert', count: 0 }, { option: 'Drinks', count: 1 }]);
  assert.equal(r.totals[2].average, 4);
  assert.deepEqual(r.people.find((y) => y.person === anu.id).answers, { q1: '21 June', q2: ['Salad', 'Drinks'], q3: 4 });
  assert.ok((await api('GET', `/api/people/${anu.id}`)).modules.some((s) => s.title === 'Surveys'));
  const csv = await t.api(owner, 'GET', `/api/surveys/${survey.id}/csv`);
  assert.match(csv.body, /"Anu","\d{4}-\d{2}-\d{2}","link","21 June","Salad; Drinks","4",""/);
});

test('in chat: the sender card names the next question; the agent records answers one by one, checked in code', async () => {
  const turn = async (name, input) => {
    t.script.push([{ type: 'tool_use', id: `tu${t.claudeReqs.length}`, name, input }], [{ type: 'text', text: 'ok' }]);
    await say(jid(RAVI), RAVI, 'sure, 14 June');
    const req = t.claudeReqs.at(-1);
    return { result: req.messages.at(-1).content[0].content, card: JSON.stringify(t.claudeReqs.at(-2).messages[0].content) };
  };
  const a = await turn('surveys__answer_survey', { question: 'q1', answer: '1' });
  assert.match(a.card, /Open survey for them: \\"Picnic <b>day<\/b>\\" \(0 of 4 answered\)/);
  assert.match(a.result, /"answered":"1 of 4".*"question":"What will you bring\?"/);
  const bad = await turn('surveys__answer_survey', { question: 'q2', answer: 'Cake' });
  assert.match(bad.result, /choose one or more of Salad, Dessert, Drinks/);
  await turn('surveys__answer_survey', { question: 'q2', answer: 'dessert and drinks' });
  await turn('surveys__answer_survey', { question: 'q3', answer: 'three' }).then((r) => assert.match(r.result, /a number, please/));
  await turn('surveys__answer_survey', { question: 'q3', answer: '3' });
  const done = await turn('surveys__answer_survey', { question: 'q4', skip: true });
  assert.match(done.result, /complete: thank them/);
  const r = await api('GET', `/api/surveys/${survey.id}`);
  assert.deepEqual(r.people.find((y) => y.person === ravi.id).answers, { q1: '14 June', q2: ['Dessert', 'Drinks'], q3: 3, q4: null });
  assert.equal(r.counts.done, 2);
  assert.equal(r.totals[2].average, 3.5);
  const res = await tool('get_survey_results').run({ survey: survey.id }, x);
  assert.equal(res.totals[0].options.find((o) => o.option === '14 June').count, 1);
});

test('the link page is rate-limited per address', async () => {
  let last = 200;
  for (let i = 0; i < 35; i++) last = (await fetch(link)).status;
  assert.equal(last, 429);
});

test('a campaign: confirmed once; a message, a wait, a follow-up only to people who did not reply; pause and stop', async () => {
  const bad = await t.api(owner, 'POST', '/api/sending/campaigns/preview', { audience: { kind: 'list', list: club.id }, purpose: 'updates', agent: 'panduga', steps: [{ kind: 'wait', days: 1 }, { kind: 'message', template: 'x' }] });
  assert.deepEqual([bad.status, bad.body.field], [400, 'steps']);
  const pv = await api('POST', '/api/sending/campaigns/preview', { title: 'Picnic', audience: { kind: 'list', list: club.id }, purpose: 'updates', agent: 'panduga',
    steps: [{ kind: 'message', template: 'Hi {first_name}, picnic on the 21st!' }, { kind: 'wait', days: 2 }, { kind: 'message', template: 'Hi {first_name}, coming to the picnic?' }], stops: { replied: true } });
  assert.match(pv.line, /Campaign "Picnic": 2 messages over about 2 days to List: Club\. Step 1 \(updates\) as Panduga to 3 people/);
  assert.match(pv.line, /Follow-ups skip people when: they replied \(or said stop\)/);
  const c = await api('POST', `/api/sending/campaigns/${pv.campaign.id}/start`);
  assert.equal(c.status, 'running');
  const d = at('10:00', 2);
  await tick(d); // step 1's run is made and its first message goes out
  await tick(d + 400000); await tick(d + 800000);
  let g = await api('GET', `/api/sending/campaigns/${c.id}`);
  assert.equal(g.steps[0].run.counts.reached, 3);
  t.script.push([{ type: 'text', text: 'Great!' }]);
  await say(jid(GITA), GITA, 'yes we come');
  await tick(d + 1200000); // the run finishes → the wait starts
  g = await api('GET', `/api/sending/campaigns/${c.id}`);
  assert.equal(g.step, 1);
  await tick(d + 86400000); // one day later: still waiting
  assert.equal((await api('GET', `/api/sending/campaigns/${c.id}`)).step, 1);
  await tick(at('10:00', 4) + 1200000); // after two days: the follow-up starts
  await tick(at('10:00', 4) + 1300000);
  g = await api('GET', `/api/sending/campaigns/${c.id}`);
  assert.equal(g.step, 2);
  const run = await api('GET', `/api/sending/runs/${g.steps[2].run.id}`);
  assert.deepEqual(run.recipients.filter((r) => r.status === 'skipped').map((r) => [r.name, r.reason]), [['Gita', 'Taken out by the campaign\'s rules']]);
  assert.equal((await tool('control_campaign').run({ campaign: c.id, action: 'pause' }, x)).status, 'paused');
  assert.equal((await api('GET', `/api/sending/runs/${g.steps[2].run.id}`)).run.status, 'paused', 'the current run pauses with it');
  assert.equal((await tool('control_campaign').run({ campaign: c.id, action: 'stop' }, x)).status, 'stopped');
  assert.equal((await api('GET', `/api/sending/runs/${g.steps[2].run.id}`)).run.status, 'stopped');
});

test('admin MCP: start_campaign previews and needs a confirm; the end day ends a campaign', async () => {
  assert.ok(tool('start_campaign').risky && tool('delete_survey').risky);
  const args = { title: 'Short', audience: { kind: 'list', list: club.id }, purpose: 'updates', agent: 'panduga', steps: [{ kind: 'message', template: 'Hi {first_name}' }, { kind: 'wait', days: 5 }, { kind: 'message', template: 'Again {first_name}' }], end_day: '2020-01-01' };
  assert.match(await tool('start_campaign').preview(args, x), /Ends 2020-01-01\./);
  const c = await tool('start_campaign').run(args, x);
  await tick(at('11:00', 6));
  const g = await api('GET', `/api/sending/campaigns/${c.id}`);
  assert.deepEqual([g.status, g.reason], ['done', 'ended on 2020-01-01']);
  assert.ok((await tool('list_sends').run({}, x)).campaigns.some((y) => y.id === c.id));
});
