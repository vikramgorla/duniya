---

description: "Task list for 001-multi-bot-platform"
---

# Tasks: Multi-Bot WhatsApp Agent Platform

**Input**: Design documents from `/specs/001-multi-bot-platform/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required by constitution VII (e2e with fakes) — included per story.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Create project structure (`src/core`, `src/channels`, `bots/`, `test/`) and `package.json` (ESM, Node ≥ 22.13, scripts start/test)
- [X] T002 [P] Add `.gitignore` for `node_modules/`, `data/`, `.env`, Terraform state

## Phase 2: Foundational

- [X] T003 Implement env/data-dir/secrets/settings and `${VAR}` interpolation in src/core/config.js
- [X] T004 [P] Implement SQLite schema and queries (messages, activity, pending, kv) in src/core/db.js
- [X] T005 [P] Implement activity log + event bus in src/core/events.js
- [X] T006 [P] Implement MCP connection pool with reconnect and secret-change reset in src/core/mcp.js
- [X] T007 Implement bot loader, live overrides, validation, chat binding, roles in src/core/bots.js
- [X] T008 Implement WhatsApp channel (Baileys, normalisation, LID→phone, mentions, QR/pairing, reconnect) in src/channels/whatsapp.js
- [X] T009 Wire startup in src/index.js
- [X] T010 Build e2e harness (fake MCP server, scripted fake Claude API, fake channel) in test/harness.js

## Phase 3: User Story 1 - Participant asks an event question (P1) 🎯 MVP

- [X] T011 [P] [US1] Test: unaddressed message gets no reply; addressed question answered with read-only tools in test/platform.test.js
- [X] T012 [US1] Implement per-role tool lists (glob allow/deny, MCP + local) in src/core/tools.js
- [X] T013 [US1] Implement Claude tool-use loop with system prompt assembly in src/core/agent.js
- [X] T014 [US1] Implement routing, triggers/mentions/replies, trigger stripping, rate limit in src/core/router.js
- [X] T015 [P] [US1] Create panduga bot (config, participant/organizer tool globs) in bots/panduga/bot.json
- [X] T016 [P] [US1] Write panduga instructions in bots/panduga/prompt.md

## Phase 4: User Story 2 - Organizer change with confirmation (P2)

- [X] T017 [P] [US2] Test: preview held, id hidden, participant confirm refused, organizer confirm applies once, look-alike commands ignored in test/platform.test.js
- [X] T018 [US2] Implement confirm gate (pending codes, id redaction, single-use, TTL, same-chat) in src/core/agent.js
- [X] T019 [US2] Only treat `confirm|cancel CODE` as a trigger when the code is pending for that bot in src/core/router.js

## Phase 5: User Story 3 - Several bots on one number (P3)

- [X] T020 [P] [US3] Test: two bots load, template ignored, hook bot answers `!ping` without model and exposes local tool in test/platform.test.js
- [X] T021 [US3] Support `index.js` hooks (`init`, `tools`, `role`, `onMessage`) in src/core/bots.js and src/core/router.js
- [X] T022 [P] [US3] Create bot template with example local tool in bots/_template/

## Phase 6: User Story 4 - Direct messages (P4)

- [X] T023 [P] [US4] Test: group member DM answered, stranger ignored in test/platform.test.js
- [X] T024 [US4] Implement DM routing (trigger, default bot, policy none/organizers/members/anyone, group membership) in src/core/router.js

## Phase 7: User Story 5 - Scheduled posts (P5)

- [X] T025 [US5] Implement scheduler (HH:MM, days, chats, once per day per chat, SKIP) in src/core/scheduler.js
- [X] T026 [US5] Add disabled morning-agenda schedule to bots/panduga/bot.json

## Phase 8: Polish

- [X] T027 Organizer helpers `!groupid` / `!groups` in src/core/router.js
- [X] T028 Pause flag honoured by router and scheduler; test in test/platform.test.js
- [X] T029 README bot authoring guide in README.md

## Dependencies

Phase 2 blocks all stories. US2 depends on US1 (agent loop). US3–US5 depend on US1 only.
