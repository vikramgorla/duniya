# Implementation Plan: One-click free VMs

**Branch**: `feat/i4-infra-signin` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Summary
A gcloud script (not Terraform: Cloud Shell has gcloud signed in already, no state to keep, one command) that creates
the firewall rule and the VM with a startup script embedding `infra/oci/bootstrap.sh` + a `bootstrap.env` (same shape
as the OCI stack), then waits for HTTPS and prints the result. The tutorial drives it from the README button.

## Constitution Check
| Principle | Check | Status |
|---|---|---|
| VI. Free tier, everything as code, same installer | e2-micro in free regions, script in the repo, same bootstrap + install.sh | PASS (IPv4 cost caveat documented) |
| VII. Spec + tests | research + spec; shellcheck and `--dry-run`; no cloud calls in CI | PASS |
| VIII. Experience first | one button, tutorial with project/billing picker, live progress page, setup code printed | PASS |

## Design decisions
- Debian 12 image: lower memory use than Ubuntu on 1 GB; the installer supports it.
- No static IP: an in-use ephemeral address is enough (sslip.io); a reserved address would add cost when unused.
- Domain is applied from the panel (031) after DNS points to the VM, because the IP is only known after creation.
- Owner password, if given, is removed from the instance metadata after install; default is the setup code.
