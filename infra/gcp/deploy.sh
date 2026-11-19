#!/usr/bin/env bash
# Deploy Duniya to Google Cloud's Always Free e2-micro (030). Made for Cloud Shell ("Open in Cloud Shell" button in
# the README), works anywhere gcloud is signed in.
#
#   bash infra/gcp/deploy.sh                       # asks for what it needs
#   bash infra/gcp/deploy.sh --project my-proj --region us-central1 --yes
#
# Creates: one e2-micro VM (Debian 12, 30 GB standard disk) in a free region and on first boot runs the same
# bootstrap + installer as the Oracle stack (2 GB swap). How the panel is reached (--exposure):
#   public      HTTPS on ports 80/443 at https://<ip>.sslip.io (firewall rule duniya-web; live progress on http://<ip>/)
#   cloudflare  Cloudflare Tunnel: no firewall rule for 80/443, nothing listens publicly (needs --cloudflare-token)
#   tailscale   Tailscale: panel at https://<vm>.<tailnet>.ts.net for your devices only, no inbound ports
#               (needs --tailscale-authkey; turn on MagicDNS + HTTPS Certificates in the Tailscale admin console)
# The VM keeps its ephemeral external IP for OUTBOUND traffic (WhatsApp, AI providers): Google's free tier covers the
# external IP of the free e2-micro. --no-external-ip removes it and adds Cloud NAT instead, which is NOT free.
#
# Options:
#   --project ID          Google Cloud project (default: the current gcloud project)
#   --region REGION       us-central1 (default) | us-west1 | us-east1 — the only Always Free regions
#   --zone ZONE           zone in that region (default: us-central1-a / us-west1-b / us-east1-b)
#   --name NAME           VM name (default: duniya)
#   --exposure MODE       public (default) | cloudflare | tailscale
#   --cloudflare-token T  Cloudflare Tunnel token (Zero Trust → Networks → Tunnels → Create → Cloudflared)
#   --tailscale-authkey K Tailscale auth key (https://login.tailscale.com/admin/settings/keys)
#   --no-external-ip      no public IP at all; outbound through Cloud NAT (costs money, see the plan). Needs
#                         --exposure cloudflare or tailscale
#   --domain NAME         your own domain (public mode): printed DNS record + add it in the panel afterwards
#   --admin-password PW   create owner "admin" with this password (default: a one-time setup code is shown)
#   --repo URL / --branch NAME   what to install (default: this repository, main)
#   --yes                 don't ask
#   --dry-run             only print what would be done
set -euo pipefail

PROJECT=""; REGION="us-central1"; ZONE=""; NAME="duniya"; DOMAIN=""; ADMIN_PASSWORD=""
EXPOSURE_MODE="public"; CF_TOKEN=""; TS_AUTHKEY=""; NO_EXTERNAL_IP=0
REPO="https://github.com/vikramgorla/duniya.git"; BRANCH="main"; ASSUME_YES=0; DRY_RUN=0
FREE_REGIONS="us-central1 us-west1 us-east1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP="$HERE/../oci/bootstrap.sh"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; }
run() { if [ "$DRY_RUN" -eq 1 ]; then printf '    [dry-run] %s\n' "$*"; else "$@"; fi; }
ask() { # ask "question" default
  local a=""
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then echo "$2"; return; fi
  read -r -p "$1 [$2]: " a || true
  echo "${a:-$2}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:?}"; shift ;;
    --region) REGION="${2:?}"; shift ;;
    --zone) ZONE="${2:?}"; shift ;;
    --name) NAME="${2:?}"; shift ;;
    --domain) DOMAIN="${2:?}"; shift ;;
    --exposure) EXPOSURE_MODE="${2:?}"; shift ;;
    --cloudflare-token) CF_TOKEN="${2:?}"; shift ;;
    --tailscale-authkey) TS_AUTHKEY="${2:?}"; shift ;;
    --no-external-ip) NO_EXTERNAL_IP=1 ;;
    --admin-password) ADMIN_PASSWORD="${2:?}"; shift ;;
    --repo) REPO="${2:?}"; shift ;;
    --branch) BRANCH="${2:?}"; shift ;;
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

