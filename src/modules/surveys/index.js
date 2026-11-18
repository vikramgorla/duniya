// @ts-check
// Surveys module (083): short forms people answer in chat or by a link.
//   - A survey: title, a short intro, questions (single choice, multiple choice, short text, number; required or not),
//     open or closed. Sent to people through Lists and sending (082): a run with a survey invites each recipient.
//   - In chat: the agent asks question by question and records each answer with its tools (validated here, in code);
//     the sender card tells the agent that the person has an open survey and which question is next.
//   - By link: one link per person (`/s/<token>`; only a hash is stored), a small server page with a plain form, no
//     login, rate-limited, every text escaped. Answers from the link and from chat land in the same rows.
//   - Results: totals per question, answers per person, CSV; a person's page lists their answers.
import { createHash, randomBytes } from 'node:crypto';
import { db, kvGet, kvSet } from '../../core/db.js';
import { clip, fail, plural } from '../../core/config.js';
import { TENANT } from '../../core/store.js';
import { activity } from '../../core/events.js';
import { addEvent, personRow } from '../../core/people.js';
import { current as webHost } from '../../core/webaccess.js';
import { surveyTools } from './tools.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS srv_surveys (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '', questions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS srv_surveys_created ON srv_surveys (tenant_id, created_at);
  CREATE TABLE IF NOT EXISTS srv_people (
    tenant_id TEXT NOT NULL, survey TEXT NOT NULL, person TEXT NOT NULL, token TEXT NOT NULL, invited_at INTEGER NOT NULL,
    started_at INTEGER, done_at INTEGER, via TEXT NOT NULL DEFAULT '', PRIMARY KEY (tenant_id, survey, person)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS srv_people_token ON srv_people (token);
  CREATE INDEX IF NOT EXISTS srv_people_person ON srv_people (tenant_id, person, done_at);
  CREATE TABLE IF NOT EXISTS srv_answers (
    tenant_id TEXT NOT NULL, survey TEXT NOT NULL, person TEXT NOT NULL, q TEXT NOT NULL, value TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, survey, person, q)
  );
  CREATE INDEX IF NOT EXISTS srv_answers_person ON srv_answers (tenant_id, person);
