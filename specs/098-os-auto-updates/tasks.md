# Tasks: Automatic OS updates

- [x] T001 [US1] `os` setting (default auto, validated) in src/core/updates.js
- [x] T002 [US1] opsRunning() in src/core/system.js, used by requestOp
- [x] T003 [US1] osAutoTick / osAutoState in src/core/os-auto.js
- [x] T004 [US1] Call osAutoTick from updateTick in src/core/update-decision.js
- [x] T005 [US2] `auto` in GET /api/system/ops (src/panel/routes/system.js); switch on the OS updates card (src/panel/public/app/server.js)
- [x] T006 [US2] Admin MCP set_os_auto_updates and get_maintenance_status → auto (src/panel/admin-tools/server.js)
- [x] T007 test/os-auto.test.js

## Phase Final: Definition of Done
- [x] T008 Issue #307 with labels, plan / progress / done comments
- [x] T009 npm test, lint, typecheck, check:panel, check:clean, check:responsive, ci-checks
- [x] T010 Docs: backups-and-updates.md, install.md, deploy guides, admin-mcp.md; README and website
- [x] T011 Screenshots retaken (server shots)
- [x] T012 Version 2.63.0 + releases.json entry
- [x] T013 PR via REST, squash merge with explicit message, issue closed
