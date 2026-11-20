# 088 · Tasks

- [x] T1 Issue #203 (labels, spec: 088), plan comment, branch
- [x] T2 smart-model.js: settings, tiers, rules, classifier
- [x] T3 Runner: tier per turn, escalation, turn cost, smart_turns, Activity detail
- [x] T4 fact-check.js + runner self-check (one rewrite, plain answer), Activity "checked"
- [x] T5 Schema, chat prefs, retention
- [x] T6 Panel: agent Model section, Models → Smart choice, Usage card, Activity notes; routes
- [x] T7 Admin MCP: set_default_models, get_smart_model_savings
- [x] T8 Tests with scripted fake models (tiers, classifier on/off, light failure, per-agent override, savings, self-check)
- [x] T9 Docs (intelligence.md, models.md, spending.md, agents.md, admin-mcp.md, README, website), screenshots
- [x] T10 Version 2.49.0, releases.json; checks; PR; merge; done comment; #62

## Definition of Done
- [x] Small servers: no timers; one optional classifier call; bounded table pruned with usage
- [x] Privacy: no message text in Activity or usage; the classifier sees only the message
- [x] Permissions unchanged (tools by role, confirm gate); self-check never adds facts
- [x] Lean code: the existing resolver, fallback and usage recording reused (`chat()` returns its cost)
