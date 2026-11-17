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

## Follow-up #140: ChatGPT usage endpoint

`chatgpt.planLimits(secret)` (endpoint `CHATGPT_BACKEND_BASE`, default `https://chatgpt.com/backend-api`) →
`plan-usage.parseWhamUsage`; `providers/index.js` adds `chatgpt` to the endpoint readers (`ENDPOINT_READERS`), with a
24-hour retry for refused accounts (`endpointUnavailable`). `view()` keeps the newest source per limit id. Panel:
`plans.js` muted line from `usageUnavailable`. Tests: fake usage endpoint in `test/plan-usage.test.js`; the harness
and the demo point the endpoint at local fakes.
