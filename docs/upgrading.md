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

## From 1.x to 2.0

2.0 renamed bots to agents everywhere (database tables, settings, API paths such as `/api/agents`, admin MCP tool
names such as `create_agent`, export files `duniya-agent`) and has **no migration**: a 1.x database, a 1.x backup or a
1.x agent export cannot be used. Install 2.x on a fresh server (or remove the data directory), link WhatsApp again and
set the agents up again (the AI helper and templates make this quick).

---
[Docs index](README.md)
