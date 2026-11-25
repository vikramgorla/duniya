# Implementation Plan: App updates install automatically by default

**Spec**: [spec.md](spec.md) · **Issue**: #309 · **Version**: 2.64.0 (minor)

## Technical approach
- `src/core/updates.js`: one `defaults()` (mode from `UPDATE_MODE`, else `auto`), read on every call.
- Provisioning defaults: install.sh, infra/oci/variables.tf, schema.yaml (field *App updates* with a description,
  auto first), bootstrap.sh, infra.yml, infra/gcp/deploy.sh (`--update-mode`, validated).
- Panel Settings → Updates lists *Install automatically (default)* first.
- `scripts/ci-checks.mjs` check 12.

## Definition of Done plan
| Item | Plan |
|---|---|
| Tests | test/updates.test.js: default auto, notify still settable; installer dry run in CI; shellcheck |
| Checks | test, lint, typecheck, check:panel, check:clean, ci-checks |
| Docs | install.md, deploy/oci-free-tier.md, deploy/google-cloud.md, deploy/terraform-github-actions.md, settings.md, backups-and-updates.md |
| Website | Backups & updates section; card-updates retaken |
| Admin MCP | n/a: no new panel functionality (update mode is unchanged as a setting) |
| Small servers | n/a |
| Version | 2.64.0, releases.json entry |
