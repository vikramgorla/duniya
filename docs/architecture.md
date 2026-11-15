# How it works

**One Node.js app: WhatsApp in, an allow-list and router, agents stored as data, models and tools out, a panel on
top.**

**In 30 seconds**
- Off chats are dropped first; agents are data; tools are allowed per role in code.
- Panel on `localhost:8080` behind Caddy, a tunnel, Tailscale or SSH. Roles: owner, admin (agents, chats, models,
  memory), viewer (read-only).

```mermaid
flowchart LR
  WA["WhatsApp<br/>linked device(s)"] --> AL{"Allow-list:<br/>chat on?"}
  AL -- off --> X["dropped"]
  AL -- on --> R["Router<br/>triggers · roles · rate limits"]
  R -- "owner DM" --> OA["Owner assistant"]
  R --> AG["Agent<br/>(stored in the app)"]
  AG --> M["Model provider<br/>+ fallback"]
  AG --> T["MCP tool services<br/>per-role allow lists"]
  AG --> W["WhatsApp actions"]
  AG --> MEM["Memory: messages,<br/>summary, notes, search"]
  AG --> PL["Plugins (optional)"]
  T -- "preview tools" --> CG["Confirm gate:<br/>organizer replies confirm CODE"]
  P["Panel · mobile app ·<br/>admin MCP"] --> DB[("SQLite · encrypted<br/>secrets & backups")]
  AG --> DB
```

| | |
|---|---|
| **Sign-in** | Google (owners invite by email; *Only allow Sign in with Google* turns passwords off) or a password |
| **Data** | SQLite in `DATA_DIR`, WhatsApp sessions, local backups; secrets encrypted, files mode 0600 |
| **Code map** | [AGENTS.md → Architecture map](../AGENTS.md#architecture-map) |
| **Specs / design** | [`specs/`](../specs) · [DESIGN.md](../DESIGN.md) |

---
**Next:** [Development](development.md) · [Docs index](README.md)
