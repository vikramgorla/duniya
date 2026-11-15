# Feature Specification: One-click free VMs (Google Cloud and other lifelong-free providers)

**Feature Branch**: `feat/i4-infra-signin` | **Created**: 2026-11-15 | **Status**: Implemented (Google), research done | **Issue**: #6

**Input**: "Like the Oracle button: one-click provisioning on Google Cloud's always-free e2-micro, and on other
providers with a permanently free tier (research which exist and their terms)." Owner also mentioned "gratisvps".

## User Scenarios & Testing

### Story 1 — Google Cloud in one click (P1)
From the README the owner clicks **Open in Cloud Shell**. Cloud Shell clones the repository and opens a tutorial:
choose a project with billing, run `bash infra/gcp/deploy.sh`, watch the progress page, open the panel with the
setup code printed at the end.

**Acceptance**
1. The VM is an e2-micro in us-central1/us-west1/us-east1 with a 30 GB standard disk; other regions are refused.
2. Ports 80/443 are open (firewall rule `duniya-web`); first boot runs the same bootstrap/installer as Oracle
   (`--ip-https`, 2 GB swap, progress page).
3. The script waits for `https://<ip>.sslip.io/healthz`, prints the panel URL and the setup code (via
   `sudo duniya show-setup-code` over `gcloud compute ssh`), and removes the startup script from the metadata.
4. Existing VM with the same name, missing billing, or another e2-micro in the project are reported in plain words.
5. `--domain` prints the DNS record and points to Settings → Web address & access (031) instead of failing on a
   certificate for a name that does not resolve yet.

### Story 2 — Which providers are really free (P1)
The README lists only providers that are free forever and trustworthy, with a short note on the others; the research
(sources, dates) is in `research.md` and posted on issue #6.

## Requirements
- **FR-001** `infra/gcp/deploy.sh` (shellcheck clean, `--dry-run`, `--help`), `infra/gcp/tutorial.md` (Cloud Shell tutorial).
- **FR-002** README "Deploy on a free cloud VM" with the Oracle and Google buttons and the honest cost note (IPv4).
- **FR-003** No button for providers that are trials (AWS, Azure, Alibaba, IBM), not VMs (Fly.io, Render) or dubious (GratisVPS).

## Success Criteria
- A new owner gets a running panel on Google Cloud without typing more than one command.
