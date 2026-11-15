# Privacy: silent by default, privacy notice, logging

- **Chats** are off by default (#10). Messages from chats that are off are dropped before storage and before any
  model call.

- **Privacy notice** (044, on by default): when a group is switched on, the number posts once "Messages in this group
  are stored so the assistant has context…" (text editable under **Settings → Privacy notice**). It is posted again
  after the group was off only if the text changed or after 90 days; per-group opt-out on Chats (recorded). Direct
  messages get a line in the agent's first reply, once per person (can be switched off). Admin MCP tools:
  `get_privacy_notice`, `set_privacy_notice`, `set_chat_privacy_notice`.

- **Private to members** (Chats): such a chat is invisible to the [owner assistant](owner-assistant.md) and the Ask box.
- **Stored messages**: only chats that are on are stored, for memory, with retention limits. Admins and owners can read
  what was stored for a chat; every look is written to the activity log. Erase a chat's memory with one click.
- **Activity log**: minimal, normal or verbose, by category and per chat, with retention. Errors, confirmations,
  configuration changes and channel status are always recorded. Message contents are only logged where the logging
  policy allows it; the weekly summary and *Why agents stayed quiet* keep counts only.
- **Personal details**: agents do not post phone numbers, emails, health or payment details in groups.
- Use a **dedicated WhatsApp number** and tell your groups that the assistant keeps context.

![Privacy notice settings](site/img/card-privacy.webp)

---
[Docs index](README.md)
