// Release title and notes from releases.json (045), used by .github/workflows/release.yml.
//   node scripts/release-notes.mjs <version> --title   → "v3.0.0" or "⚠️ Breaking — v3.0.0"
//   node scripts/release-notes.mjs <version> --notes   → Markdown notes for that version ('' when there is no entry)
//   node scripts/release-notes.mjs --sync              → 069: every existing GitHub Release whose version has an entry
//     gets its title and notes from releases.json (GitHub's generated "What's Changed" part is kept). Idempotent: a
//     release that already matches is not touched; releases and tags are never created or deleted.
//     Needs GITHUB_TOKEN (contents: write) and GITHUB_REPOSITORY; GITHUB_API_URL is GitHub's API unless set.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeReleases, releaseNotes } from '../src/core/releases.js';

const [version, what = '--notes'] = process.argv.slice(2);
if (!version) { console.error('usage: release-notes.mjs <version> [--title|--notes] | --sync'); process.exit(2); }
const releases = normalizeReleases(JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'releases.json'), 'utf8')));
const titleOf = (tag) => { const e = releases[tag.slice(1)]; return `${e?.breaking ? '⚠️ Breaking — ' : ''}${tag}${e?.title ? `: ${e.title}` : ''}`; };

/** Our notes, then what GitHub generated for the release (from "## What's Changed" or "**Full Changelog**" on). */
function mergedBody(existing, notes) {
  const body = String(existing || '').replace(/\r\n/g, '\n');
  const at = [body.indexOf("## What's Changed"), body.indexOf('**Full Changelog**')].filter((i) => i >= 0);
  const generated = at.length ? body.slice(Math.min(...at)).trim() : '';
  return `${notes.trimEnd()}\n${generated ? `\n\n${generated}\n` : ''}`;
}

async function sync() {
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const repo = process.env.GITHUB_REPOSITORY; const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) { console.error('GITHUB_REPOSITORY and GITHUB_TOKEN are needed'); process.exit(2); }
  const call = async (method, path, body) => {
    const r = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  let updated = 0; let same = 0;
  for (let page = 1; ; page++) {
    const list = await call('GET', `/repos/${repo}/releases?per_page=100&page=${page}`);
    for (const rel of list) {
      const tag = String(rel.tag_name || '');
      if (!/^v\d+\.\d+\.\d+$/.test(tag) || !releases[tag.slice(1)]) continue;
      const body = mergedBody(rel.body, releaseNotes(releases, tag)); const name = titleOf(tag);
      if (body === rel.body && name === rel.name) { same++; continue; }
      await call('PATCH', `/repos/${repo}/releases/${Number(rel.id)}`, { body, name });
      updated++; console.log(`updated ${tag}`);
    }
    if (list.length < 100) break;
  }
  console.log(`Release notes: ${updated} updated, ${same} already up to date`);
}

if (version === '--sync') await sync();
else {
  const tag = `v${version.replace(/^v/, '')}`;
  process.stdout.write(what === '--title' ? titleOf(tag) : releaseNotes(releases, tag));
}
