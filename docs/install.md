# Install

Duniya runs on any Ubuntu/Debian server (x86_64 or arm64) with 1 GB of memory. Pick one way below; all of them use the
same installer. After the install, continue with [Getting started](getting-started.md).

### One command (Ubuntu/Debian, x86_64 or arm64)

```bash
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
```

It asks how the panel should be reached. Or say it up front:

| Option | Panel address | Open ports |
|---|---|---|
| `--domain agents.example.com` | `https://agents.example.com` (automatic certificate) | 80, 443 |
| `--ip-https` | `https://<your-ip>.sslip.io` (automatic certificate, no domain needed) | 80, 443 |
| `--cloudflare-token <token>` | your Cloudflare Tunnel hostname ([guide](deploy/cloudflare-tunnel.md)) | none |
| `--tailscale-authkey <tskey-…>` | `https://<machine>.<tailnet>.ts.net`, only for devices in your tailnet (turn on MagicDNS and HTTPS Certificates in the Tailscale admin console; Tailscale Funnel can make it public) | none |
| `--local-only` | `ssh -L 8080:127.0.0.1:8080 you@server` → `http://localhost:8080`, or any tunnel of your own (e.g. frp, ngrok, Pangolin, zrok) pointed at `http://127.0.0.1:8080` | none |

```bash
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash -s -- --ip-https --yes
```

