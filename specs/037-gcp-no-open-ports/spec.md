# Feature Specification: Google Cloud without open ports, correct IP cost wording

**Feature Branch**: `feat/31-33-domain-gcp` | **Created**: 2026-11-15 | **Status**: Implemented | **Issue**: #33

**Input** (owner): "for google cloud, can we support modes which avoids public ip costs (like cloudflare tunnel or
tailscale or some more which can work without public ip)?"

## Findings
- Google's free-tier guide (https://cloud.google.com/free/docs/compute-getting-started, now redirecting to the Compute
  Engine docs; quoted by Google's community forum and others) states "Compute Engine free tier does not charge for an
  external IP address". The current Free Tier page lists e2-micro, 30 GB-months standard disk and 1 GB egress but no IP
  line; VPC pricing lists US$0.005/h for in-use IPs (US$0.01/h unused static) without a free-tier note.
- A VM without an external IP needs Cloud NAT to reach WhatsApp/AI providers: US$0.0014/h per VM (gateway) + US$0.005/h
  per NAT IP + US$0.045/GiB processed (https://cloud.google.com/nat/pricing) — more than the (free) ephemeral IP.

## Requirements
- **FR-001** `infra/gcp/deploy.sh --exposure public|cloudflare|tailscale`; tunnel modes create no 80/443 firewall rule
  and do not tag the VM; progress followed via the serial console; `--no-external-ip` adds Cloud Router + NAT and is
  marked as billed (extra confirmation unless `--yes`), SSH via IAP.
- **FR-002** `install.sh --tailscale-authkey` (exposure `tailscale`): installs Tailscale, `tailscale up`, `tailscale
  serve --bg --https=443 http://127.0.0.1:8080`, PUBLIC_URL = tailnet name; key never stored. OCI stack: exposure
  `tailscale` + `tailscale_authkey`.
- **FR-003** Panel/CLI explain Tailscale installs; wording about IP costs fixed in README, docs, site, infra/gcp.
- **FR-004** shellcheck clean; `--dry-run` for every mode.
