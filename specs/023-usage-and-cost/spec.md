# Feature Specification: Usage and Cost Reporting (+ tab loading feedback)

**Feature Branch**: `023-usage-and-cost` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "Provide visibility on tokens/cost by bot, by group, by provider, by model, visible directly in sections
next to bots, groups, providers, models, but also a global reporting section." / "When I click on tabs, the tab is
selected immediately but content changes after a second with no visual feedback that content is loading."

## Requirements
- FR-001 Every model call is recorded: time, bot, chat, provider, model, kind (reply, summary, scheduled,
  ai-helper, test), input/output tokens, cost and how it was priced.
- FR-002 Costs only from prices the owner sets (USD per 1M tokens per model) or the provider publishes (OpenRouter);
  ChatGPT plan and Copilot calls are "in plan"; `:free` models cost 0; otherwise "price not set" — never guessed.
- FR-003 Usage tab: period (today, 7/30/90 days, all), totals, per-day bars, tables by bot, chat, provider, kind and
  model (with price editor for admins).
- FR-004 Inline 30-day usage on bot cards, chat rows and provider cards.
- FR-005 MCP tools `get_usage`, `set_model_price`.
- FR-006 Tabs show a loading bar and dimmed content when rendering takes >120 ms; a slower older tab can no longer
  draw over the current one.
