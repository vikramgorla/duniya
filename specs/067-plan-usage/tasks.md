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
