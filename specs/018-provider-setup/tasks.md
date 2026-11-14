---

description: "Task list for 018-provider-setup"
---

# Tasks: Guided Provider Setup, OpenRouter Preset, GitHub Copilot

**Input**: Design documents from `/specs/018-provider-setup/`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Research & foundations

- [X] T001 Research Copilot SDK (package, transport, auth, tools, models, quota) and measure runtime memory → research.md
- [X] T002 Add optional dependency `@github/copilot-sdk` 1.0.34 (pinned) in package.json / package-lock.json

## Phase 2: OpenRouter preset (US3)

- [X] T003 [US3] `addOpenRouter`, `setFreeOnly`, `freeOnlyAdapter`, `freeOnly` kept on re-save in src/core/providers/index.js
- [X] T004 [US3] Routes `POST /api/providers/openrouter`, `POST /api/providers/compatible/:id/free-only` in src/panel/routes/providers.js
- [X] T005 [US3] Friendly bot message for `free_only` in src/core/agent.js
- [X] T006 [P] [US3] Tests: preset, secret not returned, free filter, toggle keeps key, auto picks free, paid refused in test/provider-setup.test.js

## Phase 3: Test button (US2)

- [X] T007 [US2] `testProvider()` in src/core/providers/index.js and `POST /api/providers/:id/test` (activity) in src/panel/routes/providers.js
- [X] T008 [P] [US2] Tests: reply + latency, 404/400, error shown in test/provider-setup.test.js

## Phase 4: GitHub Copilot (US5)

- [X] T009 [US5] Adapter with injectable client factory, lazy start/idle stop, scrubbed env, models, quota, account, token checks in src/core/providers/copilot.js
- [X] T010 [US5] Chat bridge (session per conversation, custom tools only, held tool calls ↔ tool_result, cleanup, error mapping) in src/core/providers/copilot.js
- [X] T011 [US5] Registry entry + status extras (account, quota) in src/core/providers/index.js; owner-only connect/disconnect routes
- [X] T012 [US5] Friendly bot message for `copilot_limit` in src/core/agent.js
- [X] T013 [P] [US5] Tests with fake client: token checks, rejected token not kept, models/quota/account, owner only, tool round trip through a bot, error, plain test, disconnect in test/provider-setup.test.js

## Phase 5: Guided Models page (US1, US4)

- [X] T014 [US1] Start here, provider cards with cost line, numbered steps, direct links, drawn cues, paste fields, connected state with Test in src/panel/public/index.html
- [X] T015 [US4] ChatGPT card: Plus/Pro note, "can’t be reached is expected" cue, copy-whole-address step (logic unchanged)
- [X] T016 [US5] Copilot card: allowance label, personal-use note, PAT template link, read/write hint, quota meter, memory note
- [X] T017 DESIGN.md checklist screenshots: light/dark × phone/iPad, empty and connected states

## Phase 6: Polish

- [X] T018 Full `npm test` passes
- [ ] T019 Verify Copilot end to end with a real GitHub account (token permission level, real event shapes, RSS during sessions)
