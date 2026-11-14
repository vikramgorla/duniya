# Implementation Plan: Admin MCP Server

**Branch**: `017-admin-mcp` | **Spec**: [spec.md](spec.md)

## Summary

Add an OAuth 2.1 authorization server (`src/core/admin-oauth.js`, SQLite tables + in-memory codes) and an MCP endpoint
(`src/panel/admin-mcp.js`) to the existing panel HTTP server. MCP tools (`src/panel/admin-tools.js`) do not duplicate
panel logic: each runs the panel's route handler in-process (`invoke`) as the token's user, so validation, role gates
and activity logging are identical to the panel. A dispatcher hook in `startPanel` hands the OAuth/MCP paths to the
module before route matching; existing routes keep their JSON-only and CSP behaviour.

## Technical Context

Node 22 ESM, `node:sqlite`, `@modelcontextprotocol/sdk` 1.32 (already a dependency: low-level `Server` +
`StreamableHTTPServerTransport`, stateless, `enableJsonResponse`). No new dependencies. Memory: one `Server` +
transport per request, freed on response close; codes, confirm codes and rate-limit windows are small maps swept on use.

## Constitution Check

- **II Generic core**: nothing bot-specific; tools address bots by id. ✔
- **III Least privilege**: tokens act as the approving user; the panel's route role is enforced on every call; tools a
  role cannot use are not even listed; role and disabled state are read on every call. ✔
- **IV Human confirmation**: risky admin actions need a separate `confirm_action` with a single-use, expiring code bound
  to user + assistant + arguments; destructive tools carry `destructiveHint` so assistants ask the user. The bots'
  own confirm gate is unchanged. ✔ (Note: the code is visible to the assistant by design — the human approves in the
  assistant's UI; this is the owner's chosen pattern for admin actions, not the bot confirm gate.)
- **V Observable**: `mcp.call` for every call (new category), `config` for grants/revocations/reuse, `confirm.*` for
  risky actions (always recorded). ✔
- **VI 1 GB VM**: stateless, no new deps, bounded maps. ✔
- **VII Spec + tests with fakes**: `test/admin-mcp.test.js` uses the SDK's own OAuth client helpers and MCP client
  against the real server. ✔
- **VIII Experience First**: Settings card with copy button and step lists; consent page in DESIGN.md style; warning
  when the panel is not on public https. Checked light/dark, phone/desktop with headless Chrome. ✔
- Security constraints: secrets never returned (tools use the panel's names-only routes; secret args masked in logs);
  consent page has CSP `frame-ancestors 'none'`, CSRF token, SameSite=Strict session.

## Structure

- `src/core/admin-oauth.js` — clients, grants, tokens (hashed), codes, refresh rotation, revocation, confirm codes.
- `src/panel/admin-mcp.js` — metadata, register, authorize (consent/login page), token, revoke, `/mcp`, CORS, rate
  limit, Settings API routes (`/api/assistants`).
- `src/panel/admin-tools.js` — tool catalogue (name, description, JSON schema, routes used, risky preview).
- `src/panel/http-util.js` — `clientIp`, `isHttps`, `cookie` moved out of `server.js`; `baseUrl`, `minuteLimiter`.
- `src/panel/server.js` — `invoke` / `routeRole`, dispatcher hook.
- `src/core/events.js` — category `mcp`; `src/core/db.js` — activity filter by chat; `src/core/store.js` —
  `onUserDeleted` (clean grants: SQLite may reuse a deleted user's id).
- `src/panel/public/index.html` — Settings card.

## Complexity Tracking

None.
