# Implementation Plan: The maintenance helper updates itself

**Spec**: [spec.md](spec.md) · **Issue**: #107 · **Release**: v2.17.0 (minor, together with 055)

## Design

- `deploy/ops/duniya-ops` — version 3; `update-helper` in the allow list; `version_lt`, `helper_repo`,
  `update_helper` (FR-002…FR-007); test-only overrides `DUNIYA_OPS_SBIN`, `DUNIYA_OPS_UNIT_DIR`, `DUNIYA_OPS_REPO`.
- `src/core/system.js` — `OPS_ACTIONS['update-helper']`, `OPS_HELPER_SELF_UPDATE = 3`, `opsHelperBundled()` (reads
  the version line of the app's own copy, never runs it), `appVersion()`, `requestOp` writes `helper-version`,
  `maybeUpdateHelper()` scheduled from `startMetrics()`.
- `src/panel/public/index.html` — note `#helper-update`: button when it can update itself, otherwise *run sudo duniya
  update once, or reinstall without SSH* with a docs link.
- `src/panel/admin-tools.js` — `run_maintenance` enum + preview, `get_maintenance_status` description.
- `scripts/demo-panel.mjs` — demo helper has the current version; `check-responsive.mjs` states `server-old-helper`
  (updated) and `server-helper-update`.
- Docs: `docs/upgrading.md#the-maintenance-helper`, `docs/backups-and-updates.md`, `docs/deploy/oci-free-tier.md`
  (SSH key only at launch, Cloud Shell `ssh-keygen`), `docs/admin-mcp.md`.

No new dependencies (git and coreutils are already required by the installer).

## Constitution Check

- Least privilege: the app writes two words; root validates and fetches itself; no app code runs as root.
- TLS never disabled (`http.sslVerify=true` explicitly); https only in production.
- Small servers: shallow, blobless, one tag; temporary directory removed.

## Complexity Tracking

None.
