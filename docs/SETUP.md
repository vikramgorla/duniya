# Setup (about 20 minutes)

You need: an Oracle Cloud account (Always Free is fine), a domain on Cloudflare, a spare WhatsApp number (a prepaid SIM in a spare phone), an Anthropic API key, and panduga.ch MCP tokens.

## 1. OCI API key → GitHub secrets

1. OCI Console → profile icon (top right) → **My profile** → **API keys** → **Add API key** → **Generate API key pair** → **Download private key** → **Add**.
2. The dialog shows a config preview with `user`, `fingerprint`, `tenancy` and `region`. Keep it open.
3. GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `OCI_TENANCY_OCID` | `tenancy=` from the preview |
| `OCI_USER_OCID` | `user=` |
| `OCI_FINGERPRINT` | `fingerprint=` |
| `OCI_REGION` | `region=` (your **home** region, e.g. `eu-zurich-1`) |
| `OCI_PRIVATE_KEY` | full contents of the downloaded `.pem`, including the BEGIN/END lines |
| `ADMIN_PASSWORD` | the panel password you want (12+ characters) |
| `CF_TUNNEL_TOKEN` | from step 2 below |
| `OCI_COMPARTMENT_OCID` | optional, defaults to the tenancy root |
| `SSH_PUBLIC_KEY` | optional, your SSH public key |
| `GIT_CLONE_TOKEN` | only if this repo is **private**: a fine-grained token with *Contents: read* on this repo |

Optional **variables** (same page, *Variables* tab): `SHAPE` (`VM.Standard.A1.Flex` if you can get Arm capacity), `SSH_INGRESS_CIDR` (e.g. `203.0.113.4/32` to allow SSH from your IP; default: no inbound ports at all), `STATE_BUCKET`.

## 2. Cloudflare Tunnel for the panel

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Name it `duniya`.
2. On the install screen, copy the long token after `--token` (or `service install`). Save it as the `CF_TUNNEL_TOKEN` secret. You don't need to run the install command; the VM does that.
3. **Public hostname**: subdomain `agents` (or any), your domain, service **HTTP** → `localhost:8080`.
4. Recommended: **Zero Trust → Access → Applications → Add → Self-hosted** for the same hostname, with a policy *Emails = your email*. You then get an email code before the panel's own password.

## 3. Create the server

GitHub → **Actions → Infrastructure (OCI) → Run workflow → action: `plan`**. Check the plan (VCN, subnet, one VM). Then run it again with **`apply`**.

The run summary shows the public IP. The VM installs itself in about 5–8 minutes (Node 22, swap, the app as a systemd service, cloudflared, nightly backups).

If you see *Out of host capacity* (mostly with A1), run `apply` again later or switch `SHAPE` back to the Micro.

## 4. First login

1. Open `https://agents.<your-domain>` and sign in with `ADMIN_PASSWORD`. Change the password under **Settings**.
2. **Overview** shows a QR code. On the bot phone: WhatsApp → Settings → **Linked devices → Link a device** and scan it. Or use *Get code* with the bot's number to link by pairing code.
3. **Secrets**: set `ANTHROPIC_API_KEY`, `PANDUGA_MCP_URL`, `PANDUGA_TOKEN_ORGANIZER`, and optionally `PANDUGA_TOKEN_MEMBER`.
4. **Bots → Panduga → Edit settings**: add organizer phone numbers. Try the test console.
5. Add the bot number to the WhatsApp group. **Chats** tab → choose *Panduga* for that group.
6. In the group: `!panduga what's on the agenda tomorrow?`

## Updating

Push to `main` → panel **Overview → Update from GitHub**. It pulls, installs dependencies if they changed, and restarts. Live settings, secrets and the WhatsApp session are kept in `/var/lib/duniya/data`.

Infrastructure changes (files in `infra/terraform`) run a `plan` on push; run the workflow with `apply` to make them.

## Troubleshooting

| Symptom | Check |
|---|---|
| Panel not reachable | Cloudflare → Tunnels: is `duniya` healthy? The OCI console's serial console or SSH (if enabled): `systemctl status cloudflared whatsapp-agent-duniya`, `tail /var/log/duniya-install.log` |
| Bot doesn't answer in a group | Chats tab: is the group bound? Activity tab: is the message there? Is the bot enabled and the whole system not paused? Does the message start with the trigger, or @mention the bot? |
| `MCP server … has no url` in Activity | Set the secret named in `bot.json` (Secrets tab) |
| WhatsApp shows *logged_out* | Scan the new QR on the Overview tab |
| VM disappeared | OCI idle reclamation: upgrade to Pay-As-You-Go, re-run `apply`, restore the latest backup tarball into `/var/lib/duniya/data` |
