# Tasks

- [X] T001 Provider layer: `onText` / `onRestart` in `chat()`, restart-once semantics, streaming off after a restart
- [X] T002 Anthropic adapter streaming (`messages.stream()`)
- [X] T003 Chat Completions SSE reader + 400/422 retry without streaming; free-only wrapper passes `streams`
- [X] T004 ChatGPT Responses `output_text.delta` → `onText`; Copilot unchanged
- [X] T005 `classify()`: SDK-wrapped `terminated` / `UND_ERR_SOCKET` → network
- [X] T006 Owner assistant `delta` / `restarted` events (Ask box only; WhatsApp and plain Ask unchanged)
- [X] T007 Harness SSE fakes (Anthropic + Chat Completions), mid-stream failures, refuse-stream
- [X] T008 Tests: `test/token-streaming.test.js` (Anthropic, fallback before first token, mid-stream restart, restart +
      failing retry → chain without streaming, OpenAI-compatible tool calls + usage, refuse-stream, ChatGPT deltas,
      JSON answer, cut stream), `test/ask-stream.test.js` updated
- [X] T009 Panel Ask card: append deltas per frame, restarted note; responsive state `overview-ask-restarted`
- [X] T010 Mobile: `applyAskEvent()` deltas/restarted, Ask card note, demo streams word by word (also fixes the
      un-awaited demo reply, code scanning #38); `ask-stream.test.ts`
- [X] T011 Docs: owner-assistant (events), models (fallback line), mobile-app, mobile/README, README highlight,
      website tick
- [X] T012 Version 2.12.0 (package.json, package-lock.json, infra/oci/schema.yaml) + releases.json entry
- [X] T013 `npm test`, `npm run lint`, `npm run check:panel`, `node scripts/ci-checks.mjs`, `npm run check:responsive`,
      mobile typecheck / lint / test
- [ ] T014 PR via REST (`Closes #83`), squash-merge after checks (left to the maintainer)

## Follow-ups

- Admin MCP: n/a (no new panel functionality; streaming is a transport detail of the Ask box).
- Site screenshots not retaken: the finished Ask card looks the same; the change is visible only while it writes.
- The partial streamed call before a restart is not in Usage (no final usage event arrives for it).
