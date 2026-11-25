# Feature Specification: App updates install automatically by default

**Feature Branch**: `feat/309-auto-app-updates` · **Issue**: #309 · **Status**: Implemented (2.64.0)

## User Scenarios & Testing

### User Story 1 — A new server keeps itself current (P1)
A new owner never has to come back to install releases: every way to set up a server (installer, Oracle stack, Google
script, Terraform workflow) starts with automatic app updates; releases install at night after a backup, breaking ones
wait for the owner, and a release that does not start is rolled back.

**Acceptance**: 1. A fresh install's Settings → Updates shows *Install automatically (default)* selected. 2. The Oracle
stack's *App updates* field and the Google script default to auto and still offer notify / off. 3. CI fails when a
provisioning path's default differs from the app's.

### User Story 2 — The owner can still choose (P2)
*Notify me* and *Off* stay in Settings → Updates and in every provisioning option.

### Edge Cases
- Existing servers keep the mode written at install time (app.env `UPDATE_MODE`).
- Docker installs do not update themselves; the setting has no effect there (unchanged).

## Requirements
- **FR-001**: The default update mode is `auto` when `UPDATE_MODE` is not set.
- **FR-002**: install.sh, infra/oci (variables.tf, schema.yaml, bootstrap.sh), .github/workflows/infra.yml and
  infra/gcp/deploy.sh (new `--update-mode`) default to `auto`.
- **FR-003**: `ci-checks.mjs` compares those defaults with the app's.

## Success Criteria
- **SC-001**: A server set up with any path with default options installs a new ordinary release the next night.
