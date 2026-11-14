---

description: "Task list for 005-app-managed-bots"
---

# Tasks: Bots, Users and Secrets Managed in the App

**Input**: Design documents from `/specs/005-app-managed-bots/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/panel-api-005.md

**Tests**: Required (constitution VII).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Amend constitution II to v1.1.0 (bots as data; templates/plugins as files) in .specify/memory/constitution.md
- [X] T002 [P] Move repo bots to templates/blank.json and templates/event-assistant-panduga.json; move hook example to plugins/example-dice/index.js

## Phase 2: Foundational

- [X] T003 Master key, AES-256-GCM, password hashing, token helpers in src/core/crypto.js
- [X] T004 Bot config defaults + validation/normalisation in src/core/schema.js
- [X] T005 Tables + repositories (tenants, users, sessions, bots, secrets, settings) in src/core/store.js
- [X] T006 Secrets and settings via store (encrypted), `${VAR}` interpolation unchanged in src/core/config.js
- [X] T007 Runtime registry from store, plugins loader, legacy migration in src/core/bots.js

## Phase 3: User Story 1 - Create and edit bots in the panel (P1) 🎯 MVP

- [X] T008 [P] [US1] Tests: create from template, edit, validation error, delete removes bindings in test/app.test.js
- [X] T009 [US1] Bot CRUD + discover endpoints in src/panel/server.js
- [X] T010 [US1] Bot editor UI (sections, tool discovery with per-role ticks, schedules, plugins) in src/panel/public/index.html

## Phase 4: User Story 2 - Templates, import, export (P2)

- [X] T011 [P] [US2] Tests: export has no secret values; import clears bindings, new id in test/app.test.js
- [X] T012 [US2] Templates, duplicate, export, import endpoints in src/panel/server.js and UI

## Phase 5: User Story 3 - Legacy migration (P2)

- [X] T013 [P] [US3] Test: legacy folders + overrides + secrets.json imported once in test/app.test.js
- [X] T014 [US3] Migration in src/core/bots.js and src/core/config.js

## Phase 6: User Story 4 - Admins with roles (P2)

- [X] T015 [P] [US4] Tests: setup code, viewer read-only on all mutating routes, admin can't manage users, last owner protected in test/app.test.js
- [X] T016 [US4] User/session auth, role gates, setup endpoint, users endpoints in src/panel/server.js
- [X] T017 [US4] Setup screen, login with username, Users management UI in src/panel/public/index.html

## Phase 7: User Story 5 - Secrets at rest (P3)

- [X] T018 [P] [US5] Test: plaintext absent from data dir in test/app.test.js

## Phase 8: Polish

- [X] T019 Update harness and existing suites to store-backed bots in test/harness.js
- [X] T020 Acting user in activity for bot/user/secret changes in src/panel/server.js
- [X] T021 Docs: README bots section rewritten for in-app bots, templates, plugins
