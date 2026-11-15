# Tasks

- [X] T001 Chat prefs `private`, `notice_off` (in-place columns); `privateChats()`, `isChatPrivate()`
- [X] T002 `privacy-notice.js`: settings, decision rules (first / text changed / 90 days / opt-out / off / DMs), post on
  switch-on, DM line once per person; Chats route wiring
- [X] T003 `owner-assistant.js`: link tables and flow (code, pending, confirm, unlink, brute-force guard, LID phones)
- [X] T004 Data scope: visible chats, output filter, chat guard for read tools; core tools `list_visible_chats`,
  `search_messages`, `chat_recap`
- [X] T005 Tool loop with admin tools via `invoke` (role gates), secret-taking tools excluded, held changes with
  `confirm/cancel CODE` bound to user + surface; audit entries `owner.*` (always recorded)
- [X] T006 Router: one early branch for direct messages; DM privacy line in `reply()`; long answers chunked
- [X] T007 Routes `/api/owner-assistant…`, `/api/owner/ask…`, `/api/privacy-notice`; admin MCP tools
  `get_owner_assistant`, `set_chat_private`, `get_privacy_notice`, `set_privacy_notice`, `set_chat_privacy_notice`
- [X] T008 Panel: Overview Ask card, Settings cards (Owner assistant, Privacy notice), Chats ticks; mobile Ask card
- [X] T009 Tests `test/owner-assistant.test.js`; harness option `privacyNotice`
- [X] T010 Docs (`docs/configuration.md`), version 2.8.0
- [X] T011 (#64) Owner-assistant and admin-MCP confirm codes stored in `ttl_state` (encrypted, expiry, single use);
  `test/restart-state.test.js`

## Follow-ups (not in this release)

- A confirmed "send a message to a group" tool (deliberately not added: replies never leave the owner's chat).
- ~~Streaming answers in the Ask box~~ — done per step in v2.11.0 (#66); token-by-token text stays a follow-up.

## #66 — streaming Ask box (v2.11.0)

- [X] T011 `ask()` `onEvent` (steps with tool names only, text per round)
- [X] T012 Route `POST /api/owner/ask/stream` (NDJSON, ping, done / error)
- [X] T013 Panel Ask card: `apiStream()`, step chips, partial text, Confirm unchanged; responsive state
  `overview-ask-streaming`; `card-ask` / overview shots retaken with steps
- [X] T014 App Ask card: `ApiClient.stream()` with `expo/fetch`, steps and partial text; demo stream
- [X] T015 Tests `test/ask-stream.test.js`, `mobile/src/lib/ask-stream.test.ts`; docs `docs/owner-assistant.md`,
  `docs/mobile-app.md`, `mobile/README.md`
