# Manage it from ChatGPT or Claude (admin MCP)

The app is also an MCP server, so you can run it by chatting: "which agents are on?", "turn off the carpool agent",
"what happened in the school group today?". Open **Settings → Connected AI assistants**, copy the address
(`https://YOUR-HOST/mcp`) and follow the short steps shown there:

- **ChatGPT**: Settings → Apps & Connectors → Advanced settings → turn on Developer mode; then Create a connector with
  the address as MCP server URL and OAuth.
- **Claude**: Settings → Connectors → Add custom connector → paste the address → Add → Connect.

A Duniya page opens: sign in (if asked), check what the assistant may do, and click **Approve**. The assistant acts as
you, with your panel role (viewers stay read-only; owner-only actions stay owner-only). Risky actions (deleting an agent,
erasing memory, secrets, users, WhatsApp numbers, backups restore, updates, restarts) return a preview and only happen
after a second `confirm_action` call. Every call is in the activity log ("AI assistants (MCP)"); disconnect an
assistant any time in the same card.

It needs the panel reachable over public HTTPS (Caddy or Cloudflare Tunnel). Behind a proxy set `TRUST_PROXY=1`, or set
`PUBLIC_URL=https://your-host` so the OAuth issuer and MCP address are fixed. Under the hood: OAuth 2.1 with dynamic
client registration, PKCE S256, resource-bound tokens (access 1 h, refresh 30 days with rotation), see
[`specs/017-admin-mcp/`](../specs/017-admin-mcp/spec.md).

## Tools

88 tools cover the panel: overview and activity; agents (create, update, draft with AI, test, export, enable);
chats (assign, settings, private, privacy notice, stored messages); usage, prices, spending caps, owner alerts and the
weekly summary; contacts; memory; WhatsApp groups; models, accounts and fallback; global tool services; secrets;
confirmations; logging; updates (incl. breaking releases: `apply_update` with `breaking: true`, `snooze_update_decision`), server metrics (with where the server is hosted), OS maintenance and restart; backups; users; WhatsApp numbers; photos &
voice. The list is in `src/panel/admin-tools.js`; when a feature adds panel functionality it adds the matching tool
there (see [AGENTS.md](../AGENTS.md)). The [owner assistant](owner-assistant.md) uses the same tools from WhatsApp.

---
[Docs index](README.md)
