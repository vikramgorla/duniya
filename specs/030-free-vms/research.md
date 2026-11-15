# Research: permanently free VMs for Duniya (as of 2026-11-15)

Need: an always-on Linux VM (WhatsApp linked device must stay connected), ideally ≥ 1 GB RAM, public IPv4 for
HTTPS, free *forever* (not a trial). Duniya runs in ~180 MB RSS and the installer adds 2 GB swap on small machines.

## Summary

| Provider | Permanently free VM? | What you get | Verdict |
|---|---|---|---|
| **Oracle Cloud** Always Free | **Yes** | 2× VM.Standard.E2.1.Micro (1/8 OCPU, 1 GB, 50 Mbps) **or** Arm A1 Flex 1,500 OCPU-h + 9,000 GB-h/month (= 2 OCPU / 12 GB); 200 GB block storage; 10 TB egress/month. Idle instances (7 days < 20 % CPU/network, A1 also memory) may be reclaimed. | Trustworthy, already supported (OCI stack). Note the A1 allowance is now 2 OCPU / 12 GB (older guides say 4/24). |
| **Google Cloud** Free Tier | **Yes** | 1 non-preemptible e2-micro (2 shared vCPU at 25 %, 1 GB) per billing account, only in us-west1, us-central1, us-east1; 30 GB-month standard persistent disk; 1 GB egress from North America/month. Billing account (card) required. | Trustworthy → **built** (`infra/gcp`). Caveat: the in-use external IPv4 is priced at US$0.005/h; Google's free-tier docs are ambiguous about whether the free e2-micro's address is covered — budget ~US$3.65/month and set a budget alert. |
| AWS | No (trial) | Since 2025-07-15 new accounts get up to US$200 credits and a *6-month* free plan; legacy 12-month 750 h t2/t3.micro only for older accounts. | Not permanent. Not listed. |
| Azure | No (trial) | 12 months of 750 h each of B1s / B2pts v2 / B2ats v2 + US$200 credit for 30 days, new customers only. | Not permanent. Not listed. |
| IBM Cloud | No | Lite plans (no VM), US$200 credit for 30 days, VPC discounts. | Not listed. |
| Alibaba Cloud | No (trial) | ECS free trial up to 12 months. | Not listed. |
| Hetzner | No | No free tier; cheapest servers ~€4–6/month (excellent value, but paid). | Not listed (could be a "cheap" option later). |
| Fly.io | No | No ongoing free allowance for new customers (short trial, card required). | Not a free VM. |
| Render | No VM | Free web services sleep after 15 idle minutes, ephemeral disk. A WhatsApp linked device cannot sleep. | Unsuitable. |
| Railway / Koyeb / similar PaaS | No | Small credits or sleeping instances, no persistent always-on VM. | Unsuitable. |
| **GratisVPS** (gratisvps.net and mirrors) | Claims "lifetime free VPS, no card" | Trustpilot 1.8/5 from 18 reviews (94 % one-star; "you have to watch ads and never receive the VPS — scam", 2026-03); many look-alike landing pages (pages.dev / netlify mirrors with "$300 credits" claims); no operator, SLA or specs published. | **Dubious — do not use or link.** |
| Other "lifetime free VPS" lists | Mostly affiliate pages | Usually re-list trials (AWS/Azure/GCP credits) or ad-funded schemes. | Dubious. |

**Decision**: buttons for **Oracle** and **Google** only. Everything else is either a trial, not a VM, or not trustworthy.
The one-command installer stays the path for any other Ubuntu/Debian VM.

## Google Cloud details used by `infra/gcp/deploy.sh`
- Regions us-central1 (zone a), us-west1 (zone b), us-east1 (zone b — us-east1 has no zone a).
- Machine `e2-micro`, image family `debian-12` (less memory than Ubuntu, Caddy 2.6.2 in Debian 12), 30 GB `pd-standard`.
- Firewall rule `duniya-web` (tcp 80, 443) on network `default`, target tag `duniya-web`.
- Startup script runs only once (marker file) and reuses `infra/oci/bootstrap.sh` (progress page on `http://<ip>/`,
  installer `--ip-https`). It is removed from the instance metadata once the panel answers (it may contain the owner
  password).
- "Open in Cloud Shell": `https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=…&cloudshell_git_branch=main&cloudshell_tutorial=infra/gcp/tutorial.md`
  (parameters `cloudshell_git_repo`, `cloudshell_git_branch`, `cloudshell_tutorial`; button image
  `https://gstatic.com/cloudssh/images/open-btn.svg`).

## Sources (read 2026-11-15)
- Google Cloud free tier overview: https://cloud.google.com/free (Compute Engine: "1 e2-micro instance per month")
- GCP Always Free summary (regions, 30 GB standard PD, 1 GB egress): https://cloudwebschool.com/docs/gcp/fundamentals/free-tier/
- e2-micro limit is by time; external IPv4 $0.005/h note (verified 2026-11-02): https://agentdeals.dev/vendor/google-compute-engine
- External IPv4 price increase to $0.005/h (2024-02-01): https://cloud.google.com/vpc/pricing-announce-external-ips
- Conflicting reports on free-tier external IP billing: https://kiwix.lema.org/serverfault.com_en_all_2023-11/questions/1012277/google-cloud-external-ip-charges-for-free-tier
- Open in Cloud Shell parameters: https://docs.cloud.google.com/shell/docs/open-in-cloud-shell
- Oracle Always Free resources (E2.1.Micro, A1 1,500 OCPU-h / 9,000 GB-h, 200 GB, 10 TB, idle reclamation): https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
- AWS free tier change (2025-07-15, $200 credits, 6-month plan): https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan
- Azure free account (12 months B1s/B2pts/B2ats, $200 for 30 days): https://azure.microsoft.com/en-us/free/
- IBM Cloud free tier FAQ (Lite plans, $200/30 days): https://www.ibm.com/cloud/free/faq
- Cloud free tier comparison (Alibaba ECS trial up to 12 months; IBM/Azure credits): https://github.com/cloudcommunity/Cloud-Free-Tier-Comparison
- PaaS free tiers checked 2026-09 (Fly.io no free allowance, Render sleeps after 15 min, no free VPS providers): https://flaviocopes.com/hosting-free-tiers/
- Hetzner (no free tier): https://agentdeals.dev/vendor/hetzner
- GratisVPS reviews (1.8/5, scam reports): https://es.trustpilot.com/review/gratisvps.net ; look-alike pages e.g. https://gratisvps.netlify.app , https://gratisvps.pages.dev/vps-korea ; generic review without evidence: https://www.positioniseverything.net/gratisvps-hosting-reviews/
