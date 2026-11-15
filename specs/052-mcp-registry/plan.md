# Implementation Plan: Browse tool services (MCP Registry)

**Spec**: [spec.md](spec.md) · **Issue**: #99 · **Release**: v2.15.0 (minor)

## Design

- `src/core/mcp-registry.js` — settings (`registrySettings`, `saveRegistrySettings`, `cleanBaseUrl`), fetch with origin
  check / no redirects / timeout / size cap / cache, `normalise()`, `publisherOf()`, trust hints, `searchRegistry()`,
  `getRegistryServer()`, `suggestKey()`, `addFields()`, `buildConfig()`, `localRegistryCheck()` (small servers),
  `isRisky()`, `confirmGateFor()`.
- `src/panel/routes/mcp-registry.js` — `GET/PUT /api/tool-services/registry/settings`, `GET /api/tool-services/registry`
  (search, admin), `GET /api/tool-services/registry/server` (entry + fields + what this user/server allows),
  `POST /api/tool-services/registry/add` (owner/small-server guards, secrets, OAuth probe, save to agent or global,
  discovery, confirm gate). Mounted from `toolServiceRoutes()` so `server.js` is unchanged.
- `src/panel/admin-tools.js` — `search_mcp_registry`, `add_tool_service_from_registry` (owner assistant gets them too).
- `src/panel/public/index.html` — `browseRegistry()` sheet (search → add form → result), `browseButton()`,
  `registrySettingsBox()`; buttons in the agent editor and Settings → Tool services; CSS `dialog.dlg.sheet` (bottom
  sheet on phones), `.reg-card`.
- `scripts/demo-panel.mjs` — offline fake registry with fictional entries; `check-responsive.mjs` states
  `registry-browse`, `registry-add`, `registry-added`; `site-shots.mjs` card `card-registry`.

No new dependencies (`fetch`). No new tables (one settings key).

## Constitution Check

- Least privilege in code: local packages owner-only and size-guarded on the server; per-role rules unchanged
  (participants get nothing by default); confirm gate kept; admin tool needs confirm_action.
- Secrets: stored encrypted with `setSecret`, config holds `${NAME}`; values never in responses, activity or admin
  tool args.
- SSRF: only the configured registry host; the base URL is https (or loopback http) and owner-set.
- Untrusted text: registry text rendered through `h()` (textContent); links only http(s), `rel=noopener noreferrer`.
- Small servers: tiny cache, no installs on add, local packages refused on small servers.

## Complexity Tracking

None.
