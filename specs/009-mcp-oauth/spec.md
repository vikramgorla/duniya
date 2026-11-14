# Feature Specification: Sign in to Tool Services with OAuth

**Feature Branch**: `009-mcp-oauth`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "MCP is asking for a secret; we have to support OAuth when the MCP server supports
OAuth. The panduga one does."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a tool service by signing in (Priority: P1)

An admin adds a tool service (MCP server) to a bot by entering its URL. The panel checks the server and, when it
supports OAuth, switches the service to **Sign in**. For each role (organizers, participants) the admin clicks
**Connect**, signs in on the service's own page and is brought back to the bot, which now shows the role as
connected. No secret is pasted.

**Why this priority**: panduga.ch only offers OAuth for third-party apps; without this the bot cannot reach it.

**Independent Test**: add an OAuth MCP server, connect the organizer role, discover tools, run a tool from the
test console.

**Acceptance Scenarios**:

1. **Given** a URL whose server answers 401 with OAuth protected-resource metadata, **When** the admin checks it,
   **Then** the service is set to Sign in, and a URL that permanently redirects is replaced by its final URL.
2. **Given** a Sign-in service, **When** the admin clicks Connect for organizers and approves on the service,
   **Then** the panel shows "Connected" with who connected it and when, and tools can be discovered and used.
3. **Given** the admin cancels on the service's page or the link is older than 10 minutes, **Then** nothing is
   stored and the panel says the sign-in did not complete.

---

### User Story 2 - Stay signed in (Priority: P1)

Access tokens expire. The bot refreshes them on its own. When the service refuses the refresh (revoked, expired),
the bot replies that the tool service needs to be reconnected, the panel shows the role as "Reconnect needed", and
the activity log records it.

**Independent Test**: expire the access token on a fake server, call a tool, see a new token used; then refuse
refresh and see the reconnect state.

---

### User Story 3 - Roles and least privilege (Priority: P2)

Organizers and participants can be connected with different accounts. When participants are not connected,
participant messages use the organizer's sign-in, limited to the tools ticked for participants (as with tokens
today). Disconnecting a role deletes its stored tokens.

## Requirements *(mandatory)*

- **FR-001**: Each tool service has an authentication mode: `oauth` (sign in), `token` (secret reference, existing
  behaviour) or `none`.
- **FR-002**: The panel MUST detect OAuth support from the server's 401 response and protected-resource metadata
  (RFC 9728) and follow permanent redirects of the URL.
- **FR-003**: Sign-in MUST use the MCP authorization flow: authorization-server discovery (RFC 8414), dynamic
  client registration (RFC 7591) when no client is known, authorization code with PKCE S256, `state` checked,
  the `resource` parameter, and the scopes the server advertises (including `offline_access` when offered).
- **FR-004**: The redirect URI is the panel's own address (`/oauth/mcp/callback`) as the admin's browser sees it,
  so it works for IP, domain and tunnel exposure.
- **FR-005**: Tokens and client registrations MUST be stored encrypted (master key), per tenant, bot, service and
  role; they MUST NOT appear in bot exports, the API or logs. They are included in encrypted backups.
- **FR-006**: Pending sign-ins are single-use and expire after 10 minutes; only admins can start one.
- **FR-007**: Tokens are refreshed automatically; a failed refresh marks the connection "reconnect needed",
  logs it, and the bot tells the user the service is unavailable rather than failing silently.
- **FR-008**: Changing a service's URL invalidates its connections; deleting a bot deletes them.
- **FR-009**: Per-role tool allowlists and the confirm gate apply unchanged to Sign-in services.

## Success Criteria

- **SC-001**: An admin connects panduga.ch to a bot from an iPad without copying any value.
- **SC-002**: A bot keeps working across token expiry without admin action while the service allows refresh.
