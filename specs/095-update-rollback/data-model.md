# Data model: 095 update rollback

## Update note: `<data>/update-pending.json`

Written by `applyUpdate` after `deploy/update.sh` succeeded and the commit changed (systemd installs only). Removed
when the update holds or was rolled back.

| Field | Meaning |
|---|---|
| `from` | commit the server ran before (7–64 hex characters; checked before it reaches git) |
| `fromVersion` | its version, e.g. `v2.58.18` |
| `to` | version of the installed release (from its `package.json`), e.g. `v2.59.0` |
| `target` | what was asked for: a tag, or `main` |
| `commit` | commit of the installed release |
| `deps` | the lockfile changed in this update |
| `backup` | file name of the pre-update backup, or null |
| `at` | when the update was installed (ms) |
| `starts` | starts counted so far (0 when written) |
| `undoTries` | failed tries to put the previous release back (absent until one fails) |

## Rollback result: `<data>/update-rolled-back.json`

Written by the guard, read once and removed by the next start of the app.

| Field | Meaning |
|---|---|
| `ok` | the previous release was put back |
| `error` | why not (last 300 characters of the command's output), when `ok` is false |
| `from` | version that did not start |
| `to` | version that runs again |
| `target`, `commit` | what was rolled back (for the automatic round) |
| `backup` | the pre-update backup, or null |
| `starts` | how many starts were tried |
| `at` | when (ms) |

## kv `updates:rolledBack`

The result plus `alerted` (the owner alert went out, there is no alert number, or it was tried six rounds). Shown as
`rolledBack` by `GET /api/updates` (and `get_update_status`) while the server runs the version it was rolled back to
(when putting it back failed: also while it runs the version that did not start).

## `GET /api/updates` (contract)

`rolledBack`: `{ ok, from, to, at, backup, text }` or null. `text` is the one wording Activity, the alert, the WhatsApp
answer, the panel and the admin MCP share (`rollbackText` in `src/core/updates.js`).
