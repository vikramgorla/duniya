# Tasks

- [X] T001 Metadata only for off chats: `chats_seen` key columns, `noteLatestKeys`, `latestKey`; key-only rows hidden
      from the People list
- [X] T002 Channel: anchor keys from history, ON_DEMAND flag, `fetchHistory`; registry routing per number
- [X] T003 Router: keys for live and history messages; ON_DEMAND batches stored only for chats that are on
- [X] T004 `history-load.js`: anchor, paging (50 per request, max 200), timeout, cooldown, statuses, summary
- [X] T005 Storage order: earlier messages get ids below stored rows; summary built or folded
- [X] T006 Agent honesty: history note in the user turn
- [X] T007 Panel API (status on rows, load route, setting) and Chats UI (status line, button, setting)
- [X] T008 Admin MCP `load_chat_history` / `set_history_on_switch_on`; owner assistant `noConfirm`
- [X] T009 Tests with a fake phone: off chats store only keys, load on switch-on, order, summary, honesty, button
      (pages back, 429, 409, viewer 403), paging, phone offline, no anchor, setting 0, owner assistant without code
- [X] T010 Demo panel states; `check:responsive` for Chats
- [X] T011 Docs: agents, privacy, getting-started, admin-mcp, README, website FAQ
- [X] T012 Version 2.12.1 (package.json, package-lock.json, infra/oci/schema.yaml) + releases.json entry
- [X] T013 `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs`
- [ ] T014 PR via REST (`Closes #91`), squash-merge after checks (left to the maintainer)

## Follow-ups

- Verify on a real phone: `fetchMessageHistory` timestamp unit (ms assumed from the proto field name; the Baileys
  README passes seconds), how many chunks the phone sends, and whether it answers for groups and 1:1 chats alike.
- The anchor message itself (newest seen while off) is not loaded.
- Statuses are in memory (lost on restart); history from `chats.upsert` events is not used (no message keys there).
