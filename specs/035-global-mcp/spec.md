# Feature Specification: Global Tool Services, and Bots Become Agents

**Feature Branch**: `feat/7-global-mcp-agents` (issue #7)

**Created**: 2026-11-15

**Status**: Implemented (v2.0.0)

**Input**: Owner request (#7): "Global MCP servers for all agents; rename bots → agents everywhere, including code."
Clarified by the owner: no backward-compatibility layers or migrations for old data — single-owner deployments
reinstall from scratch; legacy migration code that only existed for old data is removed where safe.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A tool service for every agent (Priority: P1)

An admin opens **Settings → Tool services**, adds a service once (URL → Check → token or Sign in, or a local npm/GitHub
package for the owner), discovers its tools and ticks the **default** tools per role. Every agent can use it right away,
without copying the service into each agent.

**Acceptance Scenarios**:

1. **Given** a global service with defaults "organizers: all tools, participants: `agenda_*`", **When** any agent answers
   an organizer, **Then** the model is offered all its tools; for a participant only `agenda_*`.
2. **Given** an agent whose role rules contain explicit `<service>:` entries, **Then** those replace the defaults for
   that role (`<service>:-` = none); the agent's deny list always wins; the confirm tool is never offered.
3. **Given** an agent's confirmation settings point at a global service (`svc:*_preview`, `svc:confirm`), **Then**
   previews are held and an organizer's `confirm CODE` applies the change through the global service.
4. **Given** a viewer, **Then** they can see global services but not change them.

### User Story 2 - Opt out per agent (Priority: P1)

In the agent editor, **Tool services → Global tool services** lists each global service with **Use in this agent** and
**Choose tools for this agent** (writes explicit rules) / **Use the global defaults**.

**Acceptance Scenarios**:

1. **Given** an agent that switched a service off, **Then** none of its tools are offered to that agent, and the
   service's card in Settings shows the agent under "switched off in".
2. **Given** an agent with its **own** service of the same name, **Then** the agent's own service replaces the global
   one for that agent (shown as "replaced by own service").
3. **Given** a global service is removed, **Then** its sign-ins are deleted and the agents' opt-outs for that name are
   forgotten.

### User Story 3 - Sign in once per service (Priority: P1)

A global service that uses OAuth is connected once per role (organizer, participant) in Settings. All agents use that
sign-in; it is not per agent. The callback returns to Settings.

### User Story 4 - Local global services stay owner-only (Priority: P1)

Adding, changing, removing or installing a **local** global service is owner-only (constitution: Local Tool Services).
An admin cannot turn a local service into a remote one or the reverse.

### User Story 5 - Manage it from an AI assistant (Priority: P2)

The admin MCP has `list_global_tool_services`, `add_global_tool_service` and `remove_global_tool_service`; adding and
removing are risky (preview + `confirm_action`), and run the same routes and role gates as the panel.

### User Story 6 - One word: agents (Priority: P1)

Everything that was a "bot" is an "agent": panel text and hash routes (`#agents`), API (`/api/agents`), database tables
and columns, settings (`defaultDmAgent`, per-number `dmAgent`), activity types (`agent.created`, …), admin MCP tools
(`create_agent`, `agent_id`, …), export format (`duniya-agent`), templates, docs, tests and the mobile app.

**Acceptance Scenarios**:

1. **Given** a fresh 2.0 install, **Then** no "bot" wording remains in the UI, API, admin tools or docs (WhatsApp's own
   concepts aside).
2. **Given** a 1.x backup, **When** it is restored, **Then** it is refused with a plain message (no migration).

## Requirements *(mandatory)*

- **FR-001**: Global services are stored in `global_mcp (tenant_id, name, config, …)`; `config` is a tool service
  definition (same validation as an agent's `mcpServers.<key>`) plus `defaults: { organizer: [globs], participant:
  [globs] }` (tool-name globs; default organizers `*`, participants none).
- **FR-002**: Service names: `[a-z][a-z0-9_]{0,30}`, not `local`, `memory`, `contacts` or `whatsapp` (built-in rule
  prefixes; also enforced for an agent's own services).
- **FR-003**: Effective services of an agent = global services not in `globalMcp.disabled` and not shadowed by an own
  service of the same name, plus its own services.
- **FR-004**: Per role, a global service's allow rules are the role's explicit `<name>:` rules if any, else its defaults;
  the agent's deny list and confirm tool exclusion apply as for own services. Services with nothing allowed for the
  role are not contacted.
- **FR-005**: Connections: local global services run one process for all agents (`local:*:<name>`); OAuth sign-ins are
  stored in `mcp_oauth` with `agent_id = '*'`, per service and role.
- **FR-006**: Routes (same shape as the agent's): `GET/PUT/DELETE /api/tool-services[/:name]`, `POST
  /api/tool-services/probe`, `POST /api/tool-services/discover`, `GET /api/tool-services/local`, `POST
  /api/tool-services/local/:server/install` (owner), `GET /api/tool-services/connections`, `POST/DELETE
  /api/tool-services/connections/:server/:role`. Reads: viewer; changes: admin; local: owner.
- **FR-007**: Secrets referenced by global services appear under Secrets as used; values are never returned.
- **FR-008**: Every change is recorded in the activity log (constitution V).
- **FR-009**: Agent config gains `globalMcp: { disabled: [names] }`; the AI helper knows global services and may set it.
- **FR-010**: Rename bots → agents everywhere (US6). `src/core/bots.js` → `agents.js`; the agent turn loop moves from
  `agent.js` to `runner.js` to avoid two near-identical file names.
- **FR-011**: No migrations: 1.x tables, settings keys, exports (`duniya-bot`) and backups (bundle version 1) are not
  read. Removed: pre-005 file-bot / `secrets.json` / `settings.json` import, `extraPrompt` and single `token` config
  fields, `ALTER TABLE` column migrations (folded into `CREATE TABLE`), the one-time "chats are off" notice.

## Success Criteria

- **SC-001**: A service added once in Settings is usable by all agents with no per-agent step.
- **SC-002**: Tool permissions for global services are enforced in code, with tests for defaults, explicit rules,
  deny, opt-out, shadowing, confirmation, OAuth per service and owner-only local services.
