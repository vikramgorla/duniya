---

description: "Task list for 002-admin-panel"
---

# Tasks: Admin Panel

**Input**: Design documents from `/specs/002-admin-panel/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/panel-api.md

**Tests**: Required by constitution VII — panel API test included.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Add `qrcode` dependency in package.json

## Phase 2: Foundational

- [X] T002 HTTP server, router, JSON body parsing, security headers, CSP in src/panel/server.js
- [X] T003 Auth: scrypt check (env or admin.json), sessions, login rate limit, logout, password change in src/panel/server.js
- [X] T004 CSRF guard (JSON-only mutations) and localhost bind in src/panel/server.js
- [X] T005 UI shell: login, tabs, `h()` textContent helper, API client, toasts, light/dark CSS in src/panel/public/index.html

## Phase 3: User Story 1 - See what the bots are doing (P1) 🎯 MVP

- [X] T006 [US1] Activity list/paging and SSE stream endpoints in src/panel/server.js
- [X] T007 [US1] Activity view (live prepend, bot filter, details, load older) in src/panel/public/index.html

## Phase 4: User Story 2 - Control the bots (P1)

- [X] T008 [US2] Status/settings endpoints (pause, default DM bot) in src/panel/server.js
- [X] T009 [US2] Bots list/get/update/reload endpoints using validated live overrides in src/panel/server.js
- [X] T010 [US2] Chats list + bind endpoints in src/panel/server.js
- [X] T011 [US2] Pending list/apply/cancel endpoints in src/panel/server.js
- [X] T012 [US2] Overview (control card), Bots editor, Chats, Pending views in src/panel/public/index.html
- [X] T013 [US2] Schedule "Run now" endpoint and button in src/panel/server.js and src/panel/public/index.html

## Phase 5: User Story 3 - Link WhatsApp and manage secrets (P2)

- [X] T014 [US3] Channel status with QR data URL, pair, logout, restart endpoints in src/panel/server.js
- [X] T015 [US3] Write-only secrets endpoints listing secrets referenced by bots in src/panel/server.js
- [X] T016 [US3] WhatsApp card and Secrets view in src/panel/public/index.html

## Phase 6: User Story 4 - Try a bot and update the server (P3)

- [X] T017 [US4] Test console endpoint (never posts to WhatsApp) and UI in src/panel/server.js and src/panel/public/index.html
- [X] T018 [US4] Update (deploy/update.sh) and restart endpoints + UI in src/panel/server.js
- [X] T019 [P] [US4] Fast-forward update script reinstalling deps only on lockfile change in deploy/update.sh

## Phase 7: Polish & Verification

- [X] T020 Panel e2e test (auth, CSRF, edit/validation, secrets never returned, chats, activity) in test/platform.test.js
- [X] T021 Headless-browser screenshots on 390 px and 1280 px; fix bot card header wrap and favicon 404 in src/panel/public/index.html
