# Tasks — 052 Browse tool services (MCP Registry)

## Phase 1: Core
- [x] T001 `src/core/mcp-registry.js`: settings, safe fetch (origin, no redirects, timeout, size cap, cache)
- [x] T002 Normalise server.json (remotes, packages, inputs), publisher, trust hints, supported/unsupported reasons
- [x] T003 Add mapping: fields, `buildConfig()` for remote (variables, headers, Bearer → token) and local npm (env, args)

## Phase 2: API (US1–US3, US5)
- [x] T004 Routes: settings (owner), search, entry + fields, add (owner/small-server guards, secrets, OAuth probe, agent/global, 409)
- [x] T005 Discovery after add, role defaults, risky flags, confirm gate for preview/confirm services

## Phase 3: Panel (US1–US3, US5)
- [x] T006 Browse sheet: search, cards, more, add form (seg hosted/local, fields, secrets as password), result with tools, install for local
- [x] T007 Buttons in agent editor and Settings → Tool services; registry settings box (owner)

## Phase 4: Assistants (US4)
- [x] T008 Admin tools `search_mcp_registry`, `add_tool_service_from_registry` (confirm, no keys)

## Phase 5: Tests
- [x] T009 `test/mcp-registry.test.js` with a fake registry: settings, search + pagination + no credentials + cache, normalisation, unsupported, secrets, small-server refusal, owner-only, agent and global add, discovery, admin MCP confirm

## Phase Final: Definition of Done
- [x] T010 Issue: labels (type / area / priority / status / `spec: 052`), plan comment posted, progress comments at milestones
- [x] T011 Spec artifacts match the code
- [x] T012 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T013 UI: `npm run check:responsive` passes (375 / 393 / 1440, light + dark); DESIGN.md checklist met
- [x] T014 Security review: no secrets returned or logged, TLS untouched, no shell, registry text as text, permissions in code; CodeQL checked on the PR
- [x] T015 Privacy review: n/a for chats (no message contents involved); the registry receives only the search words
- [x] T016 Small-server impact: bounded cache, no install on add, local packages refused on small servers
- [x] T017 Admin MCP tools (risky add confirms); `docs/admin-mcp.md`
- [x] T018 Docs: `docs/agents.md` (Browse section), `docs/small-servers.md`, `docs/admin-mcp.md`, `README.md` highlight; DESIGN.md n/a (existing dialog, pill and card styles)
- [x] T019 Website: tile + `card-registry.webp`, `card-mcp.webp` retaken (`npm run site:shots -- --only card-registry,card-mcp --no-video`)
- [x] T020 Version 2.15.0 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml`
- [x] T021 `releases.json` entry for 2.15.0
- [ ] T022 PR via REST with `Closes #99` (opened by the owner's session; not part of this branch's work)
- [ ] T023 Issue done comment posted; close with the release after merge
