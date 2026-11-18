# How it works

**One Node.js app: chat channels in (WhatsApp, Telegram), an allow-list and router, agents stored as data, models and
tools out, a panel on top.**

**In 30 seconds**
- Off chats are dropped first; agents are data; tools are allowed per role in code.
- Channels plug into one hub, which loads a channel only when it is set up and on (a fresh install loads no WhatsApp
  or Telegram code); chat tools follow what the chat's channel can do.
- Panel on `localhost:8080` behind Caddy, a tunnel, Tailscale or SSH. Roles: owner, admin (agents, chats, models,
  memory), viewer (read-only). The panel is a small page plus native ES modules, compressed, each cached under its
  content hash (a new release re-downloads only what changed); Overview comes first and other screens load on their
  first visit. Status and activity arrive live over server-sent events, so nothing polls.

<p align="center"><img src="diagrams/architecture.svg" alt="Architecture: the WhatsApp adapter (linked devices) and the Telegram adapter (a bot, long polling) feed the channel hub, which loads a channel only when it is set up and on; the hub feeds the allow-list (off chats are dropped), then the router (owner DMs go to the owner assistant; quick-reply commands and FAQ matches are answered without AI), then the agent, which uses a model provider with fallback, MCP tools behind the confirm gate, chat actions by channel capability (sent back through the hub) and memory; the agent, the panel and the admin MCP use SQLite with encrypted secrets" width="720"></p>

<details><summary>Diagram as text</summary>

1. Messages come from one or more WhatsApp linked devices (the WhatsApp adapter) and from a Telegram bot (the Telegram
   adapter, long polling over the Bot API).
2. The channel hub: loads a channel's adapter only when it is set up and on, notes each chat for the Chats list, and
   routes every send or action back to the chat's channel.
3. Allow-list: chats that are off are dropped.
4. Router: triggers, roles and rate limits; owner DMs go to the owner assistant; a quick-reply command or a clear FAQ match is answered right away from the owner's text (no AI, no tokens).
5. The agent (stored in the app) uses a model provider with fallback, MCP tools with per-role allow lists, chat actions (only those the chat's channel can do), memory (messages, summary, notes, search).
6. Preview tools go through the confirm gate: an organizer replies `confirm CODE`.
7. The agent, the panel and the admin MCP use SQLite with encrypted secrets and backups.

</details>

| | |
|---|---|
| **Sign-in** | [Google](google-sign-in.md) (owners invite by email; *Only allow Sign in with Google* turns passwords off) or a password |
| **Channels** | `src/channels/`: the catalogue (`index.js`: ids and capabilities), the hub (`hub.js`), one folder per adapter (`whatsapp/`, `telegram/`); [adding a channel](development.md#adding-a-channel) |
| **People** | one person id per human with their identities per channel; the same phone number joins them; on Telegram, a person's number counts only when they share their own contact (`src/core/people.js`) |
| **Data** | SQLite in `DATA_DIR`, WhatsApp sessions, local backups; secrets encrypted, files mode 0600 |
| **Code map** | [AGENTS.md → Architecture map](../AGENTS.md#architecture-map) |
| **Specs / design** | [`specs/`](../specs) · [DESIGN.md](../DESIGN.md) |

---
**Next:** [Development](development.md) · [Docs index](README.md)
