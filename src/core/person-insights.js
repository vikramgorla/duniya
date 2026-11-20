// @ts-check
// What Duniya learns about people from chats that are on (091), always visible and editable on the person's page:
//   - preferences: the language they write in (stop words, in code), the hours they usually write (their messages'
//     times in the owner's time zone) and the app they answer on (WhatsApp or Telegram). Agents reply in that language
//     (the sender card says so); Lists and sending send in their hours (inside the owner's sending hours) and on their
//     app. Recomputed on the upkeep tick for people who wrote (a few per tick); the owner's own choice is never
//     overwritten ("Automatic" brings the computed value back).
//   - relationship cues: "my daughter Vedika", "my wife Rupa" in a message of a person, for agents with the switch on,
//     become suggestions in People → Suggestions (accept creates the tie, and the person if needed; reject is final).
//     Only family words; nothing else is inferred. Never saved without the owner's tap.
import { db } from './db.js';
import { clip, env, localParts } from './config.js';
import { activity, bus } from './events.js';
import { TENANT } from './store.js';
import { addTie, createPerson, listPeople, personRow } from './people.js';
import { getAgent, OWNER_AGENT_ID } from './agents.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS person_prefs (
    person TEXT PRIMARY KEY, lang TEXT NOT NULL DEFAULT '', lang_set INTEGER NOT NULL DEFAULT 0, hours_from INTEGER, hours_to INTEGER, hours_set INTEGER NOT NULL DEFAULT 0,
    app TEXT NOT NULL DEFAULT '', app_set INTEGER NOT NULL DEFAULT 0, computed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tie_suggestions (
    key TEXT PRIMARY KEY, person TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, word TEXT NOT NULL, agent TEXT NOT NULL DEFAULT '', chat TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'proposed', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tie_suggestions_status ON tie_suggestions(status, created_at);
`);

// 092: the languages Duniya tells apart. Latin-script ones by stop words; the others by their Unicode script (in code,
// no dependency); Telugu and Hindi written in Latin letters ("ela unnaru", "kya haal hai") by a short word list.
const LANGUAGES = { en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', ar: 'Arabic',
  ru: 'Russian', uk: 'Ukrainian', el: 'Greek', he: 'Hebrew', th: 'Thai', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  'te-Latn': 'Telugu in Latin letters', 'hi-Latn': 'Hindi in Latin letters' };
const STOP = {
  en: 'the and you are is it to of for in on with this that what when where will can have not my we our'.split(' '),
  fr: 'le la les et est je tu vous nous pour dans avec ce que qui une un des pas mais où quand demain merci'.split(' '),
  de: 'der die das und ist ich du sie wir nicht ein eine mit für auf wann wo ja danke morgen'.split(' '),
  es: 'el la los las y es yo tú usted para con que una un del pero cuando donde gracias mañana'.split(' '),
  it: 'il lo la gli le e è io tu voi noi per con che una un del ma quando dove grazie domani'.split(' '),
  pt: 'o a os as e é eu você nós para com que uma um do da mas quando onde obrigado amanhã'.split(' '),
  nl: 'de het en is ik jij je wij niet een met voor op wanneer waar dank morgen'.split(' '),
  // romanized: words that are not English (or another language above)
  'te-Latn': 'garu gaaru ela unnaru unnavu unnav bagunnara bagunnava bagunnanu bagundi emi enti endi emiti cheppu cheppandi chesanu chestanu chesava chesara ledu leda ledhu undi unnadi kaadu avunu sare ippudu ekkada enduku inka naku naaku meeku manam memu vastanu vasta vellu velli randi cheyyi chala chaala baga baaga tinnava tinnara annayya nenu nuvvu meeru kavali kaavali telusu teliyadu eppudu'.split(' '),
  'hi-Latn': 'kya hai hain haan nahi nahin kaise kaisa kaisi haal aap aapka tum tumhara mera meri mujhe kyun kyon kab kahan accha acha theek thik bhai yaar karo karna raha rahi rahe hoon tha thi gaya gayi abhi bahut bohot kuch chalo dekho bolo matlab shukriya dhanyavad namaste'.split(' '),
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v)]));
// [script, language]; Arabic letters → Urdu when Urdu-only letters appear, Cyrillic → Ukrainian on і ї є ґ, Han → Japanese with kana
/** @type {[RegExp, string][]} */
const SCRIPTS = [[/\p{Script=Telugu}/gu, 'te'], [/\p{Script=Devanagari}/gu, 'hi'], [/\p{Script=Tamil}/gu, 'ta'], [/\p{Script=Kannada}/gu, 'kn'], [/\p{Script=Malayalam}/gu, 'ml'],
  [/\p{Script=Bengali}/gu, 'bn'], [/\p{Script=Gujarati}/gu, 'gu'], [/\p{Script=Gurmukhi}/gu, 'pa'], [/\p{Script=Arabic}/gu, 'ar'], [/\p{Script=Cyrillic}/gu, 'ru'],
  [/\p{Script=Greek}/gu, 'el'], [/\p{Script=Hebrew}/gu, 'he'], [/\p{Script=Thai}/gu, 'th'], [/\p{Script=Hangul}/gu, 'ko'], [/[\p{Script=Hiragana}\p{Script=Katakana}]/gu, 'ja'], [/\p{Script=Han}/gu, 'zh']];
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u; const URDU = /[ٹڈڑںھہے]/u; const UKRAINIAN = /[іїєґІЇЄҐ]/u;
const MIN_MESSAGES = 3; // a language is learned (or changed) only after this many of their recent messages show it

/** The language of Latin-script words: stop words or a romanized word list, '' when fewer than 2 hits or no clear winner. */
function latinLanguage(text) {
  const score = {};
  for (const w of String(text).toLowerCase().match(/\p{L}+/gu) || []) for (const k in STOPSETS) if (STOPSETS[k].has(w)) score[k] = (score[k] || 0) + 1;
  const [best, second] = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 2 && best[1] >= (second?.[1] || 0) * 1.5 ? best[0] : '';
}
/**
 * One message's language: { lang, alt } — `alt` is the Latin-letter language of a mixed message (Telugu words with
 * English ones), decided later by the person's majority; null when the message does not tell.
 */
function messageLanguage(text) {
  const t = String(text || '');
  const latin = (t.match(/\p{Script=Latin}/gu) || []).length;
  let lang = ''; let n = 0;
  for (const [re, code] of SCRIPTS) { const c = (t.match(re) || []).length; if (c > n) { n = c; lang = code; } }
  if (lang === 'zh' && KANA.test(t)) lang = 'ja';
  if (lang === 'ar' && URDU.test(t)) lang = 'ur';
  if (lang === 'ru' && UKRAINIAN.test(t)) lang = 'uk';
  if (n >= 2) return { lang, alt: latin >= 6 && latin >= (n + latin) * 0.3 ? latinLanguage(t) || 'en' : '' };
  const l = latinLanguage(t);
  return l ? { lang: l, alt: '' } : null;
}
/**
 * The language of a person's recent messages (newest first): each message votes; a mixed message votes for the
 * person's majority when it is one of its two languages, else for its script. At least MIN_MESSAGES votes and a clear
 * winner, else `current` stays (so one message in another language changes nothing).
 */
function detectLanguage(texts, current = '') {
  const votes = {}; const mixed = [];
  for (const t of texts) { const r = messageLanguage(t); if (r?.alt) mixed.push(r); else if (r) votes[r.lang] = (votes[r.lang] || 0) + 1; }
  const lead = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const m of mixed) { const k = lead && (lead === m.alt || lead === m.lang) ? lead : m.lang; votes[k] = (votes[k] || 0) + 1; }
  const [best, second] = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return best && best[1] >= MIN_MESSAGES && best[1] >= (second?.[1] || 0) * 1.5 ? best[0] : current;
}

// ---------- preferences ----------
const pending = new Set(); // people who wrote since the last tick (bounded)
/** Router: a person wrote in a chat that is on; their preferences are recomputed on a coming tick. */
export function noteWriter(person) { if (person && pending.size < 500) pending.add(person); }

const ownerTz = () => getAgent(OWNER_AGENT_ID)?.timezone || env.timezone;
/** Their last 100 messages (WhatsApp by phone, other apps by their ids): { text, ts, channel }. */
function messagesOf(person) {
  const p = personRow(person);
  if (!p) return [];
  const ids = db.prepare('SELECT external_id FROM identities WHERE tenant_id = ? AND person = ? LIMIT 10').all(TENANT, person).map((r) => r.external_id);
  const out = new Map(); // by message id: a WhatsApp message matches both their number and their identity (092: counted once)
  for (const m of p.phone ? db.prepare('SELECT id, text, ts, channel FROM messages WHERE sender = ? AND from_agent = 0 ORDER BY id DESC LIMIT 100').all(p.phone) : []) out.set(m.id, m);
  for (const id of ids) for (const m of db.prepare('SELECT id, text, ts, channel FROM messages WHERE sender_jid = ? AND from_agent = 0 ORDER BY id DESC LIMIT 50').all(id)) out.set(m.id, m);
  return [...out.values()].sort((a, b) => b.ts - a.ts).slice(0, 100);
}
/** Recompute one person's automatic preferences (the owner's own choices stay). */
function compute(person, now = Date.now()) {
  const msgs = messagesOf(person);
  const cur = db.prepare('SELECT * FROM person_prefs WHERE person = ?').get(person) || {};
  const lang = cur.lang_set ? cur.lang : detectLanguage(msgs.slice(0, 20).map((m) => m.text), cur.lang || ''); // their 20 latest: a switch shows soon, one message does not
  let from = cur.hours_from ?? null; let to = cur.hours_to ?? null;
  if (!cur.hours_set) {
    from = null; to = null;
    const tz = ownerTz();
    const days = new Set(msgs.map((m) => localParts(tz, m.ts).date));
    if (msgs.length >= 20 && days.size >= 5) { // enough to tell: the middle 80 % of the hours they write, an hour either side, at least 6 hours
      const hours = msgs.map((m) => Number(localParts(tz, m.ts).hhmm.slice(0, 2))).sort((a, b) => a - b);
      from = Math.max(0, hours[Math.floor(hours.length * 0.1)] - 1); to = Math.min(24, hours[Math.ceil(hours.length * 0.9) - 1] + 2);
      if (to - from < 6) { const mid = Math.round((from + to) / 2); from = Math.max(0, mid - 3); to = Math.min(24, from + 6); }
    }
  }
  let app = cur.app_set ? cur.app : '';
  if (!cur.app_set) {
    const recent = msgs.slice(0, 50); const tg = recent.filter((m) => m.channel === 'telegram').length;
    if (tg && tg < recent.length) app = tg * 2 > recent.length ? 'telegram' : 'whatsapp'; // only when they use both
  }
  db.prepare(`INSERT INTO person_prefs (person, lang, lang_set, hours_from, hours_to, hours_set, app, app_set, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (person) DO UPDATE SET lang = excluded.lang, hours_from = excluded.hours_from, hours_to = excluded.hours_to, app = excluded.app, computed_at = excluded.computed_at`)
    .run(person, lang, cur.lang_set || 0, from, to, cur.hours_set || 0, app, cur.app_set || 0, now);
}
/** Upkeep tick: a few people who wrote since. Returns how many were updated. */
export function prefsTick(now = Date.now(), max = 10) {
  let n = 0;
  for (const p of pending) { pending.delete(p); try { compute(p, now); n++; } catch { /* the person may be gone */ } if (n >= max) break; }
  return n;
}
/** A person's preferences: { language, languageName, auto: { language, hours, app }, hours: { from, to } | null, app, languages (code → name) }. */
export function prefsOf(person) {
  const r = db.prepare('SELECT * FROM person_prefs WHERE person = ?').get(String(person || ''));
  if (!r) return { language: '', languageName: '', hours: null, app: '', auto: { language: true, hours: true, app: true }, languages: LANGUAGES };
  return { language: r.lang, languageName: LANGUAGES[r.lang] || '', hours: r.hours_from != null && r.hours_to != null ? { from: r.hours_from, to: r.hours_to } : null, app: r.app,
    auto: { language: !r.lang_set, hours: !r.hours_set, app: !r.app_set }, computedAt: r.computed_at || null, languages: LANGUAGES };
}
/**
 * The owner sets (or, with 'auto', gives back to the computation) a preference.
 * @param {string} person @param {{ language?: string, hoursFrom?: number|string, hoursTo?: number|string, app?: string }} [patch]
 */
export function setPrefs(person, { language, hoursFrom, hoursTo, app } = {}) {
  if (!personRow(person)) throw Object.assign(new Error('No such person'), { status: 404 });
  const cur = db.prepare('SELECT * FROM person_prefs WHERE person = ?').get(person) || { lang: '', lang_set: 0, hours_from: null, hours_to: null, hours_set: 0, app: '', app_set: 0 };
  const next = { ...cur };
  if (language !== undefined) { if (language === 'auto') next.lang_set = 0; else { if (language && !LANGUAGES[language]) throw Object.assign(new Error(`language: ${Object.keys(LANGUAGES).join(', ')} or auto`), { status: 400, field: 'language' }); next.lang = language; next.lang_set = 1; } }
  if (hoursFrom !== undefined || hoursTo !== undefined) {
    if (hoursFrom === 'auto') next.hours_set = 0;
    else {
      const a = Number(hoursFrom); const b = Number(hoursTo);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 24 || a >= b) throw Object.assign(new Error('Hours: from 0–23, to 1–24, from before to'), { status: 400, field: 'hoursFrom' });
      next.hours_from = a; next.hours_to = b; next.hours_set = 1;
    }
  }
  if (app !== undefined) { if (app === 'auto') next.app_set = 0; else { if (!['', 'whatsapp', 'telegram'].includes(app)) throw Object.assign(new Error('app: whatsapp, telegram or auto'), { status: 400, field: 'app' }); next.app = app; next.app_set = 1; } }
  db.prepare(`INSERT INTO person_prefs (person, lang, lang_set, hours_from, hours_to, hours_set, app, app_set, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (person) DO UPDATE SET lang = excluded.lang, lang_set = excluded.lang_set, hours_from = excluded.hours_from, hours_to = excluded.hours_to, hours_set = excluded.hours_set, app = excluded.app, app_set = excluded.app_set`)
    .run(person, next.lang, next.lang_set, next.hours_from, next.hours_to, next.hours_set, next.app, next.app_set, cur.computed_at ?? null);
  if (!next.lang_set || !next.hours_set || !next.app_set) compute(person);
  return prefsOf(person);
}
/** Is it within a person's usual hours now (owner's time zone)? true when unknown. */
export function inPersonHours(person, now = Date.now()) {
  const h = prefsOf(person).hours;
  if (!h) return true;
  const hour = Number(localParts(ownerTz(), now).hhmm.slice(0, 2));
  return hour >= h.from && hour < h.to;
}
/** The sender card's line: the language to answer in. */
export const prefsLine = (person) => {
  const p = prefsOf(person);
  if (!p.languageName) return '';
  if (p.language.endsWith('-Latn')) { const name = LANGUAGES[p.language.slice(0, 2)]; return `Writes ${name} in Latin letters: answer in ${name} written in Latin letters, the way they write, unless they write otherwise.`; }
  return `Writes in ${p.languageName}: answer in ${p.languageName} unless they write otherwise.`;
};

// ---------- relationship cues ----------
const WORDS = { wife: 'partner', husband: 'partner', partner: 'partner', daughter: 'child', son: 'child', kid: 'child', child: 'child',
  mother: 'parent', mom: 'parent', mum: 'parent', father: 'parent', dad: 'parent', brother: 'sibling', sister: 'sibling' };
const CUE = new RegExp(String.raw`\b[Mm]y\s+(${Object.keys(WORDS).join('|')})\s+([A-Z][\p{Ll}]+(?:\s+[A-Z][\p{Ll}]+)?)`, 'gu');
/** Router: a message from a person in a chat that is on, for an agent with relationship cues on → suggestions. */
export function noteCues(agent, msg) {
  if (!agent?.cues || !msg.personId || !msg.text) return 0;
  let n = 0;
  for (const m of String(msg.text).matchAll(CUE)) {
    const word = m[1].toLowerCase(); const name = clip(m[2], 60);
    const key = `${msg.personId}|${WORDS[word]}|${name.toLowerCase()}`;
    const r = db.prepare('INSERT OR IGNORE INTO tie_suggestions (key, person, kind, name, word, agent, chat, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'proposed\', ?)')
      .run(key, msg.personId, WORDS[word], name, word, agent.id, msg.chat, Date.now());
    if (r.changes) { n++; activity('config', { agent: agent.id, chat: msg.chat, summary: 'A family tie was suggested for People (from a conversation)' }); }
  }
  if (n) bus.emit('status');
  return n;
}
const sugView = (r) => ({ key: r.key, person: r.person, personName: personRow(r.person)?.name || 'Someone', kind: r.kind, word: r.word, name: r.name, chat: r.chat, createdAt: r.created_at });
/** People → Suggestions: the proposed ties, newest first. */
export const tieSuggestions = () => db.prepare("SELECT * FROM tie_suggestions WHERE status = 'proposed' ORDER BY created_at DESC LIMIT 50").all().filter((r) => personRow(r.person)).map(sugView);
/** Accept (the tie is made; the other person is found by their exact name, else added) or reject (never proposed again). */
export function decideTie(key, accept, by = '') {
  const r = db.prepare("SELECT * FROM tie_suggestions WHERE key = ? AND status = 'proposed'").get(String(key));
  if (!r) throw Object.assign(new Error('This suggestion is no longer open'), { status: 404 });
  db.prepare('UPDATE tie_suggestions SET status = ? WHERE key = ?').run(accept ? 'accepted' : 'rejected', r.key);
  if (!accept) { activity('config', { summary: `A suggested family tie was rejected (${by})` }); return { ok: true }; }
  const same = listPeople({ q: r.name, limit: 5 }).filter((p) => p.name.toLowerCase() === r.name.toLowerCase());
  const other = same.length === 1 ? same[0] : createPerson({ name: r.name }, by || 'a suggestion');
  // parent: the other is the sender's parent; child: the sender is the other's parent
  const [a, b] = r.kind === 'parent' ? [other.id, r.person] : [r.person, other.id];
  addTie(a, b, { kind: r.kind === 'child' ? 'parent' : r.kind });
  activity('config', { summary: `A suggested family tie was accepted (${by})` });
  return { ok: true, person: other.id };
}
/** A person was erased: what was learned about them goes. */
export function forgetPersonInsights(person) {
  db.prepare('DELETE FROM person_prefs WHERE person = ?').run(person);
  db.prepare('DELETE FROM tie_suggestions WHERE person = ?').run(person);
  pending.delete(person);
}
