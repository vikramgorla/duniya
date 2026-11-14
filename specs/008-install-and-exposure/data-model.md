# Data Model: Install, Exposure, Updates

## Setting `updates`

`{ mode: "off" | "notify" | "auto", channel: "stable" | "main", at: "04:00" }` (default notify/stable/04:00)

## kv `updates:status`

`{ current: "v1.2.0" | "<sha>", latest: "v1.3.0" | "<sha>", available: bool, checkedAt, lastResult?: { at, ok, log } }`

## Installer config (on the server)

`/etc/duniya/app.env`: `NODE_ENV, DATA_DIR, PANEL_HOST, PANEL_PORT, ADMIN_PASSWORD?, TRUST_PROXY, PUBLIC_URL, DUNIYA_INSTALL=systemd`
`/etc/duniya/install.conf`: chosen exposure, domain, repo, branch (for re-runs).
