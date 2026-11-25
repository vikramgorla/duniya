# Tasks: App updates install automatically by default

- [x] T001 [US1] Default `auto` with one defaults() in src/core/updates.js
- [x] T002 [US1] install.sh, infra/oci/variables.tf, infra/oci/schema.yaml, infra/oci/bootstrap.sh, .github/workflows/infra.yml default auto
- [x] T003 [US1] infra/gcp/deploy.sh --update-mode (default auto, validated, in --help)
- [x] T004 [US2] Settings → Updates: Install automatically (default) first (src/panel/public/app/settings.js)
- [x] T005 [US1] scripts/ci-checks.mjs check 12
- [x] T006 test/updates.test.js default

## Phase Final: Definition of Done
- [x] T007 Issue #309 with labels, plan / done comments
- [x] T008 npm test, lint, typecheck, check:panel, check:clean, ci-checks, shellcheck, installer dry run
- [x] T009 Docs, README, website; card-updates retaken
- [x] T010 Version 2.64.0 + releases.json entry
- [x] T011 PR via REST, squash merge, issue closed
