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

The installer prints the panel address and a **one-time setup code** to create your owner account. Run it again
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

**Manage an existing deployment:** [open your stacks](https://cloud.oracle.com/resourcemanager/stacks), then pick the stack.

- *Update the app:* nothing to do in Oracle. The panel updates itself (Overview → Server → Updates).
- *Update the infrastructure:* **Edit stack**, upload the [latest stack zip](https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip), then **Apply**.
- *See what the server is doing:* while it installs, open `http://<server-ip>/` for a live progress page; if the
  install fails, that page shows the error. On Pay As You Go accounts you can also turn on *Send logs to OCI Logging*.
- *Remove everything:* run **Destroy**, then **Delete stack**. Take a backup first if you want to keep your agents.

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

Oracle Cloud details (managing the stack, logs, removal) are in the section above.

---
[Docs index](README.md)
