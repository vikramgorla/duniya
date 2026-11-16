# Feature Specification: 060 secret-free owner assistant (one-time links)

**Issue**: #121 · **Status**: implemented · **Version**: 2.21.0

## Why

The owner assistant (044, 059) runs every admin MCP tool except the three that take secret values: `set_secret`
(value), `add_user` (password) and `restore_backup` (passphrase). A secret typed in WhatsApp stays in the chat and goes
to the model provider, and an AI assistant using the admin MCP sees it too. The owner wants all three from WhatsApp
and from AI assistants, without a secret ever passing through a chat or a model.

## User stories

1. **Secret entry link** — "set the OpenAI key" (WhatsApp, Ask box or an AI assistant) returns a one-time link. The
   owner opens it, signs in to the panel if needed, pastes the key and saves. The chat says "Saved OPENAI_API_KEY"
   without the value. The link works once, for 15 minutes, only for a signed-in owner or admin.
2. **Sign-up link** — "add Anu as an admin" creates the user without a password and returns a one-time sign-up link
   (48 hours). Anu opens it, chooses her own password and is signed in. The owner never knows the password.
3. **Restore with the stored passphrase** — "restore last night's backup" previews the restore (with the backup's
   date) and asks for the confirm code; the server's stored backup passphrase opens it. A backup that does not open
   with it (made elsewhere, older passphrase) is not offered: the answer links to the panel's Backups page.
4. **No secrets in chat** — a WhatsApp message (or Ask box question) that looks like a key or password is answered
   without AI: not stored, not sent to a model, not logged; the reply says to delete it and to ask for a link.

## Requirements

- FR-1 One mechanism for one-time links (`src/core/one-time-links.js`): 256-bit random token, only its SHA-256 is
  stored (`ttl_state`, encrypted data, expiry), single use, no timers (expired rows swept by the TTL store).
- FR-2 Links put the token in the URL fragment (`/#secret=…`, `/#signup=…`) so it never reaches server or proxy logs.
- FR-3 Secret entry: `POST /api/secret-links` (admin) for a secret name or an API-key model account; the page calls
  `GET`/`POST /api/secret-links/:token` with a panel session (admin+, not the mobile token). The value is saved through
  the existing routes (`PUT /api/secrets`, `PUT /api/accounts/:id/key`), so validation and logging stay one way.
  When asked from the owner assistant in WhatsApp, "saved" is sent to the asker's own owner-assistant chat.
- FR-4 Sign-up: `POST /api/users` without a password creates the user without one and returns a sign-up link (owner,
  password sign-in must be on, as today). `POST /api/users/:id/signup-link` makes a new link (older ones stop
  working). Public `GET`/`POST /api/signup/:token` (rate limited) sets the password and signs the person in. A
  disabled or deleted user's link does nothing.
- FR-5 Restore: `POST /api/backups/restore` without a passphrase uses the stored one; `check: true` opens the backup
  without restoring (for the preview). A backup that does not open answers with the Backups page link.
- FR-6 Admin tools: `set_secret` { name | account } returns a link (no `value` any more); `add_user` has no
  password and returns the sign-up link; new `send_signup_link` (risky); `restore_backup` has no passphrase. The
  owner assistant drops its secret-argument exclusion; a test keeps every admin tool free of secret arguments.
- FR-7 The owner assistant shows links verbatim (appended when the model's text lacks them; confirm replies carry
  them outside the clipped result).

## Out of scope

- Google invites (019) stay as they are (email-based; the sign-up link is for password accounts).
- Upload restores still need the passphrase in the panel when the file comes from another server.
