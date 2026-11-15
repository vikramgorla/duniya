# Feature Specification: Photos & Voice, with Small-Server Guardrails

**Feature Branch**: `feat/48-media-ai` (issue #48)

**Created**: 2026-11-15

**Status**: Implemented (v2.7.0)

**Input**: Owner (#48): "Do we support advanced functionalities like create image when model or providers support, and
voice? ChatGPT for example can do image and voice. It is ok if data leaves to the provider." Follow-ups: small servers
(1 GB / 1 vCPU) must never crash; people should not have to resend when the server is busy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The agent looks at a photo (Priority: P1)

Someone sends a photo with "!panduga what is this?" (or replies to the agent with a photo, or sends it in a direct
message). The agent answers about the photo.

**Acceptance Scenarios**:

1. **Given** a chat that is on and an agent whose model sees images, **Then** the photo reaches the model as an image
   and the history keeps only `[image: caption]` — no photo bytes in the database.
2. **Given** a model that cannot see images, **Then** the vision fallback model (Settings) is used, or the agent says
   kindly that it can't look at photos and answers the text.
3. **Given** a photo turn whose model fails and fallback moves on (042), **Then** models that cannot see images
   (e.g. GitHub Copilot) are skipped and the vision fallback model is tried after the chain; when none can answer,
   the turn is asked again without the photo and the agent says kindly it can't look at it (#67).
4. PDFs are read the same way; stickers only when the agent allows them.
5. Photos in chats that are off, or not addressed to the agent, are never downloaded.
5. Media larger than the limit is refused by WhatsApp's declared size before any download.

### User Story 2 - The agent listens to a voice note (Priority: P1)

A voice note is transcribed and handled as typed text; history and Activity show "🎤 transcript".

1. Order: OpenAI API (`gpt-4o-mini-transcribe`, else `gpt-4o-transcribe` / `whisper-1`) → OpenRouter (paid,
   `openai/gpt-4o-mini-transcribe`) → on-server engine (when the owner switched it on). ChatGPT sign-in is not used
   (OpenAI documents the transcription API as unsupported for plan usage).
2. Nothing can listen → "Sorry, I can't listen to voice notes here yet. Please type your message." (no model call).
3. Voice notes longer than the limit (5 min default) get a polite "please send a shorter one".

### User Story 3 - The agent creates a picture (Priority: P2)

"Make a poster for Diwali" → the agent calls `media__create_image` and the picture arrives as a WhatsApp image with a
caption. "Make it a cartoon" after a photo edits that photo (`edit_of: "last_photo"`, within 15 minutes).

1. The tool exists only when a connected provider can create images (OpenAI with a `gpt-image-*` model listed for the
   key; OpenRouter image models, not in free-only mode). Organizers by default; participants when the agent allows it.
2. Pictures are counted in Usage (`image`) and spending caps: provider-reported cost (OpenRouter), the owner's price
   per picture, or token prices. A reached cap refuses the tool.
3. The test console never creates pictures.

### User Story 4 - The agent answers with voice (Priority: P2)

Per agent: **Reply with voice**: Never / To voice notes / Always. The answer is a WhatsApp voice note (Ogg/Opus);
the text is kept in the history. Replies with a confirm code or a link stay text; if speaking fails the text is sent.

### User Story 5 - The owner sees and controls it (Priority: P1)

- **Models → Photos & voice**: per provider Sees images / Hears voice / Creates images / Speaks, with how to enable
  what is missing.
- Agent page **Photos & voice**: the switches above.
- **Settings → Photos & voice**: vision fallback model, picture model and price, voice, longest voice note, and
  **On-server speech** (download, progress that survives a reload, use, remove; RAM warning).
- Admin MCP tools for all of it.

### User Story 6 - Small servers never fall over; nobody has to resend (Priority: P1)

1. The server's size (RAM incl. container limit, free memory, CPUs → small / medium / large) is shown on **Server** and
   in `/api/status`.
2. Photo / voice-note turns, picture creation and voice replies run in a queue kept in SQLite: 1 worker on small
   servers (2 medium, 3 large), in order per chat; a restart picks the jobs up again.
3. A job not started after ~10 s → ⏳ reaction on the message (taken back when done); after ~60 s one "I'm on it".
4. Jobs older than 15 min → a short apology instead of a stale answer (quiet reason "waited too long").
5. Only a full queue (20 on small servers) → one "I'm overloaded right now — please send that again in a few minutes"
   (quiet reason "server busy"). Text messages never wait in the queue.
6. On-server engines cannot be enabled below 2 GB of RAM; each job needs ~400 MB free, otherwise the provider is used or
   the agent asks for text. Copilot's helper is refused below 2 GB. At most 2 local tool services run at once on small
   servers.
7. Above 70 % of RAM used by the app, optional work pauses (summaries, on-server speech, picture creation) with one
   Activity entry, and resumes later.

### Edge Cases

- Fallback to another provider during a turn with a photo: the fallback model gets the same blocks; Copilot ignores
  images (text only).
- A queued picture edit after a restart: the temp photo is gone → "please send it again".
- A chat switched off while its job waits → the job is dropped quietly.

## Requirements *(mandatory)*

- **FR-001** Media handling only for chats that are on and messages addressed to the agent (#10, roles, rate limit).
- **FR-002** Internal format stays Anthropic-style blocks; adapters convert (`image_url` / `file` parts; Responses
  `input_image` / `input_file`).
- **FR-003** Photo bytes never stored in the database; temp files removed (15 min max).
- **FR-004** Every media provider call recorded in usage with kind `transcribe`, `image`, `speech`.
- **FR-005** Provider core changes additive only (adapter methods). Fallback gets two optional call options for photo
  turns (#67): `accept` (skip candidates that cannot see images) and `lastResort` (the vision fallback model).
- **FR-006** Logging policy applies (`media` category), errors always recorded.

## Success Criteria

- Tests with fakes cover every path above (`test/media-ai.test.js`).
- Changed screens pass `npm run check:responsive` at 375 and 1440 px, light and dark.
