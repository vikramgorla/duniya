# Research: Admin MCP Server

## MCP authorization spec (2025-06-18)

- Server is an OAuth 2.1 resource server; MUST publish RFC 9728 metadata and point to it from
  `WWW-Authenticate: Bearer resource_metadata="…"` on 401. Clients try `/.well-known/oauth-protected-resource/<path>`
  then the root; we serve both.
- Clients discover the authorization server with RFC 8414 (`/.well-known/oauth-authorization-server` for an issuer
  without path) and SHOULD use dynamic registration (RFC 7591). PKCE is mandatory; clients send `resource` (RFC 8707)
  in both authorization and token requests; servers must validate the audience.
- Decision: issuer = base URL, endpoints under `/oauth/*`, scope `duniya` (one scope; permissions come from the panel
  role, not from scopes). `iss` returned on the redirect (RFC 9207).

## Clients

- ChatGPT developer-mode connectors and Claude custom connectors both do discovery + DCR + PKCE and use https redirect
  URIs on their own domains; desktop clients use loopback http. Some registrations ask for `client_secret_post`;
  RFC 7591 lets the server answer with the method it supports, so we always answer `none` (public client).
- Verified compatibility by driving the flow with the SDK's own client helpers (`discoverOAuthProtectedResourceMetadata`,
  `discoverAuthorizationServerMetadata`, `registerClient`, `startAuthorization`, `exchangeAuthorization`,
  `refreshAuthorization`) in the e2e test.

## SameSite=Strict session on the consent page

The redirect from the assistant is a cross-site navigation, so the panel cookie is not sent. A same-origin reload
(`location.replace(… + "&_s=1")`) is same-site and carries the cookie; if there is still no session, the page shows a
sign-in form that POSTs same-origin, creates the normal panel session and renders the consent. Approve requires the
session (a cross-site POST cannot carry it) and a CSRF token derived from it. The consent page's CSP allows
`form-action` to the client's redirect origin, because Chrome applies `form-action` to the redirect after submit.

## Tools: in-process route handlers vs. core functions

Alternatives: (a) call core functions directly from each tool, (b) call the panel over HTTP, (c) run the route handler
in-process. (a) duplicates validation and role gates (e.g. `guardLocal`, owner-only routes) and drifts; (b) needs a
cookie/session and costs a socket. Chosen (c): `invoke(user, method, path, body)` matches the route, applies the same
role check and calls the handler with a minimal request/response; the minimum role of a tool is derived from the routes
it uses, so tool visibility follows the panel automatically.

## Stateless transport

Stateless `StreamableHTTPServerTransport` with JSON responses: no session map, nothing to clean up, fine on 1 GB.
GET (server-initiated SSE) and DELETE (session end) are not needed: 405 with `Allow: POST`.

## Tokens

Opaque 256-bit random strings; only sha256 stored. Refresh rotation per OAuth 2.1 §4.3.1 for public clients; reuse of a
rotated token revokes the family (all tokens from that approval). Access tokens: 1 h. Codes and confirm codes are kept
in memory (minutes-long, lost on restart by design).
