# Tasks: 060 secret-free owner assistant

- [ ] T001 `one-time-links.js` (create / peek / take / drop, hashed tokens, TTL store)
- [ ] T002 Secret links: routes, save through existing routes, "saved" note to the asker's WhatsApp chat
- [ ] T003 Sign-up links: user without password, link routes, public set-password + session, rate limit
- [ ] T004 Restore with the stored passphrase, `check`, Backups page link on failure
- [ ] T005 Admin tools: `set_secret`, `add_user`, `send_signup_link`, `restore_backup`; owner assistant filter removed
- [ ] T006 Owner assistant: pasted-secret guard, links shown verbatim, surface in tool context
- [ ] T007 Panel: `#secret=` and `#signup=` screens, Users card, restore passphrase optional; responsive states
- [ ] T008 Tests: `secretless-links.test.js`; updated suites

## Phase Final: Definition of Done

- [ ] T090 Issue: labels, plan comment, progress comments
- [ ] T091 Spec artifacts match the code
- [ ] T092 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [ ] T093 UI: `npm run check:responsive` passes
- [ ] T094 Security review (tokens, sessions, roles, confirm gate, no secrets in logs)
- [ ] T095 Privacy review (pasted secrets never stored or sent)
- [ ] T096 Small-server impact considered (no timers)
- [ ] T097 No chores for the owner
- [ ] T098 Lean code: knip, jscpd, panel size budget pass
- [ ] T099 Admin MCP updated
- [ ] T100 Docs updated
- [ ] T101 Website text (screenshots: n/a unless a shown screen changed)
- [ ] T102 Version 2.21.0 in three files
- [ ] T103 `releases.json` entry
- [ ] T104 PR via REST, required checks green, squash merge
- [ ] T105 Issue done comment and close with the release
