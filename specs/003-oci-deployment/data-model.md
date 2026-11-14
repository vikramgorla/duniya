# Data Model: Free-Tier Deployment from GitHub

## Cloud resources (Terraform)

| Resource | Name | Key settings |
|---|---|---|
| `oci_core_vcn` | `<name>-vcn` | 10.42.0.0/16, dns `duniya` |
| `oci_core_internet_gateway` | `<name>-igw` | |
| `oci_core_route_table` | `<name>-rt` | 0.0.0.0/0 → IGW |
| `oci_core_security_list` | `<name>-sl` | egress all; ingress ICMP 3/4; TCP 22 only from `ssh_ingress_cidr` |
| `oci_core_subnet` | `<name>-subnet` | 10.42.1.0/24, public IPs |
| `oci_core_instance` | `<name>` | shape var, Ubuntu 24.04 latest, 50 GB boot, user_data, optional SSH key |

All tagged `app = <name>`. Default `<name>` = `whatsapp-agent-duniya`.

## Server layout

| Path | Owner/mode | Content |
|---|---|---|
| `/etc/duniya/bootstrap.env` | root 0600 | REPO_URL, BRANCH, GIT_TOKEN, ADMIN_PASSWORD, CF_TUNNEL_TOKEN |
| `/etc/duniya/app.env` | root:duniya 0640 | NODE_ENV, DATA_DIR, PANEL_HOST/PORT, ADMIN_PASSWORD, BRANCH |
| `/opt/whatsapp-agent-duniya` | duniya | git checkout |
| `/var/lib/duniya/data` | duniya 0700 parent | sqlite, WhatsApp auth, secrets, bot settings |
| `/var/lib/duniya/backups` | duniya | `duniya-YYYY-MM-DD.tgz`, newest 7 |
| `/var/log/duniya-install.log` | root | bootstrap/install log |
| `/swapfile` | root 0600 | 2 GB |

Services: `whatsapp-agent-duniya.service` (Restart=always, MemoryMax=700M), `cloudflared.service`;
cron `/etc/cron.d/duniya-backup` 03:30.
