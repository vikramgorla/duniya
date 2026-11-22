# 093 · Tasks

- [x] T1 Issue #213 (labels, spec: 093), plan comment, branch
- [x] T2 `autonomy.js`: modes, risk table, name rules, overrides, agreement, instruction text
- [x] T3 Runner: instructions, confirm gate for People / modules, remote preview apply / wait / hold, confirm gate, Activity
- [x] T4 Schema, tools meta, owner assistant reuse, AI helper, Activity type filter + index + check-perf
- [x] T5 Panel: Tools section choice, agent row, Activity filter and label; budgets
- [x] T6 Admin MCP descriptions; tests with fakes (autonomy.test.js; people-agents updated)
- [x] T7 Docs (agents, diagram, privacy, architecture, admin-mcp, SECURITY), README, website, screenshots
- [x] T8 Version 2.54.0, releases.json; checks; PR; merge; done comment; #62
- [x] T9 2.54.1: follow-ups without the wake word (judged turns) count for clear requests and a later yes; test

## Definition of Done
- [x] Small servers: no timers or dependencies; one MCP call replaces a model round
- [x] Privacy: Activity summaries name the change, never message text; chats that are off untouched
- [x] Permissions in code: risk table + role + source decide; same-turn confirm blocked in code; participants unchanged
- [x] Lean code: the organizer / confirm wording and the two "held" strings replaced by one place; `matchesAny` shared
