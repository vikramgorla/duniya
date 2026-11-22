// @ts-check
// Campaigns (083): a sequence of sends to one audience, confirmed once.
//   - Steps: a message (optionally carrying a survey), or a wait of N days. Each message step becomes a run (index.js)
//     when its turn comes, on the upkeep tick: same consent check, pace and stop signals as any run.
//   - Stop rules per person, checked before each message step: replied to an earlier step (or said stop), registered for
//     the campaign's event, paid for it (no open order), finished the survey. The end day stops the whole campaign.
//   - The campaign waits while its current run is paused; pausing or stopping the campaign pauses or stops that run.
import { randomBytes } from 'node:crypto';
import { db } from '../../core/db.js';
import { clip, fail, plural } from '../../core/config.js';
import { TENANT } from '../../core/store.js';
import { activity, bus } from '../../core/events.js';
import { cleanAudience, describe, missingFields } from './audience.js';
import { controlRun, preview, runSummary, startRun } from './index.js';

const DAY = 86400000;
const STOPS = { replied: 'They replied (or said stop)', registered: 'They registered for the event', paid: 'They paid for the event', answered: 'They finished the survey' };
const row = (id) => db.prepare('SELECT * FROM snd_campaigns WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || ''));
const need = (id) => { const r = row(id); if (!r) throw fail('No such campaign', 404); return r; };
const runOf = (c, step) => db.prepare('SELECT run FROM snd_campaign_runs WHERE tenant_id = ? AND campaign = ? AND step = ?').get(TENANT, c, step)?.run || '';
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

/** @returns {Array<{ kind: string, days?: number, template?: string, survey?: string }>} */
function cleanSteps(list) {
  const steps = (Array.isArray(list) ? list : []).slice(0, 12).map((s, i) => {
    if (s?.kind === 'wait') {
      const days = Number(s.days);
      if (!Number.isInteger(days) || days < 1 || days > 90) throw fail(`Step ${i + 1}: wait 1 to 90 days`, 400, { field: 'steps' });
      return { kind: 'wait', days };
    }
    const template = String(s?.template || '').trim().slice(0, 1500);
    if (!template) throw fail(`Step ${i + 1}: write the message`, 400, { field: 'steps' });
    return { kind: 'message', template, ...(s.survey ? { survey: String(s.survey) } : {}) };
  });
  if (!steps.some((s) => s.kind === 'message')) throw fail('Add at least one message', 400, { field: 'steps' });
  return steps;
}
const view = (c) => ({ id: c.id, title: c.title, audience: JSON.parse(c.audience), audienceText: describe(JSON.parse(c.audience)), purpose: c.purpose, agent: c.agent, event: c.event,
  steps: JSON.parse(c.steps).map((s, i) => { const run = runOf(c.id, i); return { ...s, run: run ? runSummary(run) : null, current: i === c.step && c.status === 'running' }; }),
  stops: JSON.parse(c.stops), endDay: c.end_day, noReplyLimit: c.no_reply_limit, status: c.status, reason: c.reason, step: c.step, stepAt: c.step_at || null, createdAt: c.created_at, finishedAt: c.finished_at });

/** A draft campaign and what its first message would do: { campaign, first: the preview of step 1 (its draft run is dropped) }. */
export async function campaignPreview(body = {}, by = 'panel') {
  const title = clip(body.title, 80) || 'Campaign';
  const audience = cleanAudience(body.audience);
  const steps = cleanSteps(body.steps);
  if (steps[0].kind !== 'message') throw fail('Start with a message', 400, { field: 'steps' });
  steps.forEach((s, i) => { const m = s.kind === 'message' ? missingFields(s.template, audience.kind, !!s.survey) : []; if (m.length) throw fail(`Step ${i + 1}: this audience has no {${m.join('}, {')}}`, 400, { field: 'steps' }); });
  const stops = Object.fromEntries(Object.keys(STOPS).map((k) => [k, !!body.stops?.[k]]));
  const event = String(body.event || audience.event || '');
  if ((stops.registered || stops.paid) && !event) throw fail('"Registered" and "paid" need an event: choose one', 400, { field: 'event' });
  const endDay = String(body.endDay || '').trim();
  if (endDay && !/^\d{4}-\d{2}-\d{2}$/.test(endDay)) throw fail('End day like 2027-01-10', 400, { field: 'endDay' });
  const first = await preview({ title: `${title}: step 1`, audience, purpose: body.purpose, agent: body.agent, template: steps[0].template, survey: steps[0].survey, noReplyLimit: body.noReplyLimit ?? 0 }, by, 'campaign');
  db.prepare('DELETE FROM snd_recipients WHERE tenant_id = ? AND run = ?').run(TENANT, first.run.id); // a campaign makes each step's run when it is due
  db.prepare('DELETE FROM snd_run_surveys WHERE tenant_id = ? AND run = ?').run(TENANT, first.run.id);
  db.prepare('DELETE FROM snd_runs WHERE tenant_id = ? AND id = ?').run(TENANT, first.run.id);
  const id = `cmp_${randomBytes(6).toString('hex')}`;
  db.prepare('INSERT INTO snd_campaigns (tenant_id, id, title, audience, purpose, agent, event, steps, stops, end_day, no_reply_limit, by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, id, title, JSON.stringify(audience), first.run.purpose, first.run.agent, event, JSON.stringify(steps), JSON.stringify(stops), endDay, first.run.noReplyLimit, clip(by, 60), Date.now());
  const waits = steps.filter((s) => s.kind === 'wait').reduce((a, s) => a + s.days, 0);
  const line = `Campaign "${title}": ${plural(steps.filter((s) => s.kind === 'message').length, 'message')} over about ${plural(waits, 'day')} to ${describe(audience)}. ${first.line.replace(/^Send "[^"]*"/, 'Step 1')}`
    + `${Object.entries(stops).filter(([, v]) => v).length ? ` Follow-ups skip people when: ${Object.entries(stops).filter(([, v]) => v).map(([k]) => STOPS[k].toLowerCase()).join('; ')}.` : ''}${endDay ? ` Ends ${endDay}.` : ''}`;
  return { campaign: view(row(id)), first: { to: first.to, skipped: first.skipped, samples: first.samples, estimate: first.estimate }, line };
}
/** Confirm a draft campaign: step 1 starts at the next tick. */
export function startCampaign(id, by = 'panel') {
  const c = need(id);
  if (c.status !== 'draft') throw fail('This campaign has started already', 409);
  db.prepare("UPDATE snd_campaigns SET status = 'running', step = 0, step_at = ?, by = ? WHERE tenant_id = ? AND id = ?").run(Date.now(), clip(by, 60), TENANT, c.id);
  activity('config', { summary: `Campaign started: ${c.title} (${by})` });
  bus.emit('status');
  return view(row(c.id));
}
/** Pause, resume or stop a campaign (and the run of its current step). */
export function controlCampaign(id, action, by = 'panel') {
  const c = need(id);
  const ok = { pause: ['running'], resume: ['paused'], stop: ['running', 'paused', 'draft'] }[action];
  if (!ok) throw fail('Action: pause, resume or stop', 400, { field: 'action' });
  if (!ok.includes(c.status)) throw fail(`This campaign is ${c.status}`, 409);
  const run = runOf(c.id, c.step);
  const st = run ? db.prepare('SELECT status FROM snd_runs WHERE tenant_id = ? AND id = ?').get(TENANT, run)?.status : '';
  if (run && ((action === 'pause' && st === 'running') || (action === 'resume' && st === 'paused') || (action === 'stop' && ['running', 'paused'].includes(st)))) controlRun(run, action, by);
  const status = { pause: 'paused', resume: 'running', stop: 'stopped' }[action];
  db.prepare(`UPDATE snd_campaigns SET status = ?, reason = ?${action === 'stop' ? ', finished_at = ?' : ''} WHERE tenant_id = ? AND id = ?`)
    .run(...[status, action === 'resume' ? '' : `${action === 'stop' ? 'Stopped' : 'Paused'} by ${clip(by, 40)}`, ...(action === 'stop' ? [Date.now()] : []), TENANT, c.id]);
  activity('config', { summary: `Campaign ${status}: ${c.title} (${by})` });
  bus.emit('status');
  return view(row(c.id));
}
export const getCampaign = (id) => view(need(id));
export const listCampaigns = () => db.prepare("SELECT * FROM snd_campaigns WHERE tenant_id = ? AND status <> 'draft' ORDER BY created_at DESC LIMIT 30").all(TENANT).map(view);

/** People the stop rules take out of the next message (ids of persons and households). */
function stopped(c) {
  const out = new Set(); const stops = JSON.parse(c.stops); const steps = JSON.parse(c.steps);
  if (stops.replied) for (const r of db.prepare(`SELECT r.person FROM snd_campaign_runs cr JOIN snd_recipients r ON r.tenant_id = cr.tenant_id AND r.run = cr.run
    WHERE cr.tenant_id = ? AND cr.campaign = ? AND r.status IN ('replied', 'stop')`).all(TENANT, c.id)) out.add(r.person);
  if (stops.registered && c.event && has('ev_registrations')) for (const r of db.prepare("SELECT person, household FROM ev_registrations WHERE tenant_id = ? AND event = ? AND status IN ('registered', 'waiting', 'pending') LIMIT 5000").all(TENANT, c.event)) out.add(r.household || r.person);
  if (stops.paid && c.event && has('ord_orders')) {
    const open = new Set(db.prepare("SELECT person, household FROM ord_orders WHERE tenant_id = ? AND event = ? AND status IN ('open', 'part') LIMIT 5000").all(TENANT, c.event).map((r) => r.household || r.person));
    for (const r of db.prepare("SELECT person, household FROM ord_orders WHERE tenant_id = ? AND event = ? AND status IN ('paid', 'refunded') LIMIT 5000").all(TENANT, c.event)) if (!open.has(r.household || r.person)) out.add(r.household || r.person);
  }
  const surveys = steps.filter((s) => s.survey).map((s) => s.survey);
  if (stops.answered && surveys.length && has('srv_people')) for (const s of surveys) for (const r of db.prepare('SELECT person FROM srv_people WHERE tenant_id = ? AND survey = ? AND done_at IS NOT NULL LIMIT 5000').all(TENANT, s)) out.add(r.person);
  return out;
}
const advance = (c, now) => db.prepare('UPDATE snd_campaigns SET step = step + 1, step_at = ? WHERE tenant_id = ? AND id = ?').run(now, TENANT, c.id);
async function finishCampaign(c, why) {
  db.prepare("UPDATE snd_campaigns SET status = 'done', reason = ?, finished_at = ? WHERE tenant_id = ? AND id = ?").run(why, Date.now(), TENANT, c.id);
  activity('system', { summary: `Campaign done: ${c.title}${why ? ` (${why})` : ''}` });
  bus.emit('status');
}

/** Upkeep tick: each running campaign moves on when its wait is over or its step's run has finished (bounded). */
export async function campaignsTick(now = Date.now()) {
  for (const c of db.prepare("SELECT * FROM snd_campaigns WHERE tenant_id = ? AND status = 'running' ORDER BY created_at LIMIT 10").all(TENANT)) {
    try {
      const steps = JSON.parse(c.steps);
      if (c.end_day && new Date(now).toISOString().slice(0, 10) > c.end_day) { const run = runOf(c.id, c.step); if (run) controlRun(run, 'stop', 'campaign end'); await finishCampaign(c, `ended on ${c.end_day}`); continue; }
      const s = steps[c.step];
      if (!s) { await finishCampaign(c, ''); continue; }
      if (s.kind === 'wait') { if (now >= c.step_at + s.days * DAY) advance(c, now); continue; }
      const run = runOf(c.id, c.step);
      if (run) {
        const st = db.prepare('SELECT status FROM snd_runs WHERE tenant_id = ? AND id = ?').get(TENANT, run)?.status;
        if (!st || st === 'done' || st === 'stopped') advance(c, now);
        continue;
      }
      // a message step: the audience again (with today's facts), without the people the stop rules took out
      const p = await preview({ title: `${c.title}: step ${c.step + 1}`, audience: JSON.parse(c.audience), purpose: c.purpose, agent: c.agent, template: s.template, survey: s.survey, noReplyLimit: c.no_reply_limit },
        c.by || 'campaign', 'campaign', { drop: stopped(c), now });
      db.prepare('INSERT INTO snd_campaign_runs (tenant_id, campaign, step, run) VALUES (?, ?, ?, ?)').run(TENANT, c.id, c.step, p.run.id);
      if (p.to.total) startRun(p.run.id, c.by || 'campaign'); else advance(c, now);
    } catch (e) {
      db.prepare("UPDATE snd_campaigns SET status = 'paused', reason = ? WHERE tenant_id = ? AND id = ?").run(clip(e.message, 160), TENANT, c.id);
      activity('error', { summary: `Campaign ${c.title} paused: ${e.message}` });
    }
  }
}
