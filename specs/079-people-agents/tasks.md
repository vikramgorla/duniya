# 079 · Tasks

- [x] T1 Issue #176 (labels, spec: 079), spec folder, plan comment
- [x] T2 Tables: person_chats, person_consents, people.source / hidden (+ one-release ALTER); 078 migrations removed
- [x] T3 people-access.js: person_chats from the router and group members (upkeep), scope + canSee + agents that see a person, roles (inRole, roleEntry), sender card, consent, phone contacts → people, one-time migrations
- [x] T4 people-tools.js: find / get / add note / tag / add to list; held changes; old contacts: rules mapped; contacts tools removed
- [x] T5 Runner: tools with owner turns, sender card, ctx.hold, applyPending for people; router: person_chats, owner turns, roles by person; media queue keeps personId
- [x] T6 Agents: schema peopleAccess / peopleLists / role entries; roleIn by person; migrateRolesToPeople; merges rewrite roles; chat tools block check
- [x] T7 Privacy notice → consent; upkeep: members and phone contacts
- [x] T8 Panel API: list source/hidden, hidden, consents, person page groups/consents/agents; agent people entries and lists
- [x] T9 Panel: People list (filters, count, one line), person page (Their groups, Consent, Agents, Hide), agent editor (People access, shared lists, role pickers); budget +2 KB with reason
- [x] T10 Admin MCP: set_person_hidden, set_person_consent, list_people filters, get_person, update_agent text; erase only via MCP
- [x] T11 Tests with fakes (people-agents.test.js; people, names, chat person pages updated)
- [x] T12 check-perf: fixture (person_chats, sources, hidden, consents) and workload (tools, card, members, phone sync, migrations); budgets for the card and the find tool
- [x] T13 Demo data, responsive states (people-source, people-hidden, person-hidden, person-hide, agent-people-picker), site shots retaken
- [x] T14 Docs: people.md, agents.md, admin-mcp.md, privacy.md, README, website tile, DESIGN.md
- [ ] T15 Version 2.40.0, releases.json; all checks; PR; merge; done comment; real-device checks on #62

## Definition of Done
- [x] Small servers: no timers; bounded per tick; new queries pass `npm run check:perf`; index sizes in the PR
- [x] Lean code: replaced code deleted; one-release migrations listed for removal; ci-checks pass
- [x] Security & privacy: allow-list respected (off chats note nobody); no message text in cards, notes or logs; permissions in code
- [x] Docs, website, screenshots, admin MCP
