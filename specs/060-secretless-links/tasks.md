# Tasks: 060 secret-free owner assistant

- [x] T001 `one-time-links.js` (create / peek / take / drop, hashed tokens, TTL store)
- [x] T002 Secret links: routes, save through existing routes, "saved" note to the asker's WhatsApp chat
- [x] T003 Sign-up links: user without password, link routes, public set-password + session, rate limit
- [x] T004 Restore with the stored passphrase, `check`, Backups page link on failure
- [x] T005 Admin tools: `set_secret`, `add_user`, `send_signup_link`, `restore_backup`; owner assistant filter removed
- [x] T006 Owner assistant: pasted-secret guard, links shown verbatim, surface in tool context
- [x] T007 Panel: `#secret=` and `#signup=` screens, Users card, restore passphrase optional; responsive states
- [x] T008 Tests: `secretless-links.test.js`; updated suites

## Phase Final: Definition of Done

- [x] T090 Issue: labels, plan comment, progress comments
- [x] T091 Spec artifacts match the code
- [x] T092 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T093 UI: `npm run check:responsive` passes
- [x] T094 Security review (tokens, sessions, roles, confirm gate, no secrets in logs)
- [x] T095 Privacy review (pasted secrets never stored or sent)
- [x] T096 Small-server impact considered (no timers)
- [x] T097 No chores for the owner
- [x] T098 Lean code: knip, jscpd, panel size budget pass
- [x] T099 Admin MCP updated
- [x] T100 Docs updated
- [x] T101 Website text (screenshots: n/a — no site shot shows the changed screens)
- [x] T102 Version 2.21.0 in three files
- [x] T103 `releases.json` entry
- [ ] T104 PR via REST, required checks green, squash merge
- [ ] T105 Issue done comment and close with the release
