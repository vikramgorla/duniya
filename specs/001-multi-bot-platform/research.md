# Research: Multi-Bot WhatsApp Agent Platform

## WhatsApp connectivity without commercial connectors

- **Decision**: Baileys 7 (WhatsApp Web multi-device protocol over WebSocket), linked by QR or pairing code.
- **Rationale**: no browser needed (fits 1 GB RAM), active project, supports groups, LID↔phone mapping,
  pairing codes for headless servers.
- **Alternatives**: whatsapp-web.js (needs headless Chromium, too heavy for 1 GB); Meta Cloud API / BSPs
  (commercial, rejected by owner); Evolution API/WAHA (extra service wrapping Baileys; unnecessary layer).

## LID addressing (WhatsApp 2025+)

- **Decision**: resolve sender phone from `key.participantAlt` / `remoteJidAlt` when they are PN JIDs, else
  `signalRepository.lidMapping.getPNForLID`. Mention detection compares against both `user.id` and `user.lid`.
- **Rationale**: groups increasingly address members by LID; roles are configured by phone number.

## Calling tools: API-side MCP connector vs local MCP client

- **Decision**: local MCP client (`@modelcontextprotocol/sdk`, Streamable HTTP) and plain Messages API tool use.
- **Rationale**: we must filter tools per role, intercept preview results to hide `confirm_id`, refuse
  disallowed calls and log every call — all require running the calls ourselves.
- **Alternatives**: Messages API MCP connector (less control over results; confirm id would reach the model).

## Confirm gate

- **Decision**: any tool matching `bot.confirm.preview` glob whose result contains `idField` creates a pending row
  with a 4-char code (no ambiguous characters); the id is replaced in the tool result; `confirm CODE` from an
  organizer in the same chat calls `bot.confirm.tool` with the organizer credential. TTL default 9 min
  (panduga.ch ids live 10 min).
- **Alternatives**: let the model call confirm after a "yes" (unsafe; manipulable); per-message reactions
  (harder to parse, ambiguous).

## Storage

- **Decision**: `node:sqlite` (Node ≥ 22.13, no flag) + JSON files for small config.
- **Rationale**: no native compilation on the VM; WAL mode is plenty for this load.
- **Alternatives**: better-sqlite3 (native build), Postgres (extra service, RAM).

## Bot extensibility

- **Decision**: declarative `bot.json` + `prompt.md` + optional `index.js` exporting `tools`, `onMessage`,
  `role`, `init`. Live operator-editable fields are stored as overrides in `DATA_DIR/bots/<id>.json`.
- **Rationale**: most bots need only config; code hooks cover commands and custom tools; deploys never clobber
  live settings.

## Models

- **Decision**: default `claude-sonnet-5-5` for bots with write tools, `claude-haiku-5-5` suggested for simple
  bots; model is a live setting per bot.
