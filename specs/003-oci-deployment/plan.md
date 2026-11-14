# Implementation Plan: Free-Tier Deployment from GitHub

**Branch**: `003-oci-deployment` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-oci-deployment/spec.md`

## Summary

Terraform (OCI provider, native OCI state backend) declares a VCN, internet gateway, route table, an
egress-only security list, a public subnet and one Always Free instance. Cloud-init writes base64-encoded
bootstrap values and a bootstrap script that clones the repo and runs `deploy/install.sh` (swap, Node 22,
system user, hardened systemd unit, cloudflared, nightly backups). A GitHub Actions workflow writes the OCI API
key config, ensures the private versioned state bucket, and runs plan/apply/destroy.

## Technical Context

**Language/Version**: Terraform 1.17 (HCL), Bash, GitHub Actions YAML

**Primary Dependencies**: `oracle/oci` provider ≥ 6, OCI CLI (bucket bootstrap), `hashicorp/setup-terraform`,
cloud-init, systemd, cloudflared (Cloudflare apt repo), NodeSource Node 22

**Storage**: Terraform state in OCI Object Storage (`backend "oci"`, versioned bucket); app data in
`/var/lib/duniya/data`; backups in `/var/lib/duniya/backups`

**Testing**: `terraform validate` + `fmt -check`; escaping test for bootstrap env; `bash -n` on scripts (CI)

**Target Platform**: OCI Always Free (E2.1.Micro default, A1.Flex optional), Ubuntu 24.04

**Project Type**: infrastructure as code + bootstrap scripts

**Performance Goals**: VM ready < 15 min after apply

**Constraints**: zero inbound ports by default; idempotent re-runs; no VM rebuild on image/user-data drift

**Scale/Scope**: one VM, one environment

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| VI. Free tier, everything as code | Only Always Free shapes; all resources in Terraform; workflow from GitHub | PASS |
| VI. No inbound ports | Security list: egress all; ingress only ICMP 3/4; SSH only when `SSH_INGRESS_CIDR` set | PASS |
| VI. In-place updates | `ignore_changes` on image/user_data/AD; panel update path | PASS |
| Security constraints | Secrets via GitHub secrets → base64 cloud-init → 0600 file; service as `duniya` user with `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome`, `PrivateTmp` | PASS |
| VII. Tested | CI workflow runs tests + script syntax checks | PASS |

Noted trade-off (not a violation): bootstrap secrets are present in instance metadata and Terraform state;
state is in a private versioned bucket and runtime secrets are entered in the panel instead.

## Project Structure

### Documentation (this feature)

```text
specs/003-oci-deployment/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/github-config.md
└── tasks.md
```

### Source Code (repository root)

```text
infra/terraform/
├── versions.tf             # providers + backend "oci"
├── variables.tf
├── main.tf                 # AD/shape lookup, image, network, instance, bootstrap env
├── outputs.tf
├── cloud-init.yaml.tftpl   # write_files (b64) + runcmd
└── bootstrap.sh            # clone + run deploy/install.sh
deploy/
├── install.sh              # idempotent server install
├── update.sh               # in-place code update (panel)
└── backup.sh               # nightly data backup
.github/workflows/
├── infra.yml               # plan/apply/destroy
└── ci.yml                  # tests + script checks
docs/SETUP.md
```

**Structure Decision**: infra separate from app code; the VM pulls code from GitHub (no push/SSH deploy).

## Complexity Tracking

No violations.