The installer prints the panel address and a **one-time setup code** to create your owner account
([lost it?](#where-is-my-panel-find-the-ip--url)). Run it again
any time to update or change how the panel is reached; your data stays. `--help` lists every option
(`--admin-password`, `--update-mode off|notify|auto`, `--branch`, `--dry-run`, …).

### Docker

```bash
git clone https://github.com/vikramgorla/whatsapp-agent-duniya && cd whatsapp-agent-duniya
cp .env.example .env            # optional: DOMAIN, TUNNEL_TOKEN, ADMIN_PASSWORD
docker compose up -d            # or: --profile https / --profile tunnel
```

See [deploy/docker.md](deploy/docker.md).

### Deploy to Oracle Cloud (Always Free)

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip)

Creates a free VM that installs itself. Walkthrough and tips: [deploy/oci-free-tier.md](deploy/oci-free-tier.md).
Prefer infrastructure-as-code from your own fork? [deploy/terraform-github-actions.md](deploy/terraform-github-actions.md).

**Manage an existing deployment** (update the app or the stack, recreate, remove, find the IP and logs, common errors
such as *Out of host capacity* and *LimitExceeded*): step by step in [deploy/oci-free-tier.md](deploy/oci-free-tier.md).
In short: the app updates itself (**Overview → Server → Updates**); the stack is updated with **Edit** → latest
[stack zip](https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip)
→ **Plan** → **Apply**; to remove, run **Destroy** first, then **Delete** the stack.

Runs comfortably on a 1 GB VM (~180 MB RAM).

## Free cloud VMs

Two providers give you a server that stays free (checked November 2026, sources in
[specs/030-free-vms/research.md](../specs/030-free-vms/research.md)). Both buttons create the VM and run the same installer.

| Provider | Free server | Button |
|---|---|---|
| **Oracle Cloud** (Always Free) | 1 GB AMD VM, or Arm up to 2 OCPU / 12 GB; 200 GB disk; 10 TB traffic | [![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip) |
| **Google Cloud** (Always Free) | one e2-micro (1 GB) in us-central1 / us-west1 / us-east1; 30 GB disk; 1 GB traffic; Google's free-tier guide says its external IP is not charged (static IPs, more VMs and Cloud NAT are) | [![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fvikramgorla%2Fwhatsapp-agent-duniya&cloudshell_git_branch=main&cloudshell_tutorial=infra%2Fgcp%2Ftutorial.md) |

Both need a card for sign-up. AWS and Azure only offer 6–12 month trials, Hetzner has no free tier, Fly.io/Render
are not always-on VMs, and "lifetime free VPS" sites such as GratisVPS are not trustworthy (see the research).
Any other Ubuntu/Debian VM works with the one-command installer above.

### Google Cloud (Always Free e2-micro)

Click **Open in Cloud Shell**, confirm, and follow the tutorial on the right: choose a project with billing, run
`bash infra/gcp/deploy.sh`, wait ~15 minutes (live progress at `http://<ip>/`), then open `https://<ip>.sslip.io` with the
setup code it prints. Your own domain: *Settings → Web address & access* in the panel.
Without the button: `git clone` this repository in any shell with `gcloud`, then `bash infra/gcp/deploy.sh --help`.

How the panel is reached (`--exposure`):

| Mode | Panel | Firewall | Cost |
|---|---|---|---|
| `public` (default) | `https://<ip>.sslip.io`, later your domain | tcp 80, 443 (rule `duniya-web`) | free |
| `cloudflare --cloudflare-token …` | your Cloudflare Tunnel hostname | no rule for 80/443 | free |
| `tailscale --tailscale-authkey …` | `https://<vm>.<tailnet>.ts.net` (your devices only) | no rule for 80/443 | free |
| add `--no-external-ip` (tunnel modes only) | same | no external IP at all; outbound through Cloud NAT | **billed**: ~US$0.0014/h gateway + US$0.005/h NAT IP + US$0.045/GiB ≈ US$4.70/month + traffic |

The VM needs outbound internet (WhatsApp, AI providers). Its ephemeral external IP does that for free — Google's
free-tier guide states the free tier does not charge for an external IP address — so keep it unless you really want
no public address. A reserved (static) IP, an IP on a second VM, or Cloud NAT is billed
([VPC pricing](https://cloud.google.com/vpc/pricing), [Cloud NAT pricing](https://cloud.google.com/nat/pricing)).
Google's default network still allows SSH (port 22) unless you remove the `default-allow-ssh` rule.

Step-by-step: update, recreate, remove and console help in [deploy/google-cloud.md](deploy/google-cloud.md).
Oracle Cloud: [deploy/oci-free-tier.md](deploy/oci-free-tier.md).

## Where is my panel? (find the IP / URL)

| Installed with | Where the address is |
|---|---|
| **Oracle Cloud stack** | Job page → **reload** once it shows *Succeeded* → **Application information** (or **Outputs**): **Open the panel**, **Watch the install**, copyable **Panel address** / **Public IP**. Also at the end of the job **Logs** (`panel_url = "https://…sslip.io"`), or **Compute → Instances → duniya → Public IP address**. [Details](deploy/oci-free-tier.md#where-is-my-panel-find-the-ip--url) |
| **Google Cloud script** | End of the Cloud Shell output (`Ready: https://…sslip.io` and the setup code), or **Compute Engine → VM instances → External IP**. [Details](deploy/google-cloud.md#where-is-my-panel-find-the-ip--url) |
| **One-command installer** | The last lines it prints: `Admin panel: …` and `Setup code: …`. Later: `sudo duniya status` (Address) and `sudo duniya show-setup-code` |
| **Docker** | `http://127.0.0.1:8080` on that machine (`http://localhost:8080`), `https://$DOMAIN` with the https profile, or your tunnel hostname. Setup code: `docker compose exec app duniya show-setup-code` |
| **Tunnel / Tailscale / local** | Your Cloudflare hostname · `https://<machine>.<tailnet>.ts.net` · `ssh -L 8080:127.0.0.1:8080 you@server` → `http://localhost:8080` |

**What you see there.** On the cloud buttons, `http://<server-ip>/` is first a live progress page (10–15 minutes) that
switches to the panel by itself; afterwards it forwards to `https://<ip-with-dashes>.sslip.io`. The panel's first
screen asks for the one-time **setup code** (printed at the end of the install; `sudo duniya show-setup-code` shows it
again; it is also in `/var/lib/duniya/data/setup-code.txt`). If an owner password was given (Oracle stack,
`--admin-password`), sign in as `admin` with it instead.

## Managing your server

For servers set up with the one-command installer (any provider, or a VM you created yourself). Cloud stacks and
Docker have their own pages: [Oracle Cloud](deploy/oci-free-tier.md) · [Google Cloud](deploy/google-cloud.md) ·
[Docker](deploy/docker.md).

### Update the app

Keeps everything: agents, chats, memory, users, secrets, backups, the WhatsApp link and the web address.

1. Panel → **Overview** → **Server** card → **Updates** → **Check now**.
2. **Update to vX.Y.Z** → confirm. Agents pause for about a minute; the page reloads by itself.
3. Optional: **Update settings** → *Install automatically* at a time of day, or *Off*.

Command line: `sudo duniya update` (`--check` only looks). Running the installer again also updates and keeps your
choices (`/etc/duniya/install.conf`).

OS packages: **Server → OS updates & maintenance → Install OS updates**, then **Restart server** when it says so.

### Change how the panel is reached

**Settings → Web address & access** (domain, checks, safe switch back). Or run the installer again with a different
option, e.g. `… | sudo bash -s -- --domain agents.example.com --yes`. Your data stays.

### Recreate from scratch (new server or fresh OS)

1. Panel → **Backups** → set a passphrase (write it down) → **Back up now & download**. Keep the `.dbk` file.
2. Turn the old server off (so two servers never use the same WhatsApp link), then install on the new one.
3. On the new panel's first screen choose **Restore a backup**, enter the setup code the installer printed, pick the
   file, type the passphrase. Sign in afterwards with the accounts from the backup.
4. A new server has a new IP: an sslip.io address changes, and your domain's A record must point to the new IP.
   The WhatsApp link comes back if the backup included it; otherwise link again (**Overview**).

### Remove Duniya from a server

The cleanest way is to delete the VM at your provider. To keep the machine and remove only Duniya:

```bash
sudo systemctl disable --now whatsapp-agent-duniya duniya-ops.path caddy cloudflared 2>/dev/null
sudo rm -rf /opt/whatsapp-agent-duniya /var/lib/duniya /var/lib/duniya-ops /etc/duniya \
  /usr/local/bin/duniya /usr/local/sbin/duniya-ops /usr/local/lib/duniya-ops \
  /etc/systemd/system/whatsapp-agent-duniya.service /etc/systemd/system/duniya-ops.*
sudo systemctl daemon-reload
```

`/var/lib/duniya` holds all data (database, WhatsApp link, local backups): download a backup first. Caddy,
cloudflared, Tailscale, Node.js and the 2 GB `/swapfile` stay installed; remove them with `apt` if you don't need them.
Close ports 80/443 at your provider's firewall.

### Find things fast

| You want | Where |
|---|---|
| Is it running? | Panel **Server** (services, CPU, memory, disk, swap) · `sudo duniya status` · `sudo duniya doctor` (DNS, HTTPS, ports, disk, memory, with fixes) |
| Logs | Panel **Server → Logs** (App, Web server, Tunnel, Maintenance) · `sudo duniya logs` (`-f` to follow) · install log `/var/log/duniya-install.log` (cloud first boot) |
| Restart | Panel **Updates → Update settings → Restart service**, or **Server → Restart server** for the whole machine · `sudo duniya restart` |
| Setup code / password | `sudo duniya show-setup-code` · `sudo duniya reset-password <user>` · locked out by the IP allow-list: `sudo duniya open-access` |
| Every command | [Command line](cli.md) |

---
[Docs index](README.md)
