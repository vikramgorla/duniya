// @ts-check
// Lists and sending (082, People step 4): send a message to an audience (audience.js), one person at a time.
//   - A run starts as a draft with its recipients and a preview (who, how many, which channel, how long at this pace,
//     who is skipped and why, three sample messages). Nothing is sent before the owner or an organizer confirms.
//   - Consent is checked again in code right before every message (purpose updates or marketing; unknown = no).
//   - Each message is written for its person: the background model rewrites the approved template with that person's
//     facts and must keep every fact word for word; otherwise the filled template goes out as it is.
//   - Pace (src/core/pace.js): sending hours, typing by length after the chat's unread messages are read, a random gap
//     between messages on WhatsApp (twice as long for people who never wrote), a longer pause every N, a daily cap
//     (new chats with warm-up; three times that for people who wrote). Telegram is fast and has no WhatsApp caps.
//   - The scheduler's upkeep tick does at most one send at a time (no timers); runs live in the database, so a restart
//     carries on. A message that was being sent when the server stopped is never sent twice (marked failed).
//   - Stop signals pause a run and tell the owner: someone says stop, several people in a row did not answer, three
//     sends in a row failed, WhatsApp logged out or stayed offline for 15 minutes. The daily cap and the sending hours
//     only make it wait; it carries on by itself.
//   - "stop" / "unsubscribe" (and the same in other languages; an agent tool for other phrasings) records "no" for
//     the purpose and confirms once; "start" records "yes" again.
import { randomBytes } from 'node:crypto';
import { db, kvGet, kvSet, logMessage } from '../../core/db.js';
import { clip, fail, plural } from '../../core/config.js';
import { usageTag } from '../../core/usage.js';
import { TENANT } from '../../core/store.js';
import { activity, bus } from '../../core/events.js';
import { personRow } from '../../core/people.js';
import { consentsOf, recordConsent } from '../../core/people-access.js';
import { isChatEnabled, setChatPrefs } from '../../core/chat-prefs.js';
import { agentForChat, bindChat, getAgent, isBuiltin, listAgents } from '../../core/agents.js';
import { chatChannel } from '../../core/chat-tools.js';
import { sendOwnerAlert } from '../../core/owner-alerts.js';
import { dmNoticeOnce } from '../../core/privacy-notice.js';
import { listEstimate, listGapMs, sendingHoursNow, takeListSend, typeBefore } from '../../core/pace.js';
import { inPersonHours } from '../../core/person-insights.js';
import { chat as modelChat } from '../../core/providers/index.js';
import { isGroup, phoneOf, splitChatId } from '../../channels/index.js';
import { changeOrHold, moduleApi } from '../index.js';
import { PURPOSES, cleanAudience, describe, fill, missingFields, resolve, usedFacts } from './audience.js';
import { sendingTools } from './tools.js';
import { campaignsTick } from './campaigns.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS snd_runs (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, purpose TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'direct', grp TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL DEFAULT '', template TEXT NOT NULL, audience TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'panel', by TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', reason TEXT NOT NULL DEFAULT '', wait TEXT NOT NULL DEFAULT '', no_reply_limit INTEGER NOT NULL DEFAULT 20,
    next_at INTEGER NOT NULL DEFAULT 0, since INTEGER NOT NULL DEFAULT 0, offline_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    started_at INTEGER, finished_at INTEGER, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS snd_runs_status ON snd_runs (tenant_id, status, next_at);
  CREATE INDEX IF NOT EXISTS snd_runs_created ON snd_runs (tenant_id, created_at);
  CREATE TABLE IF NOT EXISTS snd_recipients (
    tenant_id TEXT NOT NULL, run TEXT NOT NULL, n INTEGER NOT NULL, person TEXT NOT NULL, household TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
    chat TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '', known INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
    facts TEXT NOT NULL DEFAULT '{}', text TEXT NOT NULL DEFAULT '', at INTEGER, replied_at INTEGER, PRIMARY KEY (tenant_id, run, person)
  );
  CREATE INDEX IF NOT EXISTS snd_recipients_run ON snd_recipients (tenant_id, run, status, n);
  CREATE INDEX IF NOT EXISTS snd_recipients_person ON snd_recipients (tenant_id, person, at);
  CREATE INDEX IF NOT EXISTS snd_recipients_chat ON snd_recipients (tenant_id, chat, at);
  -- 083: the survey a run carries (each recipient gets their own link), campaigns and the runs of their steps
  CREATE TABLE IF NOT EXISTS snd_run_surveys (tenant_id TEXT NOT NULL, run TEXT NOT NULL, survey TEXT NOT NULL, PRIMARY KEY (tenant_id, run));
  CREATE TABLE IF NOT EXISTS snd_campaigns (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, audience TEXT NOT NULL, purpose TEXT NOT NULL, agent TEXT NOT NULL, event TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL, stops TEXT NOT NULL DEFAULT '{}', end_day TEXT NOT NULL DEFAULT '', no_reply_limit INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
    reason TEXT NOT NULL DEFAULT '', step INTEGER NOT NULL DEFAULT 0, step_at INTEGER NOT NULL DEFAULT 0, by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    finished_at INTEGER, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS snd_campaigns_status ON snd_campaigns (tenant_id, status, created_at);
  CREATE TABLE IF NOT EXISTS snd_campaign_runs (tenant_id TEXT NOT NULL, campaign TEXT NOT NULL, step INTEGER NOT NULL, run TEXT NOT NULL, PRIMARY KEY (tenant_id, campaign, step));
  CREATE TABLE IF NOT EXISTS snd_filters (tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, audience TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id));
