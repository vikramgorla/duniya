# Research: Group Memory and Context Awareness

## How much history to send verbatim

- **Decision**: last 30 messages (bot `historySize`), each truncated to 500 characters, with reply-quotes
  (≤ 200 chars).
- **Rationale**: covers the "current conversation" fully at ~1.5k tokens.

## Long-term memory: rolling summary vs embeddings/RAG

- **Decision**: rolling LLM summary per chat + keyword search tool over stored messages + explicit notes.
- **Rationale**: group chats are small (hundreds–thousands of messages); a summary captures decisions and
  plans better than retrieval of fragments; keyword search (SQLite `LIKE`) is enough as a fallback; no vector
  DB or embedding API needed on a 1 GB VM.
- **Alternatives**: embeddings + vector search (extra dependency/API, RAM); sending full history (cost, context).

## When to summarise

- **Decision**: after storing a message, if unsummarised messages > window (30) + batch (40), summarise all but
  the newest 30 in one call; per-chat in-process lock; retry on the next message after a failure.
- **Model**: `SUMMARY_MODEL` env, default `claude-haiku-5-5`, max 1,200 output tokens; summary capped ~500 words.

## History when the bot joins late

- **Decision**: store messages for every group the number is in (bound or not); also store WhatsApp history
  sync (`messaging-history.set`) and `messages.upsert` type `append`. Deduplicate by (chat, message id).
- **Note**: how much history WhatsApp sends on linking is up to WhatsApp (typically recent days/weeks).

## Prompt-injection posture

- **Decision**: memory goes into the user turn inside `<group_memory>` / `<notes>` / `<recent_messages>` blocks with
  an explicit statement that it is information, not instructions; roles/tools are decided in code (constitution III).

## Note tools

- **Decision**: `memory__remember(text)` and `memory__list_notes()` for everyone, `memory__forget(id)` for
  organizers, `memory__search_history(query, limit)` for everyone; all scoped to the current chat.
