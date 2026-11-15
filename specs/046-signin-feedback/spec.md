# Spec 046: Sign-in feedback (#77)

Owner feedback after 2.9.x: four sign-in and docs problems.

## User stories

1. **No 1.x guidance (P3).** Nobody runs 1.x: docs no longer explain upgrading from 1.x or 1.x backups. The backup
   format check stays (old bundles are refused with a plain message).
2. **ChatGPT paste on iPad (P1).** *Given* Safari copied the failed loopback address without `http://`, *when* the
   owner pastes it, *then* sign-in completes. Also accepted: `localhost` / `127.0.0.1` / `[::1]`, any port, spaces,
   quotes, line breaks, only the query string, percent-encoded once, wrapped in another address. The state check is
   unchanged; a paste without a code does not use up the sign-in.
3. **Google origins (P1).** Authorized JavaScript origins are shown and copied as `URL.origin` (no trailing slash, no
   path); redirect URIs keep `/auth/google/callback`. The setup card lists a pair for every panel address.
4. **Domain change with Google sign-in (P1).**
   - FR-1 A Google sign-in uses the redirect URI of the address it starts on when that host is one of the panel's own
     addresses (PUBLIC_URL host, applied host + aliases, the new/old host of an added or confirmed switch); otherwise
     the main address. Only the Host header is read; never X-Forwarded-Host. The callback exchanges the code with
     the redirect URI stored with the state.
   - FR-2 Settings → Web address & access shows, while a switch is in progress and Google sign-in is set up, a callout
     with the new origin and redirect URI (copy buttons), a link to Google Cloud credentials, and what happens until
     they are added; the add and confirm dialogs mention it.
   - FR-3 A failed callback caused by addresses (Google `redirect_uri_mismatch`, started at another known address,
     missing or mismatched binding cookie) shows a page in the panel's style: what happened, the origins and
     redirect URIs of every panel address with copy buttons, the Google Cloud link, and safe links only (relative,
     or a known panel address). Google-only mode: the CLI recovery `sudo duniya enable-password-login`.
   - Security: state, PKCE, binding cookie, nonce and ID-token checks unchanged; untrusted input is never reflected
     as HTML; unknown hosts are neither shown nor linked.
