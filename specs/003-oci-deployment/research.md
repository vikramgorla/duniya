# Research: Free-Tier Deployment from GitHub

## Host

- **Decision**: OCI Always Free `VM.Standard.E2.1.Micro` (1/8 OCPU, 1 GB) default; `VM.Standard.A1.Flex` optional.
- **Rationale**: owner's choice; Micro is reliably available, A1 often hits "out of host capacity". Free A1
  allowance was halved in 2026 (now 2 OCPU / 12 GB total).
- **Risk**: idle reclamation (7-day p95 CPU < 20%, network < 20%, and for A1 memory < 20%). Mitigation:
  recommend Pay-As-You-Go upgrade (still free within limits), nightly backups, re-apply procedure.
- **Alternatives**: Cloudflare Containers (~$10–12/month; needs session persistence workarounds); paid VPS.

## Terraform state

- **Decision**: native `backend "oci"` (Terraform ≥ 1.12) with partial config at `init`; bucket created by OCI
  CLI if missing (private, versioned).
- **Alternatives**: S3-compatible backend (needs Customer Secret Keys; deprecated by Oracle docs), HTTP backend
  with PARs, OCI Resource Manager (less GitHub-native).

## Placement

- **Decision**: query `oci_core_shapes` per availability domain and pick the first that offers the shape.
- **Rationale**: E2.1.Micro is only offered in one AD in many regions.

## Bootstrap secrets transport

- **Decision**: Terraform renders `KEY='value'` lines with `'` escaped as `'\''`, base64-encodes them into
  cloud-init `write_files` (`encoding: b64`, mode 0600); the bootstrap script is shipped the same way.
- **Rationale**: immune to YAML and shell quoting issues (tested with quotes, `$`, backticks).

## Panel exposure

- **Decision**: Cloudflare Tunnel (`cloudflared service install <token>`); panel binds 127.0.0.1:8080.
- **Rationale**: owner's choice; no open ports; Cloudflare Access can add SSO/OTP.

## Private repository cloning

- **Decision**: optional fine-grained PAT (`contents:read`) in `GIT_CLONE_TOKEN`, embedded in the clone URL on
  the VM only. Public repos need nothing.
