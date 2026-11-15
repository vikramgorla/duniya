# Data model (SQLite, `src/core/db.js`)

- `messages.sender_jid TEXT` (new column): the sender's WhatsApp jid. It builds message keys for reacting to and
  deleting others' messages in groups.
- `wa_reactions(chat, msg_id, sender, name, emoji, ts)`, PK `(chat, msg_id, sender)`.
  - One reaction per person per message. An empty emoji deletes the row.
  - At most about 500 per chat.
- `wa_polls(chat, msg_id, name, options JSON, selectable, creator, message, votes JSON, ts)`, PK `(chat, msg_id)`.
  - `message`: the creation message reduced to the poll and `messageContextInfo.messageSecret`, serialised with
    `BufferJSON`.
  - `votes`: `{ voterKey: { name, options: [names], ts } }`. The latest vote replaces the earlier one; an empty
    selection removes the voter.
  - `selectable`: 1 = single choice, 0 = multiple.
- Erasing a chat's memory also erases its reactions and polls.
- **Chat ids** follow the registry: a plain jid on the main number, `<number>#<jid>` on other numbers.
