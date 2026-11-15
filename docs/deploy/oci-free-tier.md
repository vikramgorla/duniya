# Example: Oracle Cloud Always Free

This is one way to run Duniya for free. Any Ubuntu/Debian server works the same way with the
[one-command installer](../install.md).

## What you get

- `VM.Standard.E2.1.Micro` (x86, 1 GB RAM): always available on the free tier and enough for Duniya (~180 MB) with
  the 2 GB swap the installer adds.
- `VM.Standard.A1.Flex` (Arm, free up to 2 OCPU / 12 GB in total): more headroom, but often "out of capacity".
- Free resources exist only in your **home region**.

## Option A — Deploy to Oracle Cloud button

1. Sign in to Oracle Cloud, then click **Deploy to Oracle Cloud** in the README.
2. Accept the terms and pick your home region and compartment.
3. Fill the form:
   - **How to reach the admin panel**: `ip` (https://<ip>.sslip.io, simplest), `domain`, `tunnel` (Cloudflare, no
     open ports) or `local`.
   - **Owner password** (required, at least 10 characters): you sign in as `admin` with it. Later you can switch
     to Google-only sign-in in the panel.
   - **Shape**: keep `VM.Standard.E2.1.Micro` unless you have A1 capacity.
4. **Apply**. Open `http://<server-ip>/` for a live progress page; after ~10 minutes the VM has installed itself and
   the page opens the panel (`panel_url` in the job outputs). Sign in as `admin` with the owner password.

## Option B — create the VM yourself, then one command

1. **Compute → Instances → Create**: Ubuntu 24.04, shape `VM.Standard.E2.1.Micro`, add your SSH key.
2. For direct HTTPS: in the subnet's **Security list**, add ingress TCP 80 and 443 from `0.0.0.0/0`
   (skip this for Cloudflare Tunnel or local-only).
3. SSH in and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
   ```

   OCI's Ubuntu images block ports 80/443 in the host firewall (iptables); the installer opens them for you when you
   choose direct HTTPS.

## Keep it alive

- Oracle may **reclaim idle Always Free instances** (low CPU, network and — on A1 — memory over 7 days). Upgrading the
  account to **Pay As You Go** stops this and stays free within the Always Free limits.
- Turn on **Backups** in the panel (GitHub private repo or S3 such as OCI Object Storage's S3-compatible API). If the
  VM is ever lost: create a new one, install, sign in, **Backups → Restore**. The WhatsApp link comes back too.
