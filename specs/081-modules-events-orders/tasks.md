# 081 · Tasks

- [x] T1 Issue #182 (labels, spec: 081), spec folder, plan comment
- [x] T2 Remove the 2.40 one-time migrations (code, tests, check-perf)
- [x] T3 Module frame: catalogue, load on switch-on, tools and rules, held changes, sections, upkeep, signals, generic merge/undo/export/erase/household delete
- [x] T4 Events module: events, registrations (household/person, kids from the household), capacity and waiting list, confirmation, deadline, duties, attendance, CSV; agent tools
- [x] T5 Orders module: orders, lines, payments, refunds, statuses, ways to pay, price list → order, daily due list for the owner; agent tools
- [x] T6 Panel API + panel: Settings → Modules, People → Events / Orders, event and order pages, sections on person/household pages, tool ticks
- [x] T7 Admin MCP tools (risky ones confirmed); owner assistant uses them
- [x] T8 Tests with fakes (modules.test.js); check-perf fixture and workload
- [x] T9 Demo data, responsive states, site shots, docs (modules, events, orders, people, privacy, admin-mcp, index), README, website tile, DESIGN.md
- [x] T10 Version 2.43.0, releases.json; all checks; PR; merge; done comment; real-device checks on #62

## Definition of Done
- [x] Small servers: modules load only when on; no timers; bounded upkeep; check:perf passes with new budgets
- [x] Lean code: migrations removed; WhatsApp tool ticks generalised, not copied; ci-checks pass
- [x] Security & privacy: permissions and confirm in code; hidden people out of agent output; CSV formula-safe; erase covers module rows
- [x] Docs, website, screenshots, admin MCP
