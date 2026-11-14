# Specification Quality Checklist: 019 Sign in with Google, GitHub App Backups, Download/Upload Restore

**Created**: 2026-11-14 · **Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Focused on user value and owner needs
- [x] Written for non-technical stakeholders (stories), technical details kept to FRs/plan
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (owner decision on Google: both linking and invites)
- [x] Requirements are testable; each story has acceptance scenarios covered by test/signin-backups.test.js
- [x] Edge cases identified (duplicate emails, hostname change, missing GitHub fields, uninstalled app)
- [x] Dependencies and assumptions identified (Google console steps, no email sending)

## Security

- [x] Secrets (Google client secret, GitHub App key) encrypted and never returned
- [x] PKCE, state, nonce, browser binding, email_verified required
- [x] Session cookie stays SameSite=Strict; only the upload route accepts non-JSON, with header + Origin checks
- [x] First-run restore requires the setup code and no existing accounts

## Experience (DESIGN.md)

- [x] Plain-language steps with deep links and copy buttons
- [x] One clear state per thing (pills: on / not set up / almost there / invite pending)
- [x] Progress for uploads, restores, GitHub installation
- [x] Destructive actions confirm with the consequence
- [x] Checked in light and dark, phone and iPad