`);

const rid = (p) => `${p}_${randomBytes(6).toString('hex')}`;
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
export const KINDS = { single: 'One choice', multi: 'Several choices', text: 'Short text', number: 'A number' };
const MAX_Q = 20;

// ---------- surveys ----------
const row = (id) => db.prepare('SELECT * FROM srv_surveys WHERE tenant_id = ? AND id = ?').get(TENANT, String(id || ''));
const view = (r) => ({ id: r.id, title: r.title, intro: r.intro, questions: JSON.parse(r.questions), status: r.status, createdAt: r.created_at });
export function getSurvey(id) { const r = row(id); if (!r) throw fail('No such survey', 404); return view(r); }
/** A survey by id or (part of) its title, newest first. */
export function findSurvey(ref) {
  const r = String(ref || '').trim();
  const hit = row(r) || db.prepare('SELECT * FROM srv_surveys WHERE tenant_id = ? AND lower(title) LIKE ? ORDER BY created_at DESC LIMIT 1').get(TENANT, `%${r.toLowerCase()}%`);
  if (!hit) throw fail(`No survey matches "${clip(r, 40)}"`);
  return view(hit);
}
const cleanQuestions = (list) => {
  const qs = (Array.isArray(list) ? list : []).slice(0, MAX_Q).map((q, i) => {
    const text = clip(q?.text, 200);
    if (!text) throw fail(`Question ${i + 1}: write the question`, 400, { field: 'questions' });
    const kind = KINDS[q.kind] ? q.kind : 'text';
    const options = kind === 'single' || kind === 'multi' ? [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => clip(o, 80)).filter(Boolean))].slice(0, 12) : [];
    if ((kind === 'single' || kind === 'multi') && options.length < 2) throw fail(`Question ${i + 1}: give at least two choices`, 400, { field: 'questions' });
    return { id: q.id && /^q\d+$/.test(q.id) ? q.id : `q${i + 1}`, text, kind, options, required: q.required !== false };
  });
  if (!qs.length) throw fail('Add at least one question', 400, { field: 'questions' });
  const ids = new Set(); for (const q of qs) { while (ids.has(q.id)) q.id = `${q.id}x`; ids.add(q.id); }
  return qs;
};
/** Create or change a survey: { id?, title, intro, questions: [{ text, kind, options, required }], status }. */
export function saveSurvey(body = {}, by = 'panel') {
  const cur = body.id ? getSurvey(body.id) : null;
  const title = clip(body.title ?? cur?.title, 80);
  if (!title) throw fail('A survey needs a title', 400, { field: 'title' });
  const questions = body.questions !== undefined ? cleanQuestions(body.questions) : cur?.questions || cleanQuestions([]);
  if (cur && body.questions !== undefined && answered(cur.id) && JSON.stringify(questions.map((q) => [q.id, q.kind])) !== JSON.stringify(cur.questions.map((q) => [q.id, q.kind]))) {
    throw fail('People have answered already: you can reword questions and choices, but not add, remove or change their kind', 409, { field: 'questions' });
  }
  const status = ['open', 'closed'].includes(body.status) ? body.status : cur?.status || 'open';
  const vals = [title, clip(body.intro ?? cur?.intro ?? '', 400), JSON.stringify(questions), status];
  const id = cur?.id || rid('sv');
  if (cur) db.prepare('UPDATE srv_surveys SET title = ?, intro = ?, questions = ?, status = ? WHERE tenant_id = ? AND id = ?').run(...vals, TENANT, id);
  else db.prepare('INSERT INTO srv_surveys (title, intro, questions, status, tenant_id, id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...vals, TENANT, id, Date.now());
  activity('config', { summary: `Survey ${cur ? 'changed' : 'created'}: ${title} (${by})` });
  return getSurvey(id);
}
const answered = (id) => !!db.prepare('SELECT 1 FROM srv_answers WHERE tenant_id = ? AND survey = ? LIMIT 1').get(TENANT, id);
export function deleteSurvey(id, by = 'panel') {
  const s = getSurvey(id);
  for (const t of ['srv_answers', 'srv_people']) db.prepare(`DELETE FROM ${t} WHERE tenant_id = ? AND survey = ?`).run(TENANT, s.id);
  db.prepare('DELETE FROM srv_surveys WHERE tenant_id = ? AND id = ?').run(TENANT, s.id);
  activity('config', { summary: `Survey deleted: ${s.title} (${by})` });
  return { ok: true };
}
const countsOf = (id) => db.prepare('SELECT COUNT(*) AS invited, COUNT(started_at) AS started, COUNT(done_at) AS done FROM srv_people WHERE tenant_id = ? AND survey = ?').get(TENANT, id);
/** Surveys, newest first, with how many were invited, started and finished. */
export const listSurveys = () => db.prepare('SELECT * FROM srv_surveys WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100').all(TENANT).map((r) => ({ ...view(r), counts: { ...countsOf(r.id) } }));

// ---------- invitations and links ----------
/** Where links point: PUBLIC_URL, else the server's domain, else the address the panel was last opened at. */
export const noteBase = (base) => { if (base && kvGet('surveys.base') !== base) kvSet('surveys.base', base); };
function linkBase() {
  const fixed = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  let host = ''; try { host = webHost().host || ''; } catch { /* no domain */ }
  return host ? `https://${host}` : String(kvGet('surveys.base') || '');
}
/** Invite a person (Lists and sending, per recipient): { survey, survey_link } facts. A new link replaces the old one. */
export function invite(survey, person) {
  const s = getSurvey(survey);
  if (s.status !== 'open') throw fail(`The survey "${s.title}" is closed`, 409);
  const token = randomBytes(18).toString('base64url');
  db.prepare(`INSERT INTO srv_people (tenant_id, survey, person, token, invited_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET token = excluded.token`).run(TENANT, s.id, person, sha(token), Date.now());
  const base = linkBase();
  return { survey: s.title, survey_link: base ? `${base}/s/${token}` : '' };
}
/** The survey and person behind a link token (null when unknown or closed). */
export function byToken(token) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(token || ''))) return null;
  const r = db.prepare('SELECT * FROM srv_people WHERE token = ?').get(sha(token));
  if (!r || r.tenant_id !== TENANT) return null;
  const s = row(r.survey);
  return s ? { survey: view(s), person: r.person, done: !!r.done_at, answers: answersOf(r.survey, r.person) } : null;
}

