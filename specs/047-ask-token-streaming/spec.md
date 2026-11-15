# Spec 047: Ask box token streaming (#83)

Follow-up to #66 (spec 044): the Ask box streams steps, but the assistant's text inside one model call arrives at
once because the provider adapters return whole responses.

## User stories

1. **Text as it is written (P1).** *Given* a panel or mobile user asks in the Ask box, *when* the model writes its
   answer, *then* the text appears piece by piece (Anthropic, OpenAI, OpenRouter, other OpenAI-compatible endpoints,
   ChatGPT sign-in). GitHub Copilot answers whole after each step, as before.
2. **Fallback still works (P1).** *Given* the answering model fails, *then*:
   - before its first piece of text: the next model in the chain is tried as before (#43); nothing of the failed
     attempt is shown, so only the model that answers streams;
   - after its first piece: the client gets `restarted` (a reason code only), drops the partial text, and the same
     account is asked once more without streaming; if that fails, the chain continues without streaming.
3. **WhatsApp unchanged (P1).** WhatsApp replies and the plain `POST /api/owner/ask` are never streamed.

## Requirements

- FR-1 `chat()` (`src/core/providers/index.js`) takes optional `onText(delta)` and `onRestart({ reason, account })`.
  Adapters with `streams: true` get `onText`; others are called as before.
- FR-2 Stream events (`POST /api/owner/ask/stream`, NDJSON): `delta` `{ text }`, `restarted` `{ reason }` added to
  `step`, `text`, `done`, `error`, `ping`. The first `delta` after a `thinking` step starts a new text; the round's
  whole `text` still follows and wins.
- FR-3 Usage and cost are recorded once per model call from the final usage of the answer that is returned
  (Anthropic `message_delta`, Chat Completions `stream_options.include_usage`, Responses `response.completed`).
- FR-4 A server that refuses streamed requests (400 / 422 before any text) is asked again without streaming on the
  same account; a server that ignores `stream` and answers JSON still works.
- FR-5 Panel: deltas drawn at most once per animation frame; "The answer was interrupted; asking again…" while a
  restarted answer runs. Mobile: same state machine in `applyAskEvent()`; the demo streams word by word.

## Non-functional

- Small servers: no buffering beyond the current response; deltas are written to the client as they arrive.
- Privacy: deltas are the assistant's own answer to the asking user; nothing is logged; `restarted` carries a reason
  code, never an error message.
- No new dependencies (Anthropic SDK `messages.stream()`, `fetch` SSE for the others).
