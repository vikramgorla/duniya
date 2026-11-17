# Tasks: 061 remove the mobile app; the panel is the phone app

- [x] T001 Delete `mobile/`, `mobile.yml`, `routes/mobile.js`, `qr.js`, `mobile-app.test.js`, `docs/mobile-app.md`, `npm run mobile`, eslint/dockerignore entries
- [x] T002 Admin OAuth: built-in app client, Expo redirects, `/api` resource and app consent removed; one-time cleanup (2.22.0 only)
- [x] T003 Panel server: session-only `requestUser`, no `bearer` option or Bearer branch; assets map serves manifest and icons
- [x] T004 Panel: Settings → Mobile app card and QR helper removed; manifest/iOS head tags; install hint; resume reconnect; phone CSS
- [x] T005 Icons 192/512/maskable 512/apple-touch 180 from the master renders
- [x] T006 Tests: `panel-snappy`, `admin-mcp`; responsive state `overview-install-steps`
- [x] T007 Docs, website text and shots, DESIGN, AGENTS/constitution/templates/PR template wording

## Phase Final: Definition of Done

- [x] T090 Issue: labels, plan comment, progress comments
- [x] T091 Spec artifacts match the code
- [x] T092 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T093 UI: `npm run check:responsive` passes
- [x] T094 Security review (session-only panel API, OAuth for AI assistants unchanged)
- [x] T095 Privacy review (nothing new stored)
- [x] T096 Small-server impact considered (no timers, no service worker)
- [x] T097 No chores for the owner
- [x] T098 Lean code: knip, jscpd, panel size budget pass
- [x] T099 Admin MCP: n/a (nothing to cover)
- [x] T100 Docs updated
- [x] T101 Website text and screenshots (overview, card-ask) retaken
- [x] T102 Version 2.22.0 in three files
- [x] T103 `releases.json` entry
- [x] T104 PR via REST, required checks green, squash merge
- [x] T105 Issue done comment and close with the release
