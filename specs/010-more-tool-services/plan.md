# Implementation Plan: More Ways to Connect Tool Services

`src/core/mcp-local.js` (spec validation, npm install, scrubbed launch); `src/core/mcp.js` (stdio transport via the
SDK's `StdioClientTransport`, extra headers); `src/core/schema.js` (type/local/headers/oauthClient);
`src/core/mcp-oauth.js` (fixed client: no registration, `client_secret_basic` when a secret is set);
`src/panel/server.js` (owner guard on create/update/import/duplicate, install/status routes);
`src/panel/public/index.html` (type selector, local fields, headers, own OAuth app with redirect URL to copy);
Dockerfile adds git (GitHub specs). Constitution 1.2.0 adds "Local Tool Services".

Constitution check: III least privilege — per-role allowlists unchanged; local services are owner-only and run with
a scrubbed environment. VII secrets — env/header values reference Secrets; never returned.

Known limit: local services run as the app's OS user and can read its data directory; a separate OS user would
need root-level setup and is left for later.
