# Implementation Plan: Only allow Sign in with Google

**Branch**: `feat/i4-infra-signin` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

## Summary
A settings flag `googleOnly` plus `passwordLoginAllowed()`/`googleOnlyState()`/`setGoogleOnly()` in
`src/core/google-signin.js`. Enforcement at every password entry point (`src/panel/server.js` login + users,
`src/panel/admin-mcp.js` authorize, `src/panel/routes/google.js` unlink). UI card + Google-only login page in
`src/panel/public/index.html`. Recovery through the CLI (029).

## Technical Context
Node 22 ESM, no new dependencies. Storage: `settings.googleOnly` (boolean). Tests: `test/cli-signin.test.js`.

## Constitution Check
| Principle | Check | Status |
|---|---|---|
| III. Least privilege in code | enforced server-side on every password path, owner-only setting | PASS |
| V. Observable | changes and refused password sign-ins logged | PASS |
| VII. Spec + tests | this folder; e2e tests with the harness and the real CLI | PASS |
| VIII. Experience first | disabled switch says why; confirmation names who loses access; recovery command shown on card and login page | PASS |
| Security | cannot lock out: requires the owner's own Google link, auto-reverts when Google is not ready, CLI recovery | PASS |

## Design decisions
- The rule is *effective* only while Google sign-in is ready, so a broken Google setup never locks everyone out.
- Password *changes* by signed-in users stay allowed (harmless, and a fallback once passwords are back).
- The first-run setup (`/api/setup`) is unaffected: it only works with zero users, when the flag cannot be on.
