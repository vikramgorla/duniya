# Tasks: A release that does not start is rolled back

**Input**: Design documents from `/specs/095-update-rollback/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: required (constitution VII): `test/update-rollback.test.js`, with temporary git repositories and the harness fakes.

## Phase 1: Setup

- [X] T001 Issue #279 with labels and a plan comment; branch `feat/279-update-rollback`

## Phase 2: Foundational (blocks every story)

- [X] T002 Move today's `src/index.js` to `src/app.js` unchanged; `src/index.js` loads the guard with `import()` inside `try`/`catch`, calls `guardStart()`, then `await import('./app.js')`, then `holds()`
- [X] T003 `src/core/update-guard.js` (Node built-ins only): file names and constants (`MAX_STARTS = 3`, `HOLDS_AFTER = 60 s`, `GIT_WAIT = 60 s`, `NPM_WAIT = 15 min`, `UNDO_TRIES = 3`), `noteUpdate(dataDir, note)`, `readNote` (a note is valid only when `from` is 7–64 hex characters and `starts` is a whole number ≥ 0; anything else is dropped), whole-file writes (temporary file + rename)

## Phase 3: User Story 1 - The server puts the previous release back (P1)

**Goal**: three starts in a row that do not hold → the fourth start puts the previous release back and ends.

**Independent Test**: `node --test test/update-rollback.test.js` (guard tests on a temporary repository).

- [X] T004 [US1] Tests in `test/update-rollback.test.js`: no note → nothing; Docker and dev → nothing, also with a note; three starts are counted; `holds()` drops the note after a minute (mock timers) and not before; the fourth start checks the previous commit out, writes the result, drops the note and exits with 1; changed dependencies → `npm ci --omit=dev --prefer-offline` runs (a fake `npm` on PATH), unchanged → it does not; a step that fails is tried again at the next start, three times, then the result says so and the start goes on; a damaged note is dropped and the start goes on; a `from` that is not a commit id never reaches git
- [X] T005 [US1] `guardStart({ root, dataDir, kind, exit })` and `putBack` in `src/core/update-guard.js` as planned; everything that throws is printed and the start goes on
- [X] T006 [US1] `applyUpdate` in `src/core/updates.js`: commit and lockfile hash before `deploy/update.sh`; after code 0 on a systemd install with a changed commit → `noteUpdate` (`from`, `fromVersion`, `to` from the new `package.json`, `target`, `commit`, `deps`, `backup`, `at`, `starts: 0`); test: written on systemd only, not for "already up to date", not for a failed update
- [X] T007 [US1] Test: the real `src/index.js` in a child process (temporary data directory, `DUNIYA_INSTALL=systemd`, a note whose `from` is the current commit and `starts: 0`) starts, counts one start and stops cleanly; with a damaged note it starts as well

## Phase 4: User Story 2 - The owner is told what happened (P2)

**Goal**: Activity, owner alert, Updates card, admin MCP status and `duniya status` name both versions.

**Independent Test**: after `takeRollback()` with a result file: the Activity line, `GET /api/updates` → `rolledBack`, the alert in the fake channel.

- [X] T008 [US2] `takeRollbackResult(dataDir)` in `src/core/update-guard.js` (read once, removed); `takeRollback()`, `rollbackText()` and `rolledBack` in `src/core/updates.js` (shown while the server runs the version it was rolled back to; a notice about another version is cleared at the start); called from `src/app.js` after "Started"
- [X] T009 [US2] `src/core/update-decision.js`: the owner alert once (tried at each round until it went out, six rounds at most); the WhatsApp result of a confirmed update says "did not start on this server and was undone"
- [X] T010 [US2] Panel `src/panel/public/app/updates.js` (Overview row: one line with a link to Settings → Updates; Update is not the main button for the release that did not start), `src/panel/public/app/update-flow.js` (the update dialog and the watch of a running update, loaded on demand: the watch says the update did not start) and `src/panel/public/app/settings.js` (the full note on Settings → Updates); two states in `scripts/check-responsive.mjs`
- [X] T011 [P] [US2] `get_update_status` description in `src/panel/admin-tools/server.js`; `duniya status` line in `bin/duniya.js`
- [X] T012 [US2] Tests: Activity line, status, alert through the fake channel (sent once, also when WhatsApp connects later), a failed rollback is worded as such, the notice is gone after a later update holds

## Phase 5: User Story 3 - The same release is not installed again by itself (P2)

**Goal**: the automatic round skips what was rolled back; a newer release and a manual update go through.

**Independent Test**: `updateTick` on a temporary repository after a rollback.

- [X] T013 [US3] `isRolledBack(target, st)` in `src/core/updates.js` (tag on the stable channel, commit on main) and the check in `updateTick` (`src/core/update-decision.js`): `{ action: 'rolled_back', target }`, nothing installed
- [X] T014 [US3] Tests: the automatic round does nothing for the rolled-back version, installs a newer one; `applyUpdate` by hand installs the same version and writes a new note

## Phase 6: Polish

- [X] T015 [P] Docs: `docs/backups-and-updates.md` (section *A release that does not start*), `docs/troubleshooting.md`, `docs/cli.md`, `docs/admin-mcp.md`, `README.md` highlights, `AGENTS.md` architecture map, `docs/development.md` where it names the entry, `docs/site/index.html` (one line)
- [X] T016 Run `quickstart.md` (automated part)

## Phase Final: Definition of Done (REQUIRED, keep in every tasks.md; see AGENTS.md)

**Purpose**: The change is not done until these hold. Mark an item n/a only with a reason.

- [X] T017 Issue: labels (type / area / priority / status / `spec: 095`), plan comment posted, progress comments at milestones
- [X] T018 Spec artifacts (spec.md, plan.md, tasks.md) match the code (`/speckit-analyze`, `/speckit-converge`)
- [X] T019 Tests with fakes in `test/` cover the new behaviour; `npm test`, `npm run lint`, `npm run typecheck`, `npm run check:panel` pass
- [X] T020 UI: `npm run check:responsive` passes (375 / 393 / 1440, light + dark); DESIGN.md checklist met
- [X] T021 Security review: no secrets, TLS never disabled, no shell with untrusted input (the commit id is checked, `execFileSync` with argument arrays), untrusted text rendered as text, permissions enforced in code; CodeQL clean at high / error
- [X] T022 Privacy review: chat allow-list respected, no message contents in logs beyond the logging policy, privacy notice behaviour intact
- [X] T023 Small-server impact on a 1 GB / 1 vCPU VM considered (no memory, one timer per start after an update, `npm ci` only when the dependencies changed); no new queries
- [X] T024 Every wait has a deadline (git 60 s, npm 15 min); at most three tries to put the release back
- [X] T025 No chores for the owner: the rollback, the notice and the skip are automatic; nothing to configure
- [X] T026 Clean code (AGENTS.md#clean-code): `npm run check:clean` passes, `scripts/clean-baseline.json` only lowered
- [X] T027 Lean code: `src/index.js` body moved, not copied; no compatibility layer; `node scripts/ci-checks.mjs` passes; tests check behaviour; UI: no new polling
- [X] T028 Admin MCP: `get_update_status` covers the notice (no new panel action, so no new tool)
- [X] T029 Docs: see T015
- [X] T030 Website: one line in `docs/site/index.html`; no screenshot shows the note (a state after a failure): none retaken
- [X] T031 Version bump 2.59.0 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml`
- [X] T032 `releases.json` entry for 2.59.0
- [ ] T033 PR via REST with `Closes #279` + spec link, no attribution trailers or footers; required checks green; squash merge with an explicit message; never push to `main`
- [ ] T034 Issue done comment (what shipped, version, open items) and close with the release

## Dependencies & Execution Order

- Phase 2 blocks everything. US1 (T004–T007) is the MVP and stands alone. US2 needs the result file of US1 (T005). US3 needs `rolledBack` of US2 (T008).
- Within a story: tests first (they fail), then the code.
- [P]: T011 and T015 touch files nothing else in their phase touches.

## Implementation Strategy

MVP: Phases 1–3 (the server heals). Then US2 (the owner knows) and US3 (no loop of the same release), each testable on its own.

## Phase 7: Convergence

- [X] T035 Drop the note and start normally when the checkout is already on the noted commit after three failed starts (no rollback, no exit, no notice), with a test in `test/update-rollback.test.js` per spec Edge Cases: put back by hand (partial)
- [X] T036 Test that `duniya status` names a rollback in `test/cli.test.js` per plan: command line (partial)
- [X] T037 Name the `scripts/cdp.mjs` change in the PR: Chrome is stopped when the script is stopped from outside (unrequested)
