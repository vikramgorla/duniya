# Contract: Panel API additions/changes (005)

Auth now uses user accounts. Role gates: **viewer** = GET only; **admin** = everything except `/api/users*`;
**owner** = everything. 403 `{error}` when the role is insufficient.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/session` | | `{ authed, user?: {username, role}, needsSetup }` |
| POST | `/api/setup` | `{ code, username, password }` | creates first owner, signs in; 403 bad code; 409 already set up |
| POST | `/api/login` | `{ username, password }` (username optional → `admin`) | `{ ok, user }` |
| POST | `/api/password` | `{ current, next }` | own password; other sessions of this user end |
| GET | `/api/users` | | `[{ id, username, email, role, createdAt }]` (owner) |
| POST | `/api/users` | `{ username, email?, role, password }` | user (owner) |
| PUT | `/api/users/:id` | `{ role?, password?, disabled? }` | user (owner); last owner protected |
| DELETE | `/api/users/:id` | | `{ ok }` (owner; not last owner) |
| GET | `/api/templates` | | `[{ id, name, description }]` |
| GET | `/api/bots` | | `BotView[]` |
| POST | `/api/bots` | `{ id?, template?, config? }` | `BotView` (201) |
| GET | `/api/bots/:id` | | `BotView` with full config |
| PUT | `/api/bots/:id` | full or partial config | `BotView`; 400 with `{error, field}` |
| DELETE | `/api/bots/:id` | | `{ ok }` |
| POST | `/api/bots/:id/duplicate` | `{ id? }` | `BotView` |
| GET | `/api/bots/:id/export` | | bot JSON file (`application/json`, no secret values) |
| POST | `/api/bots/import` | bot JSON | `BotView` (bindings cleared) |
| POST | `/api/bots/:id/discover` | `{ server }` or `{ url, token }` | `[{ name, description }]` |
| GET | `/api/plugins` | | `[{ name, tools[] }]` |
| GET/PUT | `/api/secrets` | unchanged | values never returned; stored encrypted |

`BotView` = `{ id, name, description, enabled, config, needs: [missing secrets], updatedAt }`.