`);

const rid = (p) => `${p}_${randomBytes(6).toString('hex')}`;
const MIN = 60000;
const DRAFT_MS = 24 * 3600000;
const OFFLINE_PAUSE_MS = 15 * MIN;
const QUIET_AFTER_MS = 30 * MIN; // a message counts as unanswered after half an hour
const FAILS_IN_A_ROW = 3;
const TELEGRAM_GAP_MS = 3000;
export const STATUS_WORD = { draft: 'Draft', running: 'Sending', paused: 'Paused', stopped: 'Stopped', done: 'Done' };

const runRow = (id) => db.prepare('SELECT * FROM snd_runs WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || ''));
const need = (id) => { const r = runRow(id); if (!r) throw fail('No such run', 404); return r; };
const counts = (id) => {
  const c = { waiting: 0, sending: 0, sent: 0, replied: 0, stop: 0, skipped: 0, failed: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM snd_recipients WHERE tenant_id = ? AND run = ? GROUP BY status').all(TENANT, id)) c[r.status] = r.n;
  return { ...c, total: Object.values(c).reduce((a, b) => a + b, 0), reached: c.sent + c.replied + c.stop };
};
const runView = (r) => ({ id: r.id, title: r.title, purpose: r.purpose, mode: r.mode, group: r.grp, agent: r.agent, agentName: getAgent(r.agent)?.name || '',
  template: r.template, audience: JSON.parse(r.audience || '{}'), audienceText: describe(JSON.parse(r.audience || '{}')), source: r.source, by: r.by, status: r.status,
  reason: r.reason, wait: r.wait, noReplyLimit: r.no_reply_limit, nextAt: r.next_at || null, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, counts: counts(r.id) });
/** The Surveys module's api; 409 with the reason when it is off (083). */
const surveysApi = () => moduleApi('surveys') || (() => { throw fail('Surveys is switched off (Settings → Modules)', 409, { field: 'survey' }); })();
const on = async () => new Set((await chatChannel()?.channels?.().catch(() => []) || []).filter((c) => c.state === 'on').map((c) => c.id));

/** The agent a run speaks as: the one given, else the first agent that is on (never the owner assistant). */
function agentOf(id) {
  const a = id ? getAgent(id) : listAgents().find((x) => !isBuiltin(x) && x.enabled);
  if (!a || isBuiltin(a)) throw fail(id ? 'No such agent' : 'Create an agent first: replies go to it', 400, { field: 'agent' });
  return a;
}

// ---------- per-person wording ----------
const WRITE_SYSTEM = 'You rewrite one short message for one person. Keep its language, meaning and tone, and keep every fact in <keep> exactly as written (names, amounts, dates, places). Change the wording a little so it does not read like a copy sent to many people. Add nothing new: no facts, links, promises or questions that are not in the message. Reply with the message only.';
/** The message for one recipient: the model's rewording when it kept every fact, else the filled template. */
async function personalise(template, facts, agent, feature = 'sending') {
  const base = fill(template, facts);
  const keep = usedFacts(template, facts);
  try {
    const res = await modelChat({ model: 'auto', purpose: 'background', usage: usageTag(feature, { agent }), fallback: undefined, maxTokens: 700, system: WRITE_SYSTEM,
      messages: [{ role: 'user', content: `<message>\n${base}\n</message>\n<keep>${keep.join(' | ')}</keep>` }] });
    const out = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return out && out.length <= base.length * 2 + 200 && keep.every((k) => out.includes(k)) ? out : base;
  } catch { return base; }
}

// ---------- drafts and the preview ----------
/**
 * A draft run with its recipients and the preview: { run, recipients: [...skipped first 200, then waiting], samples,
 * estimate, chatsToSwitchOn }. `visible` (agent tools): people the agent may not see are skipped; `drop` (campaigns, 083):
 * people and households the campaign's stop rules took out; `now`: the caller's clock (a campaign's tick), so a draft is as old as the tick that
 * made it. body: { title, audience, purpose, mode: direct | group, group, agent, template, noReplyLimit }.
 */
export async function preview(body = {}, by = 'panel', source = 'panel', { visible = null, drop = null, now = Date.now() } = {}) {
  const title = clip(body.title, 80) || 'Message';
  const purpose = String(body.purpose || 'updates');
  if (!PURPOSES[purpose]) throw fail('Purpose: updates or marketing', 400, { field: 'purpose' });
  const template = String(body.template || '').trim().slice(0, 1500);
  if (!template) throw fail('Write the message', 400, { field: 'template' });
  const mode = body.mode === 'group' ? 'group' : 'direct';
  const audience = mode === 'group' ? {} : cleanAudience(body.audience);
  const sv = body.survey ? surveysApi().getSurvey(body.survey) : null; // 083
  if (sv && mode === 'group') throw fail('A survey goes to people one by one, not to a group', 400, { field: 'survey' });
  if (sv && sv.status !== 'open') throw fail(`The survey "${sv.title}" is closed`, 409, { field: 'survey' });
  if (sv && template.includes('{survey_link}') && !surveysApi().linkBase()) throw fail('Links need the server\'s address: add a domain (Settings → Domains), or remove {survey_link} and let people answer in chat', 400, { field: 'template' });
  const missing = mode === 'group' ? missingFields(template, '') : missingFields(template, audience.kind, !!sv);
  if (missing.length) throw fail(`This audience has no {${missing.join('}, {')}}: remove it from the message`, 400, { field: 'template' });
  const agent = agentOf(body.agent || (mode === 'group' ? agentForChat(body.group)?.id : ''));
  const limit = Math.max(0, Math.min(500, Math.round(Number(body.noReplyLimit ?? 20)) || 0));
  let rows;
  if (mode === 'group') {
    if (!isGroup(body.group) || !isChatEnabled(body.group)) throw fail('Choose a group that is on', 400, { field: 'group' });
    rows = [{ person: '', household: '', name: 'The group', chat: body.group, channel: splitChatId(body.group).channel, known: true, status: 'waiting', reason: '', facts: {} }];
  } else {
    rows = (await resolve(audience, purpose, await on())).map((r) => (r.status !== 'waiting' ? r
      : visible && !visible(r.person) ? { ...r, status: 'skipped', reason: 'Not one of this agent\'s people', chat: '', channel: '' }
        : drop && (drop.has(r.person) || drop.has(r.household)) ? { ...r, status: 'skipped', reason: 'Taken out by the campaign\'s rules', chat: '', channel: '' } : r));
  }
  const id = rid('run');
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO snd_runs (tenant_id, id, title, purpose, mode, grp, agent, template, audience, source, by, no_reply_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(TENANT, id, title, purpose, mode, mode === 'group' ? body.group : '', agent.id, template, JSON.stringify(audience), source, clip(by, 60), limit, now);
    const ins = db.prepare('INSERT INTO snd_recipients (tenant_id, run, n, person, household, name, chat, channel, known, status, reason, facts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    rows.forEach((r, i) => ins.run(TENANT, id, i, r.person, r.household, r.name, r.chat, r.channel, r.known ? 1 : 0, r.status, r.reason, JSON.stringify(r.facts)));
    if (sv) db.prepare('INSERT INTO snd_run_surveys (tenant_id, run, survey) VALUES (?, ?, ?)').run(TENANT, id, sv.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const going = rows.filter((r) => r.status === 'waiting');
  const samples = [];
  const svFacts = sv ? { survey: sv.title, survey_link: `${surveysApi().linkBase()}/s/…` } : {};
  for (const r of going.slice(0, 3)) samples.push({ to: r.name, channel: r.channel, text: await personalise(template, { ...r.facts, ...svFacts }, agent.id, sv ? 'surveys' : 'sending') });
  const wa = going.filter((r) => r.channel === 'whatsapp');
  const est = listEstimate(wa.length + wa.filter((r) => !r.known).length); // people who never wrote wait twice as long
  const out = { run: runView(runRow(id)), samples,
    to: { total: going.length, whatsapp: wa.length, telegram: going.filter((r) => r.channel === 'telegram').length, neverWrote: wa.filter((r) => !r.known).length },
    estimate: { minutes: wa.length ? est.minutes : Math.ceil(going.length * TELEGRAM_GAP_MS / MIN), days: wa.length ? est.days : 1 },
    skipped: rows.filter((r) => r.status === 'skipped').slice(0, 200).map((r) => ({ name: r.name, reason: r.reason })),
    chatsToSwitchOn: mode === 'group' ? 0 : going.filter((r) => !isChatEnabled(r.chat)).length };
  return { ...out, line: previewLine(out) };
}

/** One line for confirmations (agent hold, admin MCP): who, how many, which channel, how long, who is skipped. */
function previewLine(p) {
  const r = p.run; const why = {};
  for (const s of p.skipped) why[s.reason] = (why[s.reason] || 0) + 1;
  return `Send "${r.title}" (${PURPOSES[r.purpose].toLowerCase()}) as ${r.agentName} to ${r.mode === 'group' ? 'the group' : `${plural(p.to.total, 'person', 'people')} of ${r.audienceText}`}`
    + `${p.to.telegram ? ` (${p.to.whatsapp} on WhatsApp, ${p.to.telegram} on Telegram)` : ''}, about ${p.estimate.days > 1 ? `${p.estimate.days} days` : `${p.estimate.minutes} minutes`} at the current pace.`
    + `${p.skipped.length ? ` Skipped ${p.skipped.length}: ${Object.entries(why).map(([k, n]) => `${k} (${n})`).join(', ')}.` : ''}${p.samples[0] ? ` Sample: "${clip(p.samples[0].text, 200)}"` : ''}`;
}

/** Confirm a draft: it starts now (the first message at the next tick within sending hours). */
export function startRun(id, by = 'panel') {
  const r = need(id);
  if (r.status !== 'draft') throw fail(`This run is ${STATUS_WORD[r.status].toLowerCase()}`, 409);
  if (!counts(r.id).waiting) throw fail('Nobody to send to: everyone is skipped', 409);
  const now = Date.now();
  db.prepare("UPDATE snd_runs SET status = 'running', started_at = ?, since = ?, next_at = 0, by = CASE WHEN by = '' THEN ? ELSE by END WHERE tenant_id = ? AND id = ?").run(now, now, clip(by, 60), TENANT, r.id);
  activity('config', { summary: `Sending started: ${r.title}, ${plural(counts(r.id).waiting, 'person', 'people')} (${by})` });
  bus.emit('status');
  return runView(runRow(r.id));
}
/** Pause, resume or stop a run. */
export function controlRun(id, action, by = 'panel') {
  const r = need(id);
  const allowed = { pause: ['running'], resume: ['paused'], stop: ['running', 'paused', 'draft'] }[action];
  if (!allowed) throw fail('Action: pause, resume or stop', 400, { field: 'action' });
  if (!allowed.includes(r.status)) throw fail(`This run is ${STATUS_WORD[r.status].toLowerCase()}`, 409);
  const now = Date.now();
  if (action === 'pause') db.prepare("UPDATE snd_runs SET status = 'paused', reason = ? WHERE tenant_id = ? AND id = ?").run(`Paused by ${clip(by, 40)}`, TENANT, r.id);
  if (action === 'resume') db.prepare("UPDATE snd_runs SET status = 'running', reason = '', wait = '', next_at = 0, since = ?, offline_at = 0 WHERE tenant_id = ? AND id = ?").run(now, TENANT, r.id);
  if (action === 'stop') db.prepare("UPDATE snd_runs SET status = 'stopped', wait = '', finished_at = ?, reason = ? WHERE tenant_id = ? AND id = ?").run(now, `Stopped by ${clip(by, 40)}`, TENANT, r.id);
  activity('config', { summary: `Sending ${action === 'stop' ? 'stopped' : action === 'pause' ? 'paused' : 'resumed'}: ${r.title} (${by})` });
  bus.emit('status');
  return runView(runRow(r.id));
}

/** The run page: the run, its counts and its recipients (status filter optional; at most 500, in sending order). */
export function runPage(id, status = '') {
  const r = need(id);
  const rows = status
    ? db.prepare('SELECT * FROM snd_recipients WHERE tenant_id = ? AND run = ? AND status = ? ORDER BY n LIMIT 500').all(TENANT, r.id, status)
    : db.prepare('SELECT * FROM snd_recipients WHERE tenant_id = ? AND run = ? ORDER BY n LIMIT 500').all(TENANT, r.id);
  return { run: runView(r), recipients: rows.map((x) => ({ person: x.person, household: x.household, name: x.name, channel: x.channel, known: !!x.known, status: x.status,
    reason: x.reason, text: x.text, at: x.at, repliedAt: x.replied_at })) };
}
/** A run's state and counts (campaign steps). */
export const runSummary = (id) => { const r = runRow(id); return r ? { id: r.id, status: r.status, reason: r.reason, wait: r.wait, counts: counts(r.id) } : null; };
/** History: the newest 50 runs (drafts left out). */
/** The last 50 runs, newest first, with the survey each carries (085: an event's and a survey's pages link to them). */
export const listRuns = () => db.prepare(`SELECT r.*, v.survey FROM snd_runs r LEFT JOIN snd_run_surveys v ON v.tenant_id = r.tenant_id AND v.run = r.id
  WHERE r.tenant_id = ? AND r.status <> 'draft' ORDER BY r.created_at DESC LIMIT 50`).all(TENANT).map((r) => ({ ...runView(r), survey: r.survey || '' }));

// ---------- saved audiences ----------
export const listFilters = () => db.prepare('SELECT id, name, audience FROM snd_filters WHERE tenant_id = ? ORDER BY lower(name)').all(TENANT)
  .map((f) => ({ id: f.id, name: f.name, audience: JSON.parse(f.audience), text: describe(JSON.parse(f.audience)) }));
export function saveFilter({ name, audience }) {
  const n = clip(name, 60);
  if (!n) throw fail('Name it, e.g. "Families with kids"', 400, { field: 'name' });
  const a = cleanAudience(audience);
  db.prepare('INSERT INTO snd_filters (tenant_id, id, name, audience, created_at) VALUES (?, ?, ?, ?, ?)').run(TENANT, rid('sf'), n, JSON.stringify(a), Date.now());
  return listFilters();
}
export function deleteFilter(id) { db.prepare('DELETE FROM snd_filters WHERE tenant_id = ? AND id = ?').run(TENANT, String(id)); return listFilters(); }

// ---------- stop signals ----------
async function pauseFor(r, reason) {
  db.prepare("UPDATE snd_runs SET status = 'paused', reason = ?, wait = '' WHERE tenant_id = ? AND id = ?").run(reason, TENANT, r.id);
  activity('system', { summary: `Sending paused: ${r.title}: ${reason}` });
  bus.emit('status');
  await sendOwnerAlert(`Duniya: sending "${r.title}" is paused: ${reason}. Look at it and resume or stop it under People → Sending.`, { kind: 'sending' });
}
async function waitFor(r, wait, until, alert = '') {
  const first = r.wait !== wait;
  db.prepare('UPDATE snd_runs SET wait = ?, next_at = ? WHERE tenant_id = ? AND id = ?').run(wait, until, TENANT, r.id);
  if (first) bus.emit('status');
  if (first && alert) await sendOwnerAlert(`Duniya: sending "${r.title}": ${alert}`, { kind: 'sending' });
}
async function finish(r) {
  db.prepare("UPDATE snd_runs SET status = 'done', wait = '', finished_at = ? WHERE tenant_id = ? AND id = ?").run(Date.now(), TENANT, r.id);
  const c = counts(r.id);
  const line = `${plural(c.reached, 'message')} sent, ${c.replied + c.stop} replied, ${c.skipped} skipped${c.failed ? `, ${c.failed} failed` : ''}`;
  activity('system', { summary: `Sending done: ${r.title}: ${line}` });
  bus.emit('status');
  await sendOwnerAlert(`Duniya: sending "${r.title}" is done: ${line}.`, { kind: 'sending' });
}
/** Several people in a row did not answer (sent since the run started or resumed, more than half an hour ago). */
function quietInARow(r, now) {
  if (!r.no_reply_limit) return false;
  const last = db.prepare("SELECT status, at FROM snd_recipients WHERE tenant_id = ? AND run = ? AND status IN ('sent', 'replied', 'stop') ORDER BY n DESC LIMIT ?").all(TENANT, r.id, r.no_reply_limit);
  return last.length === r.no_reply_limit && last.every((x) => x.status === 'sent' && x.at >= r.since && x.at < now - QUIET_AFTER_MS);
}

// ---------- one send ----------
/** A chat a run writes to is on, with the run's agent when it had none (so replies reach it). */
async function openChat(chat, agentId, by) {
  if (!isChatEnabled(chat)) setChatPrefs(chat, { enabled: true });
  if (!agentForChat(chat)) await bindChat(chat, agentId, by);
}
/** Is the WhatsApp number of a chat connected? 'open', 'gone' (logged out) or 'offline'. */
async function waState(ch, chat) {
  const st = await ch.status?.().catch(() => null);
  if (!st) return 'offline';
  const number = splitChatId(chat).account || 'main';
  const n = (st.numbers || []).find((x) => (x.id || 'main') === number) || st;
  return n.status === 'open' ? 'open' : n.status === 'logged_out' || n.status === 'not_set_up' ? 'gone' : 'offline';
}

let working = null; // the campaign step and send in progress (they go on after the upkeep tick that started them)
/** At most one message, of the run that is due first. Never two at once. */
async function step(now) {
  const r = db.prepare("SELECT * FROM snd_runs WHERE tenant_id = ? AND status = 'running' AND next_at <= ? ORDER BY next_at, created_at LIMIT 1").get(TENANT, now);
  if (!r) return;
  const ch = chatChannel();
  if (!ch?.send) return;
  if (!sendingHoursNow(now)) return waitFor(r, 'hours', now + 10 * MIN);
  if (quietInARow(r, now)) return pauseFor(r, `${r.no_reply_limit} people in a row did not answer. Check the message is welcome before you go on`);
  // 091: the next person whose usual hours include now (within the owner's sending hours); the others wait their turn
  const next = db.prepare("SELECT * FROM snd_recipients WHERE tenant_id = ? AND run = ? AND status = 'waiting' ORDER BY n LIMIT 20").all(TENANT, r.id);
  if (!next.length) return finish(r);
  const x = next.find((y) => r.mode !== 'direct' || inPersonHours(y.person, now));
  if (!x) return waitFor(r, 'hours', now + 10 * MIN);
  const skip = (reason) => db.prepare("UPDATE snd_recipients SET status = 'skipped', reason = ? WHERE tenant_id = ? AND run = ? AND person = ?").run(reason, TENANT, r.id, x.person);
  // consent and People are checked again right before the message
  if (r.mode === 'direct') {
    const p = personRow(x.person);
    if (!p || p.hidden) return skip(p ? 'Hidden in People' : 'Not in People any more');
    if (consentsOf(p.id).find((c) => c.purpose === r.purpose)?.value !== 'yes') return skip(`No consent for ${r.purpose} any more`);
  }
  const wa = x.channel === 'whatsapp';
  if (wa) {
    if (Number(kvGet('snd.waNext') || 0) > now) return;
    const state = await waState(ch, x.chat);
    if (state === 'gone') return pauseFor(r, 'WhatsApp is logged out. Link the number again, then resume');
    if (state === 'offline') {
      if (!r.offline_at) { db.prepare('UPDATE snd_runs SET offline_at = ? WHERE tenant_id = ? AND id = ?').run(now, TENANT, r.id); return waitFor(r, 'offline', now + MIN); }
      if (now - r.offline_at >= OFFLINE_PAUSE_MS) return pauseFor(r, 'WhatsApp has not been connected for 15 minutes');
      return waitFor(r, 'offline', now + MIN);
    }
    if (r.mode === 'direct') {
      try { takeListSend(splitChatId(x.chat).account || 'main', !!x.known, now); } catch (e) {
        return waitFor(r, 'cap', now + 3600000, `${e.message.replace(/ It resets tomorrow.*$/, '')}. It carries on tomorrow within the sending hours by itself.`);
      }
    }
  }
  db.prepare("UPDATE snd_runs SET wait = '', offline_at = 0 WHERE tenant_id = ? AND id = ?").run(TENANT, r.id);
  db.prepare("UPDATE snd_recipients SET status = 'sending', at = ? WHERE tenant_id = ? AND run = ? AND person = ?").run(now, TENANT, r.id, x.person);
  try {
    if (r.mode === 'direct') await openChat(x.chat, r.agent, r.by || 'sending');
    const sv = db.prepare('SELECT survey FROM snd_run_surveys WHERE tenant_id = ? AND run = ?').get(TENANT, r.id)?.survey;
    const facts = { ...JSON.parse(x.facts || '{}'), ...(sv && r.mode === 'direct' ? surveysApi().invite(sv, x.person) : {}) }; // 083: their own survey link
    let text = await personalise(r.template, facts, r.agent, sv ? 'surveys' : 'sending');
    const notice = r.mode === 'direct' ? dmNoticeOnce(phoneOf(x.chat) || x.chat) : ''; // the privacy line, once per person
    if (notice) text = `${text}\n\n_${notice}_`;
    await typeBefore(ch, x.chat, text);
    const sent = await ch.send(x.chat, text);
    logMessage({ channel: x.channel, chat: x.chat, agent: r.agent, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text, fromAgent: true });
    db.prepare("UPDATE snd_recipients SET status = 'sent', text = ?, at = ? WHERE tenant_id = ? AND run = ? AND person = ?").run(text, now, TENANT, r.id, x.person);
    activity('message.out', { agent: r.agent, chat: x.chat, summary: `List message "${r.title}" to ${x.name}`, detail: { run: r.id } });
    if (wa) { const count = Number(kvGet('snd.waCount') || 0) + 1; kvSet('snd.waCount', count); kvSet('snd.waNext', now + listGapMs({ known: !!x.known, count })); }
    db.prepare('UPDATE snd_runs SET next_at = ? WHERE tenant_id = ? AND id = ?').run(wa ? 0 : now + TELEGRAM_GAP_MS, TENANT, r.id);
  } catch (e) {
    db.prepare("UPDATE snd_recipients SET status = 'failed', reason = ? WHERE tenant_id = ? AND run = ? AND person = ?").run(clip(e.message, 160), TENANT, r.id, x.person);
    activity('error', { agent: r.agent, chat: x.chat, summary: `List message "${r.title}" to ${x.name} failed: ${e.message}` });
    const last = db.prepare("SELECT status FROM snd_recipients WHERE tenant_id = ? AND run = ? AND status IN ('sent', 'replied', 'stop', 'failed') ORDER BY n DESC LIMIT ?").all(TENANT, r.id, FAILS_IN_A_ROW);
    if (last.length === FAILS_IN_A_ROW && last.every((y) => y.status === 'failed')) await pauseFor(r, `${FAILS_IN_A_ROW} messages in a row could not be sent (${clip(e.message, 80)})`);
  }
  if (!db.prepare("SELECT 1 FROM snd_recipients WHERE tenant_id = ? AND run = ? AND status = 'waiting' LIMIT 1").get(TENANT, r.id) && runRow(r.id).status === 'running') await finish(runRow(r.id));
}

/** Upkeep tick: drafts nobody confirmed go after a day; a message cut off by a restart is marked (never sent twice); one send. */
async function upkeep(now = Date.now()) {
  const old = db.prepare("SELECT id FROM snd_runs WHERE tenant_id = ? AND status = 'draft' AND created_at < ? LIMIT 20").all(TENANT, now - DRAFT_MS);
  for (const { id } of old) { db.prepare('DELETE FROM snd_recipients WHERE tenant_id = ? AND run = ?').run(TENANT, id); db.prepare('DELETE FROM snd_runs WHERE tenant_id = ? AND id = ?').run(TENANT, id); }
  // a message still "sending" after 10 minutes was cut off (a restart): marked failed, never sent twice
  db.prepare("UPDATE snd_recipients SET status = 'failed', reason = 'Interrupted by a restart; not sent again to be safe' WHERE tenant_id = ? AND run IN (SELECT id FROM snd_runs WHERE tenant_id = ? AND status IN ('running', 'paused')) AND status = 'sending' AND at < ?").run(TENANT, TENANT, now - 10 * MIN);
  if (working) return;
  working = campaignsTick(now).then(() => step(now)).catch((e) => activity('error', { summary: `Sending: ${e.message}` })).finally(() => { working = null; });
}
/** Resolves when no message is on its way (a stop of the app waits for it: a message cut off is never sent again). */
const idle = () => working || Promise.resolve();

// ---------- replies, stop and start ----------
const STOP = /^(stop|stopp|stopper|stoppen|unsubscribe|unsub|opt ?out|arr[eê]te[rz]?|arr[eê]t|d[ée]sabonner|d[ée]sinscri(re|s|vez)|abmelden|abbestellen|basta|alto|para|pare|baja|cancelar|annulla|disiscrivi|afmelden|stoppa|бас|стоп|बंद|बंद करो|रुको|ఆపు|ఆపండి|நிறுத்து|ನಿಲ್ಲಿಸಿ)$/iu;
const START = /^(start|restart|subscribe|resume|commencer|reprendre|weiter|empezar|शुरू)$/iu;
const word = (t) => String(t || '').toLowerCase().replace(/^\//, '').replace(/[^\p{L}\p{M}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
/** The latest list message a person got (30 days): { run, purpose, title }. */
const lastRunOf = (person, now = Date.now()) => db.prepare(`SELECT s.id AS run, s.purpose, s.title, s.status FROM snd_recipients r INDEXED BY snd_recipients_person JOIN snd_runs s ON s.tenant_id = r.tenant_id AND s.id = r.run
  WHERE r.tenant_id = ? AND r.person = ? AND r.at > ? ORDER BY r.at DESC LIMIT 1`).get(TENANT, person, now - 30 * 86400000) || null;

/** Someone does not want messages (stop word or the agent tool): "no" for the purpose, the run pauses, the owner is told. */
export async function stopFor(person, how = 'Replied STOP') {
  const last = lastRunOf(person);
  const purposes = last ? [last.purpose] : Object.keys(PURPOSES);
  const already = purposes.every((p) => consentsOf(person).find((c) => c.purpose === p)?.value === 'no' && consentsOf(person).find((c) => c.purpose === p)?.known);
  for (const p of purposes) recordConsent(person, p, 'no', how);
  if (last) {
    db.prepare("UPDATE snd_recipients SET status = 'stop', replied_at = ? WHERE tenant_id = ? AND run = ? AND person = ?").run(Date.now(), TENANT, last.run, person);
    const r = runRow(last.run);
    if (r?.status === 'running') await pauseFor(r, `${personRow(person)?.name || 'Someone'} asked not to get messages (${how.toLowerCase()})`);
  }
  activity('config', { summary: `${personRow(person)?.name || 'Someone'} does not want ${purposes.join(' or ')} messages (${how})` });
  return { purposes, already };
}
const confirmText = (purposes) => `Done: you will not get ${purposes.map((p) => PURPOSES[p].toLowerCase()).join(' or ')} from us any more. Reply START if you change your mind.`;

/** Router hook for direct messages from people: replies are counted; stop / start are answered here (no model). */
async function intercept(msg, channel) {
  if (msg.isGroup || !msg.personId) return false;
  const now = Date.now();
  db.prepare("UPDATE snd_recipients SET status = 'replied', replied_at = ? WHERE tenant_id = ? AND chat = ? AND at > ? AND status = 'sent'").run(now, TENANT, msg.chat, now - 7 * 86400000);
  const w = word(msg.text);
  if (!w || w.length > 30) return false;
  if (STOP.test(w)) {
    if (!lastRunOf(msg.personId, now)) return false; // not about our messages: the agent decides
    const { purposes, already } = await stopFor(msg.personId);
    if (!already) await channel.send(msg.chat, confirmText(purposes)); // confirmed once
    return true;
  }
  if (START.test(w)) {
    const last = lastRunOf(msg.personId, now) || (() => { const r = db.prepare("SELECT purpose FROM person_consents WHERE tenant_id = ? AND person = ? AND value = 'no' AND source LIKE 'Replied STOP%' ORDER BY at DESC LIMIT 1").get(TENANT, msg.personId); return r ? { purpose: r.purpose } : null; })();
    if (!last) return false;
    recordConsent(msg.personId, last.purpose, 'yes', 'Replied START');
    await channel.send(msg.chat, `Welcome back: you will get ${PURPOSES[last.purpose].toLowerCase()} from us again. Reply STOP any time.`);
    return true;
  }
  return false;
}
export { confirmText };

// ---------- pages, held changes ----------
function personSections(person) {
  const rows = db.prepare(`SELECT r.status, r.at, s.id, s.title FROM snd_recipients r INDEXED BY snd_recipients_person JOIN snd_runs s ON s.tenant_id = r.tenant_id AND s.id = r.run
    WHERE r.tenant_id = ? AND r.person = ? AND s.status <> 'draft' ORDER BY r.at DESC LIMIT 10`).all(TENANT, person);
  const word2 = { sent: 'sent', replied: 'replied', stop: 'said stop', skipped: 'skipped', failed: 'failed', waiting: 'waiting', sending: 'sending' };
  return rows.length ? [{ title: 'Messages from lists', rows: rows.map((r) => ({ name: r.title, sub: [word2[r.status] || r.status, r.at ? { day: r.at } : ''].filter(Boolean), href: `#people/sending/${r.id}` })) }] : [];
}
/** An organizer confirmed a run an agent prepared. */
function apply(action, agent) {
  if (action.op !== 'start') throw fail('Unknown change');
  const r = startRun(action.run, agent?.name || 'an organizer');
  return `Sending "${r.title}" started: ${plural(r.counts.waiting, 'person', 'people')}, one at a time at a person's pace.`;
}
export const hold = (ctx, p) => changeOrHold(ctx, 'sending', { op: 'start', run: p.run.id }, p.line);

export const manifest = { id: 'sending', tools: sendingTools, apply, person: personSections, upkeep, idle, intercept, api: { preview, startRun } };
