# Research: 095 update rollback

## Where the guard lives

- **Decision**: in the app's own entry point (`src/index.js`), as code that imports nothing but Node built-ins.
- **Rationale**: the systemd unit, the Dockerfile and `npm start` already run `src/index.js`; the unit file is only
  written by the installer, so a guard anywhere else (an `ExecStartPre=`, the root helper) would reach existing servers
  only after a re-install. A release whose app code is broken still loads the entry and the guard.
- **Alternatives**: the root maintenance helper (`duniya-ops`): runs as root in a checkout owned by the app user
  (git as root in that repository is avoided on purpose, #96), and needs a re-install to arrive. A systemd
  `OnFailure=` unit: never fires with `Restart=always`.

## What counts as "did not start"

- **Decision**: a start counts when the note exists; the update holds when the app finished starting and stayed up
  for 60 s; three counted starts without that → rollback at the fourth.
- **Rationale**: a crash while starting ends the process in under a second; `RestartSec=5` makes three tries about 20
  seconds. One minute also catches a crash in the first background round. A slow start (WhatsApp or Telegram not
  reachable) is not a failed start: the process is still running.
- **Alternatives**: a health request from outside (needs a second process); counting only non-zero exits (the guard
  cannot see how the last process ended without more state, and a release that is stopped again and again in its
  first minute has not shown that it runs).

## What is put back

- **Decision**: code (`git checkout -q <commit>`, not forced) and, when the lockfile changed in the update,
  dependencies (`npm ci --omit=dev --prefer-offline`). Data stays as it is.
- **Rationale**: the same two steps `deploy/update.sh` uses for a failed dependency install. A checkout that is not
  forced never discards local changes; it fails only where the update itself would have failed. `--prefer-offline`
  uses the packages the previous release already downloaded, so the rollback does not depend on the network.
  Restoring the pre-update backup would lose the messages since; schema changes are additive and breaking releases
  need the owner's decision (045).
- **Alternatives**: keeping the previous release in a second directory (doubles the disk use on small servers and
  changes the installer).

## Bounded retries

- **Decision**: a failed step of the rollback is tried again at the next start, three times; then the result says it
  failed, the note is dropped and nothing more is counted.
- **Rationale**: `npm ci` can fail for a moment (network); for good it must not loop.

## Not installing the same version again

- **Decision**: the automatic round compares its target with what was rolled back (the tag on the stable channel, the
  commit on main) and does nothing for it. A manual update is not checked.
- **Rationale**: the owner may have fixed the cause (disk space, a missing tool); the nightly round cannot know.
