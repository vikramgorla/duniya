# Feature Specification: Manage the App from AI Assistants (Admin MCP Server)

**Feature Branch**: `017-admin-mcp`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: Owner: "Everything doable in the panel should also be doable from AI assistants (ChatGPT, Claude, …) via
MCP." Decisions: OAuth 2.1 with the app as authorization and resource server; consent page in the panel's design;
tokens act as the approving panel user with the same role gates; risky actions need a confirm step; every call logged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect ChatGPT or Claude (Priority: P1)

An owner opens **Settings → Connected AI assistants**, copies the address `https://HOST/mcp`, and adds it in ChatGPT
(developer-mode connector) or Claude (custom connector). The assistant opens a Duniya page; the owner signs in (the
panel's SameSite cookie is not sent on that cross-site redirect, so the page first reloads itself, then shows a
sign-in form if needed), sees the assistant's name, where it returns to and what it may do, and clicks **Approve**.

**Why this priority**: without the connection nothing else works.

**Independent Test**: register a client, authorize with a logged-in session, exchange the code with PKCE.

**Acceptance Scenarios**:

1. **Given** no panel session, **When** the consent link opens, **Then** a sign-in form in the panel design is shown;
   after signing in the consent screen appears.
2. **Given** a session, **When** the owner approves, **Then** the browser returns to the assistant with a single-use
   code that only that assistant, with the matching PKCE verifier and redirect URI, can exchange.
3. **Given** the owner clicks Deny, **Then** the assistant gets `access_denied` and nothing is stored.
4. **Given** a redirect URI the assistant did not register, **Then** the page shows an error and never redirects.

### User Story 2 - Read and change things by chatting (Priority: P1)

The assistant lists bots, chats, activity (filtered by bot or chat), models, secrets (names only), pending
confirmations, updates, server metrics, backups, users and WhatsApp numbers, and can change them: create / update /
enable / duplicate / export bots, assign chats, set chat model and logging, rebuild summaries, set default models,
cancel pending changes, run schedules, send test messages, check updates, run backups, add users and numbers, pause
all bots, change logging settings.

**Acceptance Scenarios**:

1. **Given** an owner's assistant, **When** it calls `set_bot_enabled`, **Then** the bot is disabled exactly as from
   the panel and the activity log shows `mcp.call` with the user and assistant name.
2. **Given** a viewer's assistant, **Then** it only sees read tools, and a write call is refused ("Read-only").
3. **Given** an admin's assistant, **Then** owner-only tools (users, backups, updates, numbers, maintenance) are hidden
   and refused.

### User Story 3 - Risky actions need a second step (Priority: P1)

Deleting a bot, erasing chat memory, setting/removing a secret, removing a user or WhatsApp number, applying an update,
restarting, maintenance actions and restoring a backup first return a plain-language preview with the consequence and a
`confirm_code`. Only `confirm_action({ confirm_code })` carries it out. Codes are single-use, expire after 10 minutes and
are bound to the user, the assistant and the exact arguments.

**Acceptance Scenarios**:

1. **Given** `delete_bot`, **Then** nothing is deleted until `confirm_action` is called with the code; a second use fails.
2. **Given** another user's code, **Then** `confirm_action` refuses it.
3. **Given** `set_secret`, **Then** the preview and the activity log never contain the value.

### User Story 4 - Stay in control (Priority: P2)

Access tokens last 1 hour, refresh tokens 30 days and rotate on every use; reusing an old refresh token revokes the whole
sign-in. Each user sees their connected assistants in Settings and can disconnect them; owners see and disconnect
everyone's. Disabling or deleting a user stops their assistants immediately. 60 calls per minute per token.

**Acceptance Scenarios**:

1. **Given** a refresh, **Then** a new refresh token is issued and the old one, if used again, revokes all tokens of
   that sign-in and logs it.
2. **Given** Disconnect in Settings or a call to the revocation endpoint, **Then** the token stops working at once.
3. **Given** a disabled user, **Then** their tokens get 401 and refreshes fail.

### Edge Cases

- The panel is opened on `http://127.0.0.1` (SSH tunnel): the card warns that assistants need the public https address.
- A token issued for `https://a/mcp` is presented to the server under another host: 401 (audience binding).
- Too many registrations from one address (registration is unauthenticated): 429; old unused registrations are pruned.
- A role is lowered after approval: the next call uses the new role (role is read on every call).
- Restart loses pending authorization and confirm codes (both short-lived, in memory): the user starts again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Serve RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-protected-resource/mcp`, and RFC 8414 metadata at `/.well-known/oauth-authorization-server`.
- **FR-002**: RFC 7591 dynamic registration of public clients (`token_endpoint_auth_method: none`); redirect URIs must
  be https or http on localhost/127.0.0.1/[::1], without fragments.
- **FR-003**: Authorization code flow with PKCE S256 only; exact redirect URI match at token exchange; codes single-use,
  5 minutes.
- **FR-004**: RFC 8707 `resource` (the app's `/mcp` URL) is bound into codes and tokens and checked on every call.
- **FR-005**: Opaque tokens stored as sha256 hashes with user, client, resource, expiry; refresh rotation with reuse
  detection; RFC 7009 revocation endpoint.
- **FR-006**: `/mcp` without a valid token answers 401 with `WWW-Authenticate: Bearer resource_metadata="…"`.
- **FR-007**: `/mcp` is Streamable HTTP (stateless, JSON responses) via the MCP SDK; GET/DELETE answer 405.
- **FR-008**: Base URL = `PUBLIC_URL` if set, otherwise `Host` + scheme (`X-Forwarded-Proto` only with `TRUST_PROXY`).
- **FR-009**: Consent page in the panel design, with sign-in when there is no session; shows client name, redirect
  host and abilities by role; Approve / Deny; CSRF-protected; not frameable.
- **FR-010**: Every tool runs the panel's own route handler as the approving user, with the panel's role gate; tools a
  role cannot use are not listed.
- **FR-011**: Risky tools return a preview + `confirm_code`; `confirm_action` executes it (single-use, 10 minutes, bound
  to user + assistant + arguments hash).
- **FR-012**: Each tool call is logged as `mcp.call` (category "AI assistants (MCP)") with user and assistant; secret
  arguments are masked; grants and revocations are logged as `config`; risky previews and confirmations as
  `confirm.created` / `confirm.applied`.
- **FR-013**: 60 MCP requests per minute per token.
- **FR-014**: Settings card "Connected AI assistants": MCP address with Copy, steps for ChatGPT and Claude, abilities,
  list of connected assistants with Disconnect.
- **FR-015**: CORS (`*`, no cookies) only for `/mcp`, the metadata, token, registration and revocation endpoints.
- **FR-016**: Secret values are never returned by any tool; QR codes are not exposed.

### Key Entities

- **Assistant client**: registered app (id, name, redirect URIs).
- **Grant**: user + client approval, listed and revocable in Settings.
- **Token**: hashed access/refresh token in a family (one sign-in).
- **Confirm code**: pending risky action.

## Success Criteria *(mandatory)*

- **SC-001**: A non-technical owner connects ChatGPT or Claude in under 2 minutes using only the Settings card.
- **SC-002**: No action is possible over MCP that the same user cannot do in the panel (tests for viewer and admin).
- **SC-003**: No risky action runs without `confirm_action` (tested).
- **SC-004**: All existing tests keep passing; new e2e tests cover metadata, registration, consent, PKCE, resource
  binding, tools, roles, confirm, refresh rotation/reuse, revocation and disabled users.
