# Upgrading

## Within 2.x

Every 2.x release updates in place: **Overview → Server → Updates**, `sudo duniya update`, or run the installer again
(Docker: `docker compose pull && docker compose up -d`). Your data, chats, agents and secrets stay. Read the release
notes on [GitHub Releases](https://github.com/vikramgorla/whatsapp-agent-duniya/releases) for anything to do after an
update. Two things that may need a step on servers installed with an early 2.x:

- **Web address & access**, OS updates and restarts are applied by the root maintenance helper; if the panel says
  maintenance needs a one-time setup, run the installer once more.
- **Photos & voice** need `ffmpeg` and `bzip2` for voice replies and on-server speech; the installer (re-run) and the
  Docker image include them.

Versions follow semver: minor releases add features, patch releases fix things, a major release may need a reinstall.

## How breaking releases reach you

Since 2.9.0 the app knows which releases need you. `releases.json` in the repository lists, per version, whether it is
breaking, what changes, what you need to do and whether old data is carried over; the app reads it from the newest
release with git. When a breaking release (or a new major version) is available, automatic updates stop before it and
you are asked on the panel and on WhatsApp; see [Backups and updates](backups-and-updates.md#updates). A local backup
is made before the update when a backup passphrase is set.

Releases that need a step from you (shown in the panel and in the GitHub release notes):

| Version | Breaking | What to do |
|---|---|---|
| 2.7.0 | no | For voice replies and on-server speech: run the installer once more (adds `ffmpeg`, `bzip2`). |
| 2.5.0 | no | Run the installer once more (root maintenance helper). If you limited access to Cloudflare, choose it again under Settings → Web address & access: the old setting is not carried over. |
| 2.0.0 | **yes** | Fresh install; 1.x data, backups and exports cannot be used (below). |

Servers older than 2.9.0 do not know about `releases.json`: their automatic update may still cross a breaking
release once. Update them to 2.9.0 first (it is not breaking).

## From 1.x to 2.0

2.0 renamed bots to agents everywhere (database tables, settings, API paths such as `/api/agents`, admin MCP tool
names such as `create_agent`, export files `duniya-agent`) and has **no migration**: a 1.x database, a 1.x backup or a
1.x agent export cannot be used. Install 2.x on a fresh server (or remove the data directory), link WhatsApp again and
set the agents up again (the AI helper and templates make this quick).

---
[Docs index](README.md)
