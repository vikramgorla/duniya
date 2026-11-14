# Feature Specification: Sign in with Google, One-Click GitHub App for Backups, Download/Upload Restore

**Feature Branch**: `feat/019-signin-and-backups`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: Owner request: "Sign in with Google (existing users link by email, and the owner can invite people by email +
role who then sign in with Google the first time without a password); one-click GitHub App for backups instead of an
OAuth client id we don't have; local backups you can download and restore by upload so we can move servers without
GitHub, including from the first-run screen of a fresh install."

## Clarifications

### Session 2026-11-14

- Q: Who may sign in with Google? → A: BOTH: an existing user whose email matches (linked on first use) AND anyone the
  owner invited by email + role (account created on first sign-in, no password).
- Q: Can the panel create the Google OAuth client automatically? → A: No — Google has no API to create OAuth clients
  for this (see research.md). The panel guides the owner through four steps with deep links and copy buttons.
- Q: How do invites reach people? → A: The server sends no email. The panel offers "Email" (opens the owner's mail app
  with a prefilled message), "Copy message" (for WhatsApp) and "Resend" (renews the invite for 14 days).
- Q: GitHub without an OAuth client id? → A: A GitHub App created by the owner in one click from a manifest, installed
  on one private repository. The token option stays.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set up Sign in with Google (Priority: P1)

The owner opens Settings → "Sign in with Google" and follows four numbered steps: (1) create/select a Google Cloud
project, (2) Branding + Audience (External, Testing is fine), (3) create a Web application client with the shown
JavaScript origin and redirect URI (Copy buttons), (4) paste Client ID and secret. "Save and test" checks Google
accepts them. The panel warns when the panel address is a bare IP (suggesting the sslip.io name) or not https.

**Independent Test**: paste valid credentials → status "on", test passes, the login page shows "Sign in with Google".

**Acceptance Scenarios**:

1. **Given** the panel is opened on `https://1-2-3-4.sslip.io`, **Then** step 3 shows
   `https://1-2-3-4.sslip.io` and `https://1-2-3-4.sslip.io/auth/google/callback` with Copy buttons.
2. **Given** the panel is opened on a bare IP, **Then** a warning explains Google rejects IPs and names the sslip.io host.
3. **Given** a wrong secret, **When** Test runs, **Then** it says Google did not accept the Client ID or secret.
4. The client secret is never returned by any API (stored encrypted as `GOOGLE_CLIENT_SECRET`).

---

### User Story 2 - Sign in with Google as an existing user (Priority: P1)

