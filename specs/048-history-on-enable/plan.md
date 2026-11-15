# Plan 048

- `src/core/chat-prefs.js`: four `chats_seen` columns (added in place), `noteLatestKeys(list)` (one transaction, newer
  keys only, `last_at` untouched so key-only rows stay out of `seenChats()`), `latestKey(chat)`.
- `src/channels/whatsapp.js`: `anchorKeyOf()` for every history message (also non-text); `deliverHistory(messages,
  { onDemand, chats, keys })` (ON_DEMAND from the batch's `syncType`); `fetchHistory(jid, count, anchor)` →
  `sock.fetchMessageHistory(min(count, 50), key, anchor.ts)` (ms, the proto field is `oldestMsgTimestampMs`).
- `src/channels/registry.js`: `fetchHistory` routed like other chat actions (the chat's number); history meta keys and
  chats get app chat ids.
- `src/core/router.js`: history handler notes keys for all chats, sends ON_DEMAND batches to `storeLoadedBatch()`
  (off chats skipped); live messages note their key before the on/off check.
- `src/core/history-load.js` (new): statuses in memory, cooldown, paging, timeout, summary trigger.
- `src/core/db.js`: `insertEarlierMessages()` (ids below every stored row), `oldestStoredMessage()`, `storedSpan()`.
- `src/core/memory.js`: `maybeSummarize` starts below 0 when there is no summary; `summarizeAfterLoad()`;
  `historyNote()`. `src/core/runner.js` puts the note in the user turn (system prompt unchanged).
- Panel: routes and `historyLoadCount` (`src/panel/server.js`), Chats row status, **Load recent messages**, setting
  select; polls `GET /api/chats/:chat/history` while loading.
- Admin MCP `load_chat_history` (`noConfirm`), `set_history_on_switch_on`; owner assistant honours `noConfirm`.
- Tests: fake phone in `test/harness.js` (`t.phone`, `t.historyAsks`), `test/history-on-enable.test.js`.
- Demo panel: rides group answers with 12 messages, Family never answers (loading state).
- Docs: agents (new section), privacy, getting-started, admin-mcp, README, website FAQ.
