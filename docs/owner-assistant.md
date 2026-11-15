# Owner assistant, alerts and weekly summary

## Owner assistant and the Ask box

- **Owner assistant** (044, #50): a built-in assistant (not an agent) for panel users. **Settings → Owner assistant →
  Link my WhatsApp** shows a one-time message (`link CODE`, valid 10 minutes); send it from your phone to any agent
  number, then confirm "Linked +41…" in the panel. From then on your direct messages to an agent number go to the owner
  assistant ("what did the families decide this week?", "why is the carpool group quiet?", "turn off the helper agent"),
  unless they start with an agent's trigger (`!family …` still reaches that agent; so does `confirm CODE` for a change
  an agent prepared). It never answers in groups or anyone who is not linked. Tools: the admin MCP tools with your
  panel role (viewers read-only and without message contents; tools that take keys or passwords stay in the panel) plus
  `list_visible_chats`, `search_messages` (who said what) and `chat_recap`. Every change needs `confirm CODE` in
  WhatsApp (or **Confirm** in the panel). It sees only chats that are on; chats marked **Private to members** (Chats)
  are invisible to it and the **Ask** box on Overview (same assistant, also in the mobile app). Its conversation is
  stored separately, never in chat memory. Every question and action is in Activity (`owner.*`, always recorded). Model:
  the default model with fallback, or one chosen in the same card. Admin MCP tools: `get_owner_assistant`,
  `set_chat_private`.

![Owner assistant settings](site/img/card-owner-assistant.webp)

![Ask box on Overview](site/img/card-ask.webp)

## Owner alerts and weekly summary

- **Owner alerts and weekly summary** (041, #38): under **Settings → Owner alerts on WhatsApp** the owner enters their
  number. Cap alerts go there, and a weekly summary (on by default once a number is set; day and time configurable):
  messages handled, replies and cost per agent this week vs last, ignored chats, pending confirmations, update available,
  backup failures — counts only, never message contents. **Send now** sends it at once. Admin MCP tools:
  `get_owner_alerts`, `set_owner_alerts`, `preview_weekly_summary`, `send_weekly_summary`.
- **Breaking releases** (045, #57): when a release needs your decision, the alert number gets the release notes, and
  every owner linked to the owner assistant also gets a code: `confirm ABCD` makes a backup, updates and restarts, and
  the assistant reports the result after the restart; `cancel ABCD` reminds you in 7 days. Only owners can confirm.
  See [Backups and updates](backups-and-updates.md#updates).

---
[Docs index](README.md)
