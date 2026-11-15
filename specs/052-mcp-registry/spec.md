# Feature Specification: Browse tool services (MCP Registry)

**Feature**: 052-mcp-registry · **Issue**: #99 · **Release**: v2.15.0 · **Status**: implemented

## Goal

An owner or admin finds an MCP server in the official MCP Registry (`registry.modelcontextprotocol.io`, API v0.1) from
the panel and adds it as a tool service of one agent or of all agents (035) in one step, without hunting for URLs,
package names or header formats.

## User stories

1. **Browse (P1)** — In Agents → Tool services or Settings → Tool services, **Browse tool services** opens a
   phone-friendly sheet: search by name, cards with title, publisher, version, Hosted / Local (npm) / Not supported
   here, keys needed, a trust hint and a source link (new tab). "Show more" pages through the registry cursor.
2. **Add hosted (P1)** — Add a hosted (streamable HTTP) entry: URL variables, headers and an `Authorization: Bearer`
   key become form fields; keys are stored as secrets (never returned); without declared keys the service is probed
   for OAuth (009) and gets Connect. Tools are listed right after adding.
3. **Add local (P2)** — Add an npm package that talks over stdio as a local tool service (010): owner only, refused on
   small servers, environment variables and arguments from the entry, nothing installed until the owner clicks
   **Install and list tools**.
4. **Assistants (P2)** — Admin MCP / owner assistant: `search_mcp_registry` (read) and
   `add_tool_service_from_registry` (needs confirm; keys are never passed to it).
5. **Settings (P3)** — Owner switches browsing off or sets a private registry address (https; http only on this
   machine).

## Requirements

- **FR-001** Search calls `GET {base}/v0.1/servers?search=&version=latest&limit=&cursor=`; one entry
  `GET {base}/v0.1/servers/{name}/versions/{version}`. Pagination via `metadata.nextCursor`.
- **FR-002** Normalise `server.json`: name / namespace / title / description / version / websiteUrl / repository
  (http(s) links only), remotes (type, URL, variables, headers with required/secret), packages (npm, pypi, oci, nuget,
  mcpb; runtime hint, transport, env vars and package arguments with required/secret/default/choices), `_meta`
  official status.
- **FR-003** Supported: remotes of type `streamable-http`; npm packages with `stdio` transport from the public npm
  registry whose spec the local runner accepts. Everything else is shown with "not supported here" and the reason
  (SSE-only, Python, Docker, .NET, MCPB, other npm registry, own web server).
- **FR-004** Trust hints: verified namespace (`io.github.<owner>/…` = GitHub account, reverse-DNS = domain proof),
  source linked, hosted on the publisher's domain; warnings: hosted with no source, source under another GitHub
  account, non-active status. Levels good / ok / warn.
- **FR-005** Requests only to the configured registry host (origin check), no redirects followed, no cookies or
  credentials, 8 s timeout, 1 MB answer cap, 5-minute in-memory cache of at most 50 answers.
- **FR-006** Add maps to the existing tool-service config (`validateServer`): remote `{ url, auth: none | token |
  oauth, tokens, headers }`, local `{ type: 'local', package, args, env }`. Required fields missing → 400 with the
  list. Secret fields → secrets named `<KEY>_<FIELD>`; an already stored secret is kept when left empty.
- **FR-007** Target: one agent (organizer rule `<key>:*` added, participants nothing) or all agents (defaults
  organizer `*`, participant none). Same name exists → 409 unless `replace`.
- **FR-008** After adding a hosted service without sign-in: list tools (15 s limit) with organizers on, participants
  off, risky flagged (MCP annotations, else verbs in the name). A `*_preview` + `confirm` service sets the agent's
  confirm gate when it has none (global: suggested only).
- **FR-009** Local: owner only (403), refused when the server size class is small (400, `code: small_server`).
- **FR-010** Settings `mcpRegistry: { enabled, baseUrl }`, owner only to change; off → search answers 403 and nothing
  is fetched.
- **FR-011** Admin tools: `search_mcp_registry` (readOnly), `add_tool_service_from_registry` (risky: preview + confirm;
  refuses secret values; preview lists missing secrets by name).

## Out of scope

SSE transport, Python/Docker/.NET runners, icons from the registry (no external requests from the panel), editing
tool permissions inside the sheet (done in the existing editor).
