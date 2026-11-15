# Small servers

A 1 GB / 1 vCPU VM (OCI `VM.Standard.E2.1.Micro`, Google `e2-micro`) runs Duniya fine; optional heavy features adapt
so they never take the WhatsApp connection down. The size is detected at startup (RAM, a Docker/cgroup memory limit,
CPUs) and shown on **Server** ("Small server: 1 GB memory, 1 CPU…") and in `/api/status` (`server.size`: small < 2 GB or
1 CPU, large ≥ 8 GB and 4 CPUs, medium otherwise).

- **Media queue**: photo and voice-note turns, picture creation and voice replies run in a queue kept in SQLite (a
  restart picks them up again), one at a time on small servers (2 on medium, 3 on large), in order per chat. If a job
  hasn't started after ~10 s the agent reacts ⏳ to the message (removed when done); after ~60 s it says once "I'm on
  it". Jobs older than 15 minutes (`MEDIA_JOB_MAX_AGE_MIN`) get a short apology instead of a late answer. Only when the
  queue is full (20 jobs on small servers) does the agent ask to send it again later. Text messages never wait in it.
- **Limits**: media larger than `WA_MEDIA_MAX_MB` is refused by WhatsApp's declared size, before downloading; every
  download, conversion, transcription and picture has a timeout; ffmpeg runs with `nice` and a memory cap; temp files
  are always removed.
- **On-server engines** can't be switched on below 2 GB of memory (use OpenAI or OpenRouter instead), and each job
  checks for ~400 MB of free memory first — otherwise the provider is used or the agent asks for text.
- **Memory pressure**: when the app uses more than 70 % of the memory, optional work pauses (background summaries,
  on-server speech, picture creation) with one activity entry, and resumes when memory frees up. Replies continue.
- **Copilot**: its helper (~400 MB download, its own process) is refused below 2 GB. **Local tool services**: at most 2
  run at once on small servers (6 on medium); the least recently used one stops and starts again when needed.

![Small server note on the Server page](site/img/card-small-server.webp)

---
[Docs index](README.md)
