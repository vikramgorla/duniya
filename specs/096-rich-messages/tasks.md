# Tasks: Rich messages in the panel

## Phase 1: Storage

- [X] T001 `media` column in `CREATE TABLE messages`, guarded `ALTER TABLE` for existing installs (2.61.0 only) in `src/core/db.js`
- [X] T002 `logMessage` / `insertEarlierMessages` store `media` (`messageValues`); `listMessages` returns it in `src/core/db.js`
- [X] T003 `storedMedia`, `mediaView`, `mediaDetail` in `src/core/message-media.js`

## Phase 2: Channels (FR-002)

- [X] T004 WhatsApp: GIF and video in `mediaInfoOf`, slim `mediaRefOf`, `sentMedia` in `sendMedia`, own messages keep media in `src/channels/whatsapp/session.js`
- [X] T005 Telegram: animation and video in `mediaOf`; `sendMedia` returns media in `src/channels/telegram/`

## Phase 3: US1 / US2 — store and show (FR-003 … FR-006)

- [X] T006 [US1] Inbound and history messages store media in `src/core/router.js`
- [X] T007 [US2] Shared GIFs, `send_media`, created pictures (now stored), voice answers store media in `sharing.js`, `chat-tools.js`, `media-ai.js`, `router.js`
- [X] T008 [US1] `mediaFile()` with limits, deadline, failures and in-memory keep in `src/core/message-media.js`
- [X] T009 [US1] `GET /api/chats/:chat/messages/:id/media` with `sendBytes` (ranges) in `src/panel/routes/chats.js`, `src/panel/http.js`
- [X] T010 [US1] Messages API and Review carry `media` in `src/panel/routes/chats.js`, `src/core/review.js`
- [X] T011 [US1] `messageMedia()` / `wordsBeside()` in `src/panel/public/app/media.js`; Messages bubbles in `chats.js`; styles
- [X] T012 [US2] Review shows media in `src/panel/public/app/agent-editor.js`

## Phase 4: US3 — Activity

- [X] T013 [US3] Activity details carry `msg` and `media`; an opened entry shows it in `src/panel/public/app/answers.js`

## Phase 5: Tests

- [X] T014 `test/rich-messages.test.js`; additions in `test/whatsapp-features.test.js`, `test/telegram.test.js`, `test/fake-telegram.js`
- [X] T015 Demo: a photo, a sticker and an Activity entry with media (`scripts/demo-media.mjs`, `scripts/demo-panel.mjs`); state `activity-media` in `scripts/check-responsive.mjs`

## Phase Final: Definition of Done

- [X] T016 Issue #303 with labels, plan comment, progress comments
- [X] T017 Spec artifacts match the code
- [X] T018 `npm test`, `npm run lint`, `npm run typecheck`, `npm run check:panel` pass
- [X] T019 UI: `npm run check:responsive` (375 / 393 / 1440, light + dark); DESIGN.md
- [X] T020 Security: allow-listed content types, nosniff, sandbox CSP, admin role, no reference in JSON
- [X] T021 Privacy: chats that are off store nothing; nothing of a file in logs; erase and retention follow the row
- [X] T022 Small servers: caps by server size, 2 at a time, deadline, memory pressure, nothing on disk
- [X] T023 Every wait has a deadline (`within()` around `downloadMedia`)
- [X] T024 No chores: nothing to set up
- [X] T025 Clean code: `npm run check:clean`
- [X] T026 Lean code: `node scripts/ci-checks.mjs`; the migration goes in the next release
- [X] T027 Admin MCP: `list_chat_messages` describes `media`; `docs/admin-mcp.md`
- [X] T028 Docs: `chats.md`, `privacy.md`, `README.md`, `DESIGN.md`
- [X] T029 Website: Messages paragraph; screenshots retaken
- [X] T030 Version 2.61.0 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml`
- [X] T031 `releases.json` entry
- [X] T032 PR via REST, squash merge with explicit message
- [ ] T033 Issue done comment and close
