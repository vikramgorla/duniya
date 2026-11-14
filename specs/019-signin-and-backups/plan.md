# Implementation Plan: Sign in with Google, GitHub App Backups, Download/Upload Restore

**Branch**: `feat/019-signin-and-backups` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

## Summary

Google OIDC sign-in (`src/core/google-signin.js`, routes `src/panel/routes/google.js`) with linking by email/sub and
owner invites (new `invites` table, `users.google_sub`). GitHub App backups via the manifest flow (`backup/github.js`
gains app JWT, installation tokens, and a token-provider `api()`; `backup/index.js` picks the app or token). Raw upload
routes in the panel router for restore-from-file, also on the first-run screen. Shared HTTP helpers move to
`src/panel/http.js`.

## Technical Context

**Language/Version**: Node.js 22 LTS (ESM) · **Dependencies**: none new (`node:crypto`, `fetch`)

**Storage**: settings `googleSignin` `{ clientId, enabled, lastTest }`, `backup.githubApp`
`{ id, slug, name, owner, htmlUrl, clientId, createdAt, installationId, account, repos }`; secrets
`GOOGLE_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (AES-GCM with the master key); table `invites`; column
`users.google_sub` (unique per tenant); files `DATA_DIR/uploads/*.dbk`.

**Testing**: `test/signin-backups.test.js` — fake Google issuer (discovery, JWKS, token endpoint with PKCE check, test
RSA key), fake GitHub (manifest conversion, JWT-verified `/app/installations`, access tokens, empty repo + git data),
upload restore round trip and first-run restore.

**Constraints**: owner-only setup; secrets never returned; 1 GB VM (streamed uploads; decrypt in memory as before).

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| II. Generic core | No bot-specific code | PASS |
| V. Observable | sign-ins, invites, app/upload/restore events in activity | PASS |
| VI. Free tier | Google Cloud OAuth client and GitHub Apps are free | PASS |
| VII. Spec + fakes | this folder; fakes for Google and GitHub | PASS |
| VIII. Experience first | 4-step guided Google card with deep links/copy, one-click GitHub app, progress for upload/restore/installation; screens checked light/dark, phone/iPad | PASS |
| Security | Strict session cookie kept; PKCE+state+nonce+binding; JSON-only except the guarded upload route; setup code for first-run restore | PASS |

## Project Structure

```text
src/core/google-signin.js          # config, test, start/finish OIDC, user resolution
src/core/providers/jwt.js          # + oidcDiscovery, multiple issuers, kid refetch
src/core/store.js                  # + google_sub, invites, Google-only users
src/core/backup/github.js          # + token provider, manifest, app JWT, installations, empty-repo init
src/core/backup/index.js           # + githubAuth(), appInstallationToken(), restoreBuffer()
src/panel/http.js                  # shared helpers, upload receiving, setup code
src/panel/server.js                # raw routes, google routes, session.google, password for Google-only users
src/panel/routes/google.js         # /api/auth/google*, /api/invites*, /auth/google/{start,callback}
src/panel/routes/backups.js        # GitHub app routes, /api/backups/upload, /api/setup/{upload,restore}
src/panel/public/index.html        # login/setup, Settings cards, Backups cards
test/signin-backups.test.js
```

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| Raw upload route (non-JSON POST) | 200 MB files can't go through JSON/base64 | base64-in-JSON triples memory on a 1 GB VM; guarded by custom header + Origin |
