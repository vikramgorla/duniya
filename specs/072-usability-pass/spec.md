# 072 · Usability pass: one object, one look

Issue #153 · version 2.32.0

## Why

The owner went through every job in the panel and found places where finding things takes too long or leads nowhere:
- *Messages & memory* hid behind ⋯ after the chat name, then opened at the bottom of the page under Memory and the
  WhatsApp group card.
- An agent's answer showed in the chat's history as a generic "Agent" bubble, and you could only rate it in Review.

## User stories

1. **As the owner, I see what was said in a chat in three taps** (Chats → chat → Messages), with each answer in its
   agent's colour and avatar.
2. **I rate an answer where I notice it**: in the chat's Messages, the agent's Review or Activity. It is one row (👍 /
   👎, and Teach… on a 👎), and a rating shows the same everywhere.
3. **I get from any place to the related one in a tap**: a Review answer opens in its chat; an Activity entry links to
   its chat, agent and message; a chat shows its own Activity; an agent's Memory links to each chat's memory; Pending
   and Usage link to the chat and agent.
4. **Names, never ids**: Pending shows agent names and plain tool words; Activity and Usage show models by name.

## Requirements

- R1 A chat's page has section rows **Messages** (admins), **Memory**, **WhatsApp group** (groups, admins) and
  **Activity**. Each section is a page `#chats/<id>/<section>` with a back link. ⋯ keeps only *Send intro…*.
- R2 `GET /api/chats/:chat/messages` returns `agent`, `rating` and `rateable` (false in chats that are private to
  members) for answers, and takes `around=<id>` (the message and up to half a page on each side). It stays admin-only.
- R3 One component, `answerActions()`, used in Review, Messages and Activity. It uses the existing
  `PUT /api/agents/:id/review/:msg`, and repaints every copy on screen.
- R4 Replies in Activity carry `detail.msg` (the stored answer). `GET /api/activity` adds `rating` to them, and
  `chat=` filters the list (`#activity/chat=<id>` in the panel).
- R5 Messages opened at one answer (`#chats/<id>/messages/<msg>`) mark it and scroll only the list.
- R6 Find anything lists *Messages · <chat>* and *Memory · <chat>*. Search results open the chat's Messages.
- R7 Server summaries use `modelName()` and plain plurals. The admin MCP `list_chat_messages` gets `around_id`.

## Out of scope

- A link from a contact to their direct chat. Contacts rarely map one-to-one to a chat.
- Making Usage shorter on phones. That is a separate density pass.
