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
- **Oracle Cloud stack**: the app updates itself as above; to update the infrastructure, **Edit** the stack with the
  latest stack zip, **Plan**, then **Apply** ([step by step](deploy/oci-free-tier.md#update-the-stack-infrastructure)).
- **Google Cloud**: the app updates itself as above ([guide](deploy/google-cloud.md#update-the-app)).

## Moving to a new server or recreating one

Back up (**Backups → Back up now & download**), set up the new server, then **Restore a backup** on its first screen
(or **Backups → Restore → A file**). Per host, with what changes (IP, sslip.io address, domain DNS, WhatsApp link):
[Oracle Cloud](deploy/oci-free-tier.md#recreate-from-scratch) · [Google Cloud](deploy/google-cloud.md#recreate-from-scratch) ·
[own server](install.md#recreate-from-scratch-new-server-or-fresh-os) · [Docker](deploy/docker.md#recreate-from-scratch).

See also [Upgrading](upgrading.md) and [Managing your server](README.md).

---
[Docs index](README.md)
