# Feature Specification: Automatic Provider Fallback and Several Accounts per Provider

**Feature Branch**: `feat/43-fallback` (issue #43)

**Created**: 2026-11-15

**Status**: Implemented (v2.5.0)

**Input**: Owner question (#43): "Does the app fall back to another provider when one fails or runs out of quota? Can
people add more than one account of the same provider to pool quota?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep answering when a model fails (Priority: P1)

An agent uses Claude. Anthropic answers 429 "rate limited" (or the ChatGPT plan reports its usage limit, or the
provider is down). Instead of failing, the agent answers with the next model of the fallback chain, in the same turn.

**Acceptance Scenarios**:

1. **Given** fallback on (default) and the chosen model fails with a retryable error, **Then** the next candidate
   answers: the same model on the provider's other accounts, then the chain (default: every other connected
   account's Auto, in the order of the Models page).
2. **Given** a refused request (400/422, content policy), **Then** no other provider is asked and the error is
   handled as before. A "model not found" moves on to the next candidate without pausing the account.
3. **Given** a model call fails after tools already ran in this turn, **Then** the next provider receives the whole
   conversation including the tool results; no tool runs twice and the reply is sent once, after the turn.
4. Usage and Activity record the account and model that actually answered and why it switched; the test console shows
   "Answered by X after Y failed (usage limit)".

### User Story 2 - Paused accounts are skipped and come back (Priority: P1)

A failing account is paused: 1 minute, doubling up to 30 minutes; for quota and rate limits until the provider's
Retry-After / reset time (at most 24 h before a probe). While paused it is skipped; afterwards one call probes it and
success closes the pause. A rejected key or expired sign-in shows "reconnect this account" until the credentials change.
Models shows "Paused until 14:20 — usage limit reached" with **Try again now**. When an account stays failing for more
than 15 minutes, or no provider can answer, the owner gets one WhatsApp alert (once per episode / at most hourly).

### User Story 3 - Several accounts per provider (Priority: P2)

The owner connects a second OpenAI key ("OpenAI — work"), a second ChatGPT sign-in ("ChatGPT — Sam"), another Copilot
token or another OpenRouter key, each with a label. Per provider: **In order** (failover, default) or **Spread**
(least recently used first). The panel says: use your own accounts; some plans' terms forbid sharing accounts or
getting around their limits. Usage groups by provider and by account.

### User Story 4 - Overrides (Priority: P2)

On an agent: "When the model is unavailable: Use the Models setting / Switch to another model / Don't switch", and
optionally an own list of models. Per chat the same (mode in the Chats table; chain via API / AI assistant). The most
specific setting wins (chat > agent > global).

### Edge Cases

- Every candidate paused: accounts paused for a transient error (outage, network, timeout) are tried once anyway as
  a last resort; accounts paused for limits, quota or sign-in stay paused and the agent explains it is unavailable.
- Fallback off still lets the provider's other accounts answer the same model (it never changes the model).
- Within one turn the account that answered stays first (stateful Copilot sessions continue).
- The Test button addresses one account directly: no fallback, ignores pauses, success clears the pause.
- Background summaries and the AI helper use the same fallback.
- Pauses live in memory: a restart probes every account again.

## Requirements *(mandatory)*

- **FR-001** Accounts: stable ids; the first account of a type keeps the type id (`anthropic`, `openai`, `chatgpt`,
  `copilot`, `openrouter`), others get `<type>-<label>`. Model refs are `account:model` / `account:auto` / `auto`.
  OpenAI-compatible endpoints with the same base URL count as one provider.
- **FR-002** Error classes (`errors.js`): rate_limit, quota, server, network, timeout, auth → next + pause;
  model_not_found, unavailable → next; bad_request → stop.
- **FR-003** Breaker per account (`breaker.js`) with activity entries on pause/recovery, deduplicated switch entries
  (per from → to + reason, 15 min) and owner alerts.
- **FR-004** Settings: `fallback` { enabled, chain }, `accountStrategy` { [provider]: order | spread }, `accounts`;
  agent field `fallback` { mode, chain }; chat prefs `fallback`.
- **FR-005** API: `GET|PUT /api/fallback`, `PUT /api/fallback/strategy`, `POST /api/accounts`, `PUT /api/accounts/:id`,
  `PUT /api/accounts/:id/key`, `DELETE /api/accounts/:id` (owner), `POST /api/accounts/:id/retry`; `label` / `account`
  on the ChatGPT, Copilot and OpenRouter routes; `/api/providers` rows carry `health`, `group`, `strategy`.
- **FR-006** Usage: columns `account`, `fallback`; groupings `account`, `fallback`.
- **FR-007** Admin MCP tools: `list_model_accounts`, `get_model_fallback`, `set_model_fallback`,
  `set_account_strategy`, `retry_model_account`; `set_chat_settings` takes fallback.
- **FR-008** Panel: Models (health, accounts, strategy, terms note, "When a model fails"), agent page, Chats, Usage,
  test console; DESIGN.md phone rules.

## Success Criteria

- A provider limit or outage no longer silences an agent while another provider is connected.
- No duplicate replies or tool runs because of a fallback.
- `test/fallback.test.js` covers chain order, no retry on 400, model-not-found, breaker cooldown/doubling/recovery,
  reconnect, no double tool execution, failover/spread across accounts, overrides, alerts.
