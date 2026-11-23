# Feature Specification: Rich messages in the panel

**Feature Branch**: `feat/303-rich-messages` | **Created**: 2026-11-23 | **Status**: Implemented (2.61.0) | **Issue**: #303

**Input**: "Show rich content like gif,.. in chat preview, history,.. on panel" (owner).

## User Scenarios & Testing

### User Story 1 — See the photos, stickers, GIFs and voice notes of a chat (Priority: P1)

The owner opens a chat's **Messages** and sees the photo Marc sent, the sticker Sophie answered with and the GIF the
agent shared, instead of `[image]`, `[sticker]` and `[gif: happy]`. Voice notes and videos have a player.

**Independent test**: a photo arrives in a chat that is on; Messages shows it; the file comes from the chat app.

**Acceptance scenarios**
1. **Given** a chat that is on, **when** someone sends a photo, sticker, GIF, video or voice note, **then** the stored
   message keeps what it is (kind, content type, size, length, file name) and the chat app's reference to it, never the
   file.
2. **Given** such a message, **when** the owner opens Messages, **then** it shows in place of its placeholder line; a
   person's caption stays as words; a document shows its name only.
3. **Given** the chat app no longer has the file, **then** the message says "no longer available" and the server does
   not ask the app for it again for a while.

### User Story 2 — See what the agents sent (Priority: P1)

A GIF an agent shared (with or without its answer), a picture it created and its voice answers show the same way in
Messages, in the agent's **Review** and when an Activity entry is opened.

### User Story 3 — The same for a message in Activity (Priority: P2)

Opening the Activity entry of a message with media (an incoming photo addressed to an agent, a shared GIF, a created
picture, a voice answer) shows the media.

### Edge cases

- Chats that are off store nothing (no message, no media).
- Files larger than the server shows (by server size), and content types a browser could run (HTML, SVG), are never
  served; the message shows its kind instead.
- Many pictures at once (a long scroll): a few are fetched at a time; the rest wait or are asked again by the browser.
- Memory tight: nothing is fetched; what is kept in memory is dropped.
- The chat app is not connected: the request fails for now and is tried again on the next view (not remembered).
- A video player asks for parts of the file (Range requests).
- History loaded from the phone (#91) keeps its media like live messages; own messages too (agents never open them).

## Requirements

- **FR-001**: A stored message MUST be able to keep its media's kind (image, sticker, gif, video, audio, document),
  content type, size, length, file name and the channel's reference to it; never the file. The reference keeps only
  what a download needs (no previews or quoted context).
- **FR-002**: Every channel MUST describe the media of inbound messages and of what `sendMedia` sent (`mediaInfo`,
  `mediaRef`), including GIFs and videos; nothing in the core may depend on a channel's name.
- **FR-003**: Every place that stores a message with media MUST store its media: inbound (groups and direct chats),
  history from the phone, a shared GIF or sticker, `send_media`, a created picture (now stored), a voice answer.
- **FR-004**: The panel API MUST describe a message's media without the reference (`media: { type, mimetype, size,
  seconds?, fileName?, shown }`) in a chat's messages and in Review, and in the Activity detail of messages with media
  (`msg`, `media`).
- **FR-005**: `GET /api/chats/:chat/messages/:id/media` (admins and owners) MUST return the file from the chat app:
  only allow-listed content types, `nosniff`, a sandboxing CSP, private caching for a day, byte ranges; at most
  `AT_ONCE` fetches at a time with a deadline; a size cap by server size; failures in plain words (404, 410, 503, 504).
- **FR-006**: The panel MUST show photos and stickers as pictures (lazy), GIFs as muted looping videos that load and
  play near the screen, videos and voice notes with players (nothing loaded until played), in Messages, Review and
  opened Activity entries.
- **FR-007**: Nothing of a file is written to the server's disk; a few recently shown files stay in memory (bounded by
  server size, dropped when memory is tight).

## Success Criteria

- **SC-001**: A photo sent in a chat that is on shows in Messages without any setting.
- **SC-002**: No reference or file content reaches logs, Activity or the panel's JSON.
- **SC-003**: Opening Messages fetches nothing until a picture is near the screen; a second view of the same picture
  does not ask the chat app again while it is kept.

## Assumptions

- WhatsApp keeps media for a limited time; older media shows "no longer available" (no re-download from the phone is
  promised).
- Telegram's `getFile` serves up to 20 MB, more than the panel shows.
