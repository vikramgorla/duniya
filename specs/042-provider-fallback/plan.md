# Implementation Plan: Provider Fallback and Several Accounts

**Spec**: [spec.md](spec.md) · **Issue**: #43 · **Release**: v2.5.0

## Design

- `src/core/providers/index.js` — account registry (`providers()` lists accounts: built-in types with extra accounts
  from the `accounts` setting, then endpoints), `secretFor(type, id)` (first accounts keep `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `CHATGPT_CREDENTIALS`, `COPILOT_GITHUB_TOKEN`; others `PROVIDER_<ID>_KEY|_CREDENTIALS`),
  `addAccount/renameAccount/removeAccount`, strategies, `fallbackSettings/effectiveFallback`, `planCandidates()`
  (chosen model → siblings by strategy → chain; sticky ref first) and `chat()` (lazy Auto resolution per candidate,
  breaker checks, classification, last-resort pass for transient pauses, usage with account + reason).
- `src/core/providers/errors.js` — `classify(e)`, `retryAfterMs(e)` (Retry-After header, body reset fields, "try again
  in 20s").
- `src/core/providers/breaker.js` — states in memory, mirrored to `ttl_state` via `src/core/ttl-store.js` (#64; `loadStored()` at start), `canTry/isPaused/release/recordFailure/recordSuccess/reset`,
  status text, alerts via `owner-alerts.js`, `noteSwitch` deduplication; injectable clock for tests.
- `src/core/providers/fallback-config.js` — `cleanChain/cleanOverride` without provider imports (used by `schema.js`
  and `chat-prefs.js`).
- Adapters per account: `anthropicAdapter(secret)` (SDK `maxRetries: 0` — the chain decides), `chatgptAdapter(secret)`
  (sign-in state per secret; refused refresh → `signin_expired`), `copilotAdapter(secret)` (one runtime per token),
  OpenAI-compatible errors carry `status`, `code`, `headers`.
- `src/core/runner.js` — `effectiveFallback(agent, chat prefs)` and a `turn` object per agent turn; `ctx.fallback`,
  `ctx.answeredBy`; friendly text for "all failed/paused".
- `src/core/usage.js`, `src/core/chat-prefs.js` — added columns (`ALTER TABLE … ADD COLUMN` when missing, so in-place
  updates keep data).
- Panel routes `src/panel/routes/providers.js`; admin tools; `index.html` (`chainEditor`, `fallbackPicker`,
  `accountsBox`, `healthNote`, `chatgptFlow`); demo data shows a second ChatGPT account and a paused OpenRouter.

## Constitution Check

- II generic core: no agent-specific logic. III/IV: tool permissions and confirmations unchanged; tools never re-run.
- V: pauses, recoveries, switches and all-failed are recorded in Activity (system category, always visible at minimal).
- VI: no new dependencies; breaker mirrored to SQLite (#64); two small columns. VIII: plain-language states, one status per account,
  "Try again now", terms note; responsive check passes at 375 / 1440, light and dark.
- Security: account credentials are secrets, never returned; Anthropic via API keys only; ChatGPT via the official
  sign-in flow; the panel tells owners to use their own accounts and check the provider's terms.

## Complexity Tracking

None.
