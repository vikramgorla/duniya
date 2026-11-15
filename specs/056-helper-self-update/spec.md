# Feature Specification: The maintenance helper updates itself

**Feature**: 056-helper-self-update · **Issue**: #107 · **Release**: v2.17.0 · **Status**: implemented

## Goal

Owners without SSH never need `sudo duniya update` again: the root maintenance helper (`deploy/ops/duniya-ops`,
installed to `/usr/local/sbin/duniya-ops`) can replace itself with the copy of a release, triggered from the panel,
without the unprivileged app ever being able to make root run app-controlled code.

Background: an Oracle stack created without an SSH key cannot get one later (OCI takes `ssh_authorized_keys` only at
launch), so those owners cannot run root commands at all.

## User stories

1. **Automatic (P1)** — After an app update the app restarts; when the installed helper is older than the one this
   release ships and knows `update-helper`, the app requests it once for that version.
2. **Button (P1)** — Server → OS updates & maintenance shows *A newer maintenance helper comes with this release* with
   **Update maintenance helper** (owner). Admin MCP: `run_maintenance update-helper`.
3. **Older helpers (P1)** — A helper without the action (version < 3) cannot learn it from the panel. The note says:
   run `sudo duniya update` once (then it updates itself), or without SSH reinstall (link to
   `docs/upgrading.md#the-maintenance-helper`). Docs say so honestly; the Oracle guide says to add an SSH key at
   install (Cloud Shell can generate one).

## Requirements

- **FR-001** Helper version 3 accepts `update-helper`. The app writes the action word and `helper-version` (its own
  release, `vX.Y.Z`) to the request directory; nothing else is taken from the app.
- **FR-002** Release number: at most 32 bytes, strictly `^v\d{1,4}\.\d{1,4}\.\d{1,4}$`, else refused without echoing.
- **FR-003** No downgrades: refused when older than `v2.17.0` (first self-updating release) or the release recorded in
  `/var/lib/duniya-ops/helper-release`; a fetched helper whose `duniya-ops-version` is lower than the running one is
  refused.
- **FR-004** Repository: `REPO` from root-owned `/etc/duniya/install.conf` when it is a plain `https://host/path` URL,
  else the official URL fixed in the helper. Never from the app. (`DUNIYA_OPS_REPO` exists for tests only, like the
  other `DUNIYA_OPS_*` overrides; systemd starts the helper with a clean environment.)
- **FR-005** git runs as root only in a fresh root-owned `/var/lib/duniya-ops/src` (700): `env -i`, no system/global
  config, `http.sslVerify=true`, https protocol only, no hooks, no credential helper, 300 s timeout; fetches only
  `refs/tags/<release>` with `--depth 1 --filter=blob:none` and reads only `deploy/ops/{duniya-ops, duniya-ops.service,
  duniya-ops.path, webconfig.mjs}`. The directory is removed afterwards. Never reads the app's checkout.
- **FR-006** Checks: all four files present and non-empty; helper starts with `#!/bin/bash`, has a version line and
  passes `bash -n`. Installs changed files like `refresh_helper` (same destinations and modes) by writing a new file
  and renaming it into place (the running script keeps its old inode), then `systemctl daemon-reload` and
  `enable --now duniya-ops.path`; records the release. Same release again: no changes, no reload.
- **FR-007** Status (`status.json`, `last.log` with `== step:` lines) like other actions; failures leave everything
  unchanged.
- **FR-008** App: `opsStatus()` adds `helperBundled`, `helperOutdated`, `helperSelfUpdate`; `requestOp('update-helper')`
  refuses helpers < 3 (`code: helper_too_old`); `maybeUpdateHelper()` 30 s after start, once per app version
  (setting `opsHelperAuto`).

## Why this design

Root decides everything that matters (where from, which files, which versions are acceptable); the app can only ask
for an official release it is itself running. A compromised app could at most request another official release at
or above the last installed one. Fetching is a few hundred KB (one tag, trees only, four blobs), fine on 1 GB.

## Out of scope

Signed-tag verification (the repository has no signed tags yet); updating `/usr/local/bin/duniya` (the CLI) this way;
helpers older than version 3 (they need one root run or a reinstall).