// ---------- answers ----------
const answersOf = (survey, person) => Object.fromEntries(db.prepare('SELECT q, value FROM srv_answers WHERE tenant_id = ? AND survey = ? AND person = ?').all(TENANT, survey, person).map((a) => [a.q, JSON.parse(a.value)]));
/** A checked answer for a question, or a 400 that says what fits. */
function checkAnswer(q, value) {
  const s = (v) => String(v ?? '').trim();
  if (q.kind === 'number') {
    const n = Number(s(value).replace(',', '.'));
    if (!s(value) || !Number.isFinite(n)) throw fail(`"${q.text}": a number, please`, 400, { field: q.id });
    return n;
  }
  if (q.kind === 'text') { const t = clip(value, 500); if (!t) throw fail(`"${q.text}": write an answer`, 400, { field: q.id }); return t; }
  const pick = (v) => { const t = s(v).toLowerCase(); const n = Number(t); return q.options.find((o) => o.toLowerCase() === t) || (Number.isInteger(n) && n >= 1 && n <= q.options.length ? q.options[n - 1] : '') || q.options.find((o) => o.toLowerCase().startsWith(t) && t); };
  const vals = (Array.isArray(value) ? value : q.kind === 'multi' ? s(value).split(/\s*[,;]\s*|\s+and\s+/i) : [value]).filter((v) => s(v));
  const picked = [...new Set(vals.map(pick))];
  if (!picked.length || picked.some((x) => !x)) throw fail(`"${q.text}": choose ${q.kind === 'multi' ? 'one or more of' : 'one of'} ${q.options.join(', ')}`, 400, { field: q.id });
  if (q.kind === 'single' && picked.length > 1) throw fail(`"${q.text}": choose just one`, 400, { field: q.id });
  return q.kind === 'single' ? picked[0] : picked;
}
/** The first question still to answer (required ones, then optional ones not yet seen), or null when done. */
function nextQuestion(s, answers) { return s.questions.find((q) => !Object.hasOwn(answers, q.id)) || null; }
/** Record answers ({ questionId: value }) from chat or the link; returns { done, next, answered }. */
export function answer(surveyId, person, given = {}, via = 'chat') {
  const s = getSurvey(surveyId);
  if (s.status !== 'open') throw fail(`The survey "${s.title}" is closed`, 409);
  const now = Date.now();
  const checked = [];
  for (const [qid, v] of Object.entries(given)) {
    const q = s.questions.find((x) => x.id === qid);
    if (!q) throw fail(`No question ${clip(qid, 20)} in this survey`);
    if ((v === '' || v === null || (Array.isArray(v) && !v.length)) && !q.required) continue;
    checked.push([q.id, checkAnswer(q, v)]);
  }
  const ins = db.prepare('INSERT INTO srv_answers (tenant_id, survey, person, q, value, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value, at = excluded.at');
  for (const [q, v] of checked) ins.run(TENANT, s.id, person, q, JSON.stringify(v), now);
  db.prepare(`INSERT INTO srv_people (tenant_id, survey, person, token, invited_at, started_at, via) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET started_at = COALESCE(started_at, excluded.started_at), via = excluded.via`).run(TENANT, s.id, person, sha(randomBytes(18)), now, now, via);
  const answers = answersOf(s.id, person);
  const missing = s.questions.filter((q) => q.required && !Object.hasOwn(answers, q.id));
  const next = nextQuestion(s, answers);
  const done = !missing.length && (!next || via === 'link');
  if (done && !db.prepare('SELECT done_at FROM srv_people WHERE tenant_id = ? AND survey = ? AND person = ?').get(TENANT, s.id, person)?.done_at) {
    db.prepare('UPDATE srv_people SET done_at = ? WHERE tenant_id = ? AND survey = ? AND person = ?').run(now, TENANT, s.id, person);
    addEvent(person, `Answered the survey "${s.title}"`);
  }
  return { done, next: done ? null : next, answered: Object.keys(answers).length, of: s.questions.length };
}
/** Skip an optional question in chat. */
export function skip(surveyId, person, qid) {
  const s = getSurvey(surveyId); const q = s.questions.find((x) => x.id === qid);
  if (!q) throw fail('No such question');
  if (q.required) throw fail(`"${q.text}" needs an answer`);
  db.prepare('INSERT OR IGNORE INTO srv_answers (tenant_id, survey, person, q, value, at) VALUES (?, ?, ?, ?, ?, ?)').run(TENANT, s.id, person, q.id, 'null', Date.now());
  return answer(s.id, person, {}, 'chat');
}
/** A person's surveys still open for them: [{ survey, next, answered, of }] (invited or started, not done). */
export function openFor(person) {
  return db.prepare(`SELECT p.survey FROM srv_people p INDEXED BY srv_people_person JOIN srv_surveys s ON s.tenant_id = p.tenant_id AND s.id = p.survey
    WHERE p.tenant_id = ? AND p.person = ? AND p.done_at IS NULL AND s.status = 'open' ORDER BY p.invited_at DESC LIMIT 5`).all(TENANT, person).map((r) => {
    const s = getSurvey(r.survey); const a = answersOf(s.id, person);
    return { survey: s, next: nextQuestion(s, a), answered: Object.keys(a).length, of: s.questions.length };
  });
}

