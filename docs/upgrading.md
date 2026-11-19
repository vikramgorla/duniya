# Upgrading

**Every 2.x release updates in place and keeps your data; breaking releases wait for your OK.**

**Do it:** panel → **Overview → Server → Updates** (or `sudo duniya update`).

**In 30 seconds**
- Semver: minor = features, patch = fixes, major = may need a reinstall.
- Since 2.9.0 the app asks you before a breaking release; older servers: update to 2.9.0 first.
- Releases that need a step from you are listed [below](#how-breaking-releases-reach-you).
- Updates come from where you installed (the project or a fork); [switch the source](#update-source) any time.
- Every update shows what each release in between brings, and Overview says what's new afterwards.

## Within 2.x

| Installed with | Update |
|---|---|
| Installer (any host) | **Overview → Server → Updates**, `sudo duniya update`, or re-run the installer |
| Docker | `docker compose pull && docker compose up -d` |

Step by step per host: [Oracle Cloud](deploy/oci-free-tier.md#update-the-app) ·
[Google Cloud](deploy/google-cloud.md#update-the-app) · [own server](install.md#managing-your-server) ·
[Docker](deploy/docker.md#update-the-app). Release notes: in the panel (**Settings → Help → Release notes**, and in
the update dialog for the versions you are about to get) and on
[GitHub Releases](https://github.com/vikramgorla/duniya/releases).

> [!NOTE]
> Servers installed with an early 2.x may need one step:
> - **Web address & access**, OS updates and restarts are applied by the root maintenance helper. If the panel says
>   maintenance needs a one-time setup, re-run the installer. A newer helper later on: see
>   [The maintenance helper](#the-maintenance-helper).
> - **Photos & voice** need `ffmpeg` and `bzip2` (voice replies, on-server speech): re-run the installer; the Docker
>   image includes them.

## Update source

Updates come from the repository the server was installed from: the project, or a fork. **Settings → Updates →
Update source** shows it (*the project* or *not the project*) and switches it:

1. Type `owner/name` or `https://github.com/owner/name` (a fork, or the project again: **Use the project**).
2. **Change** → confirm. The server reads that repository's releases first; if it can't (typo, private, offline),
   nothing changes.
3. **Check now** shows what that source has. Updates install its releases from then on.

On the server: `sudo duniya source` shows it, `sudo duniya source owner/name` switches the app **and** the
maintenance helper (from the panel only the app moves: the helper keeps the source in its root-owned config, because
the app must never choose what root downloads). Re-running the installer keeps the source in use, or takes
`--repo owner/name`. Docker: set `image:` in `docker-compose.yml` (e.g. `ghcr.io/you/duniya:latest`).

> [!NOTE]
> **The repository was renamed or moved?** GitHub forwards git and release links from the old name, so servers keep
> updating; switch the source to the new name when convenient. GitHub Pages is not forwarded: the website moves to
> `https://<owner>.github.io/<new-name>/`.

## The maintenance helper

The root maintenance helper (`/usr/local/sbin/duniya-ops`) applies OS updates, restarts and web address changes. The
app has no root, so the in-panel app update cannot change it directly.

**Since 2.17 it updates itself.** After an app update the app asks it once; the server itself downloads that
release's helper from the repository in its install config (HTTPS, certificate checked, only `deploy/ops`) and
installs it. If that
did not happen: **Server → OS updates & maintenance → Update maintenance helper**.

| Panel says | Do this |
|---|---|
| *A newer maintenance helper comes with this release* | **Update maintenance helper** |
| *This server has an older maintenance helper that cannot update itself yet* | Once: `sudo duniya update` over SSH. After that it updates itself |
| Same, and you have **no SSH access** | Reinstall: back up, recreate, restore ([Oracle](deploy/oci-free-tier.md#recreate-from-scratch) · [Google Cloud](deploy/google-cloud.md#recreate-from-scratch) · [Moving to a new server](backups-and-updates.md#moving-to-a-new-server-or-recreating-one)) |

> [!IMPORTANT]
> A helper from before 2.17 does not know how to update itself, so it needs **one** root run (or a reinstall) to get
> that ability. This cannot be done from the panel: the app must never be able to make root run its own code.
> Oracle servers created without an SSH key can't get one later, so a reinstall is the way there; add an SSH key when
> you create the new one if you want shell access ([how](deploy/oci-free-tier.md#ssh-access)).

<details><summary>How it stays safe</summary>

- The app only writes the action word and its release number (`vX.Y.Z`, checked strictly by the helper).
- The repository address comes only from the root-owned `/etc/duniya/install.conf` (https only; written by the
  installer and `sudo duniya source`), never from the app; git runs as root only in the root-owned `/var/lib/duniya-ops/src`, with a clean environment,
  no hooks, one tag, shallow and blobless (a few hundred KB), and that folder is removed afterwards.
- No downgrades: releases older than 2.17.0 or than the last one it installed are refused, and so is a helper with a
  lower version line. The new helper must parse (`bash -n`) and is renamed into place.
- Status and output appear under **Server → OS updates & maintenance** like any other action.

</details>

## How breaking releases reach you

`releases.json` in the repository lists, per version, its changes (new, improved, fixed, removed), whether it is
breaking, what to do and whether old data is carried over; the app reads it from the newest release with git and shows
the releases between yours and the new one before you update. Automatic updates stop before a breaking
release (or a new major) and you are asked on the panel and on WhatsApp.
[How the decision works →](backups-and-updates.md#updates)

| Version | Breaking | What to do |
|---|---|---|
| 2.31.0 | no | New backup format: backups made by 2.30 or earlier can't be restored any more. After updating, make a new backup (**Backups → Back up now**, or wait for the next scheduled one) ([details](backups-and-updates.md#backups)). |
| 2.17.0 | no | Servers whose maintenance helper predates 2.17: run `sudo duniya update` once (or reinstall without SSH) so the helper can [update itself](#the-maintenance-helper) from then on. Small server mode moved to **Settings → Server** and now also covers local tool services ([details](small-servers.md#small-server-mode)). |
| 2.15.1 | no | Full OS updates (new kernels, gradual updates, restart banner): run `sudo duniya update` on the server once (or re-run the installer) so the root maintenance helper is refreshed; the in-panel update cannot replace it. ([details](backups-and-updates.md#os-updates-installer-servers)) |
| 2.9.6 | no | Sign in with Google on more than one address (or after a domain change): register every origin and redirect URI shown under **Settings → Sign in with Google** ([how](google-sign-in.md#when-the-panels-address-changes)). |
| 2.7.0 | no | Voice replies and on-server speech: re-run the installer (adds `ffmpeg`, `bzip2`). |
| 2.5.0 | no | Re-run the installer (root maintenance helper). Limited access to Cloudflare? Choose it again under **Settings → Web address & access**: not carried over. |

> [!WARNING]
> Servers older than 2.9.0 don't read `releases.json`: their automatic update may cross a breaking release once.
> Update them to 2.9.0 first.

---
**Next:** [Backups & updates](backups-and-updates.md) · [Docs index](README.md)
