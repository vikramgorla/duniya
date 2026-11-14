---
description: "Task list for 019-signin-and-backups"
---

# Tasks: Sign in with Google, GitHub App Backups, Download/Upload Restore

## Phase 1: Foundational

- [X] T001 Move panel HTTP helpers (CSP, cookies, client IP, session cookie, limiter, result page, setup code) to src/panel/http.js
- [X] T002 Raw upload route type with header/origin CSRF guard and streamed, size-limited receive in src/panel/server.js and src/panel/http.js
- [X] T003 Extend jwt.js: exported OIDC discovery, multiple issuers, JWKS refetch on unknown kid in src/core/providers/jwt.js

## Phase 2: US1–US3 Google sign-in and invites (P1)

- [X] T004 [P] [US1-3] Tests with fake Google issuer/JWKS/token endpoint in test/signin-backups.test.js
- [X] T005 [US2] users.google_sub, linking, Google-only users in src/core/store.js
- [X] T006 [US3] invites table and create/renew/revoke/accept in src/core/store.js
- [X] T007 [US1] Config, connection test, start/finish (PKCE, state, nonce, binding), user resolution in src/core/google-signin.js
- [X] T008 [US1-3] Routes, callback result page with same-origin hop, activity, rate limits in src/panel/routes/google.js
- [X] T009 [US1-3] Login button, Settings: setup card (4 steps, copy, deep links, test), Your Google account, users badges, invites in src/panel/public/index.html

## Phase 3: US4 GitHub App (P1)

- [X] T010 [P] [US4] Tests with fake GitHub (manifest conversion, installations, tokens, empty repo) in test/signin-backups.test.js
- [X] T011 [US4] Token-provider api(), manifest, app JWT, installation tokens/repos, empty-repo first commit in src/core/backup/github.js
- [X] T012 [US4] githubAuth()/appInstallationToken() in src/core/backup/index.js
- [X] T013 [US4] Manifest page, callback, installed page, check/repo/disconnect routes in src/panel/routes/backups.js
- [X] T014 [US4] GitHub card with progress steps and installation polling in src/panel/public/index.html

## Phase 4: US5–US6 Download/upload restore (P1)

- [X] T015 [P] [US5-6] Tests: download, upload guards/limits, wrong passphrase retry, restore staging, first-run restore in test/signin-backups.test.js
- [X] T016 [US5] restoreBuffer() in src/core/backup/index.js; /api/backups/upload and restore source "upload" in src/panel/routes/backups.js
- [X] T017 [US6] /api/setup/upload and /api/setup/restore (no users + setup code) in src/panel/routes/backups.js
- [X] T018 [US5-6] "On this server" card, Back up now & download, Restore from a file, first-run "Restore a backup" with upload progress and restart wait in src/panel/public/index.html

## Phase 5: Polish

- [X] T019 DESIGN.md checklist: screens checked light/dark on phone (390 px) and iPad (820 px)
- [X] T020 Spec Kit artifacts in specs/019-signin-and-backups/
- [ ] T021 Verify the Google steps and the GitHub manifest flow against the real services on a deployed server
