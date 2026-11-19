# 084 · Configurable repository, update source, fork setup

Issue #190 (supersedes PR #189; part of #188, the rename to `duniya`).

## Problem
The GitHub owner/name was written in ~30 files (code, installer, helper, infra, docs, website). A rename or a fork
meant editing all of them, and a missed one broke silently. Servers could not see or change where updates come from.

## Requirements
- R1 One source of truth: `repository` in `package.json` (`github:owner/name`). Every URL is derived (`src/core/repo.js`).
- R2 Runtime code (panel links, release notes, MCP client_uri, admin MCP server info) reads it; no slug in `src/`,
  `deploy/`. The root helper has no built-in repository (install config only).
- R3 Installer, GCP script, OCI defaults, compose, README, docs, website: absolute URLs rewritten by `npm run repo:sync`
  (URLs only, idempotent, specs/ untouched, example owners left alone). `DUNIYA_REPO` / `--repo owner/name` at install.
- R4 `ci-checks.mjs` fails on any project URL with another slug.
- R5 Update source: shown in Settings → Updates (the project or not), changeable to `owner/name` or a GitHub https URL;
  validated strictly; the new source's tags are fetched first and the old source is put back on failure; credentials
  in the remote are never shown. `duniya source [owner/name]`; as root it also moves the helper's install config.
  Admin MCP: `set_update_source` (confirmed). Installer re-runs keep the source in use.
- R6 Fork setup workflow: on a fork or renamed repository it syncs and opens a PR; no-op when the slug matches. Release
  image `ghcr.io/<owner>/<name>` lowercase, assets `duniya.zip`; Pages per repository.
- R7 From #189: taglines "WhatsApp and Telegram", package `duniya`, linked device "Duniya", backup texts. Server-local
  names unchanged (systemd unit, /opt path, log file, Terraform state, ChatGPT sign-in app name).
- R8 MCP listing: every admin tool and `confirm_action` declares readOnly/destructive/idempotent/openWorld hints as
  booleans derived in one place, with a title; server info has description, website, icon.
- R9 MIT LICENSE; `ADMIN_PASSWORD` / `MASTER_KEY` documented (SECURITY.md) and tested never returned, logged or printed.

## Out of scope
Changing server-local names (would need a migration). Moving the helper's source from the panel (root must never take
a repository from the app).
