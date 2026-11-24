# Implementation Plan: Automatic OS updates

**Spec**: [spec.md](spec.md) · **Issue**: #307 · **Version**: 2.63.0 (minor)

## Technical approach
- `src/core/updates.js`: `os` in the update settings (default `auto`, validated).
- `src/core/os-auto.js` (new): `osAutoState()` (on, window from–until) and `osAutoTick(now)`: window = app update time
  + 30 min for 180 min on the owner's clock (`owner-clock.js`), night key = the owner's date when the window opened
  (kv `os:autoInstall`, `os:autoRestart`); refreshes `osUpdates()`, requests `os-update` when updates wait, then
  `reboot` when `rebootStatus().required`.
- `src/core/system.js`: `opsRunning()` shared by `requestOp` and the round (one way to ask "is the helper busy").
- `src/core/update-decision.js`: `updateTick` calls `osAutoTick` (the existing 10-minute round, systemd only).
- `GET /api/system/ops` adds `auto`; the switch uses the existing `PUT /api/updates/settings`.
- Panel `server.js`: switch row on the OS updates card. Admin MCP `set_os_auto_updates` (risky when switching on).

## Definition of Done plan
| Item | Plan |
|---|---|
| Tests | `test/os-auto.test.js`: default, window, once a night, busy, off, midnight, admin MCP (fake helper dirs, fake apt) |
| Checks | test, lint, typecheck, check:panel, check:clean, check:responsive, ci-checks |
| Docs | backups-and-updates.md (In 30 seconds, OS updates), install.md, deploy guides, admin-mcp.md |
| Website | Backups & updates section and the Linux FAQ; server screenshots retaken |
| Admin MCP | `set_os_auto_updates`, `get_maintenance_status → auto` |
| Small servers | one apt simulation per night (already done twice a day); install runs at low priority in the helper |
| Version | 2.63.0, releases.json entry |
