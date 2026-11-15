# Small servers

**A free 1 GB / 1 vCPU VM runs Duniya fine; heavy features adapt so they never take WhatsApp down.**

**Check it:** panel → **Server** shows the size ("Small server: 1 GB memory, 1 CPU…").

**In 30 seconds**
- Size is detected at startup (RAM incl. a container limit, CPUs): **small** < 2 GB or 1 CPU, **large** ≥ 8 GB and 4
  CPUs, **medium** otherwise.
- Photos and voice notes queue up (one at a time on small servers); text never waits.
- Under memory pressure optional work pauses; replies continue.

Examples: OCI `VM.Standard.E2.1.Micro`, Google `e2-micro`. Size also in `/api/status` (`server.size`).

![Small server note on the Server page](site/img/card-small-server.webp)

## What adapts

| | Small | Medium | Large |
|---|---|---|---|
| Media jobs at once | 1 | 2 | 3 |
| Local tool services at once | 2 | 6 | 12 |
| On-server speech | below 2 GB: *Small server mode* only | yes | yes |
| Copilot helper | below 2 GB: no | yes | yes |

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
- **On-server speech** below 2 GB: only with **Small server mode (experimental)** in **Settings → Photos & voice**
  (~900 MB minimum; slow, one at a time). Each job checks free memory first (listening ~400 MB, speaking ~300 MB,
  +150 MB in small server mode); otherwise the provider is used or the agent asks for text.
- **Memory pressure** (> 70 %): summaries, on-server speech and picture creation pause (one activity entry), then
  resume.
- **Copilot** helper (~400 MB download): refused below 2 GB. **Local tool services** over the limit: the least
  recently used one stops until needed.

> [!TIP]
> Try it locally: `DEMO_SMALL=1 node scripts/demo-panel.mjs` pretends to be a 1 GB / 1 CPU server.

---
**Next:** [Photos & voice](models.md#photos--voice) · [Oracle Cloud](deploy/oci-free-tier.md) · [Docs index](README.md)
