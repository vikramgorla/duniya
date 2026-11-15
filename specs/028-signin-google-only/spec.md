# Feature Specification: Only allow Sign in with Google

**Feature Branch**: `feat/i4-infra-signin` | **Created**: 2026-11-15 | **Status**: Implemented | **Issue**: #4

**Input**: "Switch off password sign-in when Google sign-in is set up. Owner option: only Google sign-in. Safe recovery
via the CLI."

## User Scenarios & Testing

### Story 1 — Owner turns passwords off (P1)
The owner has set up Sign in with Google and linked their own Google account. In Settings → Sign-in they switch on
"Only allow Sign in with Google". From then on the sign-in page only offers Google.

**Acceptance**
1. Given Google sign-in is not set up, when the owner tries to switch it on, it is refused with "Set up Sign in with
   Google first".
2. Given Google works but the owner's account has no Google link, it is refused with "Link your own Google account first".
3. Given both, it switches on after a confirmation that names the accounts without a Google link (they lose access).
4. While on, `POST /api/login`, the AI-assistant (MCP) password form and creating password users refuse; existing
   sessions keep working; invites keep working (the invited person signs in with Google and gets an account).

### Story 2 — Recovery (P1)
Google stops working or the owner lost their Google account. On the server, `sudo duniya enable-password-login`
switches passwords back on; the owner signs in with the password (or resets it with `duniya reset-password`).

### Story 3 — No accidental lock-out (P2)
If Google sign-in is switched off or removed in the panel, passwords come back automatically. While only Google is
allowed, unlinking Google from an account is refused.

### Edge cases
- Google configuration becomes invalid (client id changed, secret removed): passwords are allowed again because the
  rule only applies while Google sign-in is ready.
- Users with only a password: listed on the card ("Would lose access"), so the owner can invite or link them first.

## Requirements
- **FR-001** Setting `googleOnly` (owner only, `GET/PUT /api/auth/signin`), refused unless Google is ready and the
  acting owner is linked.
- **FR-002** `passwordLoginAllowed()` = not (`googleOnly` and Google ready); `/api/session` exposes it as `passwordLogin`.
- **FR-003** When password login is not allowed: login API 403, MCP password page hidden + refused, `POST /api/users`
  400 (use invites), Google unlink 400.
- **FR-004** Turning Google off/removing it resets `googleOnly` (logged "because Sign in with Google was turned off").
- **FR-005** CLI `enable-password-login` resets it (logged "from the server command line").
- **FR-006** Every change and every refused password sign-in is in the activity log.
- **FR-007** UI: Sign-in card (state pill, switch, reason when disabled, who would lose access, recovery command);
  login page shows only "Sign in with Google" plus a collapsed "Owner locked out?" hint.

## Success Criteria
- An owner can make the panel Google-only in one tap and can always recover from the server shell.
- Covered by `test/cli-signin.test.js` (028 tests).
