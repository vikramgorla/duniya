# Tasks — 057 Names instead of numbers, group member tags, automatic upkeep

## Phase 1: Names
- [x] T001 Separate book / business / profile names; migration from `wa_name`
- [x] T002 LID names and LID→phone map from every source; names move when the pair arrives
- [x] T003 One resolver (`personInfo`, `chatTitle`) in panel, owner assistant, alerts, insights, Activity, mobile
- [x] T004 Automatic names refresh (snapshot once per number, then incremental after connect and daily)

## Phase 2: Member tags
- [x] T005 Store per chat + member (chats on only, newest wins, removal, erase with memory)
- [x] T006 Read from message contextInfo, tag-change messages, Baileys event, history participants (raw member list removed in #117: it carries no tags)
- [x] T007 Names-only diagnostic of member-list fields (#62)
- [x] T008 Tags in the panel (pills) and in the agent's context

## Phase 3: No chores
- [x] T009 History retries with backoff on the shared tick; phone-online nudge; no_anchor starts on next message
- [x] T010 `upkeep.js` on the scheduler tick (no new timers); group member lists every 12 h / after changes
- [x] T011 Update docs: automatic update checks; history wording; AGENTS.md DoD + constitution 1.4.2 + templates

## Phase 4: Tests
- [x] T012 `test/names-tags.test.js` (names, LIDs, migration, refresh on tick, tags from all sources, diagnostic, panel and agent)
- [x] T013 `test/history-on-enable.test.js` retries

## Phase Final: Definition of Done
- [x] T014 Issue #110: labels, plan comment, progress comments
- [x] T015 Spec artifacts match the code
- [x] T016 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T017 UI: `npm run check:responsive` passes
- [x] T018 Security review: labels and names rendered as text; no shell; no new secrets
- [x] T019 Privacy review: chats-on only for tags; address-book names never to a model; diagnostic names only
- [x] T020 Small-server impact: no new timers, bounded ticks, skipped under memory pressure
- [x] T021 No chores for the owner: names, member lists, history retries automatic; buttons optional
- [x] T022 Admin MCP + `docs/admin-mcp.md`
- [x] T023 Docs, diagram, README, website
- [x] T024 Version 2.18.0 + `releases.json`
- [ ] T025 PR via REST with `Closes #110` (opened by the owner's session)
- [ ] T026 Done comment; close with the release after merge
