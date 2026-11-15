# Tasks

- [X] T001 `src/core/direct-chats.js`: validation, prepare (prefs, cap, binding), cache, LID aliasing, first-message time
- [X] T002 Router + registry: resolve prepared chats before routing and `noteChat`; `lookupNumber` in channel/registry
- [X] T003 Intro: preview with single-use token, send with DM privacy line once; allow-list and agent checks
- [X] T004 Panel routes `/api/direct-chats`, `/api/direct-chats/check`, `/api/chats/:chat/intro{,/preview}`; `/api/chats`
      shows prepared chats and hides aliases
- [X] T005 Admin MCP `prepare_direct_chat` (confirm with `send_intro`), `send_chat_intro`; owner assistant prompt
- [X] T006 Panel UI: Add a direct chat, Contacts → Set up chat, waiting pill, intro card; demo seed; responsive states
- [X] T007 Tests: `test/prepare-dm.test.js` (LID + phone forms, second number, learned LID, off chat stores nothing,
      private hidden, not-on-WhatsApp warning, invalid numbers, intro confirm, owner assistant one go),
      `test/admin-mcp.test.js`
- [X] T008 Docs: agents, owner-assistant, admin-mcp, privacy, getting-started, README, website tick; screenshots
      `chats-*`, video `chat-on`
- [X] T009 Version 2.13.0 (package.json, package-lock.json, infra/oci/schema.yaml) + releases.json entry
- [X] T010 `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs`
- [ ] T011 PR via REST (`Closes #92`), squash-merge after checks (left to the maintainer)

## Follow-ups

- Not verified against real WhatsApp: `onWhatsApp` / `getLIDForPN` results, replies to a LID-delivered message sent to
  the phone JID (Baileys 7 maps PN↔LID), first messages whose phone WhatsApp hides and whose LID was not shared
  when the number was checked (they cannot be matched and stay a separate, off chat).
- Removing a prepared chat: switch it off / unassign on Chats (no separate delete).