A user whose account email matches their verified Google email clicks "Sign in with Google" and is signed in; their
account is linked to the Google account (by Google's stable id) for next time. Signed-in users can also link
explicitly from Settings → "Your Google account" (any email) and unlink when they have a password.

**Acceptance Scenarios**:

1. **Given** user `adm` with email `Adm@Example.com`, **When** Google returns verified `adm@example.com`, **Then** `adm`
   is signed in and shows a "Google" badge.
2. **Given** a linked account, **When** the Google email later changes, **Then** sign-in still works (matched by id).
3. Unknown email, unverified email, replayed/expired state, a callback in another browser, a wrong nonce or a bad
   signature are refused with a plain message and no session.
4. A Google account cannot be linked to two users; a disabled user cannot sign in.

---

### User Story 3 - Invite someone with Google (Priority: P1)

The owner enters an email and role and clicks Invite. The invite shows "invite pending · N days left" with Email,
Copy message, Resend (14 more days) and Revoke. The invited person signs in with Google once and gets an account
(username from the email, e.g. `anu.rao`) with that role; the invite disappears.

**Acceptance Scenarios**:

1. **Given** an invite for `anu.rao+duniya@gmail.com` as viewer, **When** that Google account signs in, **Then** user
   `anu.rao` (viewer, Google, no password) exists and the invite is gone.
2. Inviting an email that already has an account is refused with a hint.
3. A revoked or expired invite no longer works.
4. A Google-only user can add a password later (fallback) without a current password.

---

### User Story 4 - One-click GitHub App for backups (Priority: P1)

On Backups → GitHub, "Create GitHub app" opens GitHub with a prefilled app (contents write, metadata read, private,
no webhook) that redirects back to the panel. Then: (a) "Create private repository" opens github.com/new with
`duniya-backup` and Private prefilled (or use an existing repo), (b) "Install the app" opens the install page. The
panel detects the installation (polling every 5 s while waiting), picks the repository automatically when it is the
only one (or lets the owner choose), and backups commit with short-lived installation tokens.

**Acceptance Scenarios**:

1. The manifest form posts to `github.com/settings/apps/new?state=…` (or an organization's page); the state is
   single-use and expires after one hour.
2. The callback exchanges the code; the private key is stored encrypted and never returned.
3. Before installation the step list shows "Install the app"; after it, "✓ Backups go to owner/repo".
4. Backups work on a freshly created empty repository (first commit created automatically).
5. The personal-token option keeps working.

---

### User Story 5 - Download a backup and restore it by upload (Priority: P1)

Backups → "On this server" lists local backups with Download, plus "Back up now & download". Restore → "A file"
uploads a `.dbk` (streamed, up to 200 MB), asks for the passphrase, stages the restore and restarts. The page explains
that the passphrase is needed on the new server.

**Acceptance Scenarios**:

1. Download is owner-only and returns the encrypted file as stored.
2. Uploads must come from the panel (custom header, same origin, octet-stream); other files, oversize files and
   wrong passphrases are refused with plain messages; a wrong passphrase can be retried without re-uploading.

---

### User Story 6 - Move to a new server from the first-run screen (Priority: P1)

On a fresh install the welcome screen offers "Restore a backup": setup code + file + passphrase → Upload and restore →
the server restarts with the old accounts, bots and WhatsApp link. Moving servers is: Download → redeploy → upload →
done.

**Acceptance Scenarios**:

1. Only possible while no account exists, and only with the one-time setup code.
2. Upload progress is shown; after restart the page returns to the sign-in screen by itself.

### Edge Cases

- Two accounts with the same email: Google sign-in by email is refused (link explicitly instead).
- The panel moves to a new hostname after restore: Google redirect URI must be added for the new host (quickstart).
- GitHub omits `slug`/`owner` in the conversion: derived from the name / left blank.
- GitHub app uninstalled: "Check" clears the installation and shows the install step again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: OIDC authorization code flow with PKCE (S256), `state`, `nonce` and a Lax browser-binding cookie;
  ID token verified (RS256 via JWKS from discovery, issuer, audience, expiry, nonce); `email_verified` required.
- **FR-002**: Session cookie (SameSite=Strict) is set in the callback response, followed by a same-origin hop page.
- **FR-003**: User resolution order: linked Google id → single unlinked account with that email → open invite.
- **FR-004**: Invites (email, role, 14-day expiry) with create, renew, revoke; accepted atomically.
- **FR-005**: Sign-ins (success and failure) are logged in the activity log; start and callback are rate limited.
- **FR-006**: GitHub App manifest flow, encrypted private key, app JWT, installation detection, cached installation
  tokens; the GitHub client accepts a token or a token provider.
- **FR-007**: Upload route type that accepts `application/octet-stream` only with `x-duniya-upload: 1` and a
  same-origin `Origin`; streamed to disk with a size limit and `DUNIYA1` check.
- **FR-008**: First-run restore guarded by "no users" + setup code.

### Key Entities

See data-model.md.

## Success Criteria *(mandatory)*

- **SC-001**: A non-technical owner sets up Google sign-in in under 10 minutes using only the panel's links.
- **SC-002**: Connecting GitHub for backups takes 3 clicks on GitHub and no copied keys.
- **SC-003**: Moving to a new server needs no shell beyond running the installer.
