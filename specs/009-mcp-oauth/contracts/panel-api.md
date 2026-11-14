# Panel API additions

- `POST /api/bots/:id/probe` `{url}` → `{url, auth: "oauth"|"token"|"none", name?}` (admin)
- `GET /api/bots/:id/connections` → `[{server, role, status, connectedBy, connectedAt}]` (viewer)
- `POST /api/bots/:id/connections/:server/:role` → `{authorizeUrl}` (admin; bot must be saved with `auth: oauth`)
- `DELETE /api/bots/:id/connections/:server/:role` (admin)
- `GET /oauth/mcp/callback?code&state` (public; state-checked) → HTML that returns to `#bots/<id>`
