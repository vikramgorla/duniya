---

description: "Task list for 007-backups"
---

# Tasks: Encrypted Scheduled Backups and Restore

**Input**: Design documents from `/specs/007-backups/`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Foundational

- [X] T001 Bundle create/extract, encrypt/decrypt, VACUUM INTO snapshot in src/core/backup/bundle.js
- [X] T002 Apply staged restore before the database opens in src/core/config.js
- [X] T003 Backup settings validation, run, retention, list, scheduler in src/core/backup/index.js

## Phase 2: User Story 1 - Scheduled encrypted backups (P1)

- [X] T004 [P] [US1] Tests: passphrase required, unreadable file, local retention, schedule due logic in test/backups.test.js
- [X] T005 [US1] Backups routes (settings, passphrase, run, list, download) in src/panel/routes/backups.js

## Phase 3: User Story 2 - GitHub private repo (P1)

- [X] T006 [P] [US2] Tests: device flow, token, create private repo, upload commit with pruning in test/backups.test.js
- [X] T007 [US2] GitHub client (device flow, repos, git data API) in src/core/backup/github.js
- [X] T008 [US2] GitHub routes in src/panel/routes/backups.js

## Phase 4: User Story 3 - S3-compatible (P2)

- [X] T009 [P] [US3] Tests: SigV4 headers, put/list/delete, failure isolation in test/backups.test.js
- [X] T010 [US3] SigV4 S3 client in src/core/backup/s3.js

## Phase 5: User Story 4 - Restore (P1)

- [X] T011 [P] [US4] Tests: wrong passphrase refused; round trip into a fresh data dir in test/backups.test.js
- [X] T012 [US4] Restore staging + restart in src/core/backup/index.js and routes

## Phase 6: Polish

- [X] T013 Activity entries for backup/restore; owner-only gates
- [X] T014 Docs: README backups section
