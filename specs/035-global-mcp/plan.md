# Implementation Plan: Global Tool Services, and Bots Become Agents

**Spec**: [spec.md](spec.md) · **Issue**: #7 · **Release**: v2.0.0 (breaking)

## Design

- `src/core/global-mcp.js` — `global_mcp` table, cached `globalServers()`, `saveGlobalServer()`,
  `removeGlobalServer()`, change listeners (the MCP connection pool resets on change).
- `src/core/schema.js` — `validateServer()` extracted from the agent validator (shared by agents and global services),
  reserved names, `validateGlobalServer()` (adds `defaults`), `globalMcp.disabled` in the agent config.
- `src/core/tools.js` — `effectiveServers(agent)`, `serverConnection(srv, { scope, key, role })` (scope = agent id or
  `'*'`), `serverAllow()` (explicit rules or defaults). `toolsFor`, `organizerConnection` and so confirmation use the
  effective services.
- `src/core/mcp-oauth.js` — `GLOBAL_SCOPE = '*'` in `agent_id`, `deleteServerConnections()`, activity wording for
  global sign-ins (no agent).
- `src/panel/routes/tool-services.js` — routes mirroring the agent's tool-service routes, owner guard for local services,
  removal cleans sign-ins and opt-outs; `globalView()` (agents using / opted out / replacing, missing secrets).
- `src/panel/admin-tools.js` — three tools (FR-006 of 017 style: same routes, risky changes).
- `src/panel/public/index.html` — the tool-service editor becomes a shared `toolServiceEditor()` used by the agent
  editor and the new **Settings → Tool services** card (first card in Settings); agent editor gets a "Global tool
  services" list (on/off, choose tools, use defaults); agent cards show global services in use.
- `src/core/ai-builder.js` — inventory includes global services and their defaults; `globalMcp` editable.
- Mobile app: renamed client/types, agent screen lists global services.

## Rename

Mechanical rename of `bot` → `agent` in code, identifiers, file names, routes, tables, settings, activity types, admin
tools, templates, docs, tests and the mobile app (specs of earlier features keep their historical wording). Tables are
created with the new names; no migration (FR-011). Backup bundle version 2; version 1 refused with a plain message.

## Constitution Check

- II Generic core: global services are data, no service-specific code.
- III Least privilege: allow rules per role still decide in code; defaults are explicit per service; deny wins; the
  confirm tool is never offered; participants use the organizer sign-in only with participant tools.
- IV Confirmation: unchanged, works through global services (test).
- V Observable: add/change/remove/sign-in/out recorded.
- VIII / DESIGN.md: plain-language card in Settings, states per service ("used by N agents", "switched off in …",
  missing secrets), destructive removal confirms with the consequence. Checked headless in Chrome at 1280 px and
  375 px (no horizontal overflow).
- Local Tool Services: owner-only for global local services too; one shared process.
- Constitution 1.3.1 (PATCH): terminology bots → agents.

## Complexity Tracking

None. Known limit: a 1.x installation that updates in place starts with no agents (old tables are ignored) — documented
in `docs/configuration.md` ("Upgrading from 1.x to 2.0").
