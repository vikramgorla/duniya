# Implementation Plan: Sign in to Tool Services with OAuth

**Branch**: `009-mcp-oauth` | **Spec**: [spec.md](spec.md)

## Summary

Use the MCP SDK's OAuth client (`auth()` + `OAuthClientProvider`, already a dependency) with a provider backed by
an encrypted `mcp_oauth` table. The panel starts the flow, the browser returns to `/oauth/mcp/callback`, the
server exchanges the code. At runtime the Streamable HTTP transport gets the provider as `authProvider`, which
adds the bearer token and refreshes it on 401.

## Constitution Check

- II Generic core: no service-specific code; detection is standards-based. ✔
- III Least privilege: per-role connections; allowlists unchanged; participants fall back to organizer sign-in
  only with participant tools. ✔
- IV Confirm gate unchanged. ✔  V Connect/disconnect/refresh failures are logged. ✔
- VII Secrets encrypted at rest, never returned by the API. ✔

## Structure

- `src/core/mcp-oauth.js` — table, provider, start/finish/status/disconnect, probe.
- `src/core/mcp.js` — connections accept an `authProvider`; pool key includes the connection identity.
- `src/core/tools.js` — choose token / OAuth connection per role.
- `src/core/schema.js` — `auth` field.
- `src/panel/server.js` — probe, connect, disconnect, connections, public callback.
- `src/panel/public/index.html` — auth selector, Check, per-role Connect/Reconnect/Disconnect.
- `templates/event-assistant-panduga.json` — `https://www.panduga.ch/mcp`, `auth: oauth`.
- `test/mcp-oauth.test.js` — fake authorization server + protected MCP server.
