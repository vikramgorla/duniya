# Data Model: Multi-Bot WhatsApp Agent Platform

## Bot (repo `bots/<id>/bot.json` + live overrides `DATA_DIR/bots/<id>.json`)

| Field | Type | Default | Editable live | Rules |
|---|---|---|---|---|
| id | string | folder name | no | folders starting `_`/`.` ignored |
| name, description | string | id, "" | no | |
| enabled | bool | true | yes | |
| model | string | claude-sonnet-5-5 | yes | ≤ 8000 chars |
| maxTokens, historySize | int | 1024, 30 | yes | 1–8192 |
| triggers | string[] | [] | yes | lower-cased, trimmed |
| respondToMentions | bool | true | yes | |
| dm | enum | members | yes | none/organizers/members/anyone |
| organizers, participants | phone[] | [] | yes | digits only, ≥ 6 digits, unique |
| chats | chat id[] | [] | yes (via binding) | a chat belongs to at most one bot |
| extraPrompt | string | "" | yes | |
| schedules | Schedule[] | [] | yes | see below |
| mcpServers | map name → {url, tokens{organizer,participant}, token} | {} | no | values may use `${SECRET}` |
| tools | {participant[], organizer[], deny[]} | empty | no | globs `server:tool`, `local:name` |
| confirm | {preview, tool, idField, ttlMinutes} \| null | null | no | |
| memory | {enabled} | {enabled: true} | no | see feature 004 |

Role resolution: `hooks.role(msg)` if it returns a role, else `organizer` when phone ∈ organizers, else `participant`.

## Schedule

`{ id, at: "HH:MM", days: "daily" | "mon,tue,…", chats: "all" | chatId[], prompt, enabled }`;
runs at most once per (bot, schedule, chat, local date) — tracked in `kv`.

## Pending change (`pending` table)

`code` (PK, 4 chars) · `bot` · `server` · `confirm_tool` · `confirm_id` · `tool` · `chat` · `requester` ·
`summary` · `expires` (epoch ms). States: created → applied | cancelled | expired (row deleted in every case).

## Message (`messages` table)

See feature 004 for the full shape (memory). Minimal for routing: `chat`, `bot`, `sender`, `name`, `text`,
`from_bot`, `ts`.

## Activity (`activity` table)

`id` · `ts` · `type` · `bot` · `chat` · `summary` (≤ 500 chars) · `detail` (JSON, ≤ 4000 chars).
Types: `message.in`, `message.out`, `tool.call`, `tool.error`, `confirm.created|applied|cancelled`,
`channel.status`, `bot.updated`, `schedule.run`, `memory.*`, `system`, `error`. Retention: newest 5,000.

## Normalised inbound message (channel → router)

`{ channel, chat, isGroup, text, phone, senderJid, senderName, mentioned, replyToBot, quoted, msgId, ts, raw }`
