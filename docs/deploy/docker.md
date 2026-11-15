# Docker / Compose

```bash
git clone https://github.com/vikramgorla/whatsapp-agent-duniya && cd whatsapp-agent-duniya
cp .env.example .env
```

| Command | Result |
|---|---|
| `docker compose up -d` | Panel on `http://127.0.0.1:8080` of this machine only |
| `docker compose --profile https up -d` | Caddy serves `https://$DOMAIN` (set `DOMAIN` in `.env`, ports 80/443) |
| `docker compose --profile tunnel up -d` | Cloudflare Tunnel with `TUNNEL_TOKEN`; point the hostname to `http://app:8080` |

- Data (database, WhatsApp link, secrets, backups) lives in the `duniya-data` volume.
- Setup code: `docker compose logs app | grep -i 'setup code'`, or set `ADMIN_PASSWORD` in `.env`.
- Update: `docker compose pull && docker compose up -d` (the panel's in-place updater is for installer setups).
- Images: `ghcr.io/vikramgorla/whatsapp-agent-duniya:<version>` for amd64 and arm64, published on each release.
- Command line: `docker compose exec app duniya help` (reset a password, list users, status, backup now, …). For the
  setup code: `docker compose exec app duniya show-setup-code`.
