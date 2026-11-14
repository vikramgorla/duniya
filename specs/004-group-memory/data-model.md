# Data Model: Group Memory and Context Awareness

## messages (extended)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | insertion order |
| channel, chat, bot | TEXT | `bot` = routed bot or "" |
| msg_id | TEXT | WhatsApp message id; UNIQUE(chat, msg_id) when not null |
| sender, name | TEXT | phone digits / display name |
| text | TEXT | message text or caption |
| quoted | TEXT | text of the replied-to message (≤ 500) |
| addressed | INTEGER | 1 if it addressed a bot |
| from_bot | INTEGER | 1 for bot replies |
| ts | INTEGER | message time (epoch ms) |

Retention: rows older than 90 days deleted; per chat keep newest 5,000.

## chat_memory

| Column | Type | Notes |
|---|---|---|
| chat | TEXT PK | |
| summary | TEXT | ≤ ~500 words |
| upto_id | INTEGER | last `messages.id` folded into the summary |
| updated_at | INTEGER | epoch ms |

## notes

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| chat | TEXT | scope |
| bot | TEXT | bot that saved it |
| text | TEXT | ≤ 500 chars |
| author, role | TEXT | who asked; organizer/participant/panel |
| ts | INTEGER | |

Cap: 200 per chat (oldest dropped); newest 40 included in context.

## State: summary lifecycle

`none` → (unsummarised > 70) → `summarising` (lock) → `current(upto_id)`; on failure → back to previous state;
`erase` → none.
