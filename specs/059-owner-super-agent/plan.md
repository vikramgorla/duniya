# Implementation Plan: 059 owner assistant as a super agent

**Issue**: #119 · **Spec**: [spec.md](spec.md) · **Version**: 2.20.0 (minor: feature)

## Approach

- **Record** (`agents.js`): `OWNER_AGENT_ID`, `isBuiltin()`, `ensureOwnerAgent()` on load (defaults: character line,
  1500 max tokens, 10 turns, weekly-summary schedule), `OWNER_FIXED` fields forced on every save, delete / bind
  refused. Other agents: `alerts.to` empty and no weekly-summary schedules. Schema: `alerts: { to }`, schedule
  `kind: prompt | weekly-summary`.
- **Turn** (`owner-assistant.js`): the record + per-turn overrides (`chats` = own chat + visible chats for
  organizers; deny group-admin WhatsApp tools, `contacts:*`, `memory:search_history`) → `tools.js toolsFor()` (one way
  for global services, WhatsApp, media, memory). Each agent tool gets `prepare` (chat name → id via `chatNames()`),
  `confirmIf` (other chat, or service confirm/destructive), `preview`, `run` (re-checks visibility, privacy line).
  Core tool `send_message`. `ask()` uses the record's model, fallback, max tokens, history, timezone, character;
  attachments via `planAttachments` / `visionCallOptions`; notes via `buildContext` on `owner:<userId>`.
- **Media**: job kind `owner` in the existing media queue (`packMsg` / `unpackMsg` / `quoteOf` moved there and shared
  with the router); `payload.owner` lets jobs for the own chat run while it is off; `prepareInbound`, `wantsVoice`,
  `speak` reused. `whatsapp-tools.js` does not store sends into the own chat.
- **Schedules**: `scheduler.runSchedule` hands built-in schedules to `runOwnerSchedule` (no timer of its own);
  `weeklyTick`, weekly settings and `/api/alerts*` removed; `weekly.js` keeps the text; preview at
  `GET /api/owner-assistant/weekly-preview`.
- **Routing**: router and status ignore the built-in; panel agent pickers hide it; CLI status lists chat agents.
- **Panel**: agent editor with `bi` switches; agents list "built in"; Settings → Owner assistant keeps linking + a
  button to the editor; Owner alerts card removed. Mobile: owner screen opens the agent screen; agent screen notes
  the built-in.

## Definition of Done

| Item | This change |
|------|-------------|
| Issue & labels | #119, type: feature, area: agents / whatsapp / tools-mcp / panel, priority: high, status: in progress, spec: 059 |
| Tests (fakes) | `test/owner-super-agent.test.js` (new); budget-weekly, owner-assistant, global-mcp, fallback, breaking-updates, token-streaming, admin-mcp, platform updated |
| Checks | `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs` |
| Security | permissions in code (role → agent role, WhatsApp allow set, confirm for other chats and service confirm tools); no new secrets; model text rendered as text |
| Privacy | off/private chats refused (re-checked at confirm); own chat never stored in chat memory; notes per user; DM privacy line once; weekly summary counts only |
| Small servers | media turns through the media queue; no new timers (schedules on the agent tick); MCP lists cached as before |
| Lean code | removed: owner settings block and route, `set_owner_alerts`/`get_owner_alerts`/`send_weekly_summary`, weekly settings and tick, `/api/alerts*`, Owner alerts card; shared `packMsg`/`unpackMsg`/`quoteOf`, `OWNER_WA_TOOLS` |
| Admin MCP | update/get/run_schedule_now on `owner-assistant`, `builtin` in list_agents; `docs/admin-mcp.md` |
| Docs | `docs/owner-assistant.md` (rewritten), agents, admin-mcp, backups-and-updates, README index, README, mobile README, website section |
| Website | section text; shots retaken: `card-owner-assistant`, new `card-owner-agent` |
| Version | 2.20.0 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml`; `releases.json` entry |
