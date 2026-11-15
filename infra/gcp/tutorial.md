# Duniya on Google Cloud's free e2-micro

<walkthrough-tutorial-duration duration="20"></walkthrough-tutorial-duration>

This puts your own Duniya server (WhatsApp agents + admin panel) on Google Cloud's **Always Free** tier:

* one **e2-micro** VM (2 shared vCPUs, 1 GB memory) in `us-central1`, `us-west1` or `us-east1`,
* a **30 GB standard** disk, and **1 GB** of outgoing traffic a month (plenty for WhatsApp bots),
* automatic HTTPS at `https://<your-ip>.sslip.io`, no domain needed. You can add your own domain later.

Google needs a billing account (a card) even for free resources. Only the public IPv4 address may be billed
(about US$0.005 an hour, so about US$3.65 a month). The last step shows how to set a budget alert so nothing
surprises you.

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

## Open your panel

When the script prints **Ready**, open the address it shows (`https://<ip>.sslip.io`).

1. Enter the **setup code** from the script's output and choose your owner username and password.
2. **Overview**: link the bot's WhatsApp number (QR code or pairing code). Use a dedicated number.
3. **Models**: connect a model provider (OpenRouter has free models).
4. **Bots → New bot**: start from a template.

Lost the setup code? Run:

```bash
gcloud compute ssh duniya --zone us-central1-a -- sudo duniya show-setup-code
```

## Your own domain (optional)

1. At your DNS provider, create an **A record**: your name (e.g. `agents.example.com`) → the VM's IP.
2. In the panel: **Settings → Web address & access**, enter the name, **Check DNS**, then **Use this domain**.

The certificate is free and renews by itself. If HTTPS does not come up within 4 minutes, the panel goes back to
the previous address automatically.

## Stay free

* Keep **one** e2-micro per billing account in `us-central1`, `us-west1` or `us-east1`. Other sizes or regions are billed.
* Set a budget alert (e.g. US$1): [Budgets & alerts](https://console.cloud.google.com/billing/budgets).
* Updates: the panel updates itself (Settings → Updates). Server commands: `gcloud compute ssh duniya --zone us-central1-a -- sudo duniya help`.

To remove everything (take a backup in the panel first if you want to keep your bots):

```bash
gcloud compute instances delete duniya --zone us-central1-a && gcloud compute firewall-rules delete duniya-web
```

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

You're done. Your agents run on your own server, for free.
