// @ts-check
// Self-check of facts (088): before an agent's answer goes out, the amounts, dates and counts it states are compared,
// in code, with what People, Events, Orders, Surveys and Sending returned in that same turn (their tool results and
// the sender card). An amount that belongs to another person in the records counts as wrong too. Nothing here calls a
// model; the runner asks the model once to rewrite a wrong answer, and sends a plain answer when it is still wrong.
// Only answers that used those records are checked; the result is counts only (shown as "checked" in Activity).

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const CUR = String.raw`CHF|EUR|USD|INR|GBP|SFr\.?|Fr\.?|Rs\.?|€|\$|£|₹`;
const NUM = String.raw`\d{1,3}(?:[',]\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MONEY = new RegExp(String.raw`(?:(?:${CUR})\s?(${NUM}))|(?:(${NUM})\s?(?:${CUR}|francs?|euros?|dollars?|rupees?|\.-))`, 'gi');
const COUNT = /\b(\d{1,5})\s+(?:people|persons|families|households|registrations|orders|members|guests|adults|kids|children|answers|responses|places|seats|tickets|volunteers)\b/gi;
const ISO = /\b(\d{4})-(\d{2})-(\d{2})/g;
const DMY = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/g;
const DAY_MONTH = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTHS.join('|')})[a-z]*\.?`, 'gi');
const MONTH_DAY = new RegExp(String.raw`\b(${MONTHS.join('|')})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'gi');

const cents = (s) => {
  const t = String(s).replace(/[' ]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};
const md = (m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Amounts (in cents) stated in a text. */
export function amountsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(MONEY)) { const c = cents(m[1] ?? m[2]); if (c != null) out.push(c); }
  return out;
}
/** Dates stated in a text as "MM-DD" keys (years ignored; "12.03." is read day-first, and month-first too). */
function datesIn(text, { both = false } = {}) {
  const s = String(text); const out = new Set();
  for (const m of s.matchAll(ISO)) { const k = md(+m[2], +m[3]); if (k) out.add(k); }
  const noIso = s.replace(ISO, ' ');
  for (const m of noIso.matchAll(DMY)) {
    if (!m[3] && !/\./.test(m[0]) && !/\//.test(m[0])) continue;
    const a = md(+m[2], +m[1]); if (a) out.add(a);
    if (both) { const b = md(+m[1], +m[2]); if (b) out.add(b); }
  }
  for (const m of s.matchAll(DAY_MONTH)) { const k = md(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]); if (k) out.add(k); }
  for (const m of s.matchAll(MONTH_DAY)) { const k = md(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]); if (k) out.add(k); }
  return out;
}
/** The dates a reply states (one key per date written; "12/03" may be either way round). */
function replyDates(text) {
  const s = String(text); const out = [];
  for (const m of s.matchAll(ISO)) { const k = md(+m[2], +m[3]); if (k) out.push({ text: m[0], keys: [k] }); }
  for (const m of s.replace(ISO, ' ').matchAll(DMY)) {
    if (!m[3] && !/[./]$/.test(m[0]) && !m[0].includes('/')) continue; // "12.03." or "12/03" or with a year; not "3.5"
    const keys = [md(+m[2], +m[1]), md(+m[1], +m[2])].filter(Boolean);
    if (keys.length) out.push({ text: m[0], keys });
  }
  for (const m of s.matchAll(DAY_MONTH)) { const k = md(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]); if (k) out.push({ text: m[0].trim(), keys: [k] }); }
  for (const m of s.matchAll(MONTH_DAY)) { const k = md(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]); if (k) out.push({ text: m[0].trim(), keys: [k] }); }
  return out;
}

/** Walk parsed JSON: every array length, and per object with a who / name: the amounts in that object. */
function walk(v, out, depth = 0) {
  if (depth > 8 || v == null || typeof v !== 'object') return;
  if (Array.isArray(v)) { out.lengths.add(v.length); for (const x of v.slice(0, 500)) walk(x, out, depth + 1); return; }
  const who = typeof v.who === 'string' ? v.who : typeof v.name === 'string' ? v.name : '';
  if (who && who.length >= 2) {
    const amounts = Object.values(v).filter((x) => typeof x === 'string').flatMap(amountsIn);
    if (amounts.length) { const k = who.toLowerCase(); out.byName.set(k, new Set([...(out.byName.get(k) || []), ...amounts])); }
  }
  for (const x of Object.values(v)) walk(x, out, depth + 1);
}

/**
 * What the records of this turn allow: { amounts, sums, dates, numbers, byName }. `sources`: tool result texts and the
 * sender card; `extra`: texts whose numbers are fine to repeat (the person's own message).
 */
function facts(sources, extra = []) {
  const out = { amounts: new Set(), dates: new Set(), numbers: new Set(), lengths: new Set(), byName: new Map() };
  for (const src of [...sources, ...extra]) {
    const s = String(src || '');
    const list = amountsIn(s);
    list.forEach((c) => out.amounts.add(c));
    if (list.length > 1) out.amounts.add(list.reduce((a, b) => a + b, 0));
    for (let i = 0; i < Math.min(list.length, 40); i++) for (let j = i + 1; j < Math.min(list.length, 40); j++) out.amounts.add(list[i] + list[j]);
    for (const k of datesIn(s, { both: true })) out.dates.add(k);
    for (const m of s.matchAll(/\d+(?:[.,]\d+)?/g)) { out.numbers.add(Number(m[0].replace(',', '.'))); const c = cents(m[0]); if (c != null) out.amounts.add(c); }
    try { walk(JSON.parse(s), out); } catch { /* not JSON */ }
  }
  return out;
}

/**
 * Check a reply against the records of its turn. Returns { checked, wrong: [text], hint } — checked = how many facts
 * were compared; wrong = the ones the records do not have (or that belong to someone else).
 * `today`: "MM-DD" keys that are fine without records (today, tomorrow).
 */
export function checkFacts(reply, sources, { extra = [], today = [] } = {}) {
  const f = facts(sources, extra);
  const wrong = []; let checked = 0;
  const text = String(reply || '');
  for (const m of text.matchAll(MONEY)) {
    const c = cents(m[1] ?? m[2]); if (c == null) continue;
    checked++;
    if (!f.amounts.has(c)) wrong.push(m[0].trim());
  }
  for (const d of replyDates(text)) {
    checked++;
    if (!d.keys.some((k) => f.dates.has(k) || today.includes(k))) wrong.push(d.text);
  }
  for (const m of text.matchAll(COUNT)) {
    checked++;
    const n = Number(m[1]);
    if (!f.numbers.has(n) && !f.lengths.has(n)) wrong.push(m[0]);
  }
  // an amount next to a name it does not belong to (e.g. "Chary owes CHF 40" when CHF 40 is Rao's): each amount goes
  // with the closest name before it in the same sentence (or after it, when none comes before)
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    const names = [];
    for (const name of f.byName.keys()) {
      for (const m of sentence.matchAll(new RegExp(String.raw`(?<![\p{L}])${esc(name)}(?![\p{L}])`, 'giu'))) names.push({ name, at: m.index || 0 });
    }
    if (!names.length) continue;
    for (const m of sentence.matchAll(MONEY)) {
      const c = cents(m[1] ?? m[2]); if (c == null) continue;
      const at = m.index || 0;
      const before = names.filter((n) => n.at < at).sort((x, y) => y.at - x.at)[0];
      const owner = before || names.filter((n) => n.at > at).sort((x, y) => x.at - y.at)[0];
      const mine = f.byName.get(owner.name);
      if (!mine.has(c) && [...f.byName].some(([n, set]) => n !== owner.name && set.has(c))) wrong.push(`${owner.name}: ${(c / 100).toFixed(2)}`);
    }
  }
  const hint = [...new Set([...f.byName].slice(0, 20).map(([n, s]) => `${n}: ${[...s].map((c) => (c / 100).toFixed(2)).join(', ')}`))].join('; ');
  return { checked, wrong: [...new Set(wrong)], hint };
}