command -v gcloud >/dev/null || die "gcloud is not installed. Use the 'Open in Cloud Shell' button, or install the Google Cloud CLI."
[ -f "$BOOTSTRAP" ] || die "Run this from a clone of the repository ($BOOTSTRAP is missing)."
case " $FREE_REGIONS " in *" $REGION "*) ;; *) die "$REGION is not an Always Free region. Use one of: $FREE_REGIONS" ;; esac
if [ -z "$ZONE" ]; then case "$REGION" in us-central1) ZONE=us-central1-a ;; us-west1) ZONE=us-west1-b ;; us-east1) ZONE=us-east1-b ;; esac; fi
[[ "$ZONE" == "$REGION"-* ]] || die "Zone $ZONE is not in $REGION"
[[ "$NAME" =~ ^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$ ]] || die "VM name: lowercase letters, digits and hyphens"
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^([a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then die "That is not a valid domain: $DOMAIN"; fi
if [ -n "$ADMIN_PASSWORD" ] && [ "${#ADMIN_PASSWORD}" -lt 12 ]; then die "--admin-password must be at least 12 characters"; fi
case "$EXPOSURE_MODE" in
  public) BOOT_EXPOSURE=ip ;;
  cloudflare) BOOT_EXPOSURE=tunnel
    [ -n "$CF_TOKEN" ] || CF_TOKEN="$(ask 'Cloudflare Tunnel token' '')"
    [[ "$CF_TOKEN" =~ ^[A-Za-z0-9+/=._-]{20,}$ ]] || die "--exposure cloudflare needs --cloudflare-token (Cloudflare → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared: copy the token)" ;;
  tailscale) BOOT_EXPOSURE=tailscale
    [ -n "$TS_AUTHKEY" ] || TS_AUTHKEY="$(ask 'Tailscale auth key (tskey-auth-…)' '')"
    [[ "$TS_AUTHKEY" =~ ^tskey-[A-Za-z0-9_-]+$ ]] || die "--exposure tailscale needs --tailscale-authkey tskey-… (https://login.tailscale.com/admin/settings/keys)" ;;
  *) die "--exposure must be public, cloudflare or tailscale" ;;
esac
if [ "$NO_EXTERNAL_IP" -eq 1 ] && [ "$EXPOSURE_MODE" = public ]; then die "--no-external-ip needs --exposure cloudflare or tailscale (without a public IP nobody can reach ports 80/443)"; fi
if [ -n "$DOMAIN" ] && [ "$EXPOSURE_MODE" != public ]; then die "--domain is for --exposure public (with a tunnel, the address is set in Cloudflare or Tailscale)"; fi

# ---------- project ----------
[ -n "$PROJECT" ] || PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$PROJECT" ] || PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
if [ -z "$PROJECT" ]; then
  gcloud projects list --format='value(projectId)' 2>/dev/null | head -20 | sed 's/^/    /'
  PROJECT="$(ask 'Project ID to use' '')"
fi
[ -n "$PROJECT" ] || die "Choose a project: bash infra/gcp/deploy.sh --project YOUR-PROJECT-ID (create one at https://console.cloud.google.com/projectcreate)"
G=(gcloud --project "$PROJECT" --quiet)

if [ "$DRY_RUN" -eq 0 ]; then
  BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || echo unknown)"
  if [ "$BILLING" = "False" ]; then
    die "Billing is not enabled for $PROJECT. Google requires a billing account even for the free e2-micro: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  fi
fi

case "$EXPOSURE_MODE" in
  public) PANEL_PLAN="https://<ip>.sslip.io${DOMAIN:+ (then $DOMAIN)}"; FIREWALL_PLAN="allow tcp 80, 443 to VMs tagged duniya-web" ;;
  cloudflare) PANEL_PLAN="your Cloudflare Tunnel hostname (public hostname → http://localhost:8080)"; FIREWALL_PLAN="no rule for 80/443 (Cloudflare Tunnel connects outbound)" ;;
  tailscale) PANEL_PLAN="https://$NAME.<your tailnet>.ts.net (only devices in your tailnet)"; FIREWALL_PLAN="no rule for 80/443 (Tailscale connects outbound)" ;;
esac
if [ "$NO_EXTERNAL_IP" -eq 1 ]; then
  NETWORK_PLAN="no external IP; outbound through Cloud NAT (router duniya-router, gateway duniya-nat in $REGION)"
  COST_PLAN="NOT free: Cloud NAT costs about US\$0.0014/h for the gateway (1 VM) + US\$0.005/h for its IP + US\$0.045/GiB
               processed — roughly US\$4.70/month before traffic. The e2-micro and 30 GB disk stay free."
else
  NETWORK_PLAN="ephemeral external IP (used for outbound traffic: WhatsApp, AI providers)"
  COST_PLAN="Always Free covers one e2-micro, 30 GB standard disk and 1 GB egress a month in this region; Google's
               free-tier guide says the free tier does not charge for the external IP. A static (reserved) IP or a
               second VM is billed. Set a budget alert to be sure."
fi

cat <<EOF

Plan
  Project      $PROJECT
  VM           $NAME · e2-micro (2 shared vCPU, 1 GB) · Debian 12 · 30 GB standard disk · $ZONE
  Panel        $PANEL_PLAN
  Firewall     $FIREWALL_PLAN
  Network      $NETWORK_PLAN
  Installs     $REPO ($BRANCH)
  Owner        $([ -n "$ADMIN_PASSWORD" ] && echo 'admin (password given)' || echo 'one-time setup code, shown at the end')
  Cost         $COST_PLAN
