# 094 · Tasks

- [x] T1 Issue #216 (labels, spec: 094), plan comment, branch
- [x] T2 Risk from annotations; generic preview → confirm; name table, words and agent `risk` removed
- [x] T3 Service behaviour: schema (service default, agent override), resolution, instructions line, limits
- [x] T4 Share on its own: media tool detection, moments, mood words, one action, tag, fallback, post with credit
- [x] T5 Built-in tools annotated; held changes use the call's risk and the service's mode
- [x] T6 Panel: How it uses it (Settings and agent Tools), Risk column; routes; budgets
- [x] T7 Admin MCP get / set; AI helper; migration (one-time)
- [x] T8 Tests with fakes (tool-behaviour.test.js; autonomy and harness fakes annotated)
- [x] T9 Docs (tool-services new, agents, diagram, privacy, architecture, admin-mcp, SECURITY), README, website, screenshots
- [x] T10 Version 2.55.0, releases.json; checks; PR; merge; done comment; #62

## Definition of Done
- [x] Small servers: no timers, tables or dependencies; per-day counts are one overwritten kv row per agent and service
- [x] Privacy: only mood and style words go to a media service; Activity names the service and the mood, never text
- [x] Permissions in code: risk from annotations + overrides, role rules, limits; same-turn confirm still blocked
- [x] Lean code: name-based risk and the GIF-specific first attempt removed; one behaviour editor for both screens
