# Small servers

**A free 1 GB / 1 vCPU VM runs Duniya fine; heavy features adapt so they never take WhatsApp down.**

**Check it:** panel → **Server** shows the size ("Small server: 1 GB memory, 1 CPU…").

**In 30 seconds**
- Size is detected at startup (RAM incl. a container limit, CPUs): **small** < 2 GB or 1 CPU, **large** ≥ 8 GB and 4
  CPUs, **medium** otherwise.
- Photos and voice notes queue up (one at a time on small servers); text never waits.
- Under memory pressure optional work pauses; replies continue.
- On-server speech and local tool services are off on small servers; **Small server mode** (Settings → Server)
  allows them anyway, slower and one at a time.
- Old data is pruned by itself and the server recovers by itself (reconnects, restarts, a full disk): see
  [Health](#health-data-that-stays-small).

Examples: OCI `VM.Standard.E2.1.Micro`, Google `e2-micro`. Size also in `/api/status` (`server.size`).

![Server: CPU, memory, disk and network, the small-server note, Health and OS updates](site/img/server-desktop.webp)

## What adapts

| | Small | Medium | Large |
|---|---|---|---|
| Media jobs at once | 1 | 2 | 3 |
| Local tool services | *Small server mode* only, 2 at once | 6 at once | 12 at once |
| On-server speech | below 2 GB: *Small server mode* only | yes | yes |
| Copilot helper | below 2 GB: no (not even with *Small server mode*) | yes | yes |

## Small server mode

One server-wide switch: **Settings → Server → Small server mode: allow heavier features on this server** (owner only;
also `set_small_server_mode` for [AI assistants](admin-mcp.md), with a confirmation).

1. Open **Settings**, find the **Server** card.
2. Switch on **Small server mode**. Every refusal that it can lift says so: *…or switch on Small server mode in
   Settings → Server*.

![Settings, Server card with Small server mode switched on and its caveats](site/img/card-small-mode.webp)

| With the switch on | Extra limits that stay |
|---|---|
| On-server speech (Settings → Photos & voice) | about 900 MB minimum, smallest models, one voice note at a time, starts only with enough free memory (+150 MB), paused when memory is tight |
| Local tool services (by hand, from Browse, by the AI assistants) | at most 2 run at once, each started when first used, all stopped when memory is tight (they start again when needed) |

> [!WARNING]
> Slower, and heavier work waits or is refused at busy moments; the agent then answers without those tools or asks
> for text. The installer's 2 GB swap is the safety net. Hosted tool services and providers are faster and safer here.

> [!NOTE]
> **Not covered:** GitHub Copilot sign-in. Its ~400 MB download and helper process run inside the app's 700 MB memory
> cap next to the app itself, so on 1 GB they fail or get the app stopped. It stays refused below 2 GB.

## The media queue

Photo and voice turns, pictures and voice replies queue in SQLite (survives a restart), in order per chat.

<p align="center"><img src="diagrams/media-queue.svg" alt="Media queue: a photo or voice note is refused with please send again later when the queue is full (20 on small servers); otherwise it waits, gets an hourglass reaction after about 10 seconds, an I am on it message after about 60 seconds, and a short apology instead of a late answer after 15 minutes; the hourglass is removed when done" width="572"></p>

<details><summary>Diagram as text</summary>

1. A photo or voice note arrives.
2. Queue full (20 on small servers): "please send again later".
3. Otherwise it waits in the queue.
4. After about 10 s the agent reacts with ⏳.
5. After about 60 s it says "I'm on it" once.
6. After 15 min it sends a short apology instead of a late answer.
7. When done, the answer comes and ⏳ is removed.

</details>

Max age: `MEDIA_JOB_MAX_AGE_MIN` (15). [Settings](settings.md)

## Guardrails

- **Limits**: media over `WA_MEDIA_MAX_MB` is refused before downloading (WhatsApp's declared size). Every download,
  conversion, transcription and picture has a timeout; ffmpeg runs with `nice` and a memory cap; temp files are
  always removed.
- **On-server speech** below 2 GB: only with [Small server mode](#small-server-mode)
  (~900 MB minimum; slow, one at a time). Each job checks free memory first (listening ~400 MB, speaking ~300 MB,
  +150 MB in small server mode); otherwise the provider is used or the agent asks for text.
- **Memory pressure** (> 70 %): summaries, on-server speech and picture creation pause (one activity entry), then
  resume.
- **Copilot** helper (~400 MB download): refused below 2 GB, with or without Small server mode.
- **Local tool services** (each one an extra Node.js process): on a small server, adding or changing one is refused
  on every path (agent page → Tools, Settings → Tool services, Browse tool services, import, duplicate, AI assistants)
  with the same message, unless [Small server mode](#small-server-mode) is on. Hosted services work as usual. Over the
  limit, the least recently used one stops until needed.
- **Local tool services saved before** (on a bigger server, before 2.17, or from a backup) stay in the configuration
  but are **not started** while the server is small and the switch is off: the agent answers without their tools,
  the agent's Tools section says *Not started on this server* and why, the activity log says it once, and Install is refused.
  Switch on Small server mode, move to a bigger server, or remove them.

## Health: data that stays small

**Server → Health** shows the database size, how many stored messages, activity entries and model calls are kept and
since when, how long each kind is kept, the last automatic clean-up and the photos & voice queue. Nothing to click:

- **Every hour** old data goes, in small batches so replies never wait: stored messages older than **90 days** or
  beyond **5 000 per chat**, activity as set in **Settings → Activity log** (30 days / 5 000 entries), usage detail
  older than **400 days**, why-quiet rows after 90 days, daily counters after 60 days. Chat summaries, notes,
  contacts and settings are never pruned, so agents keep what older talk decided. The owner changes the numbers under
  **Change how long data is kept** (or with the admin MCP tool `set_retention`). Backups stay small with it.
- The database is kept compact (freed space is reused and handed back in small steps).
- **Disk:** below 500 MB free (or 5 %) the owner is told once a day. Below 100 MB, stored messages and optional
  activity pause (errors and changes are still recorded), backups wait with a clear reason, and agents keep
  answering; everything resumes by itself when space is back.
- **Clock:** if the server clock jumps, nothing old is pruned until it is steady again (a wrong clock never deletes
  history); Health says so.

> [!NOTE]
> Measured on a seeded server (300 chats, 30 agents, 200 000 stored messages, 50 000 activity entries) with 1 CPU:
> panel ready in about 0.4 s at ~160 MB, every panel request in a few milliseconds. Details:
> [development.md](development.md#scale-measurements).

## Recovering by itself

- **WhatsApp** reconnects with growing pauses (2 s up to 1 minute, a little random so several numbers never retry at
  the same moment). A number that keeps reconnecting for 15 minutes is reported to the owner once.
- **Restarts** (updates, the Restart button, systemd) are graceful: no new replies start, running ones get a few
  seconds, WhatsApp closes without unlinking and the database is closed cleanly. A crash restarts the app
  (systemd `Restart=always` with no start limit, or Docker `restart: unless-stopped`); `MemoryMax=700M` keeps a
  runaway process from taking the server down.
- **Photos & voice queue:** when it is full, new ones are refused for a few minutes (the sender is told) and the owner
  hears about it at most once an hour; waiting work is never dropped.

> [!TIP]
> Try it locally: `DEMO_SMALL=1 node scripts/demo-panel.mjs` pretends to be a 1 GB / 1 CPU server.

---
**Next:** [Photos & voice](models.md#photos--voice) · [Oracle Cloud](deploy/oci-free-tier.md) · [Docs index](README.md)
