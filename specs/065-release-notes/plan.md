# Plan: 065 Release notes

- `src/core/releases.js`: `CHANGE_TYPES`, normalised `changes`, `releaseRange()`, `releaseNotes()` groups changes and
  always links docs, `releaseCheck()` requires changes.
- `src/core/updates.js`: `notes` in the analysed status; `installedReleases()` (own `releases.json`, read once);
  `whatsNew(user)` / `markSeen(user)` in kv `updates:seen:<userId>`.
- Routes: `GET /api/releases`, `POST /api/releases/seen` (routes/updates.js); `whatsNew` in `statusFor()`.
- `src/core/update-decision.js`: key changes in the breaking notice; what's new in the WhatsApp report.
- Admin MCP: `get_release_notes`; `get_update_status` description; `apply_update` preview.
- Panel: `app/releases.js` (`releaseList`, `showReleaseNotes`, `rangeLine`, `notAfter`), one `confirmUpdate()` in
  `updates.js` replacing the custom breaking dialog; `ask({ wide, ok: null })`; *What's new* card on Overview;
  Settings → Help → Release notes (+ Find anything via `SETTINGS_SECTIONS`); `notes` icon.
- Data: backfill titles + changes for v2.0.0 → v2.25.0 (48 versions) from the merged PRs, entry 2.26.0.
- Docker: `COPY releases.json`. Release workflow unchanged in shape (`scripts/release-notes.mjs` builds from the entry);
  existing 2.x GitHub release bodies PATCHed (our part replaced, GitHub's PR list kept).
- Checks: tests with fakes (`test/release-notes.test.js`, `test/breaking-updates.test.js`), responsive states
  `update-dialog`, `overview-whats-new`, `whats-new-dialog`, `settings-release-notes`; site shot `card-update-notes`.

| Area | Note |
|---|---|
| Small servers | One JSON read at start (~60 KB), kept in memory; no timers; status adds one kv read per person |
| Security | Notes rendered with `textContent`; docs links limited by the existing pattern; no new route writes beyond a per-user kv |
| Releases | 2.26.0 minor, `releases.json` entry with changes |
