// Release notes for updates (045, issue #57). `releases.json` at the repository root says which versions are breaking
// and what the owner must do. The app reads it from the TARGET release with `git show <tag>:releases.json` (no GitHub
// API), so the newest release describes every version before it.
//
// A jump from the installed version to a target is breaking when the major version grows or any version v with
// installed < v <= target is marked breaking. `safeTarget` is the newest release that can be reached without crossing
// a breaking one (or null).
import { execFile } from 'node:child_process';

export const parseVersion = (v) => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '')); return m ? m.slice(1).map(Number) : null; };
export function compareVersions(a, b) {
  const x = parseVersion(a); const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
const bare = (v) => String(v || '').replace(/^v/, '');
const clip = (s, n) => String(s ?? '').slice(0, n);

/** Keep only well-formed entries (the file comes from the remote; never trust its shape). */
export function normalizeReleases(json) {
  const out = {};
  const versions = json && typeof json === 'object' && json.versions && typeof json.versions === 'object' ? json.versions : {};
  for (const [v, e] of Object.entries(versions)) {
    if (!parseVersion(v) || !e || typeof e !== 'object') continue;
    out[bare(v)] = {
      breaking: e.breaking === true,
      title: clip(e.title, 160),
      summary: clip(e.summary, 1200),
      actions: Array.isArray(e.actions) ? e.actions.slice(0, 10).map((a) => clip(a, 400)) : [],
      data: ['migrated', 'not-migrated', 'unchanged'].includes(e.data) ? e.data : '',
      docs: typeof e.docs === 'string' && /^[\w./#-]{1,200}$/.test(e.docs) ? e.docs : '',
    };
  }
  return out;
}

/** releases.json of a git ref (tag or branch) in `root`; {} when the file does not exist there or is not valid JSON. */
export function readReleasesAt(root, ref) {
  return new Promise((res) => execFile('git', ['show', `${ref}:releases.json`], { cwd: root, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (e, out) => {
    if (e) return res({});
    try { res(normalizeReleases(JSON.parse(out))); } catch { res({}); }
  }));
}

/**
 * Pure: what lies between `current` and `target`.
 * versions: every release tag the remote has (any order, with or without "v"); releases: normalized releases.json.
 * Returns { breaking, steps: [{ version, title, summary, actions, data, docs, major }], safeTarget, decisionVersion }.
 */
export function analyzeJump({ current, target, versions = [], releases = {} }) {
  const none = { breaking: false, steps: [], safeTarget: null, decisionVersion: null };
  if (!parseVersion(current) || !parseVersion(target) || compareVersions(current, target) >= 0) return none;
  const cur = parseVersion(current);
  const between = [...new Set([...versions.map(bare), ...Object.keys(releases), bare(target)])]
    .filter((v) => parseVersion(v) && compareVersions(v, current) > 0 && compareVersions(v, target) <= 0)
    .sort(compareVersions);
  const steps = [];
  const majors = new Set();
  let safeTarget = null; let blocked = false;
  for (const v of between) {
    const e = releases[v];
    const newMajor = parseVersion(v)[0] > cur[0] && !majors.has(parseVersion(v)[0]);
    if (newMajor) majors.add(parseVersion(v)[0]);
    if (e?.breaking || newMajor) {
      steps.push({ version: v, title: e?.title || `Version ${parseVersion(v)[0]} (new major version)`,
        summary: e?.summary || 'A new major version can change things in ways that need your attention. Read the release notes before updating.',
        actions: e?.actions || [], data: e?.data || '', docs: e?.docs || '', major: newMajor, ...(e ? {} : { unlisted: true }) });
      blocked = true;
    }
    if (!blocked && versions.map(bare).includes(v)) safeTarget = `v${v}`;
  }
  return { breaking: steps.length > 0, steps, safeTarget, decisionVersion: steps.length ? steps.at(-1).version : null };
}

/** Release notes (Markdown) for one version, for the GitHub release body. '' when there is no entry. */
export function releaseNotes(releases, version) {
  const e = releases[bare(version)];
  if (!e) return '';
  const lines = [];
  if (e.breaking) lines.push('> [!WARNING]', '> **Breaking release.** Automatic updates stop before it; the owner is asked to confirm (panel or WhatsApp).', '');
  if (e.title) lines.push(`### ${e.title}`, '');
  if (e.summary) lines.push(e.summary, '');
  if (e.actions.length) lines.push('**What you need to do**', '', ...e.actions.map((a) => `- ${a}`), '');
  if (e.data === 'not-migrated') lines.push('**Data:** not migrated: older data, backups or settings named above are not read.', '');
  if (e.data === 'migrated') lines.push('**Data:** migrated automatically.', '');
  if (e.docs) lines.push(`More: [${e.docs}](https://github.com/vikramgorla/whatsapp-agent-duniya/blob/v${bare(version)}/${e.docs})`, '');
  return lines.join('\n');
}

/**
 * CI rule (045): a major version bump needs a breaking releases.json entry with actions; every new version should have
 * an entry. previous: the latest release tag (e.g. "v2.8.2") or ''. Returns { errors: [], warnings: [] }.
 */
export function releaseCheck({ version, previous = '', releases = {} }) {
  const errors = []; const warnings = [];
  const e = releases[bare(version)];
  const cur = parseVersion(version); const prev = parseVersion(previous);
  if (!cur) return { errors: [`package.json version ${version} is not X.Y.Z`], warnings };
  if (prev && cur[0] > prev[0]) {
    if (!e?.breaking) errors.push(`Version ${bare(version)} is a new major version (previous release ${previous}) but releases.json has no entry for it with "breaking": true. Add one with title, summary and actions (AGENTS.md, Definition of Done), or consider a migration instead.`);
    else if (!e.actions.length) errors.push(`releases.json entry ${bare(version)} is breaking but lists no actions: say what the owner must do.`);
  } else if (!e && (!prev || compareVersions(version, previous) > 0)) {
    warnings.push(`releases.json has no entry for ${bare(version)}. Add one (breaking: false) when owners should know something about this release.`);
  }
  if (e?.breaking && prev && cur[0] === prev[0] && compareVersions(version, previous) > 0) warnings.push(`releases.json marks ${bare(version)} as breaking without a major version bump: breaking changes should bump the major version.`);
  return { errors, warnings };
}
