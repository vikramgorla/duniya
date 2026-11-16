# Tasks: 058 lean cleanup

- [x] T001 Baseline: knip (103 unused exports root, 17 mobile + 1 dependency), jscpd (5 clones), panel numbers
- [x] T002 Remove leftovers: ALTER guards, wa_name migration, smallServer carry-over, bare model ids, `plugins` drop
- [x] T003 Un-export / delete unused code (root, mobile), remove `expo-crypto`
- [x] T004 Remove duplication (memory summary, local tools, test fakes, shared helpers, chat ids, bareJid)
- [x] T005 CI: knip + jscpd + panel size budget in `scripts/ci-checks.mjs`; knip in the mobile workflow
- [x] T006 Panel: static shell from memory (compressed, ETag/304, versioned scripts)
- [x] T007 Panel: status over SSE, fallback poll, git version once, stream closed on pagehide
- [x] T008 Panel: screen cache with invalidation, optimistic Overview switches, no stale update box
- [x] T009 Tests: `test/panel-snappy.test.js`, model ref validation, updated tests
- [x] T010 Rules: AGENTS.md Lean code, constitution 1.4.3, templates (both copies), PR template, docs

## Phase Final: Definition of Done

- [x] T090 Issue: labels, plan comment, progress comments
- [x] T091 Spec artifacts match the code
- [x] T092 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T093 UI: `npm run check:responsive` passes
- [x] T094 Security review (headers kept, nothing inlined, no shell with untrusted input)
- [x] T095 Privacy review (stream sends only the caller's own status)
- [x] T096 Small-server impact considered
- [x] T097 No chores for the owner (stream reconnects and catches up by itself)
- [x] T098 Lean code: knip, jscpd, panel size budget pass
- [x] T099 Admin MCP: n/a (no new panel function)
- [x] T100 Docs updated
- [x] T101 Website: n/a (no visible change)
- [x] T102 Version 2.19.1 in three files
- [x] T103 `releases.json` entry
- [ ] T104 PR via REST (opened by the owner's session), required checks green, squash merge
- [ ] T105 Issue done comment and close with the release
