# Implementation Plan: Spending Caps

**Spec**: [spec.md](spec.md) · **Issue**: #35 · **Release**: v2.4.0

## Design

- `src/core/budget.js` — `budget_caps` table (tenant, scope, id, cost, tokens, fallback); `monthOf()` in the server
  timezone; `spendOf()` from the `usage` table (indexes on `(agent, ts)` and `(chat, ts)`); `capStatus()`;
  `checkBudget(agent, chat)` → `ok | fallback | quiet`, sending alerts once (kv key per scope/month/level).
- `src/core/owner-alerts.js` — `alertsTo` setting and `sendOwnerAlert()` through the WhatsApp channel (shared with 041).
- `src/core/runner.js` — gate before the first model call; the fallback model replaces the chat/agent model.
- `src/panel/routes/owner-alerts.js` — budget and alert routes; `src/panel/admin-tools.js` — MCP tools.
- `src/panel/public/index.html` — `capBar()`, `capEditor()`; agent page, Chats, Usage.

## Constitution Check

- II generic core: no agent-specific logic. III/IV unaffected. V: caps, alerts and silences are recorded in Activity.
- VI: no new dependencies; one small table. VIII: plain wording, one state per cap, phone-friendly.

## Complexity Tracking

None.
