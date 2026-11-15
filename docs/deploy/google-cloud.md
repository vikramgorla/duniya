# Google Cloud (Always Free e2-micro)

This page covers running Duniya on Google Cloud's free e2-micro: setting it up, updating it, recreating it, removing
it, and finding your way around the Google Cloud console.

**Jump to:** [What you get](#what-you-get) · [Deploy](#deploy) · [**Where is my panel?**](#where-is-my-panel-find-the-ip--url) ·
[Update the app](#update-the-app) ·
[Update the infrastructure](#update-the-infrastructure) · [Recreate from scratch](#recreate-from-scratch) ·
[Remove everything](#remove-everything) · [Find things fast](#find-things-fast) ·
[Common errors](#common-errors) · [On a phone or iPad](#on-a-phone-or-ipad)

Console labels below were checked against Google's documentation in November 2026. The quickest way to any page is
the **search bar** at the top of the console: type *VM instances*, *Firewall* or *IP addresses*.

## What you get

- One **e2-micro** VM (2 shared vCPUs, 1 GB memory) in `us-central1`, `us-west1` or `us-east1`, a **30 GB standard**
  disk and 1 GB of outgoing traffic a month. One per billing account; other sizes, regions or a second VM are billed.
- Its **ephemeral** external IP is covered by the free tier. A reserved (static) IP, a second VM or Cloud NAT are
  billed.
- Google needs a billing account (a card) even for free resources. Set a budget alert:
  [Budgets & alerts](https://console.cloud.google.com/billing/budgets).

## Deploy

1. Click **Open in Cloud Shell** in the README (or [Install](../install.md#google-cloud-always-free-e2-micro)) and
   confirm. Cloud Shell opens with the repository and a tutorial on the right.
2. Pick a project with billing enabled, then run:

   ```bash
   bash infra/gcp/deploy.sh --project YOUR-PROJECT-ID
   ```

3. It shows a plan, enables the Compute Engine API, opens ports 80/443 (firewall rule `duniya-web`), creates the VM
   `duniya` and waits (10–15 minutes). Watch live at the **progress page** it prints (`http://<ip>/`).
4. When it prints **Ready**, open `https://<ip>.sslip.io` and enter the **setup code** it shows to create your owner
   account.

### Where is my panel? (find the IP / URL)

- **In Cloud Shell**: the script ends with `==> Ready: https://<ip-with-dashes>.sslip.io` and `Setup code: XXXXXX`.
  Closed the tab? Get both again:

  ```bash
  gcloud compute instances list                     # EXTERNAL_IP column
  gcloud compute ssh duniya --zone us-central1-a -- sudo duniya status            # Address line
  gcloud compute ssh duniya --zone us-central1-a -- sudo duniya show-setup-code
  ```

- **In the console**: **Compute Engine → VM instances** → the **External IP** column of `duniya`. Open
  `http://<external-ip>/`.
- **Tunnel modes**: the Cloudflare public hostname you set, or `https://duniya.<your-tailnet>.ts.net` (from a device in
  your tailnet).

**What you see there.** During the install `http://<ip>/` is a progress page that switches to the panel by itself;
afterwards it forwards to `https://<ip-with-dashes>.sslip.io` (for example `https://34-56-78-90.sslip.io`). The first
screen asks for the **setup code** (from the script output, or `sudo duniya show-setup-code`) to create your owner
account; with `--admin-password` you sign in as `admin` instead. The address changes if the VM is stopped and started
(new ephemeral IP).

On a phone or iPad: long-press the External IP to copy it (or read it in the **Google Cloud** app); copying from Cloud Shell output is fiddly.

Options (`--region`, `--exposure cloudflare|tailscale`, `--admin-password`, `--domain`, `--no-external-ip`):
`bash infra/gcp/deploy.sh --help` and the table in [Install](../install.md#google-cloud-always-free-e2-micro).

## Update the app

Nothing to do in Google Cloud. The app updates itself and **keeps everything** (agents, chats, memory, users,
secrets, backups, the WhatsApp link, the web address).

1. In the panel open **Overview**. The **Server** card has an **Updates** box.
2. Click **Check now**, then **Update to vX.Y.Z** and confirm. Agents pause for about a minute.
3. Optional: **Update settings** → *Install automatically*.

From a shell: `gcloud compute ssh duniya --zone us-central1-a -- sudo duniya update` (use your zone).

Debian package updates: **Server → OS updates & maintenance → Install OS updates**, then **Restart server** if asked.

## Update the infrastructure

There is no stack to update on Google Cloud: the script creates a VM and one firewall rule, and then the server takes
care of itself (app updates and OS updates from the panel).

- **Re-running `deploy.sh` is safe**: if a VM with that name already exists in the zone it stops with *"A VM called
  duniya already exists"* and changes nothing; an existing `duniya-web` rule is left as it is. It never touches your
  data. Use it to recreate the firewall rule if you deleted it.
- To pick up changes to the script itself (new defaults, a newer Debian): [recreate](#recreate-from-scratch).
- To change the machine type, see **Resize** in [Find things fast](#find-things-fast). Anything other than e2-micro is
  billed.

## Recreate from scratch

**When:** the install failed, the VM is broken, you want a fresh Debian, or you want a different region or exposure.

**What you keep:** everything in your backup (agents, users, settings, secrets, chat memory and, if *Include
WhatsApp link* was ticked, the WhatsApp link).
**What changes or is lost:**

- The **external IP** changes (ephemeral), so `https://<old-ip>.sslip.io` becomes a new sslip.io address and your own
  domain needs its **A record** updated.
- Without a backup: everything. With a backup that excludes the WhatsApp link: scan the QR code again.
- Tunnels: Cloudflare keeps working with the same token. Tailscale adds a new machine; remove the old one there.

**Steps**

1. **Back up first.** Panel → **Backups** → set a passphrase if you have none (write it down) → **Back up now &
   download**. Keep the `.dbk` file and the passphrase.
2. Delete the VM: **Compute Engine → VM instances**, tick `duniya`, click **Delete** (or **More actions** (⋮) →
   **Delete**), confirm **Delete**. Or in Cloud Shell:
   `gcloud compute instances delete duniya --zone us-central1-a`.
3. Click **Open in Cloud Shell** in the README again: it opens Cloud Shell with the current version of the
   repository (if it asks, choose to get a fresh copy).
4. Run `bash infra/gcp/deploy.sh --project YOUR-PROJECT-ID` (same options as before). Wait for **Ready**.
5. Open the new address. On the first screen choose **Restore a backup**, enter the **setup code** the script printed,
   pick the `.dbk` file, type the passphrase and restore. The server restarts (1–2 minutes); sign in with the
   **accounts from the backup**.
6. Check **Overview**: WhatsApp should show *connected*; otherwise link it again.
7. Using a domain? Point its A record to the new IP, then check **Settings → Web address & access**.

(If you used `--admin-password`, there is no setup screen: sign in as `admin`, then **Backups → Restore → A file**.)

## Remove everything

1. Back up if you may want your agents again (**Backups → Back up now & download**).
2. Delete the VM: **Compute Engine → VM instances** → tick `duniya` → **Delete** → **Delete**. Its boot disk is
   deleted with it.
3. Delete the firewall rule: search **Firewall** in the console bar and open **Firewall policies**; under **VPC
   firewall rules** click `duniya-web` → **Delete** → **Delete** again to confirm.
4. If you reserved a static IP: **VPC network → IP addresses** → **External IP addresses** → select it → **Release
   static address** (a reserved IP that is not attached to a VM is billed every hour).
5. Only if you used `--no-external-ip` (Cloud NAT keeps billing until removed): search **Cloud NAT** → tick
   `duniya-nat` → **Menu** (⋮) → **Delete**; then search **Cloud Routers** and delete `duniya-router`. Or simply:
   `gcloud compute routers delete duniya-router --region us-central1` (removes the NAT with it).

All in Cloud Shell (adjust zone/region):

```bash
gcloud compute instances delete duniya --zone us-central1-a
gcloud compute firewall-rules delete duniya-web
gcloud compute addresses list                       # anything left here is billed: gcloud compute addresses delete NAME --region REGION
gcloud compute routers delete duniya-router --region us-central1   # only with --no-external-ip
```

To be completely sure nothing bills, shut down the whole project if you made it only for Duniya: **IAM & Admin → Settings** → **Shut down**, enter the project ID, **Shut down anyway** (30 days
to undo).

## Find things fast

| You want | Where |
|---|---|
| Your VM and its IP | **Compute Engine → VM instances**: the **External IP** column. Cloud Shell: `gcloud compute instances list` |
| Install progress (public mode) | `http://<external-ip>/` while installing; it shows the steps and the log and switches to the panel |
| Install progress (tunnel modes, or the page is not reachable) | **VM instances** → click `duniya` → under **Logs**, **Serial port 1 (console)**. Look for `== done:` or `install FAILED`. Cloud Shell: `gcloud compute instances get-serial-port-output duniya --zone us-central1-a \| tail -50` |
| A shell on the VM | **VM instances** → **SSH** button in the `duniya` row (opens SSH-in-browser), or `gcloud compute ssh duniya --zone us-central1-a` |
| App logs | Panel **Server → Logs**, or `sudo duniya logs` in an SSH window. Install log: `sudo tail -100 /var/log/duniya-install.log` |
| Setup code | `gcloud compute ssh duniya --zone us-central1-a -- sudo duniya show-setup-code` |
| Reboot | Panel **Server → OS updates & maintenance → Restart server** (keeps the IP). If the panel is down: **VM instances** → tick `duniya` → **Reset** → **Reset** (a hard reset, like pulling the plug; keeps the IP) |
| Stop / start | **VM instances** → tick → **Stop**. Careful: stopping **releases the ephemeral IP**, so after **Start** the sslip.io address changes. Prefer Restart/Reset |
| Resize | **VM instances** → `duniya` → **Stop** → **Edit** → **Machine configuration** → pick a type → **Save** → **Start**. Anything bigger than e2-micro is billed, and the IP changes (stop) |
| Firewall rule | Console search **Firewall** → **Firewall policies** → **VPC firewall rules** → `duniya-web` |
| Server health | Panel **Server** (CPU, memory, disk, swap), or `sudo duniya doctor` |

## Common errors

- **Billing is not enabled** (script stops): link a billing account to the project at the URL the script prints.
- **A VM called duniya already exists**: you ran the script before. Use `--name` for a second one (billed), or delete
  the old VM first ([Recreate](#recreate-from-scratch)).
- **Quota exceeded** / **ZONE_RESOURCE_POOL_EXHAUSTED**: try another free zone or region,
  e.g. `--region us-west1` or `--zone us-central1-b`.
- **Not up after 30 minutes**: open the progress page or **Serial port 1** to see where it stopped. If it failed, fix
  the cause and [recreate](#recreate-from-scratch).
- **The panel address changed**: the VM was stopped and started, so it got a new ephemeral IP. Open
  `https://<new-ip-with-dashes>.sslip.io`; with your own domain, update its A record.

## On a phone or iPad

- The Google Cloud console works in Safari and Chrome. Use the **search bar** to jump to *VM instances*; swipe the
  list sideways for the **SSH** button and the ⋮ menu.
- The **Google Cloud** app (iOS, Android) can stop or restart a VM, search logs and connect over SSH: good for a quick
  restart.
- Cloud Shell runs in a mobile browser but typing commands on a phone is slow; an iPad with a keyboard is fine. Most
  day-to-day tasks (updates, backups, restore, logs, restart) are in the panel, which is made for phones.

Sources: Google Cloud documentation on [viewing serial port
output](https://cloud.google.com/compute/docs/troubleshooting/viewing-serial-port-output), [deleting a
VM](https://cloud.google.com/compute/docs/instances/deleting-instance), [VPC firewall
rules](https://cloud.google.com/firewall/docs/using-firewalls), [static external IP
addresses](https://cloud.google.com/vpc/docs/reserve-static-external-ip-address), [ephemeral IPs are released on
stop](https://cloud.google.com/vpc/docs/ip-addresses), [stopping](https://cloud.google.com/compute/docs/instances/stop-start-instance)
and [resetting](https://cloud.google.com/compute/docs/instances/reset-instance) a VM, [changing the machine
type](https://cloud.google.com/compute/docs/instances/changing-machine-type-of-stopped-instance),
[SSH-in-browser](https://cloud.google.com/compute/docs/ssh-in-browser), [the Google Cloud app](https://cloud.google.com/app).

---
[Docs index](../README.md)
