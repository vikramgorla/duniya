# Data Model: Native Mobile App

## Server (SQLite, existing tables from spec 017)

| Table | Change |
| --- | --- |
| `admin_oauth_clients` | Row `duniya-mobile` seeded at start (`name` "Duniya mobile app", `redirect_uris` `["duniya://oauth"]`); upserted so name/redirects stay current; never pruned by the unused-client cleanup. |
| `admin_oauth_grants` | Unchanged; one grant per (user, `duniya-mobile`) — all phones of a user share it, so "Sign out" in the panel signs out all of that user's phones. |
| `admin_oauth_tokens` | Unchanged; tokens of the mobile client have `resource = <base>/api`. |
| `settings` | New key `mobile` = `{ "expoUrl": "exp://…" }` (optional). |

`listGrants()` now returns `kind: 'app' | 'assistant'`; for the phone `redirectHost` is "phone app".

## Phone (secure storage)

| Key | Value |
| --- | --- |
| `duniya.session` | JSON `{ server, accessToken, refreshToken, expiresAt }` (Keychain/Keystore, this device only) |
| `duniya.biometric` | `"1"` when the biometric lock is on |

In memory only: last good API responses per screen (offline display), demo data.
