# Data Model: Admin Panel

| Entity | Where | Fields | Notes |
|---|---|---|---|
| Admin credential | `DATA_DIR/admin.json` (0600) or `ADMIN_PASSWORD` env | `salt`, `hash` (scrypt, 32 bytes) | file wins over env once set |
| Session | memory | token → expiry (7 days) | cleared on password change/restart |
| Login attempts | memory | ip → timestamps (1 min window) | max 5 |
| Global settings | `DATA_DIR/settings.json` | `paused` (bool), `defaultDmBot` (bot id or "") | |
| Secrets | `DATA_DIR/secrets.json` (0600) | name (`^[A-Z][A-Z0-9_]{1,63}$`) → value | values never returned |
| Bot live settings | `DATA_DIR/bots/<id>.json` | editable subset (see 001 data model) | validated, atomic write |
| Activity | sqlite `activity` | see 001 | newest 5,000 |
