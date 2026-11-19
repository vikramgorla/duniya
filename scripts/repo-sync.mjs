// Repository sync (084): the project's GitHub repository lives only in package.json (`repository`). Files that must
// hold absolute URLs (README buttons, the raw install command, the website, infra defaults, docs) are rewritten from it.
//   npm run repo:sync                          rewrite every project URL to the slug in package.json
//   npm run repo:sync -- --repo owner/name     set a new slug first (a fork, a rename), then rewrite
//   npm run repo:sync -- --check               only list what would change (exit 1 when something would)
// Only URLs and slugs in URL form change (github.com/o/n, github.com:o/n, raw.githubusercontent.com/o/n, ghcr.io/o/n,
// API paths repos/o/n, URL-encoded github.com%2Fo%2Fn, o.github.io/n), and only for this project's names; prose and
// server-local names (the systemd unit, /opt path) are never touched. Idempotent. Imported by ci-checks.mjs (findDrift).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRepo, sameRepo } from '../src/core/repo.js';

const root = resolve(import.meta.dirname, '..');
// Names this project has had: a leftover URL with one of them and another owner/name is drift. Add the old name here
// when renaming the repository, so stale links anywhere are caught.
const FORMER_NAMES = ['whatsapp-agent-duniya'];
// Example owners in docs and tests (`you/duniya`, alice/bob/carol in tests) are never rewritten or reported.
const EXAMPLE_OWNERS = new Set(['you', 'alice', 'bob', 'carol']);
// History is kept as written (specs describe the state when they were made).
const SKIP = [/^specs\//, /^package-lock\.json$/];
const TEXT = /\.(md|js|mjs|cjs|json|ya?ml|sh|tf|html|css|svg|mmd|txt|example|webmanifest|service|path)$|(^|\/)(Dockerfile|CODEOWNERS|duniya|duniya-ops|[^/.]+)$/;

const OWNER = '[A-Za-z0-9][A-Za-z0-9-]{0,38}';
const NAME = '[A-Za-z0-9._-]+';
const REFS = [
  { re: new RegExp(`(api\\.github\\.com/repos/|github\\.com[/:]|githubusercontent\\.com/|ghcr\\.io/|\\brepos/)(${OWNER})/(${NAME})`, 'g'), sep: '/' },
  { re: new RegExp(`(github\\.com%2F)(${OWNER})%2F(${NAME})`, 'gi'), sep: '%2F' },
  { re: new RegExp(`()\\b(${OWNER})\\.github\\.io/(${NAME})`, 'g'), sep: '.github.io/' },
];

const pkgOf = (dir) => JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
const tracked = (dir) => execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8' }).split('\0').filter((f) => f && TEXT.test(f) && !SKIP.some((re) => re.test(f)));

/** Every project URL in `text` whose owner/name differs from `slug`, with its replacement. */
function staleRefs(text, slug, names) {
  const t = parseRepo(slug);
  const out = [];
  for (const { re, sep } of REFS) {
    for (const m of text.matchAll(re)) {
      const [all, prefix, owner, rawName] = m;
      const name = rawName.replace(/(\.git)?\.*$/, '');
      if (!names.has(name.toLowerCase()) || sameRepo(`${owner}/${name}`, slug) || (EXAMPLE_OWNERS.has(owner.toLowerCase()) && !sameRepo(owner, t.owner))) continue;
      const ghcr = prefix === 'ghcr.io/';
      const nextOwner = sep === '.github.io/' ? t.owner.toLowerCase() : ghcr ? t.owner.toLowerCase() : t.owner;
      const nextName = ghcr ? t.name.toLowerCase() : t.name;
      out.push({ index: m.index, found: all, next: `${prefix}${nextOwner}${sep}${nextName}${rawName.slice(name.length)}` });
    }
  }
  return out;
}

const namesFor = (slug, pkgName) => new Set([parseRepo(slug)?.name, pkgName, ...FORMER_NAMES].filter(Boolean).map((n) => n.toLowerCase()));

/** Project URLs in tracked files that do not match package.json's repository: [{ file, line, found, next }]. */
export function findDrift(dir = root) {
  const pkg = pkgOf(dir);
  const slug = parseRepo(pkg.repository)?.slug;
  if (!slug) return [{ file: 'package.json', line: 1, found: String(pkg.repository ?? '(missing)'), next: 'repository: "github:owner/name"' }];
  const names = namesFor(slug, pkg.name);
  const out = [];
  for (const file of tracked(dir)) {
    const text = readFileSync(resolve(dir, file), 'utf8');
    for (const r of staleRefs(text, slug, names)) out.push({ file, line: text.slice(0, r.index).split('\n').length, found: r.found, next: r.next });
  }
  return out;
}

/** Set the slug (optional) and rewrite every stale project URL. Returns the files changed. */
function sync(dir, repo, { write = true } = {}) {
  const pkg = pkgOf(dir);
  const changed = new Set();
  if (repo) {
    const r = parseRepo(repo);
    if (!r) throw new Error(`--repo: use owner/name or https://github.com/owner/name (got ${repo})`);
    if (parseRepo(pkg.repository)?.slug !== r.slug) {
      // the previous name joins the names looked for, so every URL with it moves too
      if (parseRepo(pkg.repository)) FORMER_NAMES.push(parseRepo(pkg.repository).name);
      changed.add('package.json');
      if (write) writeFileSync(resolve(dir, 'package.json'), readFileSync(resolve(dir, 'package.json'), 'utf8').replace(/("repository"\s*:\s*)"[^"]*"/, `$1"github:${r.slug}"`));
    }
  }
  const slug = repo ? parseRepo(repo).slug : parseRepo(pkg.repository)?.slug;
  if (!slug) throw new Error('package.json has no repository ("github:owner/name"): run with --repo owner/name');
  const names = namesFor(slug, pkg.name);
  for (const file of tracked(dir)) {
    const text = readFileSync(resolve(dir, file), 'utf8');
    const refs = staleRefs(text, slug, names).sort((a, b) => b.index - a.index);
    if (!refs.length) continue;
    changed.add(file);
    if (!write) continue;
    let next = text;
    for (const r of refs) next = next.slice(0, r.index) + r.next + next.slice(r.index + r.found.length);
    writeFileSync(resolve(dir, file), next);
  }
  return { slug, changed: [...changed] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--repo');
  const repo = at >= 0 ? args[at + 1] : process.env.DUNIYA_REPO || '';
  const check = args.includes('--check');
  try {
    const { slug, changed } = sync(root, repo, { write: !check });
    for (const f of changed) console.log(`${check ? 'would change' : 'changed'} ${f}`);
    console.log(changed.length ? `${check ? 'Out of date' : 'Synced'}: ${changed.length} file${changed.length > 1 ? 's' : ''} → ${slug}` : `Up to date: every project URL points to ${slug}`);
    process.exit(check && changed.length ? 1 : 0);
  } catch (e) { console.error(e.message); process.exit(2); }
}
