# Data Model: 019

## users (changed)

| Column | Type | Notes |
|---|---|---|
| google_sub | TEXT NULL | Google `sub`; unique per tenant (`users_google_sub` partial index) |
| pw_salt/pw_hash | NULL allowed | NULL for accounts created from an invite (Google-only) |

User view adds `google` (bool) and `hasPassword` (bool).

## invites (new)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| tenant_id | TEXT | |
| email | TEXT | lower-cased; UNIQUE(tenant_id, email) |
| role | TEXT | owner/admin/viewer |
| invited_by | TEXT | username |
| created_at, renewed_at, expires_at | INTEGER ms | 14 days from create/renew |

Accepting an invite creates the user (username from the email local part, `+tag` dropped, de-duplicated with `-2`…)
and deletes the invite in one transaction.

## settings

- `googleSignin`: `{ clientId, enabled (default true), lastTest: { at, ok, checks[] } }`
- `backup.githubApp`: `{ id, slug, name, owner, htmlUrl, clientId, createdAt, installationId?, account?, repos[] }`

## secrets

- `GOOGLE_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (PEM).

## in memory

- Google pending sign-ins: state → `{ mode, userId, verifier, nonce, sha256(binding), redirectUri, expires (10 min) }`
- GitHub manifest states: state → `{ expires (1 h), by }`
- Installation token cache: `{ installationId, token, expiresAt }` (refreshed 5 min before expiry)

## files

- `DATA_DIR/uploads/<32 hex>.dbk` (0600), removed after a successful restore or after 1 hour.
