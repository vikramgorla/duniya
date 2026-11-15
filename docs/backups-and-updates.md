# Backups and updates

**Encrypted backups to GitHub, S3 or a download, and updates that keep your data and never cross a breaking release
without you.**

**Do it:** panel → **Backups** → set a passphrase → choose where → turn on the schedule.

**In 30 seconds**
- Encrypted with your passphrase **before** leaving the server: to this server, a private GitHub repo or S3.
- Every update makes a local backup first (with a passphrase set); no backup, no update.
- Breaking releases wait for an owner: panel, or `confirm CODE` on WhatsApp.

![Backups page](site/img/backups-desktop.webp)

## Backups

1. **Backups** (owner) → set a passphrase. Write it down: without it a backup can't be opened.
2. Choose a destination: this server, **GitHub** (the one-click GitHub App creates a private repository; or a token,
   or device login with your own OAuth app) or **S3-compatible**.
3. Turn on the schedule (e.g. daily at 04:00, keep 14).
4. **Download** a backup any time.

> [!NOTE]
> **Pre-update backups** stay on this server only, are listed with the local backups and kept apart from the normal
> retention: the last 3 (*Update settings → keep the last N pre-update backups*, 1–20). If one fails, the update is
> not installed.

### Restore

<p align="center"><img src="diagrams/restore-backup.svg" alt="Restoring a backup: download a .dbk file and keep its passphrase, then restore it on the first screen of a fresh server (with the setup code) or under Backups, Restore on a running server; after a 1-2 minute restart sign in with the backup accounts" width="511"></p>

<details><summary>Diagram as text</summary>

1. **Backups → Back up now** and download the `.dbk` file; keep its passphrase.
2. On a fresh server: first screen → **Restore a backup** (with the setup code).
3. On a running server: **Backups → Restore** → a file or a stored backup.
4. The server restarts (1–2 min); sign in with the accounts from the backup.

</details>

Uploads up to `BACKUP_UPLOAD_MAX_MB` ([settings](settings.md)). Command line: `sudo duniya backup-now`. Admin MCP:
`get_backup_status`, `list_backups`, `run_backup`, `restore_backup` (with confirmation).

## Updates

**Overview → Server → Updates** → **Update to vX.Y.Z** installs in place, keeps all data, survives a reload.
**Update settings**: *Notify me*, *Install automatically* (time of day) or *Off*; stable or latest `main`
(`--update-mode off|notify|auto`). Also `sudo duniya update [--check]` or re-running the installer.

<p align="center"><img src="diagrams/update-decision.svg" alt="How updates are decided: ordinary releases follow the update mode (install automatically after a backup, or notify); a breaking release or new major stops automatic updates, tells the owner once, and the owner updates, postpones or dismisses it" width="720"></p>

<details><summary>Diagram as text</summary>

1. A new release is published.
2. Not breaking: with *Install automatically* it is installed after a backup at the set time; with *Notify me* it is shown on Updates.
3. Breaking or a new major: automatic updates stop at the last safe release.
4. The owner is told once: Overview banner, Updates, Activity and WhatsApp.
5. The owner decides: **Update to vX** (or `confirm ABCD`) backs up, updates and reports after the restart; **Remind me in 7 days** (or `cancel ABCD`) asks again later; **Dismiss** hides it until a newer breaking release.

</details>

### Breaking releases need your decision

A jump is *breaking* when the major version grows or a release in between is marked breaking in `releases.json`
(read from the release itself with git).

1. You are told **once**: **Overview** banner ("Version 3.0.0 needs your decision"), Updates card, Activity, the
   owner alert number (**Settings → Owner alerts**), and a code to every owner linked to the
   [owner assistant](owner-assistant.md).
2. **Review update**: what changes, what to do, a docs link, *Make a backup first* (on by default).
3. **Update to vX**, or on WhatsApp reply `confirm ABCD` (backup, update, result reported after the restart).
4. Not now: *Remind me in 7 days* / `cancel ABCD`, or *Dismiss* until a newer breaking release.

> [!IMPORTANT]
> Codes are valid 3 days and only for owners. *Notify me* never installs; *Install automatically* stops before the
> breaking release.

<details>
<summary>Command line and admin MCP</summary>

- `sudo duniya update` installs the newest release that needs no decision and prints the notes;
  `sudo duniya update --breaking` also crosses a breaking one.
- Admin MCP: `get_update_status` (steps, safe target), `apply_update` (`breaking: true` to cross one; confirmation
  required), `snooze_update_decision`.

</details>

### OS updates (installer servers)

**Server → OS updates & maintenance → Install OS updates**, then **Restart server** when the page says so.

- The list is grouped: **Will install** (the count on the **Server** tab), **Rolling out gradually** and **Held
  back** (with the reason, e.g. *On hold (apt-mark hold)*).
- The install uses `apt-get full-upgrade`, so new kernels install too (plain `apt upgrade` keeps them back), then
  removes packages nobody needs any more (`autoremove --purge`; the running kernel is kept). This frees disk on small
  servers.
- **Rolling out gradually**: Ubuntu releases some updates to a growing share of servers over a few days (*phased
  updates*). They install by themselves within days; **Include gradual updates now** installs them right away.
- After a run you get one line, e.g. *Installed 3 updates · 4 new packages · 1 rolling out gradually · restart
  needed*. The full apt output stays under **Output**.
- **Restart needed to finish (new kernel)** shows the packages that asked for it and a **Restart server** button
  (agents are offline 1–2 minutes). If it waits more than 7 days, the [weekly summary](owner-assistant.md#owner-alerts-and-weekly-summary) says so.

> [!NOTE]
> On a 1 GB server a kernel update takes a few minutes and uses swap (the installer adds 2 GB); apt runs at low
> priority so agents keep answering. A run that was cut off is finished first on the next run.

> [!IMPORTANT]
> The OS update steps live in the root maintenance helper, which the in-panel app update cannot replace. If the
> page says *This server has an older maintenance helper*, run `sudo duniya update` on the server once (or re-run
> the installer). Admin MCP: `list_os_updates`, `run_maintenance` with `os-update` or `os-update-all`.

### Per host

| Host | App | OS / infrastructure |
|---|---|---|
| Installer server | as above | **Server → OS updates & maintenance** ([details](#os-updates-installer-servers)) |
| Docker | `docker compose pull && docker compose up -d` | host `apt upgrade` |
| Oracle Cloud stack | as above | **Edit** stack → latest zip → **Plan** → **Apply** ([step by step](deploy/oci-free-tier.md#update-the-stack-infrastructure)) |
| Google Cloud | as above ([guide](deploy/google-cloud.md#update-the-app)) | panel OS updates |

## Moving to a new server or recreating one

Back up (**Backups → Back up now & download**), set up the new server, then **Restore a backup** on its first screen
(or **Backups → Restore → A file**). What changes per host (IP, sslip.io address, domain DNS, WhatsApp link):
[Oracle Cloud](deploy/oci-free-tier.md#recreate-from-scratch) · [Google Cloud](deploy/google-cloud.md#recreate-from-scratch) ·
[own server](install.md#recreate-from-scratch-new-server-or-fresh-os) · [Docker](deploy/docker.md#recreate-from-scratch).

---
**Next:** [Upgrading](upgrading.md) · [Managing your server](README.md#run-it) · [Docs index](README.md)
