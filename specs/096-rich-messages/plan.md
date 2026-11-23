# Implementation Plan: Rich messages in the panel

**Branch**: `feat/303-rich-messages` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

## Summary

`messages` gains a `media` column (JSON from `storedMedia()`); channels describe inbound and sent media
(`mediaInfo`, `mediaRef`); a new route streams the file from the channel on demand through `mediaFile()`
(`src/core/message-media.js`); the panel renders it with `messageMedia()` (`src/panel/public/app/media.js`).

## Technical context

Node 22, `node:sqlite`, Baileys, Telegram Bot API over `fetch`, native ES-module panel. No new dependency.

## Design decisions

| Decision | Why | Rejected |
|---|---|---|
| Store the reference, not the file | No disk use, nothing to prune, erase and retention work as for messages | Saving files (disk on a 1 GB VM, another retention) |
| Fetch from the channel at view time | The channel already downloads by reference (Photos & voice, 043) | Proxying public GIF URLs (only covers what agents send, external requests) |
| One column on `messages` | Moves, erases, retention and deletes follow the row by themselves | A side table (joins, its own clean-up) |
| One-time `ALTER TABLE` guarded by `PRAGMA table_info` | Existing installs get the column; removed in the next release (AGENTS.md) | Asking owners to reinstall |
| Own small limiter + `within()`, not `runJob` | Panel views must not wait behind (or delay) agent photo and voice jobs | `runJob` (1 slot on small servers) |
| Small in-memory cache of recently shown files | Video players fetch in parts; repeated views | Disk cache |
| Allow-list of content types, sandbox CSP, nosniff | The bytes come from chat members | Serving the declared type as is |

## Touch-points

- `src/core/db.js`: column, guarded migration, `logMessage` / `insertEarlierMessages` (`messageValues`), `listMessages`.
- `src/core/message-media.js` (new): `storedMedia`, `mediaView`, `mediaDetail`, `mediaFile`.
- `src/channels/whatsapp/session.js`: video / GIF in `mediaInfoOf`, slim `mediaRefOf`, `sentMedia`, own messages keep media.
- `src/channels/telegram/inbound.js`, `index.js`: animation and video in `mediaOf`; `sendMedia` returns media.
- `src/core/router.js`, `sharing.js`, `chat-tools.js`, `media-ai.js`: store media; Activity detail.
- `src/core/review.js`, `src/panel/routes/chats.js` (route), `src/panel/http.js` (`sendBytes`).
- Panel: `media.js` (new), `chats.js`, `agent-editor.js` (Review), `answers.js` (Activity), `styles.css`.
- Admin MCP: `list_chat_messages` description; `docs/admin-mcp.md`.

## Definition of Done plan

| Item | Plan |
|---|---|
| Tests | `test/rich-messages.test.js` (storage, view, route headers, ranges, roles, failures, off chats, agent sends, Activity); `whatsapp-features.test.js` (slim reference, GIF); `telegram.test.js` (sent animation) |
| Docs | `docs/chats.md` (Messages, *Pictures in messages*), `docs/privacy.md`, `docs/admin-mcp.md`, `README.md`, `DESIGN.md` |
| Website | Messages paragraph and alt text; `card-messages` retaken (demo photo and sticker) |
| Admin MCP | `list_chat_messages` returns `media` (through the API) |
| Small servers | 4 MB cap, 2 at a time, 30 s deadline, 6 MB kept in memory, nothing on disk, paused under memory pressure |
| Version | 2.61.0 (feature) |
