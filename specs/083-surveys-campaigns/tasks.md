# 083 · Tasks

- [x] T1 Issue #186 (labels, spec: 083), spec folder, plan comment
- [x] T2 Surveys module: tables, questions, answers checked per kind, invitations and hashed links, results, CSV, person section, sender-card line
- [x] T3 Agent tools (my_surveys, answer_survey, survey_results); frame card hook
- [x] T4 Public link page (escaped, same-origin form, rate limit); server form routes
- [x] T5 Sends carry a survey ({survey}, {survey_link})
- [x] T6 Campaigns: steps, waits, stop rules, end day, confirm once, tick, pause/resume/stop with the current run
- [x] T7 Panel: People → Surveys (list, editor, results), New message survey picker, New campaign, campaign page
- [x] T8 Admin MCP tools (risky ones confirmed)
- [x] T9 Tests with fakes and a fake clock (surveys-campaigns.test.js); check-perf fixture and workload
- [x] T10 Demo data, responsive states, site shots, docs (surveys, campaigns, sending, modules, people, events, orders, privacy, admin-mcp, index), README, website tile
- [x] T11 Version 2.45.0, releases.json; all checks; PR; merge; done comment; real-device checks on #62

## Definition of Done
- [x] Small servers: modules load only when on; no timers; bounded work per tick; check:perf passes with new budgets
- [x] Lean code: one audience form for messages and campaigns; campaigns reuse runs; no 082 schema change (no migration)
- [x] Security & privacy: public page escaped, CSP, same-origin form, rate limit, hashed tokens; answers checked in code; erase/export cover answers
- [x] Docs, website, screenshots, admin MCP
