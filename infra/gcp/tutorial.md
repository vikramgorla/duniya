# Duniya on Google Cloud's free e2-micro

<walkthrough-tutorial-duration duration="20"></walkthrough-tutorial-duration>

Your own Duniya server (WhatsApp agents + admin panel) on Google Cloud's **Always Free** tier, in about 15 minutes:

* one **e2-micro** VM (2 shared vCPUs, 1 GB) in `us-central1`, `us-west1` or `us-east1`,
* a **30 GB standard** disk and **1 GB** of outgoing traffic a month (plenty for agents),
* automatic HTTPS at `https://<your-ip>.sslip.io`, no domain needed.

**Good to know:** Google needs a billing account (a card) even for free resources. The VM's ephemeral public IP is
free; a static IP, a second VM or Cloud NAT are billed. The last step sets a budget alert.

Click **Start**.

## Choose a project

Pick (or create) a project with **billing enabled**.

<walkthrough-project-setup billing="true"></walkthrough-project-setup>

## Create the server

Copy this into the terminal below and press Enter:

```bash
bash infra/gcp/deploy.sh --project <walkthrough-project-id/>
```

It shows a short plan, then:

1. turns on the Compute Engine API,
2. opens ports 80 and 443 (firewall rule `duniya-web`),
3. creates the VM `duniya` with a 30 GB standard disk in a free region,
4. waits until the panel answers (**10–15 minutes**).

**Watch it live:** open the **progress page** it prints (`http://<ip>/`).

**Options:** `--region us-west1` / `us-east1`, `--name`, `--admin-password '…'` (instead of a setup code),
`--domain agents.example.com` (prints the DNS record). `--help` lists everything.

**No open ports?** Use a tunnel instead of ports 80/443 (no firewall rule is created):

```bash
bash infra/gcp/deploy.sh --project <walkthrough-project-id/> --exposure tailscale --tailscale-authkey tskey-auth-…
bash infra/gcp/deploy.sh --project <walkthrough-project-id/> --exposure cloudflare --cloudflare-token eyJ…
```

* **Tailscale**: create an auth key at [Tailscale → Settings → Keys](https://login.tailscale.com/admin/settings/keys),
  turn on MagicDNS and HTTPS Certificates (admin console → DNS). Panel: `https://duniya.<your-tailnet>.ts.net`, your
  devices only.
* **Cloudflare Tunnel**: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, copy the token; then
  add a public hostname → `http://localhost:8080`.

**Not free:** `--no-external-ip` removes the free IP and adds Cloud NAT (about US$4.70 a month plus traffic).

## Open your panel

When the script prints **Ready**, open the address it shows (`https://<ip>.sslip.io`).

1. Enter the **setup code** from the output; choose your owner username and password.
2. **Overview**: link the agent's WhatsApp number (QR or pairing code). Use a dedicated number.
3. **Models**: connect a provider (OpenRouter has free models).
4. **Agents → New agent**: start from a template.

**Lost the setup code?**

```bash
gcloud compute ssh duniya --zone us-central1-a -- sudo duniya show-setup-code
```

**Careful:** stopping the VM releases its IP, so the sslip.io address changes. Restart from the panel instead.

## Your own domain (optional)

1. At your DNS provider: an **A record** `agents.example.com` → the VM's IP (directly or through a proxy/CDN).
2. Panel: **Settings → Web address & access** → enter the name → **Check** → **Add this domain**.
3. Open the panel at the new address → **Confirm — new address works**. Turn the old address off later.

HTTPS is automatic and free. If it doesn't come up within 4 minutes, the previous settings come back by themselves.

## Stay free

* **One** e2-micro per billing account in `us-central1`, `us-west1` or `us-east1`; other sizes or regions are billed.
* Set a budget alert (e.g. US$1): [Budgets & alerts](https://console.cloud.google.com/billing/budgets).
* Updates: the panel updates itself (**Overview → Server → Updates**). Server commands:
  `gcloud compute ssh duniya --zone us-central1-a -- sudo duniya help`.

**Remove everything** (back up in the panel first to keep your agents):

```bash
gcloud compute instances delete duniya --zone us-central1-a && gcloud compute firewall-rules delete duniya-web
# only if you used --no-external-ip (Cloud NAT keeps billing until removed):
gcloud compute routers delete duniya-router --region us-central1
```

Update, recreate, remove, find the IP, logs and serial console later:
[Google Cloud guide](https://github.com/vikramgorla/duniya/blob/main/docs/deploy/google-cloud.md).

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

You're done. Your agents run on your own server, for free.
