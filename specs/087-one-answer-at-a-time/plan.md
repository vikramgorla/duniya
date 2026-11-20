# 087 · Plan

- `src/core/turns.js` (new): `claimTurn` / `releaseTurn` (Map agent|chat → waiting list, max 8); duplicate guard
  `isDuplicate(chat, agent, what, since)` / `noteSent` (in memory, 3-minute window, 20 entries per chat), `similarity`.
- `src/core/router.js`: `serialTurn` around `runTurn`; WAITED_NOTE; `onEdited`; `deliver` drops duplicates; `msg.arrived`.
- `src/core/runner.js`: `ctx.turnNote` appended to the turn.
- `src/core/chat-tools.js`: duplicate guard in send_media / react / reply; `editWindow`, `editOwnMessage`,
  `edit_my_last_message`.
- `src/core/db.js`: `message_edits` (+ trigger), `editStoredMessage`, `editsOf`, `agentAnsweredAfter`.
- `src/core/memory.js`: `forgetDeleted` → `forgetChanged` (deletions and edits).
- Channels: `editMinutes` capability; WhatsApp `MESSAGE_EDIT`, Telegram `edited_message` → `kind: 'edited'`.
- Panel: routes `PUT /api/chats/:chat/messages/:id`, `POST …/:id/correction`; Messages: Edit / Send a correction,
  edited marker. Admin MCP `edit_chat_message` (risky).
- Small servers: in-memory maps bounded per chat; no timers; one extra indexed lookup per edit.
- No new dependencies. Schema: one new table (`CREATE TABLE IF NOT EXISTS`), no migration.
