# Contract: Installer CLI and Updates API

## `install.sh`

```text
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash -s -- [options]

--domain NAME            Serve the panel at https://NAME (DNS must point here). Opens 80/443.
--ip-https               Serve at https://<ip>.sslip.io. Opens 80/443.
--cloudflare-token TOK   Run a Cloudflare Tunnel (no inbound ports). Configure the hostname → http://localhost:8080.
--local-only             Panel only on 127.0.0.1:8080 (use an SSH tunnel).
--admin-password PW      Create owner "admin" (otherwise a setup code is printed).
--repo URL --branch B    Source (default: this repo, main).
--update-mode M          off | notify | auto (default notify).
--yes                    Non-interactive; --dry-run prints the plan only.
```

Exit codes: 0 ok, 1 error, 2 unsupported OS.

## Updates API (owner)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/updates` | | `{ settings, status, install: "systemd" \| "docker" \| "dev" }` |
| PUT | `/api/updates/settings` | `{ mode?, channel?, at? }` | settings |
| POST | `/api/updates/check` | | status |
| POST | `/api/updates/apply` | | `{ code, log }` then restart when code 0 |
