# Privacy: silent by default, privacy notice, logging

**Nothing is stored or sent to a model until you switch a chat on, and groups are told once.**

**Do it:** panel → **Chats** → switch only the chats you want **on** (choosing an agent for a chat that is off
switches it on too, as does **Switch on** in Getting started).

**In 30 seconds**
- Off chats are dropped before storage and before any model call (only the id and time of the newest message are
  kept, so recent messages can be loaded from your phone when you switch the chat on).
- Switching a group on posts a one-time notice (your text; per-group opt-out).
- Every look at stored messages is logged; contents are logged only where your policy allows.

<p align="center"><img src="diagrams/message-privacy.svg" alt="Message privacy: messages from chats that are off are dropped, not stored and never sent to a model; messages from chats that are on are stored for memory within retention limits and the agent may answer; chats private to members are hidden from the owner assistant and Ask" width="607"></p>

<details><summary>Diagram as text</summary>

1. A message arrives.
2. Chat off: dropped, not stored, no model call.
3. Chat on: stored for memory (within the retention limits) and the agent may answer.
4. Chat private to members: hidden from the owner assistant and Ask.

</details>

## Privacy notice

When a group is switched on, the number posts once "Messages in this group are stored so the assistant has
context…" (edit under **Settings → Privacy notice**).

- Posted again after the group was off only if the text changed or after 90 days.
- Switching on also loads the group's recent messages from your phone, so "stored" covers those earlier messages too.
- Per-group opt-out on **Chats** (recorded).
- Direct messages get a line in the agent's first reply, once per person (can be switched off). An intro the agent
  sends to a [prepared direct chat](chats.md#set-up-a-direct-chat-before-the-person-writes) carries it too.
- A [welcome message](agents.md#quick-replies-welcome--faq) for new members comes after the notice when the notice is
  still due.
- Admin MCP: `get_privacy_notice`, `set_privacy_notice`, `set_chat_privacy_notice`.

![Privacy notice settings](site/img/card-privacy.webp)

## What is kept, and who sees it

| | |
|---|---|
| **Stored messages** | only chats that are on, for memory, with retention limits (90 days and 5 000 per chat by default, pruned every hour; **Server → Health**). Switching a chat on loads its recent messages from your phone ([Agents → Earlier messages](chats.md#earlier-messages-when-a-chat-is-switched-on)). Admins and owners can read them; every look is in the activity log. Erase a chat's memory with one click |
| **Search messages** | the owner only, over chats that are on and not *Private to members*; each search is in the activity log with its words and the number found, never message text ([Agents → Chats](chats.md#search-messages-owner)) |
| **Answer ratings** | 👍 / 👎 on an agent's answers (*Review*): who rated and when, no copy of the text; gone with the answer. Answers in private chats are not shown ([Review and teach](agents.md#review-and-teach)) |
| **People** | a person is stored only when they write in a chat that is on, or when you add them: their app ids and phone, the name their app showed, and what you add (name, nickname, birthday, ties, households, notes, tags, lists). Agent notes never copy message text unless the activity log is *verbose*. Export or erase anyone on their page; erase removes their stored messages too ([People](people.md#merge-export-erase)) |
| **Names and member tags** | phone contact, business and profile names from your linked phone (they name people but never add anyone to People; agents use the same name you see, phone contact names included, unless you switch that off on the People screen); group member tags only for chats that are on, erased with the chat's memory ([Agents → Contacts](chats.md#which-name-is-shown)) |
| **Telegram phone numbers** | a person's phone is stored with their Telegram id only when they share their own contact with the bot (*Share my number*); it joins them to the same person as on WhatsApp ([Telegram](telegram.md#share-my-number-one-person-on-both-apps)). A contact someone else forwards is never used |
| **Chats that are off** | the id, time and sender id of the newest message only (no text, no names), to ask the phone for history later |
| **Activity log** | minimal, normal or verbose, by category and per chat, with retention. Errors, confirmations, configuration changes and channel status are always recorded |
| **Summaries** | the weekly summary and *Why agents stayed quiet* keep counts only |
| **Welcomes** | a hash of the group and the new member's id, so each person is welcomed once (no names or numbers); the activity log says how many were welcomed |
| **Personal details** | agents don't post phone numbers, emails, health or payment details in groups |
| **Keys and passwords** | never through a chat or a model: entered on one-time panel links; a key pasted to the owner assistant is not read, stored or logged ([Owner assistant](owner-assistant.md#what-it-may-do-decided-in-code)) |

![Logging settings](site/img/card-logging.webp)

> [!WARNING]
> Use a **dedicated WhatsApp number** and tell your groups that the assistant keeps context.

---
**Next:** [Owner assistant](owner-assistant.md) · [Agents](agents.md) · [Docs index](README.md)
