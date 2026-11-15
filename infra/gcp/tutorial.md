# Duniya on Google Cloud's free e2-micro

<walkthrough-tutorial-duration duration="20"></walkthrough-tutorial-duration>

This puts your own Duniya server (WhatsApp agents + admin panel) on Google Cloud's **Always Free** tier:

* one **e2-micro** VM (2 shared vCPUs, 1 GB memory) in `us-central1`, `us-west1` or `us-east1`,
* a **30 GB standard** disk, and **1 GB** of outgoing traffic a month (plenty for WhatsApp agents),
* automatic HTTPS at `https://<your-ip>.sslip.io`, no domain needed. You can add your own domain later.

Google needs a billing account (a card) even for free resources. Google's free-tier guide says the free tier does
not charge for an external IP address, so the VM's (ephemeral) public IP is covered. A reserved static IP, a second
VM or Cloud NAT would be billed. The last step shows how to set a budget alert so nothing surprises you.

Click **Start**.

## Choose a project

Pick (or create) the project for Duniya. It must have **billing enabled**.

<walkthrough-project-setup billing="true"></walkthrough-project-setup>

## Create the server

Run this in the terminal below (click the copy icon, then press Enter in the terminal):

```bash
bash infra/gcp/deploy.sh --project <walkthrough-project-id/>
```

It shows a short plan, then:

1. turns on the Compute Engine API,
2. opens ports 80 and 443 (firewall rule `duniya-web`),
3. creates the VM `duniya` with a 30 GB standard disk in a free region,
4. waits until the panel answers (10–15 minutes on the free VM).

While it works, open the **progress page** it prints (`http://<ip>/`) to watch the setup live.

Options: `--region us-west1` or `--region us-east1`, `--name`, `--admin-password '…'` (instead of a setup code),
`--domain agents.example.com` (prints the DNS record to create). `--help` lists everything.

**No open ports?** Reach the panel through a tunnel instead of ports 80/443 (no firewall rule is created):

```bash
bash infra/gcp/deploy.sh --project <walkthrough-project-id/> --exposure tailscale --tailscale-authkey tskey-auth-…
bash infra/gcp/deploy.sh --project <walkthrough-project-id/> --exposure cloudflare --cloudflare-token eyJ…
```

* **Tailscale**: create an auth key at [Tailscale → Settings → Keys](https://login.tailscale.com/admin/settings/keys) and
  turn on MagicDNS and HTTPS Certificates (Tailscale admin console → DNS). The panel is
  `https://duniya.<your-tailnet>.ts.net`, only for devices in your tailnet.
* **Cloudflare Tunnel**: Cloudflare → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared, copy the token;
  afterwards add a public hostname → `http://localhost:8080`.

The VM keeps its free ephemeral IP for outgoing traffic (WhatsApp, AI providers). `--no-external-ip` removes it and
adds Cloud NAT so the VM can still go out — that is **not free** (about US$4.70 a month plus traffic).

## Open your panel

When the script prints **Ready**, open the address it shows (`https://<ip>.sslip.io`).

1. Enter the **setup code** from the script's output and choose your owner username and password.
2. **Overview**: link the agent's WhatsApp number (QR code or pairing code). Use a dedicated number.
3. **Models**: connect a model provider (OpenRouter has free models).
4. **Agents → New agent**: start from a template.

Lost the setup code? Run:

```bash
gcloud compute ssh duniya --zone us-central1-a -- sudo duniya show-setup-code
```

## Your own domain (optional)

1. At your DNS provider, create an **A record**: your name (e.g. `agents.example.com`) → the VM's IP (directly, or
   through a proxy/CDN — both work).
2. In the panel: **Settings → Web address & access**, enter the name, **Check**, then **Add this domain**.
3. Open the panel at the new address and click **Confirm — new address works**. Later you can turn the old address off.

HTTPS is automatic and free. If it does not come up within 4 minutes, the previous settings come back by themselves.

## Stay free

* Keep **one** e2-micro per billing account in `us-central1`, `us-west1` or `us-east1`. Other sizes or regions are billed.
* Set a budget alert (e.g. US$1): [Budgets & alerts](https://console.cloud.google.com/billing/budgets).
* Updates: the panel updates itself (Overview → Server → Updates). Server commands: `gcloud compute ssh duniya --zone us-central1-a -- sudo duniya help`.

To remove everything (take a backup in the panel first if you want to keep your agents):

```bash
gcloud compute instances delete duniya --zone us-central1-a && gcloud compute firewall-rules delete duniya-web
# only if you used --no-external-ip (Cloud NAT keeps billing until removed):
gcloud compute routers delete duniya-router --region us-central1
```

Updating, recreating, removing, and where to find the IP, logs and serial console later:
[docs/deploy/google-cloud.md](https://github.com/vikramgorla/whatsapp-agent-duniya/blob/main/docs/deploy/google-cloud.md).

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

You're done. Your agents run on your own server, for free.
