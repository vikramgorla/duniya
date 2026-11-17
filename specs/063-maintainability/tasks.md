# Tasks: 063 maintainability

- [x] T001 Measure before: first load (bytes, time) on 1.6 Mbps / 150 ms, 10 Mbps / 40 ms and a 4× slower CPU; test time; file sizes
- [x] T002 Split `index.html` into shell, `styles.css` and ES modules; shared mutable state into `S`; `diff.js` as a module
- [x] T003 Lazy screens (`SCREENS` in `core.js`), Find and the AI helper on first use; no Overview draw under another screen
- [x] T004 `assets.js` + `module-graph.js`: content-hash URLs, import map, CSP hash, modulepreload of the first screen
- [x] T005 `/api/session?status=1`: the first screen in one round trip
- [x] T006 `check-panel.mjs` (link check, `import()` names, budgets); ESLint, knip, jscpd over the modules; `ci-checks.mjs`
- [x] T007 Dev scripts (`check-responsive`, `site-shots`, `demo-panel`) through `import('/app/…')`
- [x] T008 `npm run typecheck`, `// @ts-check` on core modules, panel server and routes; fix what it finds
- [x] T009 Inline routes into `routes/<area>.js`; `requestUser`, `personView`, `bootstrapAuth` moved; `fail()` everywhere
- [x] T010 Tests in parallel; next-second waits; tests for the new serving and the session status
- [x] T011 Measure after; numbers in the issue and PR

## Phase Final: Definition of Done

- [x] T090 Issue: labels, plan comment, progress comments
- [x] T091 Spec artifacts match the code
- [x] T092 Tests with fakes; `npm test`, `npm run lint`, `npm run typecheck`, `npm run check:panel` pass
- [x] T093 UI: `npm run check:responsive` passes
- [x] T094 Security review
- [x] T095 Privacy review
- [x] T096 Small-server impact considered
- [x] T097 No chores for the owner
- [x] T098 Lean code: knip, jscpd, panel budgets pass
- [x] T099 Admin MCP covers the change (n/a: no new function)
- [x] T100 Docs updated
- [x] T101 Website: n/a (no visible change)
- [x] T102 Version 2.24.0 in three files
- [x] T103 `releases.json` entry
- [x] T104 PR via REST, required checks green, squash merge
- [x] T105 Issue done comment and close with the release
