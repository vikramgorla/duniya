# How it works

```
WhatsApp (linked device) ─► allow-list ─► router ─► agent (stored in the app) ─► model provider
                                            │            ├─ MCP tool services (per-role allow lists, enforced in code)
                                            │            ├─ WhatsApp actions (media, reactions, polls, group admin)
                                            │            ├─ memory: recent messages + running summary + notes + search
                                            │            └─ plugins (optional code: tools, commands)
                                            └─ confirm gate: *_preview results held; an organizer replies "confirm CODE"
Admin panel (localhost:8080 behind Caddy / Cloudflare Tunnel / SSH) · SQLite · encrypted secrets & backups
```

- **Panel users**: owner (everything), admin (agents, chats, models, memory), viewer (read-only). Sign in with Google
  (owners invite people by email; *Only allow Sign in with Google* turns passwords off) or a password.
- **Data**: SQLite in `DATA_DIR`, WhatsApp sessions, local backups; secrets encrypted with mode 0600.
- **Where the code lives**: see the architecture map in [AGENTS.md](../AGENTS.md#architecture-map).
- Feature specs: [`specs/`](../specs). Design language: [DESIGN.md](../DESIGN.md).

---
[Docs index](README.md)
