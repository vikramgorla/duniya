# Spec 067: Plan usage everywhere

Issue #135. Owner: "Wherever we can, show the usage of the plan (e.g. quota of ChatGPT if possible, same for Copilot…)".
064 built the slots (list-row meter, the provider page's *Plan usage*); only Copilot's runtime quota fed them.

## Requirements

- R1 Only what the provider reports, never an estimate; anything unknown or malformed shows nothing.
- R2 Sources:
  - ChatGPT plan: the headers of every answer and failure, `x-codex-{primary,secondary}-{used-percent,window-minutes,
    reset-at}` (Unix seconds; `reset-after-seconds` from older backends), and the `codex.rate_limits` stream event —
    names as in `openai/codex` `codex-rs/codex-api/src/rate_limits.rs`. Windows are named from their length
    ("5-hour limit", "weekly limit").
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
- R6 A quota or rate-limit failure names the plan window that is used up in the pause ("Paused until 14:20 — 5-hour
  limit used up, resets 14:20"), in the fallback activity and in "after …" texts, and the pause lasts until that reset
  when the error has no Retry-After.
- R7 Admin MCP `list_model_accounts` returns `usage` (label, kind, percent used, left, reset ISO time, updated) and
  `spend_this_month`; the owner assistant uses it ("how much ChatGPT quota is left?"). Secrets never appear.

## Follow-up: ChatGPT usage endpoint (#140, v2.28.1)

Verified on a real server: the Sign in with ChatGPT route (`POST https://api.openai.com/v1/responses`) sends no
`x-codex-*` headers and no `codex.rate_limits` event, so ChatGPT plan usage never appeared.

- **FR-140-1** ChatGPT accounts read `GET https://chatgpt.com/backend-api/wham/usage` (as OpenAI's open-source Codex:
  `codex-rs/backend-client/src/client/rate_limit_resets.rs` `rate_limit_status_url`) with `Authorization: Bearer
  <access token>`, `chatgpt-account-id` when the ID token carries one, and Duniya's own `originator` / User-Agent.
  The body (`rate_limit.primary_window|secondary_window` with `used_percent`, `limit_window_seconds`, `reset_at`,
  `reset_after_seconds`; `additional_rate_limits`) is parsed defensively; nothing is estimated.
- **FR-140-2** Read when Models opens (at most every 10 minutes) and on the upkeep tick (at most every 30 minutes); no
  new timers. A 401 / 403 / 404 records "not available for this sign-in": no numbers, no alert, no error; the ChatGPT
  page shows one muted line, `list_model_accounts` a `usage_note`; asked again after 24 hours or a new sign-in.
- **FR-140-3** Header parsing stays and accepts every Codex header family (`x-<limit>-primary-used-percent`, named by
  `x-<limit>-limit-name`); when headers and the endpoint report the same window, the newer reading wins.
