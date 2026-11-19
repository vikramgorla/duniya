# 085 · Tasks

- [x] T1 Issue #197 (labels, spec: 085), audit screenshots, plan comment, branch
- [x] T2 Formatting: panel `money` / `day` / `phone`, server `money` in config.js; module rows as day parts
- [x] T3 Events: list line, header, attendance, quiet ⋯, Messages; Orders: Overdue, reminder link, ⋯; order page
- [x] T4 Sending: list, New message, a message's page, campaign page and form
- [x] T5 Surveys: counts, results, people rows, Messages
- [x] T6 Settings: Sending pace, Modules, Updates; Channels → Telegram
- [x] T7 Demo seed; responsive states (sending-run-live, events-past, orders-overdue)
- [x] T8 Tests: module rows with day parts and Overdue; runs carry their survey; one money format in the admin MCP
- [x] T9 Docs (events, orders, sending, surveys), DESIGN.md, website screenshots
- [x] T10 Version 2.47.0, releases.json; all checks; PR; merge; done comment

## Definition of Done
- [x] Small servers: no timers or polling; one extra request (`/api/sending`) on an event's or survey's page, only
      with Lists and sending on
- [x] Lean code: one money helper on the server (two copies removed), one state pill for messages and campaigns
- [x] Security: every text from people is a text node; no new routes
- [x] Docs, DESIGN.md, screenshots
