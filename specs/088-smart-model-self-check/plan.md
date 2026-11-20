# 088 · Plan

- `src/core/smart-model.js`: settings, `tierModels`, `strongRef`, rules (`ruleTier`), `chooseTier` (classifier).
- `src/core/fact-check.js`: `checkFacts(reply, sources, { extra, today })`, `amountsIn`.
- `src/core/runner.js`: tier per turn, light → strong escalation, turn cost, `selfCheck()`, Activity detail.
- `src/core/providers/index.js`: `chat()` returns `cost`; `refCost(ref, in, out)` (set or published price).
- `src/core/usage.js`: `smart_turns` table (+ index on ts), `recordSmartTurn`, `smartReport`; retention prunes it.
- Schema: `model: 'smart'`, `modelTiers { light, strong }`, `selfCheck`; chat prefs accept `smart`.
- Panel: agent Model section, Models → Smart choice, Usage card, Activity notes; routes `/api/usage/smart`, models.
- Admin MCP: `set_default_models` (+light/strong/classifier), `get_smart_model_savings`.
- Small servers: rules are regexes; at most one classifier call per unsure turn; no timers; `smart_turns` is one row per
  answer, pruned with usage detail; its report reads by the ts index (period-bounded).
- No new dependencies.
