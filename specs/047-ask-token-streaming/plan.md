# Plan 047

- `src/core/providers/anthropic.js`: with `onText`, `messages.stream()` + `on('text')`; `finalMessage()` gives content,
  stop reason and usage. Without it, `messages.create()` as before.
- `src/core/providers/openai-chat.js`: `readChatStream()` (SSE frames, text deltas, tool-call deltas joined by index,
  last-chunk usage, JSON answer accepted, error chunk → error, end without finish → error); `streamRequest()`; a
  400/422 before any text → same account without streaming. Used by OpenAI, OpenRouter (incl. free-only wrapper,
  which passes `streams` through) and other endpoints.
- `src/core/providers/chatgpt.js`: forward `response.output_text.delta` to `onText` (the Responses call already
  streams).
- Copilot: no `streams` flag → called without `onText`.
- `src/core/providers/index.js` `chat()`: per candidate, wrap `onText` to note the first token; on a failure after it,
  `onRestart`, retry the same adapter without `onText`, and turn streaming off for the rest of the call. Failures
  before the first token go through the unchanged fallback path. Breaker/usage bookkeeping unchanged (the retry's
  outcome counts).
- `src/core/providers/errors.js`: a stream cut mid-way through the Anthropic SDK (`terminated`, cause chain
  `UND_ERR_SOCKET`) classifies as `network`.
- `src/core/owner-assistant.js` `ask()`: with `onEvent`, pass `onText` → `delta`, `onRestart` → `restarted`.
- Panel `askCard()`, mobile `applyAskEvent()` + Ask card + demo stream.
- Tests: `test/harness.js` fakes answer `stream: true` with SSE (Anthropic events / Chat Completions chunks), with
  mid-stream failures (`t.claudeStreamFail`, `f.streamFail`) and `f.refuseStream`; `test/token-streaming.test.js`;
  `test/ask-stream.test.js` updated; mobile `ask-stream.test.ts`.
- Responsive state `overview-ask-restarted`. Website text updated; screenshots unchanged (the final Ask card looks the
  same).
- Small servers: one response held at a time, as before. No new dependencies.
