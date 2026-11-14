# Contract: Panel HTTP API

All endpoints except `GET /`, `GET /healthz`, `GET /api/session` and `POST /api/login` require the
`duniya_session` cookie (401 otherwise). Non-GET requests must send `Content-Type: application/json`
(415 otherwise). Errors: `{ "error": "message" }` with 4xx.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/session` | | `{ authed, passwordConfigured }` |
| POST | `/api/login` | `{ password }` | `{ ok }` + cookie; 401 wrong; 429 rate-limited |
| POST | `/api/logout` | | `{ ok }` |
| POST | `/api/password` | `{ current, next }` (next ≥ 12 chars) | `{ ok }`; all sessions end |
| GET | `/api/status` | | `{ channel, settings, version, uptimeSec, memoryMb, node, bots[], pending }` |
| POST | `/api/settings` | `{ paused?, defaultDmBot? }` | settings |
| GET | `/api/activity?limit&bot&before` | | `Activity[]` newest first |
| GET | `/api/events` | | SSE stream of `Activity` |
| GET | `/api/bots` | | `BotView[]` (no secrets, no hooks) |
| GET | `/api/bots/:id` | | `BotView` |
| PUT | `/api/bots/:id` | editable fields only | `BotView`; 400 on invalid/non-editable field |
| POST | `/api/bots/reload` | | `BotView[]` |
| POST | `/api/bots/:id/test` | `{ text, role }` | `{ reply, usage }` (never posts to WhatsApp) |
| POST | `/api/bots/:id/schedules/:sid/run` | | `[{ chat, reply }]` |
| GET | `/api/chats` | | `[{ id, name, size, bot }]` |
| POST | `/api/chats/bind` | `{ chat, bot \| null }` | `{ ok }` |
| GET | `/api/chats/:chat/memory` | | `{ summary, summarizedUpTo, updatedAt, notes[], messageCount }` (feature 004) |
| POST | `/api/chats/:chat/memory/summarize` | | `{ summary }` (feature 004) |
| DELETE | `/api/chats/:chat/memory` | | `{ ok }` erase all (feature 004) |
| DELETE | `/api/notes/:id` | | `{ ok }` (feature 004) |
| GET | `/api/pending` | | `Pending[]` (no confirm ids) |
| POST | `/api/pending/:code/apply` | | `{ result }`; 404 expired |
| DELETE | `/api/pending/:code` | | `{ ok }` |
| GET | `/api/secrets` | | `[{ name, set, usedByBots }]` |
| PUT | `/api/secrets` | `{ name, value }` (empty value deletes) | `{ ok }` |
| POST | `/api/whatsapp/pair` | `{ phone }` | `{ code }` |
| POST | `/api/whatsapp/logout` | | `{ ok }` |
| POST | `/api/whatsapp/restart` | | `{ ok }` |
| POST | `/api/updates/apply` | | `{ code, log }` then restarts (owner; see feature 008) |
| POST | `/api/system/restart` | | `{ ok }` then restarts |
