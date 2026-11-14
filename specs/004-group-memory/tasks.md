---

description: "Task list for 004-group-memory"
---

# Tasks: Group Memory and Context Awareness

**Input**: Design documents from `/specs/004-group-memory/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/memory-tools.md

**Tests**: Required by constitution VII — e2e scenarios per story.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Add `SUMMARY_MODEL`, retention and memory defaults to src/core/config.js

## Phase 2: Foundational

- [X] T002 Migrate `messages` (msg_id unique per chat, quoted, addressed) and add `chat_memory`, `notes` tables with queries and retention in src/core/db.js
- [X] T003 Normalise quoted text, message id and timestamp; emit history-sync and `append` batches; expose `chatName` in src/channels/whatsapp.js
- [X] T004 Fake-Claude summariser handling and memory helpers in test/platform.test.js

## Phase 3: User Story 1 - The bot follows the conversation (P1) 🎯 MVP

- [X] T005 [P] [US1] Test: unaddressed messages + reply-quote appear in context; unbound-group messages appear after binding; history batch stored once and not answered in test/platform.test.js
- [X] T006 [US1] Store every group message (bound or not) and history batches in src/core/router.js
- [X] T007 [US1] Context builder (recent messages with quotes, fenced as untrusted) in src/core/memory.js
- [X] T008 [US1] Use the context builder in src/core/agent.js; default historySize 30 in src/core/bots.js

## Phase 4: User Story 2 - Long discussions stay in memory (P1)

- [X] T009 [P] [US2] Test: summary created past threshold and included; summariser failure doesn't break replies; search finds old message in test/platform.test.js
- [X] T010 [US2] Background summariser with per-chat lock and threshold in src/core/memory.js
- [X] T011 [US2] `memory:search_history` tool in src/core/memory.js

## Phase 5: User Story 3 - Remember things on request (P2)

- [X] T012 [P] [US3] Test: remember → note in next context; participant has no forget; organizer forget works in test/platform.test.js
- [X] T013 [US3] `remember`, `list_notes`, `forget` tools and notes in context in src/core/memory.js
- [X] T014 [US3] Add memory tools to per-role tool lists (default allows, deny-able, opt-out) in src/core/tools.js

## Phase 6: User Story 4 - Operator sees and controls memory (P2)

- [X] T015 [P] [US4] Test: memory endpoint shows summary/notes/count; erase removes all in test/platform.test.js
- [X] T016 [US4] Memory endpoints (get, summarize, erase chat, delete note) in src/panel/server.js
- [X] T017 [US4] Memory view on Chats tab in src/panel/public/index.html

## Phase 7: Polish

- [X] T018 Memory activity entries (`memory.summary`, `memory.note.added|removed`, `memory.erased`) in src/core/memory.js
- [X] T019 [P] Document memory in README.md and bot-definition contract (`memory.enabled`)
- [X] T020 Run full test suite and update tasks/spec status
