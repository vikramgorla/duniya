# Implementation Plan: Breaking Releases Need the Owner's Confirmation

**Spec**: [spec.md](spec.md) · **Issue**: #57 · **Release**: v2.9.0

## Design

- `releases.json` (repo root) — honest entries: 2.0.0 (breaking, bots → agents, 1.x data/backups/exports not read),
  2.5.0 (not breaking; old "Cloudflare only" access setting not carried over, installer re-run for the root helper),
  2.7.0 (not breaking; ffmpeg/bzip2 via installer re-run), 2.9.0.
- `src/core/releases.js` — pure: `normalizeReleases`, `analyzeJump({ current, target, versions, releases })` →
  `{ breaking, steps, safeTarget, decisionVersion }`, `releaseNotes`, `releaseCheck` (CI rule); `readReleasesAt(root,
  ref)` with `execFile('git', ['show', ref:releases.json])`.
- `src/core/updates.js` — `checkForUpdate` stores tags ahead and the target's releases; `updateStatus` recomputes the
  analysis for the running version; `applyUpdate({ target, backup, by })` = pre-update backup (phase `backup`) →
  `deploy/update.sh`; settings `keepPreUpdate`; `_setAppRoot` for tests.
- `src/core/backup/index.js` — `runBackup({ preUpdate, keepPreUpdate })`: local only, tracked in kv
  `backup:preUpdate`, excluded from normal retention; `listPreUpdate()`.
- `src/core/update-decision.js` — `pendingDecision`, `snoozeDecision`, `announceBreaking` (Activity, owner alert,
  linked owners with codes in kv `updates:codes`), `resolveUpdateConfirm` (registered with the owner assistant),
  `runConfirmedUpdate`, `deliverUpdateReport`, `updateTick` + `startUpdateScheduler` (moved here).
- `src/core/owner-assistant.js` — `registerConfirmHandler()`: codes not its own are offered to handlers.
- `src/panel/routes/updates.js` — `GET /api/updates` adds `decision`, `backup`; `POST /api/updates/apply` `{ breaking,
  backup }` (409 without confirmation when nothing safe); `POST /api/updates/decision` `{ action: snooze|dismiss }`.
- Panel: Overview banner slot (`#ov-update-banner`, reused on soft refresh), Updates card (decision line, *Review*,
  safe *Update to*, backup phase, keep N setting), `<dialog>` with notes and *Make a backup first*.
- `bin/duniya.js` `update --breaking`; weekly summary says "needs your decision".
- `.github/workflows/release.yml` uses `scripts/release-notes.mjs` (title + notes file, `--generate-notes` kept);
  `scripts/ci-checks.mjs` releases rule (`git describe --tags --abbrev=0`, quality job has `fetch-depth: 0`).

## Constitution Check

- III least privilege in code: owner-only routes; update codes only for owners, bound to the user, WhatsApp only.
- IV human confirmation: breaking updates only after an explicit confirmation; auto mode never crosses one.
- V observable: Activity for notice, snooze/dismiss, confirm, backup, result.
- VI small: no dependencies; kv entries only; git reads with timeouts; backup reuses the existing bundle code.
- VIII: plain-language banner and dialog; responsive states `overview-update-decision`, `update-decision-dialog`.
- IX DoD: docs, website line, admin MCP, version 2.9.0, releases.json entry.

## Releases

| Item | Value |
|---|---|
| Version | 2.9.0 (minor feature) in `package.json`, `package-lock.json`, `infra/oci/schema.yaml` |
| Releases | `releases.json` entry 2.9.0, not breaking |
