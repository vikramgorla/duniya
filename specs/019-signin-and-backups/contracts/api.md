# Contract: 019 routes

## Sign in with Google (owner unless noted)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/auth/google` | | `{ clientId, enabled, secretSet, ready, lastTest, origin, redirectUri, warnings: [{kind: ip\|https, text}] }` |
| PUT | `/api/auth/google` | `{ clientId?, clientSecret?, enabled? }` | same as GET (400 `field` on invalid) |
| DELETE | `/api/auth/google` | | `{ ok }` |
| POST | `/api/auth/google/test` | | `{ at, ok, checks: [{ name, ok, detail }] }` |
| DELETE | `/api/me/google` (any user) | | user (400 if no password) |
| DELETE | `/api/users/:id/google` | | user |
| GET | `/api/invites` | | `{ invites: [{ id, email, role, invitedBy, expiresAt, expired }], panelUrl, googleReady }` |
| POST | `/api/invites` | `{ email, role }` | 201 invite / 409 has account / 400 `field` |
| POST | `/api/invites/:id/renew` | | invite |
| DELETE | `/api/invites/:id` | | `{ ok }` |
| GET | `/auth/google/start[?mode=link]` (public) | | 302 to Google + `duniya_oidc` Lax cookie |
| GET | `/auth/google/callback` (public) | `?code&state` | HTML result page; on login sets `duniya_session` (Strict) |
| GET | `/api/session` (public) | | adds `google: bool`; `user` adds `google`, `hasPassword` |
| POST | `/api/password` | `{ current?, next }` | `current` not needed when the user has no password |

## GitHub App (owner unless noted)

| Method | Path | Response |
|---|---|---|
| GET | `/backups/github-app/new[?org=]` | HTML page auto-posting the manifest (CSP allows form-action to GitHub) |
| GET | `/backups/github-app/callback?code&state` (public) | HTML result page |
| GET | `/backups/github-app/installed` (public) | HTML page back to `/#backups` |
| POST | `/api/backups/github-app/check` | `{ app, installed, account, repos, installUrl, newRepoUrl, repo?, enabled? }` |
| PUT | `/api/backups/github-app/repo` `{ repo }` | `{ ok, repo }` |
| DELETE | `/api/backups/github-app` | `{ ok, deleteUrl }` |
| GET | `/api/backups` | `github` adds `via: app\|token\|null`, `app: {...}`; adds `uploadMaxMb` |

## Upload / restore

Upload requests: `POST`, `content-type: application/octet-stream`, `x-duniya-upload: 1`, same-origin `Origin` (else 415),
optional `x-file-name`. Body: the `.dbk` file. Response `{ upload, size }`; 400 not a backup; 413 too large.

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/backups/upload` | owner | file | `{ upload, size }` |
| POST | `/api/backups/restore` | owner | `{ source: 'upload', upload, passphrase, name? }` | `{ ok, restarting }` / 400 |
| POST | `/api/setup/upload` | public, no users, `x-setup-code` | file | `{ upload, size }` / 403 / 409 |
| POST | `/api/setup/restore` | public, no users | `{ code, upload, passphrase, name? }` | `{ ok, restarting }` / 400 / 403 / 409 |
| GET | `/api/backups/download/:file` | owner | | encrypted file (attachment) |
