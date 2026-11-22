// Clean code gate (AGENTS.md, Clean code): small functions, shallow nesting, few parameters, short files. The rules are
// strict; code that broke them before the gate is listed in scripts/clean-baseline.json (file → rule → count) and may
// only shrink: a new break, or more breaks in a listed file, fails; a file that got cleaner must lower its entry
// (`npm run clean:baseline`, which never raises one). Raising an entry by hand needs a reason in the PR.
//   node scripts/check-clean.mjs            check (also part of ci-checks.mjs)
//   node scripts/check-clean.mjs --update   lower the baseline to what the code is now
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { ESLint } from 'eslint';

const root = resolve(import.meta.dirname, '..');
const BASELINE = resolve(root, 'scripts/clean-baseline.json');
const lines = { skipBlankLines: true, skipComments: true };
const CLEAN_RULES = {
  complexity: ['error', 20], // branches in one function
  'max-depth': ['error', 4], // nested blocks
  'max-params': ['error', 5], // more: pass an object
  'max-nested-callbacks': ['error', 4],
  'max-lines-per-function': ['error', { max: 120, ...lines }],
  'max-lines': ['error', { max: 800, ...lines }], // one file, one topic
};

/** { file: { rule: count } } of clean-code breaks in src/, scripts/ and bin/. */
async function breaks() {
  const eslint = new ESLint({ cwd: root, overrideConfig: { rules: CLEAN_RULES } });
  const out = {};
  for (const r of await eslint.lintFiles(['src', 'scripts', 'bin'])) {
    for (const m of r.messages) {
      if (!CLEAN_RULES[m.ruleId]) continue;
      const f = relative(root, r.filePath);
      (out[f] ||= {})[m.ruleId] = (out[f][m.ruleId] || 0) + 1;
    }
  }
  return out;
}
const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((f) => [f, Object.fromEntries(Object.keys(o[f]).sort().map((k) => [k, o[f][k]]))]));

/** Compare with the baseline: { errors: [text], lower: [text] }. */
export async function checkClean() {
  const now = await breaks();
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const errors = []; const lower = [];
  for (const [f, rules] of Object.entries(now)) {
    for (const [rule, n] of Object.entries(rules)) {
      const was = base[f]?.[rule] || 0;
      if (n > was) errors.push(`${f}: ${n - was} new ${rule} break${n - was === 1 ? '' : 's'} (split the function, return early, pass an object; npx eslint --rule '{"${rule}":${JSON.stringify(CLEAN_RULES[rule])}}' ${f})`);
    }
  }
  for (const [f, rules] of Object.entries(base)) {
    for (const [rule, was] of Object.entries(rules)) if ((now[f]?.[rule] || 0) < was) lower.push(`${f}: ${rule} ${was} → ${now[f]?.[rule] || 0}`);
  }
  return { errors, lower, now };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors, lower, now } = await checkClean();
  if (process.argv.includes('--update')) {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const next = {};
    for (const [f, rules] of Object.entries(now)) for (const [rule, n] of Object.entries(rules)) if (base[f]?.[rule]) (next[f] ||= {})[rule] = Math.min(n, base[f][rule]);
    writeFileSync(BASELINE, `${JSON.stringify(sorted(next), null, 1)}\n`);
    console.log(`clean-baseline.json lowered (${lower.length} entr${lower.length === 1 ? 'y' : 'ies'}); new breaks are never added: ${errors.length}`);
  } else {
    for (const e of errors) console.log(`::error::Clean code: ${e}`);
    for (const l of lower) console.log(`::error::Clean code: cleaner than the baseline, lower it with npm run clean:baseline: ${l}`);
    console.log(errors.length || lower.length ? '' : 'clean code: ok');
    process.exit(errors.length || lower.length ? 1 : 0);
  }
}
