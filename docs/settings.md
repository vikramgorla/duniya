# Optional settings (environment)

**Environment variables for the service itself; almost everything else is in the panel.**

**Where:** installer servers `/etc/duniya/app.env` (then `sudo duniya restart`) · Docker `.env`.

> [!TIP]
> You rarely need these: the installer sets `PUBLIC_URL`, and the panel covers models, agents, access and backups.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | from the request | Public address of the panel (set by the installer); used for sign-in redirects and the MCP address |
| `TRUST_PROXY` | off | Trust `X-Forwarded-*` headers from a reverse proxy |
| `PANEL_HOST` / `PANEL_PORT` | `127.0.0.1` / `8080` | Where the panel listens |
| `ADMIN_PASSWORD` | — | Create owner `admin` with this password on first start (otherwise a setup code is printed) |
| `DATA_DIR` | `data` | SQLite database, WhatsApp sessions, local backups |
| `TZ_DEFAULT` | `Europe/Zurich` | Default timezone for schedules |
| `RATE_LIMIT_PER_MIN` | 6 | Requests one person may make to one agent per minute |
| `MEMORY_RETENTION_DAYS` / `MEMORY_MAX_MESSAGES` | 90 / 5000 | Default stored-message limits per chat; the owner changes them on **Server → Health** ([Health](small-servers.md#health-data-that-stays-small)) |
| `HISTORY_WAIT_MS` | 45000 | How long to wait for the phone to send a chat's recent messages after it is switched on (per 50 messages) |
| `WA_MEDIA_MAX_MB` | 16 | Largest media file an agent may send or receive (photos, PDFs, voice notes) |
| `MEDIA_JOB_MAX_AGE_MIN` | 15 | Photo / voice-note jobs older than this get a short apology instead of a late answer |
| `UPDATE_MODE` | `notify` | `off`, `notify` or `auto` |
| `BACKUP_UPLOAD_MAX_MB` | 200 | Largest backup file accepted by "Restore from a file" |

---
**Next:** [Admin MCP](admin-mcp.md) (`PUBLIC_URL`, `TRUST_PROXY`) · [Small servers](small-servers.md) · [Docs index](README.md)
