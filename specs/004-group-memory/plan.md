# Implementation Plan: Group Memory and Context Awareness

**Branch**: `004-group-memory` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-group-memory/spec.md`

## Summary

Three memory layers per chat, all in SQLite: (1) every message stored with reply-quote and id (deduplicated),
including WhatsApp history-sync batches and messages in unbound groups; (2) a rolling summary maintained in the
background by a low-cost model once enough messages fall outside the recent window; (3) notes written by the bot
through built-in `memory__*` tools. The agent's context is assembled as: summary + notes (both fenced as
untrusted information) + the last N messages verbatim + the new message. A keyword search tool covers anything
the summary dropped. The panel gets a per-chat memory view.

## Technical Context

**Language/Version**: Node.js 22 LTS

**Primary Dependencies**: existing (Baileys `messaging-history.set` and `messages.upsert` type `append`,
Anthropic SDK for the summariser); no new dependencies

**Storage**: `node:sqlite`: `messages` gains `msg_id` (unique per chat), `quoted`, `addressed`; new
`chat_memory` and `notes` tables

**Testing**: extend `test/platform.test.js`; the fake Claude API answers summariser requests (recognised by
system prompt) without consuming the scripted bot responses

**Target Platform**: same server

**Project Type**: service feature

**Performance Goals**: no added latency to replies (summaries run in the background); per-answer context
< ~6k tokens

**Constraints**: summariser runs at most once at a time per chat; failures never block replies; memory text
can't alter permissions (it only enters the user turn, inside fenced blocks)

**Scale/Scope**: ≤ 5,000 stored messages per chat, 90-day retention; ≤ 200 notes per chat (newest 40 in context)

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| II. Generic core | Memory is core and bot-agnostic; bots can opt out (`memory.enabled: false`) | PASS |
| III. Least privilege | `memory:forget` organizer-only; memory tools obey allow/deny globs (`memory:*` default allow) | PASS |
| IV. Confirmation | Memory tools change only local memory, not external systems — no confirm needed | PASS |
| V. Observable/controllable | `memory.summary`, `memory.note.*`, `memory.erased` activity; panel view/erase | PASS |
| VI. Free tier | No new process/deps; SQLite growth bounded by retention | PASS |
| Security & privacy | Summary prompt excludes phone/email; memory fenced as untrusted; per-chat isolation; erase per chat | PASS |
| VII. Tested | New e2e tests for each user story | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/004-group-memory/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/memory-tools.md
└── tasks.md
```

### Source Code (repository root)

```text
src/core/db.js            # schema migration, message/memory/notes queries, retention
src/core/memory.js        # NEW: context builder, summariser queue, memory tools
src/core/tools.js         # adds memory tools to per-role tool lists
src/core/agent.js         # uses memory context
src/core/router.js        # stores every group message (bound or not), history batches
src/channels/whatsapp.js  # quoted text, msg ids, timestamps, history sync, chat names
src/panel/server.js       # memory endpoints
src/panel/public/index.html  # memory view on Chats tab
test/platform.test.js     # memory scenarios
```

**Structure Decision**: one new core module (`memory.js`); everything else extends existing modules.

## Complexity Tracking

No violations.
