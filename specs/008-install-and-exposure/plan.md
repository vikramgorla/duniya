# Implementation Plan: One-Command Install, Exposure Options and Auto-Update

**Branch**: `008-install-and-exposure` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

## Summary

`install.sh` (repo root, served from raw.githubusercontent.com) replaces `deploy/install.sh`; it installs Node 22, the
app as a hardened systemd service, and one of: Caddy (domain or `<ip>.sslip.io`), cloudflared, or nothing. Host firewall
handling covers ufw and OCI's iptables REJECT rules. `src/core/updates.js` checks the git remote (tags or main) and
applies updates via `deploy/update.sh <ref>`. A Dockerfile + compose with profiles covers containers. `infra/oci/` is a
single Terraform config used both as a Resource Manager stack (release zip, Deploy button, `schema.yaml`) and by the
GitHub Actions workflow (backend file written at runtime).

## Technical Context

**Language/Version**: Bash, Node.js 22, Terraform ≥ 1.5 (RM) / 1.17 (Actions), Docker

**Primary Dependencies**: Caddy (apt repo), cloudflared (apt repo), NodeSource

**Testing**: `bash -n` + shellcheck-style checks; `terraform validate` for infra/oci; installer dry-run mode
(`--dry-run` prints planned steps); unit tests for update version logic and proxy handling

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| VI. Free tier, everything as code | Same installer for every path; OCI stack in repo; no inbound ports unless direct | PASS (amended: direct HTTPS allowed when chosen) |
| Security | App on localhost; Caddy TLS; firewall 80/443 only; TRUST_PROXY only with local proxy | PASS |
| VII. Tested | dry-run + validate + unit tests | PASS |

Constitution VI says "MUST expose no inbound ports by default" — still true (default exposure in the stack is tunnel or
local); direct mode is an explicit opt-in. Amend wording in v1.1.0.

## Project Structure

```text
install.sh                     # NEW one-command installer (replaces deploy/install.sh)
deploy/update.sh               # target ref support
deploy/backup.sh               # removed (backups are in-app since 007)
Dockerfile, docker-compose.yml, deploy/Caddyfile.compose
src/core/updates.js            # check/apply, schedule
src/panel/routes/updates.js
infra/oci/                     # NEW Terraform (RM stack + Actions), schema.yaml
infra/terraform/               # REMOVED (replaced by infra/oci)
.github/workflows/infra.yml    # points to infra/oci, writes backend.tf
.github/workflows/release.yml  # NEW: zip stack on tag, attach to release
docs/deploy/*.md               # oci-free-tier, cloudflare-tunnel, docker, terraform-github-actions
```

## Complexity Tracking

No violations.
