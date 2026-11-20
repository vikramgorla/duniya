# 087 · Tasks

- [x] T1 Issue #201 (labels, spec: 087), plan comment, branch
- [x] T2 turns.js: one turn per agent + chat, waiting list, duplicate guard
- [x] T3 Router: serial turns, one follow-up for what waited, duplicate drop, `[quiet]` never sent
- [x] T4 Chat tools: duplicate guard, edit window, edit_my_last_message
- [x] T5 Edits: table + marker, WhatsApp and Telegram incoming edits, summary rebuild, judged turn on a changed meaning
- [x] T6 Panel: Edit / Send a correction, edited marker; admin MCP edit_chat_message
- [x] T7 Tests (car-pooling race, coalescing, duplicates, self-correction, panel, incoming, Telegram)
- [x] T8 Docs (agents.md, chats.md, admin-mcp.md), release notes 2.48.0, version bump
- [x] T9 Checks, PR, merge, done comment, real-device checks in #62

## Definition of Done
- [x] Small servers: no timers; bounded in-memory maps
- [x] Privacy: chats that are off untouched; silence reason counts only; edit marker without text
- [x] Permissions in code: edit only own messages, within the window; panel admin role; MCP confirmed
- [x] Lean code: one edit path (`editOwnMessage`) for the tool, the panel and MCP; `forgetChanged` reused
