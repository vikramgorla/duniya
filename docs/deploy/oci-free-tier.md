# Oracle Cloud (Always Free)

This page covers running Duniya on Oracle Cloud: setting it up, updating it, recreating it, removing it, and finding
your way around the Oracle Console. Any other Ubuntu/Debian server works the same way with the
[one-command installer](../install.md).

**Jump to:** [What you get](#what-you-get) · [Deploy](#deploy) · [**Where is my panel?**](#where-is-my-panel-find-the-ip--url) ·
[Update the app](#update-the-app) ·
[Update the stack](#update-the-stack-infrastructure) · [Recreate from scratch](#recreate-from-scratch) ·
[Remove everything](#remove-everything) · [Find things fast](#find-things-fast) ·
[Common errors](#common-errors) · [On a phone or iPad](#on-a-phone-or-ipad)

Console labels below were checked against Oracle's documentation in November 2026. Oracle is moving pages to a new
layout, so some pages show **tabs** (for example an **OS Management** tab) and others a **Resources** list on the left.
Where that matters, both are given.

## What you get

- `VM.Standard.E2.1.Micro` (x86, 1 GB RAM): always available on the free tier and enough for Duniya (~180 MB) with
  the 2 GB swap the installer adds. Free accounts get up to two.
- `VM.Standard.A1.Flex` (Arm, free up to 2 OCPU / 12 GB in total): more headroom, but often "out of host capacity".
- Free resources exist only in your **home region**. Free accounts can have at most **2 VCNs** (networks) and
  **200 GB** of block storage (boot volumes count).

## Deploy

### Option A: Deploy to Oracle Cloud button (a "stack")

1. Sign in to Oracle Cloud, then click **Deploy to Oracle Cloud** in the README. The **Create stack** page opens
   with the latest release zip already selected.
2. Tick the terms checkbox, keep your home region and pick a compartment. Click **Next**.
3. Fill the form:
   - **How to reach the admin panel**: `ip` (https://&lt;ip&gt;.sslip.io, simplest), `domain`, `tunnel` (Cloudflare,
     no open ports) or `local`.
   - **Owner password** (required, at least 10 characters): you sign in as `admin` with it.
   - **Shape**: keep `VM.Standard.E2.1.Micro` unless you have A1 capacity.
4. Click **Next**, tick **Run apply**, then **Create**. The job page opens.
5. When the job shows **Succeeded** (2–3 minutes), **reload the page**, open the **Application information** tab and
   click **Watch the install**. This live page follows the install (about 10–15 minutes) and opens your panel when it
   is ready. Sign in as `admin` with the owner password. Can't find it? See [Where is my
   panel?](#where-is-my-panel-find-the-ip--url).

The stack is Oracle's record of what it created (network, security list, VM). Keep it: you use it to update, recreate
and remove the server.

### Where is my panel? (find the IP / URL)

After **Apply** the job page shows **Succeeded**, but the panel address is not on the first screen. Here is where it is:

1. **Reload the page** once the job has finished. The **Application information** and **Outputs** tabs often only
   appear after a reload. If you don't see them, reload again.
2. **Application information** tab (on the job page and on the stack page):
   - **Open your panel**: **Watch the install** (the progress page) and **Open the panel**.
   - **Copy**: **Panel address**, **Install progress address** and **Public IP**, each with a copy button.
   The **Outputs** tab lists the same values by name: `install_progress_url`, `panel_url`, `public_ip`.
3. Or the job's **Logs**: scroll to the very end. After `Apply complete! Resources: … added` comes `Outputs:` with
   lines like:

   ```text
   install_progress_url = "http://203.0.113.10/"
   panel_url = "https://203-0-113-10.sslip.io"
   public_ip = "203.0.113.10"
   ```

4. Or the instance itself: ☰ → **Compute** → **Instances** (right compartment) → `duniya` → **Public IP address**.
   Open `http://<that-ip>/`.

**What you see there.** During the install (10–15 minutes) `http://<ip>/` is a progress page with the steps and the
log; it switches to your panel by itself when it is ready. Afterwards `http://<ip>/` forwards to the panel at
`https://<ip-with-dashes>.sslip.io` (for example `https://203-0-113-10.sslip.io`). Sign in as **`admin`** with the
**Owner password** you typed in the stack form (the stack sets it, so there is no setup code). Other choices:
`domain` → `https://your-domain` once its A record points to the public IP; `tunnel` → your Cloudflare hostname;
`local` → `ssh -L 8080:127.0.0.1:8080 ubuntu@<ip>` then `http://localhost:8080` (needs *Allow SSH from*).

**On a phone or iPad** copying from the job log is fiddly: use the copy buttons in **Application information →
Copy**, or the instance page.

### Option B: create the VM yourself, then one command

1. **Compute → Instances → Create instance**: Ubuntu 24.04, shape `VM.Standard.E2.1.Micro`, add your SSH key.
2. For direct HTTPS: in the subnet's **Security list**, add ingress TCP 80 and 443 from `0.0.0.0/0`
   (skip this for Cloudflare Tunnel or local-only).
3. SSH in and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
   ```

   OCI's Ubuntu images block ports 80/443 in the host firewall (iptables); the installer opens them for you when you
   choose direct HTTPS.

A VM made this way is an ordinary server: update, recreate and remove it as in [Install → Managing your
server](../install.md#managing-your-server), and use [Find things fast](#find-things-fast) below for the Console.

## Update the app

Nothing to do in Oracle. The app updates itself and **keeps everything** (agents, chats, memory, users, secrets,
backups, the WhatsApp link, the web address).

1. In the panel open **Overview**. The **Server** card has an **Updates** box.
2. Click **Check now**. If a new version exists it says **Update available: vX.Y.Z**.
3. Click **Update to vX.Y.Z** and confirm. Agents pause for about a minute; the page reloads by itself.
4. Optional: **Update settings** → *Install automatically* at a time of day.

Without the panel: SSH in (only if you opened SSH in the stack) and run `sudo duniya update`.

Operating-system updates are separate: **Server → OS updates & maintenance → Install OS updates**, then
**Restart server** if it says a restart is needed.

## Update the stack (infrastructure)

You rarely need this. Do it when a release note says the stack changed, or when you want to change a stack setting
(shape, A1 size, SSH access, OCI Logging, which ports are open).

**What an update changes, and what it never touches**

- The VM is **not rebuilt** for a newer Ubuntu image, a changed bootstrap script, or a different owner password: the
  stack ignores those on purpose, so your data stays.
- Network rules (security list: ports 80/443, SSH from your IP) are changed in place.
- Changing **A1 OCPUs / memory** or the shape within the same processor family reboots the VM (1–2 minutes offline).
- Changing **Owner password** or **How to reach the admin panel** in the stack does **not** change the running app.
  Change the password in the panel (or `sudo duniya reset-password admin`) and the address in **Settings → Web
  address & access**. The stack only opens or closes ports 80/443 to match.

**Steps**

1. Download the latest stack zip to your computer:
   [whatsapp-agent-duniya.zip](https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip)
   (also on the [Releases](https://github.com/vikramgorla/whatsapp-agent-duniya/releases) page).
2. In the Oracle Console open the **navigation menu** (☰) → **Developer Services** → under **Resource Manager**,
   **Stacks**. Pick the compartment you deployed to (top left of the list) if the stack is not shown.
3. In the stack's row open the **Actions** menu (⋮) → **Edit**.
4. On **Edit stack**, choose **.Zip file**, then drag the zip onto the box or click **Browse** and pick it. Click
   **Next**.
5. **Configure variables**: change settings if you want; otherwise keep them. Click **Next**.
6. **Review**: leave **Run apply** **unticked** (you check the plan first). Click **Save changes**. The **Stack
   details** page opens.
7. Click **Plan**, then **Plan** in the panel. Wait for **Succeeded**, open the job and read the end of the log:
   - `0 to add, N to change, 0 to destroy` (or "No changes"): safe.
   - Any line with **must be replaced** or `-/+`, or `1 to destroy` for `oci_core_instance.app`: **stop**. That would
     delete the VM and everything on it. Undo the variable you changed, or follow [Recreate from
     scratch](#recreate-from-scratch) instead (backup first).
8. Back on **Stack details**, click **Apply**. Under **Apply job plan resolution** pick the plan job you just ran
   (it applies exactly that plan), then **Apply**.
9. Wait for **Succeeded**. The panel address is unchanged; if the VM rebooted, it is back in 1–2 minutes.

If the job asks for it, open **Show advanced options** and tick **Upgrade provider versions**, then run Plan again.

## Recreate from scratch

**When:** the install failed half-way, the VM is broken or was reclaimed, you want a fresh Ubuntu, or you switch
between x86 (E2.1.Micro) and Arm (A1.Flex), which cannot be changed in place.

**What you keep:** everything in your backup (agents, users, settings, secrets, chat memory and, if *Include
WhatsApp link* was ticked, the WhatsApp link).
**What changes or is lost:**

- The **public IP** changes (it is not reserved), so an `ip` address `https://<old-ip>.sslip.io` becomes a new
  sslip.io address, and a `domain` needs its **DNS A record** updated to the new IP.
- Without a backup: everything. With a backup that excludes the WhatsApp link: you scan the QR code again
  (**Overview → Link WhatsApp**).
- Tunnels: Cloudflare keeps working with the same token. Tailscale adds a new machine; remove the old one in the
  Tailscale admin console.

**Steps**

1. **Back up first.** In the panel: **Backups** → set a passphrase if you have none (write it down) → **Back up now &
   download**. Keep the `.dbk` file and the passphrase. (A backup in GitHub or S3 works too.)
2. **Stacks** → your stack → **Destroy** → **Destroy**. Wait for **Succeeded** (the VM and network are deleted;
   the stack stays).
3. Optional: **Edit** the stack (change the shape, or upload the latest zip as in [Update the
   stack](#update-the-stack-infrastructure)).
4. Click **Apply** → **Apply**. When it succeeds, open **Application information** → **Watch the install**.
5. Find the new address as in [Where is my panel?](#where-is-my-panel-find-the-ip--url) (reload the job page) and
   sign in as `admin` with the stack's owner password.
6. **Backups → Restore → A file**: choose the `.dbk` file, type the passphrase, **Upload and restore**. The server
   restarts (1–2 minutes). From now on, sign in with the **accounts from the backup**.
7. Check **Overview**: WhatsApp should show *connected*. If not, link it again.
8. Using a domain? Point its A record to the new **Public IP** (Application information), then check **Settings →
   Web address & access**.

Lost the owner password after a restore? `sudo duniya reset-password <user>` (needs SSH), or redeploy with a new one
and restore again.

## Remove everything

Order matters: **Destroy first, then Delete the stack.** Deleting the stack first leaves the VM, network and boot
volume behind without a record, and they keep counting against your free limits (that is what later causes
`LimitExceeded`).

1. Take a backup if you may want your agents again (**Backups → Back up now & download**).
2. **Developer Services → Resource Manager → Stacks** → your stack → **Destroy** → **Destroy**. Wait for
   **Succeeded**.
3. Back on the **Stacks** list: the stack's **Actions** menu (⋮) → **Delete** → confirm.
4. Check for leftovers (all in the same compartment and region):
   - **Compute → Instances**: no `duniya` instance (terminated ones disappear after a while).
   - **Storage → Block Storage → Boot volumes**: no `duniya` boot volume.
   - **Networking → Virtual cloud networks**: no `duniya-vcn`.
   Delete any you find (a VCN: open it and use **Delete**; it removes its subnets and gateways).
5. If you turned on OCI Logging: **Observability & Management → Logging → Log groups** → delete the `duniya` log group.

Costs: on Always Free nothing here costs money. On Pay As You Go, only shapes, storage or logging beyond the Always
Free limits are billed.

## Find things fast

| You want | Where |
|---|---|
| Your stack | ☰ → **Developer Services** → **Resource Manager** → **Stacks** (pick the compartment), or the **Manage stack** link in Application information |
| Panel link, IP, install progress | Stack or job → reload → **Application information** tab: **Open the panel**, **Watch the install**, copyable **Panel address** and **Public IP** ([details](#where-is-my-panel-find-the-ip--url)) |
| Install progress (direct HTTPS) | `http://<server-ip>/` while installing; it shows the steps and the log and switches to the panel |
| Install progress (tunnel / local, or the page is not reachable) | ☰ → **Compute** → **Instances** → your instance → **OS Management** tab (or **Resources**) → **Console history** → **View current history**. Lines `== done:` or `install FAILED` tell you the result |
| Job logs (why Apply failed) | Stack → **Jobs** → the job → **Logs** |
| App logs | Panel **Server → Logs** (App, Web server, Tunnel, Maintenance), or `sudo duniya logs` over SSH. With *Send logs to OCI Logging*: ☰ → **Observability & Management** → **Logging** → **Search** |
| Reboot | Panel **Server → OS updates & maintenance → Restart server**. If the panel is down: ☰ → **Compute** → **Instances** → instance **Actions** (⋮) → **Reboot** → **Reboot instance** |
| Resize | A1 OCPUs / memory: **Edit** the stack variables → Plan → Apply (reboots). Or instance → **Actions** → **More actions** → **Edit** → **Edit shape** → **Save changes** (reboots), then set the same values in the stack so the next Apply doesn't undo it. x86 ↔ Arm: [recreate](#recreate-from-scratch) |
| Server health | Panel **Server** (CPU, memory, disk, swap, services), or `sudo duniya doctor` |
| Free limits in use | ☰ → **Governance & Administration** → **Tenancy Management** → **Limits, Quotas and Usage** |
| A shell on the VM | Only if you set *Allow SSH from* in the stack: `ssh ubuntu@<public-ip>` |

## Common errors

- **Out of host capacity** (A1 Arm): Oracle has no free Arm capacity in that availability domain right now. Oracle's
  advice: try another availability domain, or wait and try again. With the stack: run **Apply** again later, or
  **Edit** the stack, choose `VM.Standard.E2.1.Micro` (always available) and Apply. Upgrading the account to Pay As
  You Go gives access to more capacity and stays free within the Always Free limits.
- **LimitExceeded** (job log): something from an earlier try still exists and uses up a free limit, usually a
  second/third VCN or a leftover boot volume or instance. Clean up as in step 4 of [Remove
  everything](#remove-everything), then **Apply** again. See what is used under **Limits, Quotas and Usage**.
- **QuotaExceeded**: a compartment quota set by your tenancy admin blocks it; pick another compartment or ask them.
- **The progress page never loads**: wait 2–3 minutes after the job succeeds (the VM is booting). For `tunnel` or
  `local` there is no progress page: use **Console history**.
- **Install failed** on the progress page: the end of the log says why. Fix it (for example a wrong domain or tunnel
  token), then [recreate](#recreate-from-scratch) (Destroy → Apply).
- **Instance reclaimed / stopped by Oracle**: Always Free instances that stay idle for 7 days (95th-percentile CPU,
  network and, on A1, memory under 20%) may be reclaimed. Upgrading to Pay As You Go stops this. Keep scheduled
  backups on so you can recreate quickly.

## On a phone or iPad

- The Oracle Console works in Safari and Chrome. Tables are wide: swipe the table sideways to reach the **Actions**
  (⋮) menu at the end of a row, or turn the device to landscape.
- To upload the stack zip, first tap the zip link (it lands in **Files → Downloads** on iPhone/iPad, **Downloads** on
  Android), then in **Edit stack** tap **Browse** and pick it from there.
- The **Oracle Cloud Infrastructure** app (iOS, Android) can start, stop and restart instances (**Resources** tab →
  Compute instances), handy for a quick reboot. Stacks (Plan, Apply, Destroy) need the web Console.
- Everything inside the server (updates, backups, restore, logs, restart) is in the panel, which is made for phones.

## Keep it alive

- Turn on scheduled **Backups** in the panel (GitHub private repo or S3 such as OCI Object Storage's S3-compatible
  API). If the VM is ever lost, [recreate](#recreate-from-scratch) and restore.
- Upgrading to **Pay As You Go** prevents idle reclamation and stays free within the Always Free limits.

Sources: Oracle documentation on [updating a stack's
configuration](https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/update-stack-tf-config.htm),
[plan](https://docs.oracle.com/iaas/Content/ResourceManager/Tasks/create-job-plan.htm),
[apply](https://docs.oracle.com/iaas/Content/ResourceManager/Tasks/create-job-apply.htm) and
[destroy](https://docs.oracle.com/iaas/Content/ResourceManager/Tasks/create-job-destroy.htm) jobs, [deleting a
stack](https://docs.oracle.com/iaas/Content/ResourceManager/Tasks/delete-stack.htm), [Always Free
resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm), [console
history](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/displayingconsole-viewing.htm),
[rebooting](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/restartinginstance-reboot-instance.htm) and
[changing the shape](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/resizinginstances.htm) of an
instance, [service limits](https://docs.oracle.com/en-us/iaas/Content/General/service-limits/view-tenancy.htm), [stack schema
outputs](https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Concepts/terraformconfigresourcemanager_topic-schema.htm),
[the mobile app](https://docs.oracle.com/iaas/Content/GSG/Concepts/mobile.htm).

---
[Docs index](../README.md)
