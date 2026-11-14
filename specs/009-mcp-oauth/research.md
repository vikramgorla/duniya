# Research: MCP OAuth

- panduga.ch (2026-11-14): `POST https://www.panduga.ch/mcp` → 401 with
  `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`; metadata lists
  authorization server `https://www.panduga.ch`, scopes `panduga offline_access`; AS supports dynamic
  registration, PKCE S256, public clients (`none`), refresh tokens. `https://panduga.ch/mcp` 301-redirects to
  `www` — a POST would be turned into a GET, so the probe follows the redirect and stores the final URL.
- MCP SDK 1.32 `auth()` implements discovery, registration, PKCE, `resource`, refresh; the transport calls it on
  401. Decision: use it rather than hand-roll.
- The session cookie is `SameSite=Strict`, so it is not sent on the cross-site redirect back from the service.
  Decision: the callback is authorised by the single-use `state` (bound to the admin who started it) and returns
  a small page that navigates to the panel with script (same-site, cookie sent).
- Redirect URI from the request (`Host`, `X-Forwarded-Proto` when TRUST_PROXY) — matches what the browser uses.
