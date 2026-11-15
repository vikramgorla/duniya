# Backups and updates

## Backups

**Backups** (owner): set a passphrase, then choose where encrypted backups go: this server, a private GitHub repository
the one-click GitHub App creates for you (or a token, or device login with your own OAuth app), or any S3-compatible
bucket. Turn on the schedule (e.g. daily at 04:00, keep 14). Backups are encrypted with your passphrase before they
leave the server. **Download** a backup any time; restore from a stored backup or upload a file (up to
`BACKUP_UPLOAD_MAX_MB`), also from the welcome screen of a fresh server. Command line: `sudo duniya backup-now`.
Admin MCP: `get_backup_status`, `list_backups`, `run_backup`, `restore_backup` (with confirmation).

**Before every update** (also automatic ones and `sudo duniya update`) a local backup is made when a backup passphrase
is set: the update waits for it and is not installed if the backup fails. Pre-update backups stay on this server only,
are listed with the local backups and are kept apart from the normal retention: the last 3 are kept (change it under
*Update settings → keep the last N pre-update backups*, 1–20).

## Updates

- **Installer servers**: **Overview → Server → Updates** shows the current and latest version; *Update to vX.Y.Z* installs it
  in place and keeps all data (the progress survives a reload). *Update settings* choose *Notify me*, *Install automatically*
  (at a time of day) or *Off*, and stable releases or latest `main` (installer: `--update-mode off|notify|auto`). Command line: `sudo duniya update [--check]`. Running the
  installer again also updates.
- **Breaking releases need your decision.** Each release can carry notes in `releases.json` (in the repository, read
  from the release itself with git). A jump is *breaking* when the major version grows or a release in between is
  marked breaking. Then:
  - *Install automatically* installs only the newest release that can be reached without crossing a breaking one, and
    stops there. *Notify me* never installs.
  - You are told **once per breaking release**: a banner on **Overview** ("Version 3.0.0 needs your decision"), the
    Updates card, Activity, a WhatsApp message to the owner alert number (Settings → Owner alerts) and, for every owner
    who linked the [owner assistant](owner-assistant.md), a message with a code: reply `confirm ABCD` to update (a
    backup is made first, the result is reported back after the restart) or `cancel ABCD` to be reminded in 7 days.
    Codes are valid 3 days and only for owners.
  - **Review update** opens the release notes (what changes, what you need to do, a link to the docs), *Make a backup
    first* (on by default; the update waits for it) and *Update to vX*. *Remind me in 7 days* snoozes the notice;
    *Dismiss* hides it until a newer breaking release.
  - Command line: `sudo duniya update` installs the newest release that needs no decision and prints the notes;
    `sudo duniya update --breaking` also crosses a breaking one. Admin MCP: `get_update_status` (steps, safe target),
    `apply_update` (`breaking: true` to cross one; confirmation required), `snooze_update_decision`.
- **OS packages**: **Server → OS updates & maintenance** (security updates, restart when needed).
- **Docker**: `docker compose pull && docker compose up -d`.
- **Oracle Cloud stack**: the app updates itself as above; to update the infrastructure, *Edit stack* with the latest
  stack zip and *Apply* (see [Install](install.md)).

See also [Upgrading](upgrading.md).

---
[Docs index](README.md)
