# Implementation Plan: Names instead of numbers, group member tags, automatic upkeep

**Spec**: [spec.md](spec.md) · **Issue**: #110 · **Release**: v2.18.0 (minor)

## Design

- `src/core/contacts.js` — columns, migration, `contact_lids`, `mapLid`, `lidPhone`, `unmappedLids`, `personInfo`,
  `chatTitle`, `contactSummary` (FR-001…FR-003).
- `src/core/member-tags.js` + `member_tags` table in `db.js` (erased in `eraseChat`) (FR-006).
- `src/channels/whatsapp.js` — contacts/LID events, `captureTags` / `captureHistoryTags`, `fetchGroupMeta` (same IQ as
  Baileys + `extractGroupMetadata`, raw participant nodes), diagnostic, `refreshNames`, `upkeep`, `refreshGroup`,
  `onPhoneActive`, `onGroupChange`; `registry.js` routes them (FR-002, FR-005…FR-007).
- `src/core/history-load.js` — retry due times, `historyRetryTick`, `historyPhoneOnline`, `historyChatActive`,
  `resumeHistoryRetries` (FR-008).
- `src/core/upkeep.js`, hooked into `scheduler.js` (FR-009, FR-010).
- Router (Activity / why-quiet via resolver, `senderTag`), runner and memory (tags in model context; FR-004).
- Panel: `server.js` (people, group members, chats, messages, `/api/contacts/summary`, `/api/contacts/refresh`),
  `owner-assistant.js`, `owner-alerts.js`, `insights.js`; `index.html` (tag pills, labels, Contacts summary, history
  status wording); mobile `chatLabel` (LID) and message tags.
- Admin MCP: `contact_names_status`, `refresh_contact_names`; `load_chat_history` description.
- Docs: `docs/agents.md` (Which name is shown, Group member tags, Earlier messages), diagram `contact-names`,
  `privacy.md`, `admin-mcp.md`, update steps (install, GCP, OCI), README, website; AGENTS.md + constitution 1.4.2.

No new dependencies (`extractGroupMetadata` is imported from Baileys' own module).

## Constitution Check

- Privacy: tags only for chats that are on; address-book names never sent to a model; diagnostic has names only.
- Small servers: no new timers; bounded work per tick; skipped under memory pressure; contacts snapshot is one
  app-state collection once per number.
- No chores for the owner (new in 1.4.2): names, member lists and history retries are automatic.

## Complexity Tracking

None.