EOF
if [ "$NO_EXTERNAL_IP" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
  [ "$(ask 'Cloud NAT is billed (about US$5/month). Continue? (y/n)' n)" = y ] || die "Cancelled"
fi
[ "$ASSUME_YES" -eq 1 ] || [ "$(ask 'Continue? (y/n)' y)" = y ] || die "Cancelled"

# ---------- APIs, existing VMs ----------
say "Enabling the Compute Engine API (first time: about a minute)"
run "${G[@]}" services enable compute.googleapis.com
if [ "$DRY_RUN" -eq 0 ]; then
  if "${G[@]}" compute instances describe "$NAME" --zone "$ZONE" --format='value(name)' >/dev/null 2>&1; then
    die "A VM called $NAME already exists in $ZONE. Use --name, or delete it: gcloud compute instances delete $NAME --zone $ZONE"
  fi
  MICROS="$("${G[@]}" compute instances list --filter='machineType~e2-micro' --format='value(name)' 2>/dev/null | wc -l | tr -d ' ')"
  [ "${MICROS:-0}" -gt 0 ] && warn "This project already has $MICROS e2-micro VM(s). Always Free covers the hours of ONE e2-micro per billing account; a second one is billed."
fi

# ---------- firewall (public mode only) / Cloud NAT (no external IP only) ----------
if [ "$EXPOSURE_MODE" != public ]; then
  say "No firewall rule for ports 80/443: the panel is reached through ${EXPOSURE_MODE^} (outbound connection only)"
elif [ "$DRY_RUN" -eq 1 ] || ! "${G[@]}" compute firewall-rules describe duniya-web >/dev/null 2>&1; then
  say "Opening ports 80 and 443"
  run "${G[@]}" compute firewall-rules create duniya-web --network default --direction INGRESS --action allow \
    --rules tcp:80,tcp:443 --source-ranges 0.0.0.0/0 --target-tags duniya-web \
    --description "Duniya panel: HTTP (certificates, redirect) and HTTPS"
fi
if [ "$NO_EXTERNAL_IP" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ] || ! "${G[@]}" compute routers describe duniya-router --region "$REGION" >/dev/null 2>&1; then
    say "Creating Cloud NAT (billed) so the VM can reach WhatsApp and AI providers without a public IP"
    run "${G[@]}" compute routers create duniya-router --network default --region "$REGION"
    run "${G[@]}" compute routers nats create duniya-nat --router duniya-router --region "$REGION" \
      --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
  fi
fi

# ---------- first-boot script (same bootstrap as the Oracle stack) ----------
q() { printf "%s='%s'" "$1" "${2//\'/\'\\\'\'}"; }
ENVFILE="$(printf '%s\n' "$(q REPO_URL "$REPO")" "$(q BRANCH "$BRANCH")" "$(q EXPOSURE "$BOOT_EXPOSURE")" "$(q DOMAIN '')" "$(q ADMIN_PASSWORD "$ADMIN_PASSWORD")" \
  "$(q UPDATE_MODE notify)" "$(q CF_TUNNEL_TOKEN "$CF_TOKEN")" "$(q TS_AUTHKEY "$TS_AUTHKEY")")"
STARTUP="$(mktemp)"; trap 'rm -f "$STARTUP"' EXIT
cat > "$STARTUP" <<EOF
#!/bin/bash
# Duniya first boot (written by infra/gcp/deploy.sh). Google runs startup scripts on every boot: only the first counts.
install -d -m 700 /etc/duniya
[ -f /etc/duniya/.first-boot ] && exit 0
touch /etc/duniya/.first-boot
echo '$(printf '%s\n' "$ENVFILE" | base64 | tr -d '\n')' | base64 -d > /etc/duniya/bootstrap.env
chmod 600 /etc/duniya/bootstrap.env
echo '$(base64 < "$BOOTSTRAP" | tr -d '\n')' | base64 -d > /usr/local/sbin/duniya-bootstrap
chmod 700 /usr/local/sbin/duniya-bootstrap
/usr/local/sbin/duniya-bootstrap
EOF

VM_ARGS=(--zone "$ZONE" --machine-type e2-micro --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB
  --boot-disk-type pd-standard --metadata-from-file "startup-script=$STARTUP" --labels app=duniya)
[ "$EXPOSURE_MODE" = public ] && VM_ARGS+=(--tags duniya-web)
[ "$NO_EXTERNAL_IP" -eq 1 ] && VM_ARGS+=(--no-address)
SSH=("${G[@]}" compute ssh "$NAME" --zone "$ZONE")
[ "$NO_EXTERNAL_IP" -eq 1 ] && SSH+=(--tunnel-through-iap)
say "Creating the VM $NAME in $ZONE"
run "${G[@]}" compute instances create "$NAME" "${VM_ARGS[@]}"
[ "$DRY_RUN" -eq 1 ] && { say "Dry run: nothing was created."; exit 0; }

# ---------- wait for the panel ----------
URL=""
if [ "$EXPOSURE_MODE" = public ]; then
  IP="$("${G[@]}" compute instances describe "$NAME" --zone "$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
  [ -n "$IP" ] || die "The VM has no public IP address"
  URL="https://$(echo "$IP" | tr '.' '-').sslip.io"
  say "The VM is starting at $IP"
  note "Follow the setup live: http://$IP/   (takes 10–15 minutes on the free VM)"
  note "Your panel will be:   $URL"
  say "Waiting for the panel (you can close this; the server finishes on its own)"
  T0=$(date +%s)
  until curl -fsS --max-time 8 -o /dev/null "$URL/healthz" 2>/dev/null; do
    E=$(( $(date +%s) - T0 ))
    [ "$E" -gt 1800 ] && { warn "Not up after 30 minutes. Look at http://$IP/ for the log, or: gcloud compute ssh $NAME --zone $ZONE -- sudo tail -50 /var/log/duniya-install.log"; exit 1; }
    printf '\r    %02d:%02d elapsed…' $((E / 60)) $((E % 60))
    sleep 15
  done
  echo
else
  # No public web port to poll: follow the first-boot log on the VM's serial console instead.
  say "The VM is starting; following the setup on its serial console (10–15 minutes; you can close this)"
  T0=$(date +%s)
  while :; do
    OUT="$("${G[@]}" compute instances get-serial-port-output "$NAME" --zone "$ZONE" 2>/dev/null || true)"
    if grep -q 'whatsapp-agent-duniya install FAILED' <<< "$OUT"; then warn "The install failed. Log: ${SSH[*]} -- sudo tail -50 /var/log/duniya-install.log"; exit 1; fi
    if grep -q '== done:' <<< "$OUT"; then
      URL="$(grep -o 'Admin panel: https://[a-z0-9.-]*' <<< "$OUT" | tail -1 | sed 's/Admin panel: //')"
      break
    fi
    E=$(( $(date +%s) - T0 ))
    [ "$E" -gt 1800 ] && { warn "Not finished after 30 minutes. Log: ${SSH[*]} -- sudo tail -50 /var/log/duniya-install.log"; exit 1; }
    printf '\r    %02d:%02d elapsed…' $((E / 60)) $((E % 60))
    sleep 20
  done
  echo
fi
# The startup script may contain the owner password or a tunnel key: remove it from the VM's metadata now that it ran.
"${G[@]}" compute instances remove-metadata "$NAME" --zone "$ZONE" --keys startup-script >/dev/null 2>&1 || true

CODE=""
if [ -z "$ADMIN_PASSWORD" ]; then
  CODE="$("${SSH[@]}" --command 'sudo duniya show-setup-code' 2>/dev/null | sed -n 's/.*Setup code: *\([A-Z0-9]*\).*/\1/p' | head -1 || true)"
fi

echo
case "$EXPOSURE_MODE" in
  public) say "Ready: $URL" ;;
  cloudflare) say "Ready: open your Cloudflare Tunnel hostname"
    note "In Cloudflare → Zero Trust → Networks → Tunnels → your tunnel → Public hostname: add your name → http://localhost:8080" ;;
  tailscale) say "Ready: ${URL:-https://$NAME.<your tailnet>.ts.net} (from a device signed in to your tailnet)"
    note "If it does not open: Tailscale admin console → DNS → turn on MagicDNS and HTTPS Certificates." ;;
esac
if [ -n "$CODE" ]; then note "Setup code: $CODE   (enter it in the panel to create your owner account)"
elif [ -n "$ADMIN_PASSWORD" ]; then note "Sign in as admin with the password you chose."
else note "Setup code: ${SSH[*]} -- sudo duniya show-setup-code"; fi
if [ -n "$DOMAIN" ]; then
  note "Your domain: create the DNS record   A  $DOMAIN  →  $IP"
  note "then in the panel: Settings → Web address & access → $DOMAIN → Check → Add this domain."
fi
note "Server commands: ${SSH[*]} -- sudo duniya help"
note "Stay free: keep only this one e2-micro, and set a budget alert: https://console.cloud.google.com/billing/budgets"
CLEAN="gcloud compute instances delete $NAME --zone $ZONE"
[ "$EXPOSURE_MODE" = public ] && CLEAN+=" && gcloud compute firewall-rules delete duniya-web"
[ "$NO_EXTERNAL_IP" -eq 1 ] && CLEAN+=" && gcloud compute routers delete duniya-router --region $REGION   (Cloud NAT keeps billing until removed)"
note "Remove everything: $CLEAN"
