# Plan 051

- `deploy/ops/duniya-ops`: version line; `os_update [phased]` (update → `dpkg --configure -a` → full-upgrade →
  autoremove --purge → clean) with `NEEDRESTART_MODE=l`, `ionice`/`nice`, `== step:` markers, memory note;
  `os-update-all` action; test overrides `DUNIYA_OPS_APT_GET`, `DUNIYA_OPS_DPKG`, `DUNIYA_REBOOT_REQUIRED_FILE`.
- `deploy/duniya`: `refresh_helper` after `update` (rc 0 or already up to date) — git check as the app user, copy
  only files that differ, daemon-reload.
- `src/core/system.js`: pure `parseAptLists`, `parseAptSimulation`, `parseAptPolicy`, `classifyUpdates`,
  `parseAptRun`, `runSummaryText`; `osUpdates()` groups + `count`; `osUpdatesCached()`; `rebootStatus()`;
  `opsHelperVersion()`; `opsStatus()` gains `result`, `reboot`, `helperVersion`, `helperCurrent`; background check
  (5 min after start, then every 12 h); `DUNIYA_FAKE_APT` for tests and the demo.
- `src/panel/server.js`: `/api/status` → `osUpdates { count, security, at, restart }` for admins/owners.
- `src/core/weekly.js`: `restart` (> 7 days) → one *Needs you* item.
- Panel (`index.html`): tab badge, restart banner, grouped `<details>`, result line, *Include gradual updates now*,
  old-helper note.
- Admin MCP tools; docs (backups-and-updates, upgrading, admin-mcp, cli, owner-assistant), website text + shots.
- Tests: `test/os-updates.test.js` with fixtures in `test/fixtures/apt/` (owner's output included) and the helper
  with stubbed apt-get/dpkg. Small servers: no new dependencies; apt runs in the root helper, not the app.
