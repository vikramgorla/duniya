# Quickstart: Multi-Bot WhatsApp Agent Platform

## Automated validation

```bash
npm ci
npm test
```

Expected: all `platform.test.js` scenarios pass — bot loading, silence when not addressed, participant
read-only tools, refused write tool, confirm gate (participant refused, organizer applies exactly once),
look-alike commands ignored, hook bot (local tool + `!ping`), DM routing, pause.

## Manual validation (real WhatsApp, dedicated number)

1. `ADMIN_PASSWORD=dev-password-123 npm start`, open http://127.0.0.1:8080, scan the QR.
2. Panel → Secrets: `ANTHROPIC_API_KEY`, `PANDUGA_MCP_URL`, `PANDUGA_TOKEN_ORGANIZER`.
3. Panel → Bots → Panduga: add your number as organizer. Add the bot number to a test group; Chats → bind it.
4. In the group:
   - `hello everyone` → no reply.
   - `!panduga what's on the agenda tomorrow?` → answer from panduga.ch.
   - As organizer: `!panduga move the Rao family to room 4` → preview + code; `confirm CODE` → applied once.
   - From another member: `confirm CODE` for a new preview → refused.
5. DM the bot from a group member → reply; from an unrelated number → silence.
