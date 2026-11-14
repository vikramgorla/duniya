# Quickstart: Admin MCP Server

## Try it locally

```bash
npm test                                  # includes test/admin-mcp.test.js
PANEL_PORT=8080 npm start                 # then open http://127.0.0.1:8080 → Settings → Connected AI assistants
```

Local MCP clients (MCP Inspector, Claude Desktop via a loopback redirect) can use `http://127.0.0.1:8080/mcp`.
ChatGPT and Claude on the web need the public address.

## Production

1. Expose the panel over HTTPS (installer: domain, IP with Caddy, or Cloudflare Tunnel; `TRUST_PROXY=1` is set).
   Optionally set `PUBLIC_URL=https://your-host` in the service environment.
2. Settings → Connected AI assistants → Copy the address.
3. ChatGPT: Settings → Apps & Connectors → Advanced → Developer mode on → Create → paste URL, OAuth → Create.
   Claude: Settings → Connectors → Add custom connector → paste URL → Add → Connect.
4. Sign in on the Duniya page if asked, review, Approve.
5. Ask: "list my bots", "turn off helper", "delete bot X" (the assistant shows the preview and asks you to confirm).

## Check by hand with curl

```bash
curl -s https://HOST/.well-known/oauth-protected-resource/mcp
curl -s https://HOST/.well-known/oauth-authorization-server
curl -si -X POST https://HOST/mcp | grep -i www-authenticate
```
