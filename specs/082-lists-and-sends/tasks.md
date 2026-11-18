# 082 · Tasks

- [x] T1 Issue #184 (labels, spec: 082), spec folder, plan comment
- [x] T2 Pace: list helpers in pace.js (hours, gap, cap, typing after reads, estimate)
- [x] T3 Frame: moduleApi, interceptMessage; router hook
- [x] T4 Sending module: audiences and skips, drafts and preview, start/pause/resume/stop, the tick step with waits and stop signals, restart safety, stop/start words, person section, held start
- [x] T5 Orders: Send reminders, automatic reminders per event; Events: message registered people
- [x] T6 Panel API + panel: People → Sending (history, New message with preview, run page), Orders and event entry points
- [x] T7 Agent tools; admin MCP tools (risky ones confirmed)
- [x] T8 Tests with fakes and a fake clock (sending.test.js); modules test; check-perf fixture and workload
- [x] T9 Demo data, responsive states, site shots, docs (sending, modules, events, orders, people, privacy, pace, admin-mcp, index), README, website tile
- [x] T10 Version 2.44.0, releases.json; all checks; PR; merge; done comment; real-device checks on #62

## Definition of Done
- [x] Small servers: module loads only when on; no timers; one send per tick; check:perf passes with new budgets
- [x] Lean code: pace reused, not copied; knip, jscpd, ci-checks pass
- [x] Security & privacy: consent and permissions in code; confirm before any send; chats that are off and hidden people never messaged; texts rendered as text
- [x] Docs, website, screenshots, admin MCP; honest about WhatsApp ban risk and terms
