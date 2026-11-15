# Implementation Plan: Local tool services and Small server mode on small servers

**Spec**: [spec.md](spec.md) · **Issue**: #106 · **Release**: v2.17.0 (minor, together with 056)

## Design

- `src/core/resources.js` — `smallServerMode()` (server setting, one-time carry-over of the old speech switch),
  `setSmallServerMode()`, `smallServerCheck()`, `SMALL_MODE_HINT`; `localEngineCheck` message names the switch;
  `heavyCheck` explains why the switch does not cover Copilot; `onMemoryPressure()` listeners.
- `src/core/mcp-local.js` — `localServiceCheck()`, `addedLocalServices()`, `guardLocalSmall()`; `installPackage`
  refuses.
- `src/core/agents.js`, `global-mcp.js` — guard after validation (covers panel, import, duplicate, registry, admin
  MCP, owner assistant). `ai-builder.js` unchanged (it never adds local services).
- `src/core/tools.js` — `serverConnection` does not start a local service when refused (one activity line).
- `src/core/mcp.js` — no start while memory is tight on a small server; `stopLocalServices()` on pressure.
- `src/panel/server.js` — `code` in error answers; `/api/server/small-mode`; `server.smallMode` in status; `blocked`
  in local lists. `routes/tool-services.js` — `blocked`.
- `src/panel/public/index.html` — Settings → **Server** card (`#small-mode`), local service editor note
  (`#local-blocked`), Local option disabled when refused, Photos & voice links to the switch, size note wording.
- `src/panel/admin-tools.js` — `set_small_server_mode` (risky), registry tool description.
- Demo: the small demo has the switch on; `check-responsive.mjs` states `settings-small-mode`,
  `agent-local-blocked`; `site-shots.mjs` card `card-small-mode`.

No new dependencies, no new tables (one settings key).

## Constitution Check

- Permissions in code: the switch is owner-only (route role + admin MCP confirm); local services stay owner-only.
- Small servers: default stays safe (off); with the switch on, the existing caps plus stop-on-pressure.
- No secrets or message contents involved.

## Complexity Tracking

None.
