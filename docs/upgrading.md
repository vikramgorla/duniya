# Upgrading

**Every 2.x release updates in place and keeps your data; breaking releases wait for your OK.**

**Do it:** panel → **Overview → Server → Updates** (or `sudo duniya update`).

**In 30 seconds**
- Semver: minor = features, patch = fixes, major = may need a reinstall.
- Since 2.9.0 the app asks you before a breaking release; older servers: update to 2.9.0 first.
- Releases that need a step from you are listed [below](#how-breaking-releases-reach-you).

## Within 2.x

| Installed with | Update |
|---|---|
| Installer (any host) | **Overview → Server → Updates**, `sudo duniya update`, or re-run the installer |
| Docker | `docker compose pull && docker compose up -d` |

Step by step per host: [Oracle Cloud](deploy/oci-free-tier.md#update-the-app) ·
[Google Cloud](deploy/google-cloud.md#update-the-app) · [own server](install.md#managing-your-server) ·
[Docker](deploy/docker.md#update-the-app). Release notes: [GitHub Releases](https://github.com/vikramgorla/whatsapp-agent-duniya/releases).

> [!NOTE]
> Servers installed with an early 2.x may need one step:
> - **Web address & access**, OS updates and restarts are applied by the root maintenance helper. If the panel says
>   maintenance needs a one-time setup, re-run the installer.
> - **Photos & voice** need `ffmpeg` and `bzip2` (voice replies, on-server speech): re-run the installer; the Docker
>   image includes them.

## How breaking releases reach you

`releases.json` in the repository lists, per version, whether it is breaking, what changes, what to do and whether
old data is carried over; the app reads it from the newest release with git. Automatic updates stop before a breaking
release (or a new major) and you are asked on the panel and on WhatsApp.
[How the decision works →](backups-and-updates.md#updates)

| Version | Breaking | What to do |
|---|---|---|
| 2.9.6 | no | Sign in with Google on more than one address (or after a domain change): register every origin and redirect URI shown under **Settings → Sign in with Google** ([how](google-sign-in.md#when-the-panels-address-changes)). |
| 2.7.0 | no | Voice replies and on-server speech: re-run the installer (adds `ffmpeg`, `bzip2`). |
| 2.5.0 | no | Re-run the installer (root maintenance helper). Limited access to Cloudflare? Choose it again under **Settings → Web address & access**: not carried over. |

> [!WARNING]
> Servers older than 2.9.0 don't read `releases.json`: their automatic update may cross a breaking release once.
> Update them to 2.9.0 first.

---
**Next:** [Backups & updates](backups-and-updates.md) · [Docs index](README.md)
