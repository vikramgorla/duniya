# Contracts: Mobile App ↔ Server

## OAuth (spec 017 endpoints, mobile client)

- `GET /.well-known/oauth-protected-resource/api` → `{ resource: "<base>/api", authorization_servers: ["<base>"], scopes_supported: ["duniya"], bearer_methods_supported: ["header"], resource_name, mobile_client_id: "duniya-mobile" }`
- `GET /.well-known/oauth-authorization-server` → endpoints (unchanged).
- `GET /oauth/authorize?response_type=code&client_id=duniya-mobile&redirect_uri=duniya://oauth&code_challenge=…&code_challenge_method=S256&state=…&scope=duniya&resource=<base>/api`
  - Allowed `redirect_uri`: `duniya://oauth`, or matching `^exps?://[A-Za-z0-9.-]+(:\d{1,5})?(/[A-Za-z0-9._~-]+)*/--/oauth$`.
  - `resource` other than `<base>/api` → redirect with `error=invalid_target`.
  - Consent CSP: `form-action 'self' duniya:` (or `exp:`).
  - Approve → `302 <redirect_uri>?code=…&state=…&iss=<base>`.
- `POST /oauth/token` (form): `grant_type=authorization_code&client_id=duniya-mobile&code&code_verifier&redirect_uri&resource=<base>/api`
  → `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope }`; `grant_type=refresh_token` rotates.
- `POST /oauth/revoke` (form): `token=<refresh>&client_id=duniya-mobile` → `200 {}`.

## Panel API with Bearer

Every `/api/*` route accepts `Authorization: Bearer <access token for <base>/api>`:

| Case | Response |
| --- | --- |
| valid token | as the approving user, current role; route role gates unchanged (403 `Read-only account` / `Requires <role> role`) |
| invalid / expired / revoked / other resource | `401 { error }` + `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/api", error="invalid_token"` |
| session-only route (`POST /api/password`, raw uploads) | `403 { error: "Do this in the web panel" }` |
| > 300 requests / minute / token | `429` + `Retry-After` |
| non-JSON body on POST/PUT/DELETE | `415` (unchanged CSRF guard) |

Routes the app uses: `GET /api/session`, `GET /api/status`, `POST /api/settings {paused}`, `GET /api/bots`,
`GET|PUT /api/bots/:id`, `POST /api/ai/bot-draft`, `GET /api/chats`, `POST /api/chats/bind`,
`PUT /api/chats/:chat/prefs`, `GET /api/chats/:chat/messages` (admin), `GET /api/models`, `GET /api/activity`,
`GET /api/usage?groupBy=bot|model&period=1d|7d|30d|90d`, `GET /api/system`, `GET /api/updates`,
`POST /api/updates/check|apply` (owner), `GET /api/pending`, `POST /api/pending/:code/apply`, `DELETE /api/pending/:code`.

## Settings → Mobile app

- `GET /api/mobile` (viewer) → `{ serverUrl, https, connectUrl: "duniya://connect?server=<enc base>", expoUrl, devices: Grant[], you }`
  (owners see all users' phones, others their own).
- `PUT /api/mobile { expoUrl }` (owner) → `{ expoUrl }`; `400` unless empty, `exp://…`, `exps://…` or `https://*.expo.dev|expo.io/…`.
- Sign a phone out: `DELETE /api/assistants/:userId/duniya-mobile` (existing route).
- `GET /qr.js` → the QR encoder (`DuniyaQR.encode(text, level, { mask, minVersion })`, `DuniyaQR.svgPath(qr, border)`).

## Deep links into the app

- `duniya://connect?server=<url-encoded base>` → Connect with the address filled in (also accepted by the in-app scanner,
  as is `exp://…/--/connect?server=…` and a plain https address).
- `duniya://oauth` → sign-in return (handled by expo-auth-session).
