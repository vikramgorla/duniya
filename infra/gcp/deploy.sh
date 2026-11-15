#!/usr/bin/env bash
# Deploy Duniya to Google Cloud's Always Free e2-micro (030). Made for Cloud Shell ("Open in Cloud Shell" button in
# the README), works anywhere gcloud is signed in.
#
#   bash infra/gcp/deploy.sh                       # asks for what it needs
#   bash infra/gcp/deploy.sh --project my-proj --region us-central1 --yes
#
# Creates: one e2-micro VM (Debian 12, 30 GB standard disk) in a free region, a firewall rule for ports 80/443,
# and on first boot runs the same bootstrap + installer as the Oracle stack (live progress page on http://<ip>/,
# 2 GB swap, automatic HTTPS at https://<ip>.sslip.io). Prints the panel address and the one-time setup code.
#
# Options:
#   --project ID          Google Cloud project (default: the current gcloud project)
#   --region REGION       us-central1 (default) | us-west1 | us-east1 — the only Always Free regions
#   --zone ZONE           zone in that region (default: us-central1-a / us-west1-b / us-east1-b)
#   --name NAME           VM name (default: duniya)
#   --domain NAME         your own domain: printed DNS record + switch in the panel afterwards
#   --admin-password PW   create owner "admin" with this password (default: a one-time setup code is shown)
#   --repo URL / --branch NAME   what to install (default: this repository, main)
#   --yes                 don't ask
#   --dry-run             only print what would be done
set -euo pipefail

PROJECT=""; REGION="us-central1"; ZONE=""; NAME="duniya"; DOMAIN=""; ADMIN_PASSWORD=""
REPO="https://github.com/vikramgorla/whatsapp-agent-duniya.git"; BRANCH="main"; ASSUME_YES=0; DRY_RUN=0
FREE_REGIONS="us-central1 us-west1 us-east1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP="$HERE/../oci/bootstrap.sh"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }
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

cat <<EOF

Plan
  Project      $PROJECT
  VM           $NAME · e2-micro (2 shared vCPU, 1 GB) · Debian 12 · 30 GB standard disk · $ZONE
  Firewall     allow tcp 80, 443 to VMs tagged duniya-web
  Installs     $REPO ($BRANCH), panel at https://<ip>.sslip.io${DOMAIN:+ (then $DOMAIN)}
  Owner        $([ -n "$ADMIN_PASSWORD" ] && echo 'admin (password given)' || echo 'one-time setup code, shown at the end')
  Cost         Always Free covers one e2-micro, 30 GB standard disk and 1 GB egress a month in this region.
               Google may bill the public IPv4 address (about US\$0.005/hour); set a budget alert to be sure.
EOF
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

# ---------- firewall ----------
if [ "$DRY_RUN" -eq 1 ] || ! "${G[@]}" compute firewall-rules describe duniya-web >/dev/null 2>&1; then
  say "Opening ports 80 and 443"
  run "${G[@]}" compute firewall-rules create duniya-web --network default --direction INGRESS --action allow \
    --rules tcp:80,tcp:443 --source-ranges 0.0.0.0/0 --target-tags duniya-web \
    --description "Duniya panel: HTTP (certificates, redirect) and HTTPS"
fi

# ---------- first-boot script (same bootstrap as the Oracle stack) ----------
q() { printf "%s='%s'" "$1" "${2//\'/\'\\\'\'}"; }
ENVFILE="$(printf '%s\n' "$(q REPO_URL "$REPO")" "$(q BRANCH "$BRANCH")" "$(q EXPOSURE ip)" "$(q DOMAIN '')" "$(q ADMIN_PASSWORD "$ADMIN_PASSWORD")" "$(q UPDATE_MODE notify)")"
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

say "Creating the VM $NAME in $ZONE"
run "${G[@]}" compute instances create "$NAME" --zone "$ZONE" --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard \
  --tags duniya-web --metadata-from-file "startup-script=$STARTUP" --labels app=duniya
[ "$DRY_RUN" -eq 1 ] && { say "Dry run: nothing was created."; exit 0; }

IP="$("${G[@]}" compute instances describe "$NAME" --zone "$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
[ -n "$IP" ] || die "The VM has no public IP address"
URL="https://$(echo "$IP" | tr '.' '-').sslip.io"
say "The VM is starting at $IP"
note "Follow the setup live: http://$IP/   (takes 10–15 minutes on the free VM)"
note "Your panel will be:   $URL"

# ---------- wait for the panel ----------
say "Waiting for the panel (you can close this; the server finishes on its own)"
T0=$(date +%s)
until curl -fsS --max-time 8 -o /dev/null "$URL/healthz" 2>/dev/null; do
  E=$(( $(date +%s) - T0 ))
  [ "$E" -gt 1800 ] && { warn "Not up after 30 minutes. Look at http://$IP/ for the log, or: gcloud compute ssh $NAME --zone $ZONE -- sudo tail -50 /var/log/duniya-install.log"; exit 1; }
  printf '\r    %02d:%02d elapsed…' $((E / 60)) $((E % 60))
  sleep 15
done
echo
# The startup script may contain the owner password: remove it from the VM's metadata now that it ran.
"${G[@]}" compute instances remove-metadata "$NAME" --zone "$ZONE" --keys startup-script >/dev/null 2>&1 || true

CODE=""
if [ -z "$ADMIN_PASSWORD" ]; then
  CODE="$("${G[@]}" compute ssh "$NAME" --zone "$ZONE" --command 'sudo duniya show-setup-code' 2>/dev/null | sed -n 's/.*Setup code: *\([A-Z0-9]*\).*/\1/p' | head -1 || true)"
fi

echo
say "Ready: $URL"
if [ -n "$CODE" ]; then note "Setup code: $CODE   (enter it in the panel to create your owner account)"
elif [ -n "$ADMIN_PASSWORD" ]; then note "Sign in as admin with the password you chose."
else note "Setup code: gcloud compute ssh $NAME --zone $ZONE -- sudo duniya show-setup-code"; fi
if [ -n "$DOMAIN" ]; then
  note "Your domain: create the DNS record   A  $DOMAIN  →  $IP"
  note "then in the panel: Settings → Web address & access → $DOMAIN → Check DNS → Use this domain."
fi
note "Server commands: gcloud compute ssh $NAME --zone $ZONE -- sudo duniya help"
note "Stay free: keep only this one e2-micro, and set a budget alert: https://console.cloud.google.com/billing/budgets"
note "Remove everything: gcloud compute instances delete $NAME --zone $ZONE && gcloud compute firewall-rules delete duniya-web"
