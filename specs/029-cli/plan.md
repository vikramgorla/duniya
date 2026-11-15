# Implementation Plan: `duniya` command line tool

**Branch**: `feat/i4-infra-signin` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

## Summary
`bin/duniya.js` imports the app's core modules lazily (help works without a database) and sets `DUNIYA_CLI=1` so
`config.js` skips applying a staged restore. `src/core/db.js` gains `PRAGMA busy_timeout = 5000` (WAL was already on).
`src/core/runtime.js` writes the heartbeat used by `status`/`doctor`. `deploy/duniya` is the root wrapper.

## Technical Context
Node 22 ESM, `node:sqlite`, no new dependencies. Tests: `test/cli-signin.test.js`.

## Constitution Check
| Principle | Check | Status |
|---|---|---|
| V. Observable | CLI changes are recorded in the activity log | PASS |
| VI. Everything as code | installed by install.sh; Dockerfile adds the command | PASS |
| VII. Tests | real child-process tests | PASS |
| Security | data files stay owned by the app user (node runs as `duniya`); only systemctl/journalctl run as root; the wrapper passes only app.env to node | PASS |

## Design decisions
- Root-only operations live in bash so node never runs as root against the data directory (a root-created
  `duniya.sqlite-shm` would break the service).
- `update` exits 3 for "already up to date" so the wrapper restarts the service only after a real update.
- Generated passwords: 16 characters in groups of four from an unambiguous alphabet.