// ---------- results ----------
/** Totals per question and the answers per person (≤ 500 people), for the panel, CSV and the owner assistant. */
export function results(id) {
  const s = getSurvey(id);
  const totals = s.questions.map((q) => {
    const vals = db.prepare("SELECT value FROM srv_answers WHERE tenant_id = ? AND survey = ? AND q = ? AND value <> 'null' ORDER BY at DESC LIMIT 5000").all(TENANT, s.id, q.id).map((r) => JSON.parse(r.value));
    if (q.kind === 'number') { const n = vals.map(Number); return { id: q.id, text: q.text, kind: q.kind, answers: n.length, ...(n.length ? { average: Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 100) / 100, min: Math.min(...n), max: Math.max(...n), sum: n.reduce((a, b) => a + b, 0) } : {}) }; }
    if (q.kind === 'text') return { id: q.id, text: q.text, kind: q.kind, answers: vals.length, latest: vals.slice(0, 20) };
    const count = Object.fromEntries(q.options.map((o) => [o, 0]));
    for (const v of vals) for (const o of [].concat(v)) if (Object.hasOwn(count, o)) count[o]++;
    return { id: q.id, text: q.text, kind: q.kind, answers: vals.length, options: q.options.map((o) => ({ option: o, count: count[o] })) };
  });
  const people = db.prepare('SELECT person, invited_at, started_at, done_at, via FROM srv_people WHERE tenant_id = ? AND survey = ? ORDER BY COALESCE(done_at, started_at, invited_at) DESC LIMIT 500').all(TENANT, s.id)
    .map((p) => ({ person: p.person, name: personRow(p.person)?.name || 'Someone', invitedAt: p.invited_at, startedAt: p.started_at, doneAt: p.done_at, via: p.via, answers: answersOf(s.id, p.person) }));
  return { survey: s, counts: { ...countsOf(s.id) }, totals, people };
}
const cell = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v));
export const csvRows = (id) => { const r = results(id); return [['Person', 'Finished', 'Via', ...r.survey.questions.map((q) => q.text)],
  ...r.people.map((p) => [p.name, p.doneAt ? new Date(p.doneAt).toISOString().slice(0, 10) : '', p.via, ...r.survey.questions.map((q) => cell(p.answers[q.id]))])]; };

// ---------- pages, the sender card ----------
function personSections(person) {
  const rows = db.prepare(`SELECT p.survey, p.done_at, s.title, s.questions FROM srv_people p INDEXED BY srv_people_person JOIN srv_surveys s ON s.tenant_id = p.tenant_id AND s.id = p.survey
    WHERE p.tenant_id = ? AND p.person = ? ORDER BY p.invited_at DESC LIMIT 10`).all(TENANT, person);
  return rows.length ? [{ title: 'Surveys', rows: rows.map((r) => { const a = answersOf(r.survey, person); const qs = JSON.parse(r.questions);
    return { name: r.title, sub: r.done_at ? qs.filter((q) => a[q.id] !== undefined && a[q.id] !== null).map((q) => `${q.text} ${cell(a[q.id])}`).join(' · ') : `${Object.keys(a).length} of ${plural(qs.length, 'question')} answered`, href: `#people/surveys/${r.survey}` }; }) }] : [];
}
/** A line for the sender card: an open survey and its next question (so the agent asks it). */
function card(person) {
  const o = openFor(person).find((x) => x.next);
  return o ? `Open survey for them: "${o.survey.title}" (${o.answered} of ${o.of} answered). If they are answering it, ask the next question ("${o.next.text}") and record answers with the survey tools.` : '';
}

export const manifest = { id: 'surveys', tools: surveyTools, person: personSections, card, api: { invite, getSurvey, linkBase } };
