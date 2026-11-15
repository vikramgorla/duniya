# Tasks: Only allow Sign in with Google

- [X] T001 `passwordLoginAllowed`, `googleOnlyState`, `setGoogleOnly` in src/core/google-signin.js
- [X] T002 `GET/PUT /api/auth/signin` (owner) in src/panel/routes/google.js
- [X] T003 Refuse password login (403 + activity), password users, Google unlink while active
- [X] T004 MCP authorize page: hide the password form, show Sign in with Google, refuse `action=login`
- [X] T005 Auto-reset when Google sign-in is turned off or removed
- [X] T006 `/api/session.passwordLogin`; Google-only login page with recovery hint
- [X] T007 Settings → Sign-in card (state, switch, reason, who loses access, recovery command); hide "add user with password"
- [X] T008 CLI `enable-password-login` (029)
- [X] T009 Tests in test/cli-signin.test.js
- [ ] T010 Manual check of the card and login page on a phone/iPad in light and dark mode (pending on a live server)
