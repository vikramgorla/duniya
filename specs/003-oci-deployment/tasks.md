---

description: "Task list for 003-oci-deployment"
---

# Tasks: Free-Tier Deployment from GitHub

**Input**: Design documents from `/specs/003-oci-deployment/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/github-config.md

**Tests**: validation tasks (terraform validate, escaping test, script syntax) per constitution VII.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Terraform providers and partial `backend "oci"` in infra/terraform/versions.tf
- [X] T002 [P] Variables (region, compartment, shape, A1 sizing, SSH, repo, branch, secrets) in infra/terraform/variables.tf

## Phase 2: Foundational

- [X] T003 AD lookup by shape, Ubuntu 24.04 image lookup, shell-safe bootstrap env in infra/terraform/main.tf
- [X] T004 [P] Network: VCN, IGW, route table, egress-only security list, public subnet in infra/terraform/main.tf

## Phase 3: User Story 1 - Create the server from GitHub (P1) 🎯 MVP

- [X] T005 [US1] Instance with optional flex shape config, metadata, `ignore_changes` in infra/terraform/main.tf
- [X] T006 [P] [US1] Outputs (IP, AD, image, next steps) in infra/terraform/outputs.tf
- [X] T007 [US1] Workflow: secret check, OCI config, CLI, state bucket, init/validate/plan/apply/destroy, summary in .github/workflows/infra.yml
- [X] T008 [P] [US1] Cloud-init template with base64 write_files in infra/terraform/cloud-init.yaml.tftpl
- [X] T009 [P] [US1] First-boot clone with retries in infra/terraform/bootstrap.sh

## Phase 4: User Story 2 - Panel without open ports (P1)

- [X] T010 [US2] SSH ingress only when `ssh_ingress_cidr` set (dynamic block) in infra/terraform/main.tf
- [X] T011 [US2] Install cloudflared from Cloudflare apt repo and `service install` token in deploy/install.sh

## Phase 5: User Story 3 - Reliable on the smallest machine (P2)

- [X] T012 [US3] Idempotent install: swap, Node 22, system user, npm ci, app.env, hardened systemd unit in deploy/install.sh
- [X] T013 [P] [US3] Nightly backup with 7-day local rotation and optional rclone in deploy/backup.sh and /etc/cron.d via deploy/install.sh

## Phase 6: Polish & Verification

- [X] T014 [P] CI workflow (tests + `bash -n` scripts) in .github/workflows/ci.yml
- [X] T015 `terraform fmt -check` and `terraform validate` pass for infra/terraform
- [X] T016 Bootstrap env escaping verified with quotes, `$`, backticks
- [X] T017 Operator guide in docs/SETUP.md
