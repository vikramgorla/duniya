# Plan 053

- `src/core/agents.js`: drop `loadPlugin`, `listPlugins`, `hooksFor`, the plugin cache; `toRuntime` is synchronous
  config + id; `agentView` without `localTools` / `missingPlugins`. `src/core/config.js`: drop `PLUGINS_DIR`.
- `src/core/router.js`: role from `resolveRole` only; no hook reply. `src/core/tools.js`: no hook tools.
- `src/core/schema.js`: no `plugins` default or validation; `REMOVED_FIELDS` keeps old saved configs quiet.
- `src/core/ai-builder.js`: no `plugins` in editable fields, guide or context. `src/panel/server.js`: no
  `/api/plugins`; duplicate no longer strips `hooks`. `src/panel/routes/insights.js`: "Built-in" label.
- Panel `index.html`: field, FIELD_LABEL, AI section, list helper renamed `names` (used for global services).
- Mobile: types, demo data, agent screen, AI review helper.
- `Dockerfile`, `AGENTS.md` architecture map, constitution 1.4.1, `docs/agents.md`, `docs/architecture.md` + diagram.
- Constitution check: principle II tightened (no per-agent code); no violations.
