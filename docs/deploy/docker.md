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

- **Where is my panel?** `http://localhost:8080` on the machine running Docker (from another computer:
  `ssh -L 8080:127.0.0.1:8080 you@host`, then the same address), `https://$DOMAIN` with the https profile, or your
  Cloudflare hostname with the tunnel profile. The first screen asks for the setup code (below).
- Data (database, WhatsApp link, secrets, backups) lives in the `duniya-data` volume.
- Setup code: `docker compose exec app duniya show-setup-code`, or set `ADMIN_PASSWORD` in `.env`.
- Images: `ghcr.io/vikramgorla/whatsapp-agent-duniya:v<version>` (e.g. `v2.8.3`) or `:latest`, for amd64 and arm64, published on each release.
- Command line: `docker compose exec app duniya help` (reset a password, list users, status, backup now, …).

Run every command below in the cloned folder, and use the **same `--profile` flags** you started with (for example
`docker compose --profile https pull`), otherwise Caddy or cloudflared are left out.

## Update the app

The panel's one-click updater is for installer servers; in Docker you pull the new image. Everything in the
`duniya-data` volume stays (agents, chats, memory, users, secrets, backups, the WhatsApp link).

1. Optional but cheap: **Backups → Back up now & download** in the panel.
2. Get the latest compose file and image, then restart:

   ```bash
   git pull
   docker compose pull          # add your --profile flags
   docker compose up -d         # add your --profile flags
   ```

3. Check: the panel's **Overview → Server** shows the new version; `docker compose logs --tail 50 app` shows no errors.

To stay on a version, set `image: ghcr.io/vikramgorla/whatsapp-agent-duniya:v2.8.3` in a `docker-compose.override.yml`
and change it when you want to update. Host OS updates are up to you (`apt upgrade` on the host).

## Recreate from scratch

When the containers are in a bad state, or you move to another machine.

- Containers only (data stays): `docker compose down && docker compose up -d` (with your profiles).
- Fresh start or a new machine:
  1. Panel → **Backups** → set a passphrase (write it down) → **Back up now & download**.
  2. Stop the old one: `docker compose down` (so two servers never use the same WhatsApp link).
  3. On the new machine clone, copy your `.env`, `docker compose up -d`.
  4. Open the panel, choose **Restore a backup**, enter the setup code, pick the file and type the passphrase. Sign in
     with the accounts from the backup. If the backup did not include the WhatsApp link, link it again.
  5. With `--profile https`, point your domain's DNS to the new machine.

## Remove everything

```bash
docker compose down        # stops and removes the containers; the volumes (your data) stay
docker compose down -v     # also deletes the volumes: database, WhatsApp link, local backups. Back up first!
docker image rm ghcr.io/vikramgorla/whatsapp-agent-duniya caddy:2 cloudflare/cloudflared 2>/dev/null
```

Then delete the cloned folder. If you opened ports 80/443 for the https profile, close them in your firewall.

## Find things fast

| You want | Command |
|---|---|
| Is it running? | `docker compose ps` · `docker compose exec app duniya status` |
| Logs | `docker compose logs -f app` (also `caddy`, `cloudflared`) |
| Restart | `docker compose restart app` |
| Setup code / password | `docker compose exec app duniya show-setup-code` · `docker compose exec app duniya reset-password <user>` |
| Where the data is | `docker volume ls` (the volume ends in `duniya-data`) |

On a phone or iPad: these are terminal commands, so use an SSH app (for example Termius or Blink) to reach the host.
Backups, restore and the update check are in the panel.

---
[Docs index](../README.md)
