# Plan 067

> Removed in #146 (v2.29.3): see the note at the top of `spec.md`.

- **Server:**
  - `providers/plan-usage.js` (new): parsers (Anthropic and OpenAI rate-limit headers,
    Copilot user, OpenRouter key/credits), the per-account snapshot store (`ttl_state` kind `plan-usage`), `view()`,
    `tightest()`, `exhausted()`, `warnings()`, alerts.
  - Adapters return the response `headers` (Anthropic via `.withResponse()`; Chat Completions via `onHeaders`; ChatGPT). `providers/index.js` notes them after an answer and from a failure's headers, enriches the
    breaker (`limit` text, reset as retry time), refreshes endpoints in `status()` and `planUsageTick()`, adds
    `usage` and `spend` (budget `spendOf('account', …)`) to each account row, and forgets an account's snapshot with its
    credentials.
  - `copilot.planLimits()` replaces `copilot.quota()`; `openai-chat.openRouterLimits()`.
  - `breaker.js`: `limit` text in the state, the status line, alerts and switch notes.
  - `upkeep.js`: `planUsageTick()` after the memory check. `routes/status.js`: `plans` (≥ 80 %).
  - `admin-tools.js`: `list_model_accounts` with usage and spend.
- **Panel:** `plans.js` (new, loaded with Models/Usage): `rowStatus`, `planSection`, `plansCard`; `models.js` drops its
  own `limitsOf`; `overview.js` note; CSS spacing. Budgets: first screen +0.4 KB, total +2 KB (reason in the PR).
- **Demo:** Claude snapshot from headers; OpenRouter `/key` from the fake endpoint.
- **Tests:** `test/plan-usage.test.js` (fake ChatGPT backend for the limit error, fake GitHub, fake OpenRouter `/key` + `/credits`, Claude
  headers); harness fakes can send headers; Copilot setup test reads `usage`.
- No new dependency, timer or polling. Small servers: one HTTP request per Copilot/OpenRouter account every 30 min at
  most, a few hundred bytes of memory per account, no runtime started.

## Follow-up #144: ChatGPT plan usage removed

Deleted: `chatgpt.planLimits()`, `CHATGPT_BACKEND_BASE`, the account-id claim reader and the `codex.rate_limits` event;
in `plan-usage.js` the Codex header families, `parseCodexEvent`, `parseWhamUsage`, `windowLabel`, `noteEvent` and the
`unavailable` endpoint flag (`endpointUnavailable`); in `providers/index.js` `chatgpt` as an endpoint type, the 24-hour
refused TTL and the `usageUnavailable` row flag; `usage_note` in `list_model_accounts`; the muted line in `plans.js`;
the ChatGPT demo snapshots and the harness/demo usage-endpoint fakes. Tests: ChatGPT cases replaced by one that shows no
usage and pauses until the reported reset; alert/pause/Overview/admin coverage moved to OpenRouter's free requests.
