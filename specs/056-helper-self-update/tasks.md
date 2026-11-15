# Tasks — 056 The maintenance helper updates itself

## Phase 1: Root helper
- [x] T001 Version 3, `update-helper` action: strict release number, no downgrades, repo from root-owned config or official
- [x] T002 Locked-down git fetch (one tag, shallow, blobless) into a root-owned temp dir; checks; atomic install; daemon-reload; status

## Phase 2: App
- [x] T003 `requestOp('update-helper')` (helper ≥ 3, writes the release), status fields, auto-request once per version
- [x] T004 Panel note + **Update maintenance helper** button; old-helper wording (run once or reinstall, docs link)
- [x] T005 Admin MCP `run_maintenance update-helper`

## Phase 3: Tests
- [x] T006 `test/helper-self-update.test.js`: helper against a local bare repo (install, idempotent, bad versions, downgrades, missing tag, broken helper, missing file), git lock-down, app request/auto/refusal, admin MCP

## Phase Final: Definition of Done
- [x] T007 Issue #107: labels (type / area / priority / status / `spec: 056`), plan comment, progress comments
- [x] T008 Spec artifacts match the code
- [x] T009 Tests with fakes (no network, no root); `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T010 UI: `npm run check:responsive` passes (`server-old-helper`, `server-helper-update`)
- [x] T011 Security review: no app-controlled code or URL reaches root; TLS verified; no shell built from request content
- [x] T012 Privacy review: n/a
- [x] T013 Small-server impact: few hundred KB fetch, temp dir removed
- [x] T014 Admin MCP + `docs/admin-mcp.md`
- [x] T015 Docs: `docs/upgrading.md`, `docs/backups-and-updates.md`, `docs/deploy/oci-free-tier.md`, README highlight, website Server tile
- [x] T016 Version 2.17.0 + `releases.json`
- [ ] T017 PR via REST with `Closes #107` (opened by the owner's session)
- [ ] T018 Done comment; close with the release after merge
