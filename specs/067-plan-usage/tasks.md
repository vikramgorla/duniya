# Tasks: 067 Plan usage everywhere

- [x] T001 Audit (demo panel, code); verify the Codex header names in `openai/codex`
- [x] T002 `plan-usage.js`: parsers, snapshot store, view, alerts, warnings, exhausted
- [x] T003 Adapters return headers (Anthropic, Chat Completions, ChatGPT + `codex.rate_limits` event)
- [x] T004 `providers/index.js`: note headers on answers and failures; breaker limit text and reset; `status()` usage + spend; endpoint refresh with TTL; `planUsageTick()`; forget on credential change/removal
- [x] T005 Copilot `planLimits()` (copilot_internal/user, runtime fallback); OpenRouter `openRouterLimits()`
- [x] T006 Upkeep tick; `/api/status` plans; admin MCP `list_model_accounts`
- [x] T007 Panel `plans.js`: list row, provider page and extra accounts, Usage card, Overview note
- [x] T008 Demo data; responsive states `models-rate-limits`, `models-plan-used-up`
- [x] T009 Tests with fakes (`test/plan-usage.test.js`, harness headers, Copilot setup test)

## Definition of Done

- [x] T100 Docs: `docs/models.md#plan-usage`, `admin-mcp.md`, `owner-assistant.md`, `spending.md`, `DESIGN.md` meters, README, website tile
- [x] T101 Website screenshots retaken (`npm run site:shots`) and checked
- [x] T102 Version 2.28.0 in three files (minor: a feature)
- [x] T103 `releases.json` entry with changes
- [x] T104 `npm test`, lint, typecheck, `check:panel`, `check:responsive`, `ci-checks.mjs`
- [x] T105 PR via REST, required checks green, squash merge
- [x] T106 Issue done comment and close with the release

## Follow-up #140 (v2.28.1)

- [x] T140-1 `chatgpt.planLimits()` + `parseWhamUsage()` (Codex payload), all Codex header families, newest source wins
- [x] T140-2 ChatGPT in the endpoint refresh (Models 10 min, tick 30 min, refused: 24 h); `usageUnavailable` row flag
- [x] T140-3 Panel muted line; admin MCP `usage_note`
- [x] T140-4 Tests with a fake usage endpoint (ok, 401/403/404, 5xx, garbage); harness and demo never reach chatgpt.com
- [x] T140-5 Docs `models.md#plan-usage`, `admin-mcp.md`; version 2.28.1 + `releases.json`

## Follow-up #144 (v2.29.2): ChatGPT plan usage removed

- [x] T144-1 Delete the ChatGPT usage reader, Codex headers/event parsing, `unavailable` mechanism, `usage_note`, muted line
- [x] T144-2 Tests: ChatGPT shows no usage and pauses until the reported reset; alert/pause/Overview/admin via OpenRouter
- [x] T144-3 Demo without ChatGPT meters; `card-plan-usage` shot from OpenRouter; Models shots retaken
- [x] T144-4 Docs (`models.md`, `admin-mcp.md`, `owner-assistant.md`, `spending.md`), README, website; version 2.29.2 + `releases.json`

## Removal #146 (v2.29.3): plan usage removed for every provider

- [x] T146-1 Delete `plan-usage.js`, `plans.js`; header plumbing (Anthropic, Chat Completions, ChatGPT), Copilot `copilot_internal/user` and runtime quota, OpenRouter `/key` and `/credits`, the upkeep tick and the Models-open refresh, the `limit` text in pauses and fallbacks, per-account spend
- [x] T146-2 Panel: Models row meters and *Plan usage*, Usage *Plans and credit*, Overview hint, styles; budgets lowered
- [x] T146-3 Admin MCP `list_model_accounts` back to health only; tests: the ChatGPT usage-limit pause kept (`test/usage-limit.test.js`)
- [x] T146-4 Demo, shots (`card-plan-usage` gone; Models, Usage, Overview retaken), docs, README, website, DESIGN.md; version 2.29.3 + `releases.json`
