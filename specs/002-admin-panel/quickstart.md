# Quickstart: Admin Panel

## Automated

`npm test` → the panel test checks: 401 without login, wrong password 401, login cookie, status, CSRF guard (415),
bot edit with phone normalisation, non-editable field rejected, secrets never returned, chats with binding,
activity contains tool calls and confirmations, memory endpoints (feature 004), page served.

## Manual (phone)

1. Start locally (`ADMIN_PASSWORD=dev-password-123 npm start`) or open the tunnel hostname.
2. Sign in; wrong password 6× → "Too many attempts".
3. Overview: QR visible when unlinked; Pause all → bots stop; per-bot toggles.
4. Activity: send a message in a bound group → entries appear live; tap one for details.
5. Bots: edit organizers (any phone format) → saved as digits; invalid schedule time → error.
6. Test console: ask as participant and organizer; nothing posted to WhatsApp.
7. Secrets: add/remove; values never displayed.
8. Settings: change password → signed out.
9. Update from GitHub: with a new commit on `main`, version changes after restart.
