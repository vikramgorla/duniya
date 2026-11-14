# Quickstart: Bots, Users and Secrets Managed in the App

## Automated

`npm test` → `test/app.test.js` covers: setup code flow, roles (viewer blocked on every mutating route, admin
blocked from users, last owner protected), bot create from template / edit / validation error / duplicate /
export (no secret values) / import (bindings cleared) / delete, tool discovery, secrets encrypted at rest, legacy
migration (folders + overrides + secrets.json → tables, once).

## Manual

1. Fresh start without `ADMIN_PASSWORD`: log shows `Setup code: XXXXXXXXXX`; open the panel → setup screen.
2. Bots → New bot → Event assistant (panduga.ch) → fill secrets → Discover tools → tick → Save.
3. Chats → bind the group → ask a question in WhatsApp.
4. Settings → Users → add a viewer; sign in as viewer; Save buttons fail with "read-only".
5. Export the bot, import it → new bot "…-copy" without bindings.
