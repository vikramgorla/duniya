// 084: the repository lives in one place (package.json `repository`): parsing, derived URLs, `npm run repo:sync`
// (idempotent, URLs only) and the drift check ci-checks runs. The sync runs on a copy in a temporary git repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseRepo, repoLinks, sameRepo } from '../src/core/repo.js';
import { findDrift } from '../scripts/repo-sync.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const up = (s) => s.replaceAll('{U}', 'upstream-owner');

test('084 parseRepo: owner/name, github:, GitHub https URLs; nothing else', () => {
  for (const s of ['alice/duniya', 'github:alice/duniya', 'https://github.com/alice/duniya', 'https://github.com/alice/duniya.git', 'https://github.com/alice/duniya/', 'git+https://github.com/alice/duniya.git', { type: 'git', url: 'https://github.com/alice/duniya.git' }, ' alice/duniya ']) {
    assert.deepEqual(parseRepo(s), { owner: 'alice', name: 'duniya', slug: 'alice/duniya' }, JSON.stringify(s));
  }
  for (const s of ['', 'alice', 'alice/', '/duniya', 'alice/duniya/extra', 'http://github.com/alice/duniya', 'https://gitlab.com/alice/duniya', 'https://evil.example/github.com/alice/duniya',
    'git@github.com:alice/duniya.git', 'https://x:token@github.com/alice/duniya.git', 'https://github.com/alice/duniya?x=1', 'alice/..', 'ali ce/duniya', "alice/duniya'; rm -rf /", '-alice/duniya', null, 42]) {
    assert.equal(parseRepo(s), null, JSON.stringify(s));
  }
  assert.ok(sameRepo('Alice/Duniya', 'alice/duniya'));
  assert.ok(!sameRepo(null, 'alice/duniya'));
});

test('084 repoLinks: every URL derived from the slug', () => {
  const r = repoLinks('Alice/my.bot');
  assert.equal(r.url, 'https://github.com/Alice/my.bot');
  assert.equal(r.git, 'https://github.com/Alice/my.bot.git');
  assert.equal(r.pages, 'https://alice.github.io/my.bot/');
  assert.equal(r.image, 'ghcr.io/alice/my.bot');
  assert.equal(r.blob('v2.0.0', 'docs/README.md'), 'https://github.com/Alice/my.bot/blob/v2.0.0/docs/README.md');
  assert.throws(() => repoLinks('nope'));
});

test('084 this checkout: package.json names the repository and no tracked file points elsewhere', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseRepo(pkg.repository), 'repository is github:owner/name');
  assert.deepEqual(findDrift(), []);
});

/** A small copy of the project (the sync script, repo.js and a few files) in its own git repository. */
function project(files) {
  const d = mkdtempSync(join(tmpdir(), 'duniya-repo-'));
  mkdirSync(join(d, 'scripts')); mkdirSync(join(d, 'src/core'), { recursive: true });
  cpSync(join(ROOT, 'scripts/repo-sync.mjs'), join(d, 'scripts/repo-sync.mjs'));
  cpSync(join(ROOT, 'src/core/repo.js'), join(d, 'src/core/repo.js'));
  // {U}: the upstream owner, filled in here so this file holds no URL that looks like the project's own
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), up(text)); }
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['add', '-A'], { cwd: d });
  const sync = (...args) => execFileSync(process.execPath, ['scripts/repo-sync.mjs', ...args], { cwd: d, encoding: 'utf8', env: { ...process.env, DUNIYA_REPO: '' } });
  return { d, sync, read: (f) => readFileSync(join(d, f), 'utf8') };
}

const README = `# Duniya
Install: curl -fsSL https://raw.githubusercontent.com/{U}/whatsapp-agent-duniya/main/install.sh | sudo bash
Site: https://{U}.github.io/whatsapp-agent-duniya/ and [guides](https://github.com/{U}/whatsapp-agent-duniya/blob/main/docs/README.md).
Cloud Shell: cloudshell_git_repo=https%3A%2F%2Fgithub.com%2F{U}%2Fwhatsapp-agent-duniya&x=1
Image: ghcr.io/{U}/whatsapp-agent-duniya:latest · API: gh api repos/{U}/whatsapp-agent-duniya/pulls
Example: DUNIYA_REPO=you/duniya, https://github.com/you/duniya. Not ours: https://github.com/WhiskeySockets/Baileys and https://github.com/{U}/duniya-backups.
Service whatsapp-agent-duniya.service in /opt/whatsapp-agent-duniya stays. Clone git@github.com:{U}/whatsapp-agent-duniya.git
`;

test('084 repo:sync: a fork rewrites only project URLs, idempotent; the drift check sees what is left', () => {
  const p = project({
    'package.json': `{\n  "name": "duniya",\n  "repository": "github:{U}/whatsapp-agent-duniya"\n}\n`,
    'README.md': README,
    'install.sh': 'DEFAULT_REPO="https://github.com/{U}/whatsapp-agent-duniya.git"\n',
    'specs/001-old/spec.md': 'History: https://github.com/{U}/whatsapp-agent-duniya\n',
  });
  assert.match(p.sync('--check'), /Up to date/);
  assert.deepEqual(findDrift(p.d), []);

  assert.throws(() => p.sync('--repo', 'not a repo'), /--repo: use owner\/name/);
  assert.throws(() => p.sync('--check', '--repo', 'Alice/my-bot'), (e) => e.status === 1 && /would change README\.md/.test(e.stdout));
  assert.equal(p.read('README.md'), up(README), '--check writes nothing');

  const out = p.sync('--repo', 'https://github.com/Alice/my-bot');
  assert.match(out, /Synced: 3 files → Alice\/my-bot/);
  assert.match(p.read('package.json'), /"repository": "github:Alice\/my-bot"/);
  assert.equal(p.read('install.sh'), 'DEFAULT_REPO="https://github.com/Alice/my-bot.git"\n');
  const r = p.read('README.md');
  for (const want of ['raw.githubusercontent.com/Alice/my-bot/main/install.sh', 'https://alice.github.io/my-bot/', 'github.com/Alice/my-bot/blob/main/docs/README.md',
    'github.com%2FAlice%2Fmy-bot&x=1', 'ghcr.io/alice/my-bot:latest', 'repos/Alice/my-bot/pulls', 'git@github.com:Alice/my-bot.git']) assert.ok(r.includes(want), want);
  for (const keep of ['https://github.com/you/duniya', 'https://github.com/WhiskeySockets/Baileys', up('github.com/{U}/duniya-backups'), 'whatsapp-agent-duniya.service', '/opt/whatsapp-agent-duniya', '# Duniya']) assert.ok(r.includes(keep), keep);
  assert.equal(p.read('specs/001-old/spec.md'), up('History: https://github.com/{U}/whatsapp-agent-duniya\n'), 'specs keep their history');

  // idempotent: a second run changes nothing
  assert.match(p.sync(), /Up to date: every project URL points to Alice\/my-bot/);
  assert.equal(p.read('README.md'), r);

  // a stale link added later (copied from upstream) is drift, with file, line and the fix
  writeFileSync(join(p.d, 'docs.md'), up('one\nsee https://github.com/{U}/duniya/blob/main/x.md\n'));
  execFileSync('git', ['add', 'docs.md'], { cwd: p.d });
  assert.deepEqual(findDrift(p.d), [{ file: 'docs.md', line: 2, found: up('github.com/{U}/duniya'), next: 'github.com/Alice/my-bot' }]);
  p.sync();
  assert.deepEqual(findDrift(p.d), []);
});
