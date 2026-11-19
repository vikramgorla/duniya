# Docker / Compose

**Duniya in containers on any machine with Docker: three commands, data in one volume.**

```bash
git clone https://github.com/vikramgorla/whatsapp-agent-duniya && cd duniya
cp .env.example .env
docker compose up -d
```

**In 30 seconds**
- All data lives in the `duniya-data` volume.
- Update: `git pull` + `docker compose pull` + `up -d` (the panel updater is for installer servers).
- Always repeat the **same `--profile` flags** you started with.

| Command | Result |
|---|---|
| `docker compose up -d` | Panel on `http://127.0.0.1:8080`, this machine only |
| `docker compose --profile https up -d` | Caddy serves `https://$DOMAIN` (set `DOMAIN` in `.env`, ports 80/443) |
| `docker compose --profile tunnel up -d` | Cloudflare Tunnel with `TUNNEL_TOKEN`; point the hostname to `http://app:8080` |

## Where is my panel?

| Profile | Address |
|---|---|
| none | `http://localhost:8080` on the Docker machine; from another computer `ssh -L 8080:127.0.0.1:8080 you@host`, then the same address |
| `https` | `https://$DOMAIN` |
| `tunnel` | your Cloudflare hostname |

The first screen asks for the setup code: `docker compose exec app duniya show-setup-code`, or set `ADMIN_PASSWORD`
in `.env`.

> [!NOTE]
> Images: `ghcr.io/vikramgorla/whatsapp-agent-duniya:v<version>` or `:latest`, amd64 and arm64, published on each
> release. Command line: `docker compose exec app duniya help`.

## Update the app

1. Optional: **Backups → Back up now & download** in the panel.
2. In the cloned folder, with your `--profile` flags:

   ```bash
   git pull
   docker compose pull
   docker compose up -d
   ```

3. Check: **Overview → Server** shows the new version; `docker compose logs --tail 50 app` shows no errors.

> [!WARNING]
> Forgetting your `--profile` flags (e.g. `docker compose --profile https pull`) leaves Caddy or cloudflared out.

> [!TIP]
> Pin a version: `image: ghcr.io/vikramgorla/whatsapp-agent-duniya:v2.9.2` in a `docker-compose.override.yml`.
> Host OS updates are yours (`apt upgrade`).

## Recreate from scratch

- **Containers only** (data stays): `docker compose down && docker compose up -d` (with your profiles).
- **Fresh start or a new machine:**
  1. Panel → **Backups** → passphrase (write it down) → **Back up now & download**.
  2. Old machine: `docker compose down`.
  3. New machine: clone, copy your `.env`, `docker compose up -d`.
  4. Panel → **Restore a backup** → setup code → file → passphrase. Sign in with the backup's accounts; link
     WhatsApp again if the backup didn't include it.
  5. `https` profile: point your domain's DNS to the new machine.

> [!WARNING]
> Never run two servers with the same WhatsApp link: stop the old one first.

## Remove everything

```bash
docker compose down        # removes the containers; the volumes (your data) stay
docker compose down -v     # also deletes the volumes: database, WhatsApp link, local backups. Back up first!
docker image rm ghcr.io/vikramgorla/whatsapp-agent-duniya caddy:2 cloudflare/cloudflared 2>/dev/null
```

Then delete the cloned folder, and close ports 80/443 if you opened them.

## Find things fast

| You want | Command |
|---|---|
| Is it running? | `docker compose ps` · `docker compose exec app duniya status` |
| Logs | `docker compose logs -f app` (also `caddy`, `cloudflared`) |
| Restart | `docker compose restart app` |
| Setup code / password | `docker compose exec app duniya show-setup-code` · `docker compose exec app duniya reset-password <user>` |
| Where the data is | `docker volume ls` (ends in `duniya-data`) |

> [!TIP]
> On a phone or iPad, use an SSH app (Termius, Blink) for these commands. Backups, restore and the update check are
> in the panel.

---
**Next:** [Getting started](../getting-started.md) · [Cloudflare Tunnel](cloudflare-tunnel.md) · [Docs index](../README.md)
