# Tasks — 055 Local tool services and Small server mode on small servers

## Phase 1: One rule
- [x] T001 `localServiceCheck`, `addedLocalServices`, `guardLocalSmall` in `src/core/mcp-local.js`; registry check is the same function
- [x] T002 Guard in `createAgent`, `updateAgent`, `saveGlobalServer`; `installPackage` refuses; error `code` in API answers

## Phase 2: Already configured
- [x] T003 `serverConnection` does not start a refused local service (tool error + one activity line); `blocked` in local lists
- [x] T004 Panel: local editor note, Install disabled, Local option disabled when refused

## Phase 3: Small server mode (owner addition)
- [x] T005 `smallServerMode` as a server setting (old speech switch read once), `smallServerCheck`, messages name the switch
- [x] T006 Local services with the switch: cap 2, lazy start, no start under pressure, stop on pressure
- [x] T007 `heavyCheck` stays refused below 2 GB and says so
- [x] T008 `/api/server/small-mode`, status `server.smallMode`, Settings → Server card, Photos & voice links to it
- [x] T009 Admin MCP `set_small_server_mode` (confirm)

## Phase 4: Tests
- [x] T010 `test/local-small-server.test.js`: every path off/on, existing services, install refused, pressure stop, heavyCheck, admin MCP; `test/media-ai.test.js` uses the new switch

## Phase Final: Definition of Done
- [x] T011 Issue #106: labels (type / area / priority / status / `spec: 055`), plan comment, progress comments
- [x] T012 Spec artifacts match the code
- [x] T013 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T014 UI: `npm run check:responsive` passes (new states `settings-small-mode`, `agent-local-blocked`); DESIGN.md checklist met (existing card, toggle and note styles)
- [x] T015 Security review: permissions in code (owner-only route, confirm in admin MCP); nothing app-controlled runs as root
- [x] T016 Privacy review: n/a (no chat contents involved)
- [x] T017 Small-server impact: default off; with the switch, caps + stop on pressure; Copilot still refused
- [x] T018 Admin MCP tools + `docs/admin-mcp.md`
- [x] T019 Docs: `docs/small-servers.md` (Small server mode section, existing services), `docs/agents.md`, `docs/models.md`, `README.md`; DESIGN.md n/a
- [x] T020 Website: tile text, `card-small-mode.webp` added, `card-small-server.webp`, `card-mcp.webp`, `server-desktop.webp` retaken
- [x] T021 Version 2.17.0 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml`; `releases.json` entry
- [ ] T022 PR via REST with `Closes #106` (opened by the owner's session)
- [ ] T023 Done comment; close with the release after merge
