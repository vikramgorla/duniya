# Implementation Plan: A release that does not start is rolled back

**Branch**: `feat/279-update-rollback` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/095-update-rollback/spec.md`

## Summary

`applyUpdate` leaves a note in the data directory before the restart: the commit and version it came from, the
version it went to, whether the dependencies changed, the pre-update backup. The entry point `src/index.js` becomes a
guard that runs before any app code: a start with a note counts; the app up for one minute drops the note; the fourth
start in a row puts the noted commit back (`git checkout`, `npm ci` when the dependencies changed), writes the result
and exits, so systemd starts the previous release. That release reads the result at its start, tells the owner
(Activity, owner alert, Updates card, admin MCP, command line) and keeps automatic updates from installing the same
version again.

## Technical Context

**Language/Version**: Node 22 (ESM), bash for `deploy/update.sh` (unchanged)

**Primary Dependencies**: none new. The guard uses Node built-ins only (`node:fs`, `node:path`, `node:child_process`)

**Storage**: two small JSON files in the data directory (`update-pending.json`, `update-rolled-back.json`); kv
`updates:rolledBack` for what the status shows

**Testing**: `node:test`; temporary git repositories as in `test/updates.test.js`; the harness and its fakes; the real
entry point in a child process

**Target Platform**: installer servers (systemd). Docker and development checkouts: nothing happens

**Project Type**: single Node service with a panel

**Performance Goals**: a start without a note costs one failed `readFileSync`; no git call unless a rollback happens

**Constraints**: 1 GB / 1 vCPU; every wait has a deadline (git 60 s, npm 15 min); no new timers besides the one-minute
check of a start after an update

**Scale/Scope**: one server, one owner

## Constitution Check

- [x] I–VIII: self-hosted (no service involved); generic core (nothing keyed on a name); least privilege (the guard
      runs as the app user, in the app's own checkout); confirm gate untouched (updates keep their confirmations);
      observable (Activity, alert, status); free tier / 1 GB (no memory, no timers); spec + tests with fakes;
      experience first (plain words, no chore)
- [x] IX Definition of Done & documentation: named below

## Definition of Done plan (constitution IX, AGENTS.md)

| Item | Plan for this feature |
|------|-----------------------|
| Issue & labels | #279, `type: feature`, `area: infra`, `area: install`, `priority: high`, `status: in progress`, `spec: 095`; plan, progress, done comments |
| Tests (fakes) | `test/update-rollback.test.js`: the guard on temporary git repositories and data directories (counting, holding, rollback with and without changed dependencies through a fake `npm` on PATH, bounded retries, fail open, Docker/dev do nothing); `applyUpdate` writes the note only on a systemd install and only when the code changed; the start hook → Activity, status, alert through the fake channel; the automatic round skips the version, takes a newer one, a manual update is allowed; the real `src/index.js` in a child process counts a start and still starts with a damaged note |
| Checks | `npm test`, `npm run lint`, `npm run typecheck`, `npm run check:panel`, `npm run check:responsive` (Updates card has a new note), `npm run check:clean`, `node scripts/ci-checks.mjs` |
| Security | No secrets in the note (commit, versions, backup file name). The note is read as untrusted: the commit must be 7–64 hex characters before it reaches `git` (`execFileSync` with an argument array, no shell). TLS untouched |
| Privacy | No message contents anywhere near it |
| Small servers | No memory, no timer besides one `setTimeout` per start after an update; `npm ci --prefer-offline` only when the dependencies changed; deadlines on git and npm; at most 3 tries to put the release back |
| Lean code | Today's `src/index.js` body moves to `src/app.js` unchanged; nothing else is kept beside it. No compatibility layer: the first release with the guard protects updates from itself onwards |
| Clean code | `update-guard.js`: `readNote`, `countStart`, `putBack`, `guardStart`, `noteUpdate`, `takeRollbackResult`: one job each; named constants with units (`MAX_STARTS`, `HOLDS_AFTER`, `GIT_WAIT`, `NPM_WAIT`, `UNDO_TRIES`) |
| Admin MCP | `get_update_status` description names `rolledBack`; no new tool |
| Docs | `docs/backups-and-updates.md` (new section *A release that does not start*), `docs/troubleshooting.md`, `docs/cli.md` (status line), `docs/admin-mcp.md`, `README.md` highlights, `AGENTS.md` architecture map (`src/index.js`, `src/app.js`, `update-guard.js`), `docs/development.md` if it names the entry |
| Website | `docs/site/index.html`: one line in the updates text; no screenshot shows the note (a state after a failure), so none is retaken. Panel budgets: first screen lowered to 63.7 KB, total +1.05 KB |
| Version | 2.59.0 (minor) in `package.json`, `package-lock.json`, `infra/oci/schema.yaml` |
| Releases | `releases.json` entry: new "A release that does not start is rolled back by itself…" |

## Design

### The note and the result (data directory)

See [data-model.md](data-model.md). Written whole (temporary file + rename). Both are read as untrusted input.

### `src/core/update-guard.js` (Node built-ins only)

- `noteUpdate(dataDir, note)`: called by `applyUpdate`.
- `guardStart({ root, dataDir, kind, exit })` → `holds()`:
  1. `kind !== 'systemd'` or no note → nothing.
  2. A note that cannot be read or is not valid → dropped, nothing.
  3. `starts < MAX_STARTS (3)` → `starts + 1` is written; `holds()` (called by the entry when the app has started)
     sets one timer of `HOLDS_AFTER` (60 s) that drops the note.
  4. Otherwise `putBack`: `git checkout -q <from>`; `npm ci --omit=dev --prefer-offline …` when `deps` is true; the
     result file is written, the note dropped, `exit(1)`. A step that fails: `undoTries + 1`; below `UNDO_TRIES` (3)
     the note stays and the process exits (the next start tries again); at 3 the result says it failed, the note is
     dropped and the start goes on with what is there.
  5. Anything that throws inside the guard is printed and the start goes on.
- `takeRollbackResult(dataDir)`: read once and removed (the app's start hook).

### `src/index.js` and `src/app.js`

`src/index.js` (the path systemd, Docker and `npm start` already use) imports the guard with `import()` inside
`try`/`catch`, calls `guardStart()`, then `await import('./app.js')` (today's `index.js`, moved as it is) and then
`holds()`. A release whose app code throws while it starts never reaches `holds()`.

### `src/core/updates.js`

- `applyUpdate`: commit and lockfile hash before `deploy/update.sh`; after a code 0, when the install is systemd and
  the commit changed: `noteUpdate` with `from`, `fromVersion`, `to` (the version in the new `package.json`), `target`,
  `commit`, `deps`, `backup`.
- `takeRollback()` (start hook, called from `app.js`): the result file → kv `updates:rolledBack`, one Activity line
  (`rollbackText`). A kept notice about another running version is cleared.
- `rolledBack()`: the notice, while the server still runs the version it was rolled back to; `GET /api/updates`
  returns it as `rolledBack` with the text (`rollbackText`, the one wording everywhere).
- `isRolledBack(target, st)`: is this what was rolled back (tag on the stable channel, commit on main).

### `src/core/update-decision.js`

- `updateTick`: the owner alert about a rollback is sent once (tried at each round until it went out, six rounds at
  most; nothing to send without an alert number); the automatic round returns `{ action: 'rolled_back' }` instead of
  installing the version that was rolled back.
- `deliverUpdateReport`: "did not start on this server and was undone" when the rollback is the reason.

### Panel, admin MCP, command line

- `updates.js` (panel): a note under the status line (Overview row: one line with a link; Settings → Updates: the full
  text); **Update** is not the main button for the release that did not start. The update dialog and the watch of a
  running update move to `update-flow.js`, loaded on demand (the first screen gets 1.1 KB smaller); the watch says that
  the update did not start instead of "Updated to …". Two states in `scripts/check-responsive.mjs`.
- `get_update_status`: description mentions `rolledBack`.
- `duniya status`: one line when a rollback notice is there.

## Project Structure

### Documentation (this feature)

```text
specs/095-update-rollback/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/index.js                     the guard, then import('./app.js')
src/app.js                       startup (today's index.js)
src/core/update-guard.js         note, counting, rollback, result (Node built-ins only)
src/core/updates.js              writes the note, takes the result, rolledBack
src/core/update-decision.js      alert, automatic round, WhatsApp result wording
src/panel/public/app/updates.js  the note in the Updates row
src/panel/public/app/update-flow.js  the update dialog and the watch of a running update (on demand)
src/panel/public/app/settings.js the note on Settings → Updates
src/panel/admin-tools/server.js  get_update_status description
bin/duniya.js                    duniya status line
test/update-rollback.test.js     everything above
docs/…, README.md, AGENTS.md, docs/site/index.html, releases.json
```

**Structure Decision**: the existing single-service layout; one new core module and the entry split in two.

## Complexity Tracking

No violations.
