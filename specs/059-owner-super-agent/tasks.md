# Tasks: 059 owner assistant as a super agent

- [x] T001 Agent tools for the owner assistant through `tools.js toolsFor()` (global services, WhatsApp, media, memory)
- [x] T002 Chat resolution by name, hold for other chats, `send_message`, privacy line, re-check at confirm
- [x] T003 Role mapping (owner/admin → organizer, viewer → participant), WhatsApp allow set, service confirm tools held
- [x] T004 Photos / PDFs / voice notes through the media queue (`owner` job), voice replies, own chat not stored
- [x] T005 Built-in agent record `owner-assistant` (fixed fields, not deletable/assignable, not routed)
- [x] T006 Agent editor for the built-in (hidden fields, Character, Alerts, schedules wording), Settings card, agents list
- [x] T007 Weekly summary as its schedule; owner schedules to linked owners/admins; alerts number in the record
- [x] T008 Remove old settings, routes, admin tools, Owner alerts card, weekly tick
- [x] T009 Admin MCP descriptions, mobile owner/agent screens, demo data, responsive state, site shot
- [x] T010 Tests: `owner-super-agent.test.js`, updated suites

## Phase Final: Definition of Done

- [x] T090 Issue: labels, plan comment, progress comments
- [x] T091 Spec artifacts match the code
- [x] T092 Tests with fakes; `npm test`, `npm run lint`, `npm run check:panel` pass
- [x] T093 UI: `npm run check:responsive` passes
- [x] T094 Security review (permissions in code, confirm gate, no secrets)
- [x] T095 Privacy review (off/private chats, own chat not stored, counts-only summary, DM line once)
- [x] T096 Small-server impact considered (media queue, no new timers)
- [x] T097 No chores for the owner (defaults: all services, weekly summary on)
- [x] T098 Lean code: knip, jscpd, panel size budget pass
- [x] T099 Admin MCP updated
- [x] T100 Docs updated
- [x] T101 Website text and screenshots
- [x] T102 Version 2.20.0 in three files
- [x] T103 `releases.json` entry
- [ ] T104 PR via REST (opened by the owner's session), required checks green, squash merge
- [ ] T105 Issue done comment and close with the release
