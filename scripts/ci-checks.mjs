// Small CI checks (quality job), also runnable locally: `node scripts/ci-checks.mjs [base-ref]`.
//  1. Version consistency (fails): package.json, package-lock.json and infra/oci/schema.yaml carry the same version.
//  2. Breaking releases (045): a major bump over the latest release tag fails without a breaking releases.json entry
//     (with actions); a version without an entry warns. Needs tags (checkout with fetch-depth: 0).
//  3. Doc links (fails, #68): relative links, images and #anchors in README.md and docs/**/*.md exist
//     (scripts/check-doc-links.mjs), also GitHub links into docs/ from the website, the panel and releases.json.
//  4. Diagrams (fails, #74): every docs/diagrams/*.mmd has an SVG rendered from the same source (src-sha256), no SVG
//     without a source, no ```mermaid blocks in README.md or docs/ (scripts/render-diagrams.mjs, npm run docs:diagrams).
//  5. Docs freshness (warns only): the panel UI changed but no docs/ or README.md file did. Needs the base branch
//     (GITHUB_BASE_REF on pull requests, or an argument); skipped when it can't be compared.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeReleases, releaseCheck } from '../src/core/releases.js';
import { checkDocLinks } from './check-doc-links.mjs';
import { checkDiagrams } from './render-diagrams.mjs';

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

// 2. breaking releases need a releases.json entry
{
  let releases = null;
  try { releases = normalizeReleases(JSON.parse(read('releases.json'))); } catch (e) { failed = true; console.log(`::error file=releases.json::releases.json is missing or not valid JSON: ${e.message}`); }
  if (releases) {
    let previous = '';
    try { previous = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*.*.*'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* no tags (shallow clone) */ }
    if (previous === `v${pkg}`) {
      // HEAD is the release itself: compare with the tag before it
      try { previous = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*.*.*', `${previous}^`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { previous = ''; }
    }
    const r = releaseCheck({ version: pkg, previous, releases });
    for (const m of r.errors) { failed = true; console.log(`::error file=releases.json::${m}`); }
    for (const m of r.warnings) console.log(`::warning file=releases.json::${m}`);
    if (!r.errors.length) console.log(`Releases: ok (${pkg}${previous ? `, previous release ${previous}` : ', no release tag found'})`);
  }
}

// 3. doc links
{
  const { problems, count } = checkDocLinks();
  for (const p of problems) { failed = true; console.log(`::error::Broken doc link: ${p}`); }
  if (!problems.length) console.log(`Doc links: ok (${count} checked)`);
}

// 4. diagrams are rendered images, up to date with their sources
{
  const { problems, count } = checkDiagrams();
  for (const p of problems) { failed = true; console.log(`::error::Diagrams: ${p}`); }
  if (!problems.length) console.log(`Diagrams: ok (${count} up to date)`);
}

// 5. docs freshness hint
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
