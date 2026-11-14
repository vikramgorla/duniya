# Feature Specification: More Ways to Connect Tool Services

**Feature Branch**: `010-more-tool-services`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "Will it only support OAuth or any mode supported by MCP? — Yes [add the missing ones],
and local ones too, if that means downloading something from npm or GitHub to run locally on the server."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Local tool service from npm or GitHub (Priority: P1)

The owner adds a tool service of type Local, enters a package (`@scope/server@1.2.3` or `github:owner/repo#tag`),
optional arguments and environment (values may reference Secrets), and clicks Install. The panel shows the installed
name and version. Discover tools and per-role ticks work as for remote services. The panel warns that the package
runs on the server with the app's access.

**Acceptance Scenarios**:

1. **Given** an admin (not owner), **When** they add or change a local service or click Install, **Then** it is
   refused; they can still edit the rest of the bot.
2. **Given** a package spec that is not a plain npm name/version or `github:owner/repo#ref`, **Then** it is rejected.
3. **Given** an installed package, **When** a tool runs, **Then** the process gets only PATH, network settings and
   the configured env — not the app's secrets or settings.
4. **Given** a package not yet installed (e.g. after a restore), **When** it is first used, **Then** it installs.

### User Story 2 - Custom headers (Priority: P2)

A remote service that wants a key in its own header (e.g. `X-API-Key`) gets extra headers, with values from Secrets.
Headers the app manages (Authorization, Content-Type, MCP session headers…) are refused.

### User Story 3 - Your own OAuth app (Priority: P2)

For services that do not allow automatic app registration, the admin enters a client ID (and a client secret as a
Secret reference) and registers the shown redirect URL with the service. Sign-in then uses that app; no registration
is attempted; the secret is sent to the token endpoint as the service requires.

## Requirements *(mandatory)*

- **FR-001**: `mcpServers.<key>.type`: `remote` (default) or `local`.
- **FR-002**: Local: `package`, `args`, `env`, `allowScripts` (npm install scripts, default off). Installed under
  `DATA_DIR/mcp-local/<hash>` with `--ignore-scripts` unless allowed; name and version recorded and shown.
- **FR-003**: Only the owner role may add, change or install local services (constitution: Local Tool Services).
- **FR-004**: Local processes run over stdio with a scrubbed environment; stderr tail is included in errors.
- **FR-005**: Remote: `headers` map (validated names, reserved names refused, values may use Secrets).
- **FR-006**: Remote OAuth: optional `oauthClient { id, secret }`; with it, no dynamic registration.

## Also fixed in this release (reported while testing v1.1.0)

- Auto model choice now uses any connected provider (ChatGPT-only setups showed "No model available").
- The Updates card shows the running version after an update (it showed the pre-update check), with one clear
  state line, a progress state while installing, and no stray "null" text.
