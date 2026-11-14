---

description: "Task list for 008-install-and-exposure"
---

# Tasks: One-Command Install, Exposure Options and Auto-Update

## Format: `[ID] [P?] [Story] Description`

## Phase 1: User Story 1 - One-command install (P1) 🎯 MVP

- [X] T001 [US1] Installer with exposure modes, firewall (ufw/iptables), Caddy, cloudflared, systemd, summary, --dry-run in install.sh
- [X] T002 [US1] TRUST_PROXY: client IP from X-Forwarded-For and scheme from X-Forwarded-Proto in src/panel/server.js
- [X] T003 [P] [US1] Remove deploy/install.sh and deploy/backup.sh (superseded); keep deploy/update.sh

## Phase 2: User Story 4 - Updates (P2)

- [X] T004 [P] [US4] Tests: version compare, stable tag pick, update against bare repo with rollback, routes owner-only in test/updates.test.js
- [X] T005 [US4] Update check/apply/schedule in src/core/updates.js; target-ref + rollback in deploy/update.sh
- [X] T006 [US4] Routes in src/panel/routes/updates.js

## Phase 3: User Story 2 - Docker (P2)

- [X] T007 [P] [US2] Dockerfile, .dockerignore, docker-compose.yml (profiles https, tunnel), deploy/Caddyfile.compose

## Phase 4: User Story 3 - Deploy to Oracle Cloud (P2)

- [X] T008 [US3] Terraform for OCI usable by Resource Manager and Actions with schema.yaml in infra/oci/
- [X] T009 [US3] Release workflow zipping the stack in .github/workflows/release.yml; infra.yml points to infra/oci
- [X] T010 [P] [US3] Remove infra/terraform (replaced)

## Phase 5: User Story 5 - Docs by example (P3)

- [X] T011 README rewrite (product, install options, Deploy button) in README.md
- [X] T012 [P] Example guides in docs/deploy/oci-free-tier.md, cloudflare-tunnel.md, docker.md, terraform-github-actions.md; remove docs/SETUP.md
- [X] T013 CI: installer dry-run + terraform validate in .github/workflows/ci.yml
