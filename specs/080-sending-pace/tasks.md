# 080 · Tasks

- [x] T1 Issue #180 (labels, spec: 080), spec folder, plan comment
- [x] T2 pace.js: settings, presets, validation, bell-shaped jitter
- [x] T3 Read queue: queue for chats that are on, drain on messages and the upkeep tick, answered turns wait for their receipt
- [x] T4 Typing by reply length (≤ 8 s) in deliver(); typing after the read while the model works
- [x] T5 Daily cap of new chats with warm-up; intros counted; sending hours; list estimate
- [x] T6 Panel API + Settings → Sending pace; admin MCP get/set
- [x] T7 Tests with fakes (sending-pace.test.js)
- [x] T8 Docs: sending-pace.md, whatsapp.md, admin-mcp.md, index, README, website; responsive state; screenshots
- [x] T9 Version 2.42.0, releases.json; all checks; PR; merge; done comment; real-device checks on #62

## Definition of Done
- [x] Small servers: no timers; bounded per tick; no new queries
- [x] Lean code: localParts shared, nothing duplicated; ci-checks pass
- [x] Security & privacy: chats that are off never touched; no message text stored or logged by the pace
- [x] Docs, website, screenshots, admin MCP
