# Backups and updates

## Backups

**Backups** (owner): set a passphrase, then choose where encrypted backups go: this server, a private GitHub repository
the one-click GitHub App creates for you (or a token, or device login with your own OAuth app), or any S3-compatible
bucket. Turn on the schedule (e.g. daily at 04:00, keep 14). Backups are encrypted with your passphrase before they
leave the server. **Download** a backup any time; restore from a stored backup or upload a file (up to
`BACKUP_UPLOAD_MAX_MB`), also from the welcome screen of a fresh server. Command line: `sudo duniya backup-now`.
Admin MCP: `get_backup_status`, `list_backups`, `run_backup`, `restore_backup` (with confirmation).

## Updates

- **Installer servers**: **Overview → Server → Updates** shows the current and latest version; *Update to vX.Y.Z* installs it
  in place and keeps all data (the progress survives a reload). *Update settings* choose *Notify me*, *Install automatically*
  (at a time of day) or *Off*, and stable releases or latest `main` (installer: `--update-mode off|notify|auto`). Command line: `sudo duniya update [--check]`. Running the
  installer again also updates.
- **OS packages**: **Server → OS updates & maintenance** (security updates, restart when needed).
- **Docker**: `docker compose pull && docker compose up -d`.
- **Oracle Cloud stack**: the app updates itself as above; to update the infrastructure, *Edit stack* with the latest
  stack zip and *Apply* (see [Install](install.md)).

See also [Upgrading](upgrading.md).

---
[Docs index](README.md)
