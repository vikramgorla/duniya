# Plan 067

- **Server:**
  - `providers/plan-usage.js` (new): parsers (Codex headers and event, Anthropic and OpenAI rate-limit headers,
    Copilot user, OpenRouter key/credits), the per-account snapshot store (`ttl_state` kind `plan-usage`), `view()`,
    `tightest()`, `exhausted()`, `warnings()`, alerts.
  - Adapters return the response `headers` (Anthropic via `.withResponse()`; Chat Completions via `onHeaders`; ChatGPT
    plus `planEvent`). `providers/index.js` notes them after an answer and from a failure's headers, enriches the
    breaker (`limit` text, reset as retry time), refreshes endpoints in `status()` and `planUsageTick()`, adds
    `usage` and `spend` (budget `spendOf('account', …)`) to each account row, and forgets an account's snapshot with its
    credentials.
  - `copilot.planLimits()` replaces `copilot.quota()`; `openai-chat.openRouterLimits()`.
  - `breaker.js`: `limit` text in the state, the status line, alerts and switch notes.
  - `upkeep.js`: `planUsageTick()` after the memory check. `routes/status.js`: `plans` (≥ 80 %).
  - `admin-tools.js`: `list_model_accounts` with usage and spend.
- **Panel:** `plans.js` (new, loaded with Models/Usage): `rowStatus`, `planSection`, `plansCard`; `models.js` drops its
  own `limitsOf`; `overview.js` note; CSS spacing. Budgets: first screen +0.4 KB, total +2 KB (reason in the PR).
- **Demo:** ChatGPT, ChatGPT · Sam and Claude snapshots from headers; OpenRouter `/key` from the fake endpoint.
- **Tests:** `test/plan-usage.test.js` (fake ChatGPT backend, fake GitHub, fake OpenRouter `/key` + `/credits`, Claude
  headers); harness fakes can send headers; Copilot setup test reads `usage`.
- No new dependency, timer or polling. Small servers: one HTTP request per Copilot/OpenRouter account every 30 min at
  most, a few hundred bytes of memory per account, no runtime started.
