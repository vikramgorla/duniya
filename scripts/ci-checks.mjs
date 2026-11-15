// Small CI checks (quality job), also runnable locally: `node scripts/ci-checks.mjs [base-ref]`.
//  1. Version consistency (fails): package.json, package-lock.json and infra/oci/schema.yaml carry the same version.
//  2. Docs freshness (warns only): the panel UI changed but no docs/ or README.md file did. Needs the base branch
//     (GITHUB_BASE_REF on pull requests, or an argument); skipped when it can't be compared.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (f) => readFileSync(resolve(root, f), 'utf8');
let failed = false;

// 1. versions
const pkg = JSON.parse(read('package.json')).version;
const lock = JSON.parse(read('package-lock.json'));
const schema = (read('infra/oci/schema.yaml').match(/^version:\s*"?([^"\s]+)"?\s*$/m) || [])[1];
const found = { 'package.json': pkg, 'package-lock.json': lock.version, 'package-lock.json packages[""]': lock.packages?.['']?.version, 'infra/oci/schema.yaml': schema };
const off = Object.entries(found).filter(([, v]) => v !== pkg);
if (off.length) {
  failed = true;
  for (const [f, v] of off) console.log(`::error file=${f.split(' ')[0]}::Version ${v ?? '(missing)'} in ${f} differs from package.json ${pkg}. Bump all three files together (see AGENTS.md).`);
} else console.log(`Versions match: ${pkg}`);

// 2. docs freshness hint
const base = process.argv[2] || process.env.GITHUB_BASE_REF;
if (base) {
  let files = null;
  for (const ref of [`origin/${base}`, base]) {
    try { files = execFileSync('git', ['diff', '--name-only', `${ref}...HEAD`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); break; } catch { /* try the next form */ }
  }
  if (!files) console.log(`Docs check skipped: could not compare with ${base}.`);
  else if (files.includes('src/panel/public/index.html') && !files.some((f) => f.startsWith('docs/') || f === 'README.md')) {
    console.log('::warning file=src/panel/public/index.html::The panel UI changed but no docs/ or README.md file did. Update docs, the website (docs/site, screenshots via npm run site:shots) and README if users see the change (Definition of Done in AGENTS.md).');
  } else console.log('Docs check: ok');
}
process.exit(failed ? 1 : 0);
