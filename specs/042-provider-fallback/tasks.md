# Tasks

- [X] T001 `errors.js`: classification and Retry-After / reset parsing
- [X] T002 `breaker.js`: cooldown (1 min doubling to 30 min, quota reset ≤ 24 h), probe, reconnect state, activity, alerts
- [X] T003 Adapters per account (Anthropic, OpenAI, ChatGPT, Copilot); error status/code/headers
- [X] T004 Account registry, ids, secrets, add/rename/remove, strategies (order / spread)
- [X] T005 `planCandidates` + `chat()` fallback, sticky per turn, last-resort pass, usage account + reason
- [X] T006 Runner: effective fallback (global → agent → chat), `ctx.fallback`, friendly "unavailable" text
- [X] T007 Agent schema `fallback`, chat prefs `fallback`, usage columns and groupings
- [X] T008 Routes `/api/fallback…`, `/api/accounts…`, labels on ChatGPT/Copilot/OpenRouter routes; admin MCP tools
- [X] T009 Panel: Models (health, accounts, strategy, terms note, fallback card), agent page, Chats, Usage, test console;
  demo data
- [X] T010 Tests `test/fallback.test.js` (failing fake providers in `test/harness.js`); existing tests adjusted where a
  failure now falls back; docs; version 2.5.0

## #65 — per-chat chain editor (v2.11.0)

- [X] T011 Panel Chats: `chatFallbackLine()` under the model, **Fallback…** opens `chatFallbackEditor()` (shared
  `fallbackPicker` with an `inheritLabel`), saved through `PUT /api/chats/:chat/prefs`
- [X] T012 Admin MCP `set_chat_settings`: partial fallback change keeps the other half (reads `GET /api/chats`)
- [X] T013 Tests `test/chat-fallback-editor.test.js`; responsive state `chats-fallback`
- [X] T014 Docs `docs/models.md`, `docs/admin-mcp.md`; screenshots `chats-*`, `card-fallback` retaken; version 2.11.0
