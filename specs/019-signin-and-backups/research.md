# Research: 019 Sign in with Google, GitHub App backups, download/upload restore

## Google OAuth client cannot be created by API

- **Decision**: guided 4-step setup card with deep links and copy buttons.
- **Rationale**: Google offers no public API to create OAuth 2.0 web clients for a project (IAP's OAuth admin API was
  for IAP brands/clients only and is deprecated). Console pages used:
  - https://console.cloud.google.com/projectcreate
  - https://console.cloud.google.com/auth/branding
  - https://console.cloud.google.com/auth/audience
  - https://console.cloud.google.com/auth/clients/create
- Basic scopes `openid email profile` are non-sensitive: no verification needed; an External app in "Testing" works
  for them (owner research). Docs: https://support.google.com/cloud/answer/13463073 ,
  https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- Redirect URIs must use https (except localhost) and may not be raw IP addresses:
  https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation → we show the sslip.io host
  (the installer's `--ip-https` option already uses `<ip-with-dashes>.sslip.io`).
- The client secret is shown only once at creation (Google Auth Platform, 2025) → the card says so.

## OIDC with Google

- Discovery: https://accounts.google.com/.well-known/openid-configuration (authorization, token, jwks endpoints).
- Flow: https://developers.google.com/identity/openid-connect/openid-connect (code flow, `state`, `nonce`,
  `email_verified`, `sub` is the stable identifier; `iss` is `https://accounts.google.com` or `accounts.google.com`).
- PKCE S256 supported: https://developers.google.com/identity/protocols/oauth2/native-app#step1-code-verifier
- **Decision**: reuse `src/core/providers/jwt.js` (RS256 + JWKS); extended with multiple issuers, exported discovery
  and a single JWKS refetch on unknown `kid` (key rotation). `GOOGLE_OIDC_ISSUER` overrides the issuer for tests.
- **Test button**: exchanges an impossible code; Google answers `invalid_grant` for a valid client and
  `invalid_client` for wrong credentials (RFC 6749 §5.2 error codes). This proves credentials without a person signing
  in; "Link my Google account" is the full end-to-end check.

## SameSite=Strict cookie after a cross-site callback

- **Decision**: set the session cookie in the callback response, then a tiny same-origin page navigates to `/` (the
  same pattern as `/oauth/mcp/callback`). Strict cookies are stored from a cross-site response but only sent on
  same-site requests: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitesamesite-value
- The login-CSRF binding cookie `duniya_oidc` is `SameSite=Lax` (sent on the top-level GET back from Google), path
  `/auth/google`, 10 minutes.

## GitHub App manifest flow

- Docs: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
  - form POST field `manifest` to `https://github.com/settings/apps/new?state=…` (or
    `/organizations/ORG/settings/apps/new`); `url` required; omit `hook_attributes` for no webhook; `redirect_url`;
    `setup_url`; `public`; `default_permissions`.
  - exchange: `POST https://api.github.com/app-manifests/{code}/conversions` within 1 hour → `id`, `slug`, `pem`,
    `webhook_secret`, `client_id`, `client_secret`, `owner`, `html_url` (handled when missing).
- JWT + installation tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
  , https://docs.github.com/en/rest/apps/apps#list-installations-for-the-authenticated-app ,
  https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app ,
  https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation
- Prefilled repo creation: `https://github.com/new?name=duniya-backup&visibility=private&owner=@me`; install page
  `https://github.com/apps/<slug>/installations/new`.
- An empty repository answers 409 "Git Repository is empty." to Git Data API calls; the first commit is made with the
  contents API (`PUT /repos/{owner}/{repo}/contents/README.md`): https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents
- The panel CSP has `form-action 'self'`; the manifest page alone allows `form-action https://github.com`.

## Uploads

- **Decision**: a dedicated raw route type; CSRF guard = custom header (forces a CORS preflight, which the panel never
  answers) + same-origin `Origin` + `application/octet-stream`; streamed to `DATA_DIR/uploads/<id>.dbk` (0600, 1-hour
  lifetime); the passphrase goes in the following JSON request, never in a header.
- Size limit 200 MB (`BACKUP_UPLOAD_MAX_MB`). Decryption still happens in memory (existing bundle format).
