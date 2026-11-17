# Spec 067: Plan usage everywhere

> **Removed (#146, v2.29.3).** Owner: "If we cannot show quota for ChatGPT, remove it for all including Copilot, to keep
> the code clean — it won't be consistent anyway, and we avoid polling." All of R1–R5 and R7 are gone (no reader, no
> snapshots, no meters, no plan alerts, no `usage` / `spend_this_month` in `list_model_accounts`). What stays is the
> error handling of R6 without the plan window's name: a usage or rate-limit error pauses the account until the reset
> the provider reports ("Paused until 14:20 — usage limit reached") and the fallback answers. The text below is history.

Issue #135. Owner: "Wherever we can, show the usage of the plan (e.g. quota of ChatGPT if possible, same for Copilot…)".
064 built the slots (list-row meter, the provider page's *Plan usage*); only Copilot's runtime quota fed them.

## Requirements

- R1 Only what the provider reports, never an estimate; anything unknown or malformed shows nothing.
- R2 Sources:
  - ChatGPT plan: none (#144: the Sign in with ChatGPT token gets no plan usage from any source).
  - GitHub Copilot: `GET {GITHUB_API_BASE}/copilot_internal/user` → `quota_snapshots` (`premium_interactions`, `chat`:
    entitlement, remaining, percent_remaining, unlimited) and `quota_reset_date(_utc)`; when GitHub does not answer it
    for the token, the Copilot runtime's quota — never starting the runtime just for this on the tick.
  - OpenRouter: `GET /key` (`limit`, `limit_remaining`, `limit_reset`, `free_model_daily_requests`) and `GET /credits`
    (`total_credits`, `total_usage`) when the key may read it.
  - API keys (Anthropic, OpenAI, OpenAI-compatible): `anthropic-ratelimit-*` and `x-ratelimit-*` headers as rate-limit
    headroom; plus Duniya's spend through the account this month (usage table).
- R3 One snapshot per account (in memory + a `ttl_state` row, written at most once a minute from headers). No new
  timers: headers update it on every answer; endpoints are read when Models opens (TTL 10 min; a stale reading refreshes
  in the background, the first one is awaited; `refresh=1` forces)
  and on the existing upkeep tick (one account per tick, each every 30 min, skipped while memory is tight or the
  account is paused). A window whose reset passed shows as renewed (0 %).
- R4 Shown on: Models rows (tightest plan/credit limit, "62% of 5-hour limit" + 3 px meter); the provider page and each
  extra account (*Plan usage*: meters, what is left, reset time, rate-limit headroom as "% left", this month's spend,
  "Updated 3m ago"); Usage (*Plans and credit*); Overview (a note at ≥ 80 %, bad when used up).
- R5 Owner alert (owner assistant → Alerts) when a plan or credit limit reaches 90 % and when it is used up, once per
  limit, level and window (a window is known by its reset time, ±30 min; limits without one at most weekly). Rate
  limits never alert.
- R6 A quota or rate-limit failure names the plan window that is used up in the pause ("Paused until 01:00 — free
  requests today used up, resets 01:00"), in the fallback activity and in "after …" texts, and the pause lasts until that reset
  when the error has no Retry-After.
- R7 Admin MCP `list_model_accounts` returns `usage` (label, kind, percent used, left, reset ISO time, updated) and
  `spend_this_month`; the owner assistant uses it ("how much Copilot quota is left?"). Secrets never appear.

## Follow-up: ChatGPT plan usage removed (#144, v2.29.2)

#140 (v2.28.1–v2.29.1) tried `x-codex-*` headers, the `codex.rate_limits` stream event and
`chatgpt.com/backend-api/wham/usage`. Verified on a real server: the official Sign in with ChatGPT for third-party apps
gets none of them. Owner decision: remove the feature and its code.

- **FR-144-1** ChatGPT accounts show no plan limits and no "not available" note; their page keeps Duniya's own 30-day
  usage line. No request is made for ChatGPT plan usage.
- **FR-144-2** A ChatGPT usage-limit error still pauses the account until the reset the error reports and the fallback
  answers (errors.js `retryAfterMs`, breaker).
- **FR-144-3** Copilot, OpenRouter and API-key rate-limit headroom are unchanged.
