// Release title and notes from releases.json (045), used by .github/workflows/release.yml.
//   node scripts/release-notes.mjs <version> --title   → "v3.0.0" or "⚠️ Breaking — v3.0.0"
//   node scripts/release-notes.mjs <version> --notes   → Markdown notes for that version ('' when there is no entry)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeReleases, releaseNotes } from '../src/core/releases.js';

const [version, what = '--notes'] = process.argv.slice(2);
if (!version) { console.error('usage: release-notes.mjs <version> [--title|--notes]'); process.exit(2); }
const releases = normalizeReleases(JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'releases.json'), 'utf8')));
const tag = `v${version.replace(/^v/, '')}`;
const entry = releases[tag.slice(1)];
if (what === '--title') process.stdout.write(`${entry?.breaking ? '⚠️ Breaking — ' : ''}${tag}${entry?.title ? `: ${entry.title}` : ''}`);
else process.stdout.write(releaseNotes(releases, tag));
