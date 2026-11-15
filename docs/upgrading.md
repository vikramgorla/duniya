# Upgrading

**Every 2.x release updates in place and keeps your data; breaking releases wait for your OK.**

**Do it:** panel → **Overview → Server → Updates** (or `sudo duniya update`).

**In 30 seconds**
- Semver: minor = features, patch = fixes, major = may need a reinstall.
- Since 2.9.0 the app asks you before a breaking release; older servers: update to 2.9.0 first.
- 1.x → 2.x: fresh install, no migration.

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
| 2.7.0 | no | Voice replies and on-server speech: re-run the installer (adds `ffmpeg`, `bzip2`). |
| 2.5.0 | no | Re-run the installer (root maintenance helper). Limited access to Cloudflare? Choose it again under **Settings → Web address & access**: not carried over. |
| 2.0.0 | **yes** | Fresh install; 1.x data, backups and exports cannot be used ([below](#from-1x-to-20)). |

> [!WARNING]
> Servers older than 2.9.0 don't read `releases.json`: their automatic update may cross a breaking release once.
> Update them to 2.9.0 first.

## From 1.x to 2.0

2.0 renamed bots to agents everywhere (database tables, settings, API paths such as `/api/agents`, admin MCP tools
such as `create_agent`, export files `duniya-agent`) and has **no migration**.

1. Install 2.x on a fresh server (or remove the data directory).
2. Link WhatsApp again.
3. Set the agents up again: templates and the AI helper make it quick.

> [!CAUTION]
> A 1.x database, backup or agent export cannot be used with 2.x.

---
**Next:** [Backups & updates](backups-and-updates.md) · [Docs index](README.md)
