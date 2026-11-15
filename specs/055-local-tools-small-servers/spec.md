# Feature Specification: Local tool services and Small server mode on small servers

**Feature**: 055-local-tools-small-servers · **Issue**: #106 · **Release**: v2.17.0 · **Status**: implemented

## Goal

Small servers (1 GB / 1 CPU, `serverSize().size === 'small'`) behave the same on every path: a local (on-server,
command-based) tool service is refused everywhere with one clear message, not only in the MCP Registry browser (052).
The owner can still allow heavier features with **one** server-wide switch, **Small server mode**, that every
small-server refusal consults the same way.

## User stories

1. **Same refusal everywhere (P1)** — On a small server, adding or changing a local tool service is refused in the
   agent editor, Settings → Tool services, Browse tool services, agent import and duplicate, and through the admin MCP
   tools / owner assistant (same API), with the message *This is a small server (… MB memory, 1 CPU): local tool
   services are not run here, because each one is an extra Node.js process. Use a hosted tool service (one with a web
   address) instead, or switch on Small server mode in Settings → Server.* (HTTP 400, `code: small_server`).
2. **Already configured (P1)** — Local services saved before (bigger server, older version, backup) stay in the
   configuration, are not started, and do not break the agent: tools are listed without them, the reason is recorded
   with the tool errors and once in the activity log, the agent editor shows *Not started on this server* with the
   reason, Install is refused. Other edits of that agent still save; removing the service always works.
3. **Small server mode (P1)** — Owner switches **Settings → Server → Small server mode: allow heavier features on this
   server**. With it on, small servers allow on-server speech (its existing guards stay) and local tool services
   (at most `maxLocalServices().small` = 2 at once, started on first use, stopped when memory is tight, not started
   while it is tight). Shown in `/api/status` (`server.smallMode`).
4. **Copilot stays refused (P2)** — `heavyCheck` (Copilot SDK, ~400 MB download + helper inside the service's 700 MB
   cap) is refused below 2 GB even with the switch; the message says the switch does not cover it.
5. **Assistants (P2)** — admin MCP `set_small_server_mode` (risky: preview + confirm), refusals reach them unchanged.

## Requirements

- **FR-001** `localServiceCheck()` (mcp-local.js) is the one rule; `localRegistryCheck` is the same function.
- **FR-002** `guardLocalSmall(before, after)` refuses only new or changed local services (package, args, env,
  allowScripts); called in `createAgent`, `updateAgent` and `saveGlobalServer`, so every API path is covered.
- **FR-003** `installPackage` refuses on small servers without the switch; `serverConnection` throws for a local
  service instead of starting it; `/api/agents/:id/local` and `/api/tool-services/local` carry `blocked`.
- **FR-004** `smallServerCheck({ what, alternative })` (resources.js) is the shared gate; `smallServerMode()` reads the
  server setting `smallServerMode`; when it was never set, the old `media.local.smallServer` is read once and saved
  as the new setting. The Photos & voice toggle is replaced by a link.
- **FR-005** `GET /api/server/small-mode` (what it covers / does not cover), `PUT` owner only, activity entry.
- **FR-006** Memory pressure on a small server stops running local services (`onMemoryPressure` listener); starting
  one while memory is tight is refused with a clear error.
- **FR-007** Every refusal message the switch can lift ends with *…or switch on Small server mode in Settings →
  Server*.

## Out of scope

Running local services in a separate memory-limited cgroup; allowing Copilot on 1 GB.
