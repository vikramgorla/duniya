# Tasks

- [X] T001 Rename bots → agents across code, file names, routes, tables, settings, activity, admin tools, templates,
  panel, docs, README, docs/site, tests, mobile app; `agent.js` → `runner.js`
- [X] T002 Remove legacy migrations (pre-005 files, secrets/settings JSON, `extraPrompt`, single `token`, ALTER TABLE
  column migrations, one-time notice); backup bundle v2 with a plain refusal of v1
- [X] T003 Schema: shared `validateServer`, reserved names, `validateGlobalServer` with defaults, `globalMcp.disabled`
- [X] T004 `global-mcp.js` storage + change listeners (MCP pool reset)
- [X] T005 Effective services, per-service connections (scope agent/global), defaults vs explicit rules, skip services
  with nothing allowed
- [X] T006 OAuth per global service (`agent_id = '*'`), callback back to Settings, removal deletes sign-ins
- [X] T007 Routes `/api/tool-services…` with owner-only local services; secrets listing includes global references
- [X] T008 Admin MCP: list/add/remove global tool services (add/remove risky)
- [X] T009 Panel: shared tool-service editor, Settings → Tool services card, agent editor opt-out/choose tools
- [X] T010 AI helper knows global services; mobile agent screen lists them
- [X] T011 Tests: `test/global-mcp.test.js` (fake MCP + fake OAuth server); existing suites renamed
- [X] T012 Docs (configuration incl. upgrade note, README, site), constitution 1.3.1, version 2.0.0 (package.json,
  infra/oci/schema.yaml)
