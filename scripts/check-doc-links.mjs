// Doc link check (#68): every relative link and image in README.md and docs/**/*.md (also the root *.md files)
// points to a file that exists, and every #anchor matches a heading (GitHub slug rules) or an explicit id/name.
// Also checks links into this repository's docs written as GitHub URLs (…/blob/main/docs/…#anchor) from the website,
// the panel and releases.json, because those break silently when a heading is renamed.
// Usage: `node scripts/check-doc-links.mjs` (exit 1 on a broken link). Imported by scripts/ci-checks.mjs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOB = /https:\/\/github\.com\/vikramgorla\/whatsapp-agent-duniya\/(?:blob|tree)\/main\/([^\s"'`)<>]+)/g;

/** Remove fenced and inline code so example links inside code are not checked. */
function stripCode(md) {
  return md.replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2\s*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** GitHub heading slugs (with -1, -2 for duplicates) plus explicit id="…" / name="…" anchors. */
export function anchorsOf(md) {
  const seen = new Map();
  const out = new Set();
  for (const line of stripCode(md).split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!h) continue;
    const text = h[1].replace(/<[^>]+>/g, '').replace(/[<>]/g, '') // slugs never keep < or >.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_~]/g, (c) => (c === '_' ? '_' : ''));
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  for (const m of md.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) out.add(m[1]);
  return out;
}

function mdFiles() {
  const files = readdirSync(root).filter((f) => f.endsWith('.md')).map((f) => join(root, f));
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== 'site') walk(p); } else if (e.endsWith('.md')) files.push(p);
    }
  };
  walk(join(root, 'docs'));
  return files;
}

const anchorCache = new Map();
function checkTarget(fromFile, target, problems, label) {
  const [rawPath, hash] = target.split('#');
  const path = decodeURIComponent(rawPath || '');
  const abs = path ? resolve(dirname(fromFile), path) : fromFile;
  const rel = relative(root, fromFile);
  if (!existsSync(abs)) { problems.push(`${rel}: ${label} → ${target}: file not found`); return; }
  if (hash && abs.endsWith('.md')) {
    if (!anchorCache.has(abs)) anchorCache.set(abs, anchorsOf(readFileSync(abs, 'utf8')));
    if (!anchorCache.get(abs).has(hash)) problems.push(`${rel}: ${label} → ${target}: no heading #${hash} in ${relative(root, abs)}`);
  }
}

export function checkDocLinks() {
  const problems = [];
  let count = 0;
  for (const file of mdFiles()) {
    const md = stripCode(readFileSync(file, 'utf8'));
    const targets = [
      ...[...md.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
      ...[...md.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1]),
      ...[...md.matchAll(/\b(?:href|src|srcset)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1].split(/\s/)[0]),
    ];
    for (const t of targets) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(t)) {
        for (const m of t.matchAll(BLOB)) { count++; checkTarget(join(root, 'README.md'), m[1], problems, t); }
        continue;
      }
      count++;
      checkTarget(file, t, problems, t);
    }
  }
  for (const f of ['docs/site/index.html', 'src/panel/public/index.html', 'releases.json', 'infra/gcp/tutorial.md']) {
    if (!existsSync(join(root, f))) continue;
    const text = readFileSync(join(root, f), 'utf8');
    for (const m of text.matchAll(BLOB)) { count++; checkTarget(join(root, 'README.md'), m[1], problems, m[0]); }
    if (f === 'releases.json') {
      for (const m of text.matchAll(/"docs"\s*:\s*"([^"]+)"/g)) { count++; checkTarget(join(root, 'README.md'), m[1], problems, `releases.json docs ${m[1]}`); }
    }
  }
  return { problems, count };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, count } = checkDocLinks();
  for (const p of problems) console.log(`::error::Broken doc link: ${p}`);
  console.log(problems.length ? `Doc links: ${problems.length} broken of ${count}` : `Doc links: ok (${count} checked)`);
  process.exit(problems.length ? 1 : 0);
}
