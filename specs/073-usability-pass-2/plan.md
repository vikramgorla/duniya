# 073 · Plan

- **Server:** new `chat-names.js` (no import of `direct-chats.js`, so `budget.js` can use it without a cycle). The
  registry remembers subjects from `chatName()` and `listChats()`. Routes add `chatName` with `withChatNames()`; the
  SSE frame adds it with the stored-only `chatLabel()`. `personChats()` in `routes/contacts.js`: direct chats from
  prepared chats and `chats_seen`, groups from `messages` (≤ 50, chats that were on).
- **Panel:** `quiet.js` (grouped card, `quietReason()`), `updates.js` (row; the page is drawn by `settings.js` from
  the parts it gets), `core.js` + `styles.css` (`.kbd` focus rings), `usage.js` (Breakdown rows, Set price dialog),
  `server.js` (summary lines, lazy Logs), `contacts.js` (rows → person page), `find.js` (contacts), `chats.js`
  (*Contact page ›*, `quietReason`), `overview.js` (agent links, Review).
- **Small servers:** no timers. One extra query per person page; WhatsApp is asked for a group name at most once per
  10 minutes per unknown group.
- **Privacy:** names only; the person page is admin-only and shows chats, not messages.
- **Budgets:** first screen +0.8 KB, total +3.2 KB (reasons in `scripts/check-panel.mjs`).
