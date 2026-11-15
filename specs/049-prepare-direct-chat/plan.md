# Plan 049

- `src/core/direct-chats.js` (new): tables `direct_chats` (chat, number, phone, lid, on_whatsapp, created/first/intro
  times) and `chat_aliases`; `normalizePhone()`, `checkDirectNumber()`, `prepareDirectChat()` (validates, then
  `setChatPrefs`, `setCap`, `bindChat`; aliases a LID learned from the number check or seen earlier without settings),
  `resolveDirectChat(msg)` (router entry; cached), `introPreview()` / `sendIntro()` (ttl-store token bound to the text,
  `dmNoticeOnce`, `logMessage`).
- `src/core/privacy-notice.js`: `dmNoticePending()` (peek for the preview).
- `src/core/router.js`: `resolveDirectChat()` at the start of `onMessage` (one line; the history handler is untouched).
- `src/channels/registry.js`: resolve before `noteChat`; `lookupNumber(number, phone)`. `src/channels/whatsapp.js`:
  `lookupNumber()` via Baileys `onWhatsApp` + `lidMapping.getLIDForPN`.
- `src/panel/routes/direct-chats.js` (new) + `/api/chats` lists prepared chats (`prepared`, `waiting`) and hides aliases.
- `src/panel/admin-tools.js`: `prepare_direct_chat` (`risky` as a function of the arguments), `send_chat_intro`;
  `src/panel/admin-mcp.js` evaluates a function `risky`. Owner assistant system prompt: prepare instead of asking the
  person to write first.
- Panel: `addDirectChatCard()`, `introCard()`, Contacts "Set up chat"; demo seeds a prepared chat (Mia); responsive
  states `chats-add-dm`, `chats-intro`, `contacts`.
- Tests: `test/prepare-dm.test.js`, `test/admin-mcp.test.js` (MCP confirm). Docs: agents, owner-assistant,
  admin-mcp, privacy, getting-started, README, website; chats screenshots and chat-on video retaken.
