# Spec 048: Recent messages when a chat is switched on (#91)

Bug: on a new install the owner linked WhatsApp, created an agent and switched a group on; the agent had no history
and told him it could not see it. WhatsApp sends history while linking, but then every chat is still off (#10, spec
032), so it is dropped by design.

## User stories

1. **Context after switching on (P1).** *Given* a chat that was off, *when* an admin switches it on (panel, admin MCP
   or owner assistant through the same route), *then* the server asks the linked phone for its recent messages
   (default 50), stores them (the chat is on now) before anything stored since, and builds the running summary.
2. **Nothing stored while off (P1).** *Given* a chat that is off, *then* no message text, no sender name and no
   on-demand history is stored; only the newest message key (id, fromMe, participant jid) and its time per chat.
3. **Status and retry (P1).** The Chats row shows *Loading recent messages from your phone…* → *Loaded N earlier
   messages*, or *Your phone didn't send history (keep it online and try again)*. **Load recent messages** (chats that
   are on, admins) asks for the messages before the oldest stored one; at most once per 30 s per chat.
4. **Honest agent (P1).** The agent's turn states what is stored ("N stored messages since <date>", plus a summary if
   any) or that nothing is stored yet, and points to *Load recent messages* instead of guessing.
5. **Owner tools (P2).** Admin MCP `load_chat_history` (status with `status_only`) and `set_history_on_switch_on`;
   the owner assistant runs `load_chat_history` without a confirm code (it only adds messages from the owner's own
   phone; logged as `owner.tool`).

## Requirements

- FR-1 `chats_seen` gains `last_msg_id`, `last_from_me`, `last_participant`, `last_msg_at`, updated from link and
  reconnect history and from live messages for every chat (newer keys only). Chats known only this way stay off the
  People list.
- FR-2 `loadChatHistory(chat, { count })`: chat must be on (409); anchor = oldest stored message with a WhatsApp id,
  else the remembered key (none → state `no_anchor`); asks the chat's own number (`fetchHistory` →
  Baileys `fetchMessageHistory(count ≤ 50, key, timestamp ms)`), page by page up to `count` (max 200).
- FR-3 Answers arrive as `messaging-history.set` with `syncType ON_DEMAND`; stored only for chats that are on (groups
  and people), deduplicated by message id, with row ids below the chat's stored rows so recent-window and summary
  boundaries stay right. No answer within `HISTORY_WAIT_MS` (45 s) → `no_response` (or `loaded` if a page arrived).
- FR-4 After a load: no summary yet → build one from everything stored; a summary exists → fold the earlier messages
  into it (boundary kept).
- FR-5 API: `GET /api/chats` rows and `PUT /api/chats/:chat/prefs` include `history`; `GET|POST
  /api/chats/:chat/history`; setting `historyLoadCount` (0–200, default 50; 0 = don't load on switch-on) via
  `POST /api/settings`.

## Non-functional

- Privacy: activity entries keep counts only; the status carries no content. Chats that are off still never reach
  storage or a model.
- Small servers: text only, at most 200 messages per load, one summary call; no new dependencies.
- Needs the phone online; WhatsApp decides what it sends (unverifiable in tests: fakes only).
