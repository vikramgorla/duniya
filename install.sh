#!/usr/bin/env bash
# whatsapp-agent-duniya installer — install or update on Ubuntu/Debian (x86_64, arm64).
#
#   curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
#   curl -fsSL …/install.sh | sudo bash -s -- --ip-https --yes
#
# Panel exposure (pick one; asked interactively if omitted):
#   --domain NAME            https://NAME with an automatic certificate (DNS A/AAAA must point to this server)
#   --ip-https               https://<ip>.sslip.io with an automatic certificate (no domain needed)
#   --cloudflare-token TOK   Cloudflare Tunnel, no inbound ports (set the hostname → http://localhost:8080 in Cloudflare)
#   --local-only             only on 127.0.0.1:8080 (reach it with: ssh -L 8080:127.0.0.1:8080 user@server)
# Other:
#   --admin-password PW      create owner "admin" with this password (otherwise a one-time setup code is printed)
#   --repo URL               git repository (default: https://github.com/vikramgorla/whatsapp-agent-duniya.git)
#   --branch NAME            branch to install (default: main)
#   --git-token TOKEN        read-only token for a private repository
#   --update-mode MODE       off | notify | auto (default: notify)
#   --yes                    don't ask questions
#   --dry-run                print what would happen and exit
set -euo pipefail

REPO="https://github.com/vikramgorla/whatsapp-agent-duniya.git"
BRANCH="main"
EXPOSURE=""
DOMAIN=""
CF_TOKEN=""
ADMIN_PASSWORD=""
GIT_TOKEN=""
UPDATE_MODE="notify"
ASSUME_YES=0
DRY_RUN=0
APP_DIR=/opt/whatsapp-agent-duniya
APP_USER=duniya
DATA_DIR=/var/lib/duniya/data
CONF_DIR=/etc/duniya
PORT=8080

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit "${2:-1}"; }
usage() { sed -n '2,24p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

# Re-runs reuse previous choices
if [ -f "$CONF_DIR/install.conf" ]; then
  # shellcheck disable=SC1091
  . "$CONF_DIR/install.conf"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) EXPOSURE=domain; DOMAIN="${2:?}"; shift ;;
    --ip-https) EXPOSURE=ip ;;
    --cloudflare-token) EXPOSURE=tunnel; CF_TOKEN="${2:?}"; shift ;;
    --local-only) EXPOSURE=local ;;
    --admin-password) ADMIN_PASSWORD="${2:?}"; shift ;;
    --repo) REPO="${2:?}"; shift ;;
    --branch) BRANCH="${2:?}"; shift ;;
    --git-token) GIT_TOKEN="${2:?}"; shift ;;
    --update-mode) UPDATE_MODE="${2:?}"; shift ;;
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

case "$UPDATE_MODE" in off|notify|auto) ;; *) die "--update-mode must be off, notify or auto" ;; esac

# ---------- environment checks ----------
if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then die "Run as root (sudo bash install.sh …)"; fi
. /etc/os-release 2>/dev/null || true
case "${ID:-} ${ID_LIKE:-}" in
  *ubuntu*|*debian*) ;;
  *) [ "$DRY_RUN" -eq 1 ] || die "Unsupported OS (${PRETTY_NAME:-unknown}). Use Docker instead: see docs/deploy/docker.md" 2 ;;
esac
ARCH=$(uname -m)
case "$ARCH" in x86_64|aarch64|arm64) ;; *) die "Unsupported CPU architecture $ARCH" 2 ;; esac

public_ip() {
  curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'
}

ask() { # ask "question" default → echoes answer
  local q="$1" def="${2:-}" a=""
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -r /dev/tty ]; then echo "$def"; return; fi
  read -r -p "$q [${def}]: " a < /dev/tty || true
  echo "${a:-$def}"
}

if [ -z "$EXPOSURE" ]; then
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -r /dev/tty ]; then EXPOSURE=local; else
    cat <<'EOF'

How should the admin panel be reached?
  1) My own domain with HTTPS        (opens ports 80/443)
  2) This server's IP with HTTPS     (https://<ip>.sslip.io, opens ports 80/443)
  3) Cloudflare Tunnel               (no open ports; needs a tunnel token)
  4) Only locally / SSH tunnel       (most private)
EOF
    case "$(ask 'Choose 1-4' 2)" in
      1) EXPOSURE=domain; DOMAIN="$(ask 'Domain (DNS must point to this server)' '')"; [ -n "$DOMAIN" ] || die "A domain is required" ;;
      2) EXPOSURE=ip ;;
      3) EXPOSURE=tunnel; CF_TOKEN="$(ask 'Cloudflare tunnel token' '')"; [ -n "$CF_TOKEN" ] || die "A tunnel token is required" ;;
      *) EXPOSURE=local ;;
    esac
  fi
fi

HOSTNAME_PUBLIC=""
case "$EXPOSURE" in
  domain) HOSTNAME_PUBLIC="$DOMAIN" ;;
  ip) IP="$(public_ip)"; [ -n "$IP" ] || die "Could not detect the public IP"; HOSTNAME_PUBLIC="$(echo "$IP" | tr '.:' '--').sslip.io" ;;
esac
PUBLIC_URL=""
[ -n "$HOSTNAME_PUBLIC" ] && PUBLIC_URL="https://$HOSTNAME_PUBLIC"

cat <<EOF

Plan
  Source       $REPO ($BRANCH)
  Install to   $APP_DIR   data: $DATA_DIR
  Service      whatsapp-agent-duniya (systemd, user $APP_USER, panel on 127.0.0.1:$PORT)
  Exposure     $EXPOSURE${PUBLIC_URL:+ → $PUBLIC_URL}
  Updates      $UPDATE_MODE
  Owner        $([ -n "$ADMIN_PASSWORD" ] && echo 'admin (password given)' || echo 'setup code will be printed')
EOF
[ "$DRY_RUN" -eq 1 ] && { echo; say "Dry run: nothing changed."; exit 0; }
[ "$ASSUME_YES" -eq 1 ] || [ "$(ask 'Continue? (y/n)' y)" = "y" ] || die "Cancelled"

export DEBIAN_FRONTEND=noninteractive
# On a fresh cloud VM, unattended-upgrades holds the apt lock for several minutes after boot; wait instead of failing.
echo 'DPkg::Lock::Timeout "1200";' > /etc/apt/apt.conf.d/90duniya-wait-for-lock
trap 'echo "whatsapp-agent-duniya install FAILED at line $LINENO (see output above)" >&2' ERR

# ---------- swap for small machines ----------
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2048 ] && ! swapon --show | grep -q .; then
  say "Adding 2 GB swap (RAM is ${MEM_MB} MB)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-duniya-swap.conf && sysctl -q -p /etc/sysctl.d/99-duniya-swap.conf
fi

# ---------- packages ----------
say "Installing packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

# ---------- user + code ----------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/duniya --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR" && chown -R "$APP_USER:$APP_USER" /var/lib/duniya && chmod 700 /var/lib/duniya
CLONE_URL="$REPO"
[ -n "$GIT_TOKEN" ] && CLONE_URL="${REPO/https:\/\//https://x-access-token:${GIT_TOKEN}@}"
if [ -d "$APP_DIR/.git" ]; then
  say "Updating code"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch -q origin --tags
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout -q "$BRANCH" 2>/dev/null || sudo -u "$APP_USER" git -C "$APP_DIR" checkout -q -b "$BRANCH" "origin/$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" merge -q --ff-only "origin/$BRANCH"
else
  say "Downloading code"
  git clone -q --branch "$BRANCH" "$CLONE_URL" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund --loglevel=error"

# ---------- config + service ----------
install -d -m 750 -o root -g "$APP_USER" "$CONF_DIR"
OLD_PW=""
[ -f "$CONF_DIR/app.env" ] && OLD_PW="$(grep -E '^ADMIN_PASSWORD=' "$CONF_DIR/app.env" | cut -d= -f2- || true)"
TRUST_PROXY=0
case "$EXPOSURE" in domain|ip|tunnel) TRUST_PROXY=1 ;; esac
umask 027
cat > "$CONF_DIR/app.env" <<EOF
NODE_ENV=production
DATA_DIR=$DATA_DIR
PANEL_HOST=127.0.0.1
PANEL_PORT=$PORT
TRUST_PROXY=$TRUST_PROXY
PUBLIC_URL=$PUBLIC_URL
UPDATE_MODE=$UPDATE_MODE
DUNIYA_INSTALL=systemd
ADMIN_PASSWORD=${ADMIN_PASSWORD:-$OLD_PW}
EOF
chown root:"$APP_USER" "$CONF_DIR/app.env"; chmod 640 "$CONF_DIR/app.env"
cat > "$CONF_DIR/install.conf" <<EOF
REPO='$REPO'
BRANCH='$BRANCH'
EXPOSURE='$EXPOSURE'
DOMAIN='$DOMAIN'
UPDATE_MODE='$UPDATE_MODE'
EOF
chmod 600 "$CONF_DIR/install.conf"

cat > /etc/systemd/system/whatsapp-agent-duniya.service <<EOF
[Unit]
Description=whatsapp-agent-duniya (WhatsApp agents + admin panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONF_DIR/app.env
ExecStart=/usr/bin/node --max-old-space-size=384 --disable-warning=ExperimentalWarning src/index.js
Restart=always
RestartSec=5
SyslogIdentifier=whatsapp-agent-duniya
MemoryMax=700M
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
# Also write app + web server logs to a plain file, so log shippers (e.g. OCI Logging) can tail it. journalctl still works.
command -v rsyslogd >/dev/null || apt-get install -y -qq rsyslog >/dev/null || true
if command -v rsyslogd >/dev/null; then
  cat > /etc/rsyslog.d/30-whatsapp-agent-duniya.conf <<'EOF'
if $programname == 'whatsapp-agent-duniya' or $programname == 'caddy' or $programname == 'cloudflared' then /var/log/whatsapp-agent-duniya.log
EOF
  cat > /etc/logrotate.d/whatsapp-agent-duniya <<'EOF'
/var/log/whatsapp-agent-duniya.log /var/log/duniya-install.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
  copytruncate
}
EOF
  systemctl restart rsyslog 2>/dev/null || true
fi
systemctl daemon-reload
systemctl enable -q whatsapp-agent-duniya
systemctl restart whatsapp-agent-duniya

# ---------- exposure ----------
open_web_ports() {
  if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
  # OCI and some clouds ship iptables rules that REJECT everything but SSH
  if command -v iptables >/dev/null && iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
    for p in 443 80; do
      iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null || {
        line=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
        iptables -I INPUT "${line:-1}" -p tcp --dport "$p" -m state --state NEW -j ACCEPT
      }
    done
    command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
  fi
}

if [ "$EXPOSURE" = "domain" ] || [ "$EXPOSURE" = "ip" ]; then
  if ! command -v caddy >/dev/null; then
    say "Installing Caddy (automatic HTTPS)"
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  cat > /etc/caddy/Caddyfile <<EOF
$HOSTNAME_PUBLIC {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  open_web_ports
  systemctl enable -q caddy && systemctl reload-or-restart caddy
  systemctl disable -q --now cloudflared 2>/dev/null || true
elif [ "$EXPOSURE" = "tunnel" ]; then
  if ! command -v cloudflared >/dev/null; then
    say "Installing cloudflared"
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq && apt-get install -y -qq cloudflared >/dev/null
  fi
  systemctl is-enabled -q cloudflared 2>/dev/null || cloudflared service install "$CF_TOKEN" >/dev/null 2>&1
  systemctl restart cloudflared || true
  systemctl disable -q --now caddy 2>/dev/null || true
else
  systemctl disable -q --now caddy 2>/dev/null || true
  systemctl disable -q --now cloudflared 2>/dev/null || true
fi

# ---------- summary ----------
say "Waiting for the service"
CODE=""
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    [ -f "$DATA_DIR/setup-code.txt" ] && CODE="$(cat "$DATA_DIR/setup-code.txt")"
    break
  fi
  sleep 1
done

echo
say "Installed."
case "$EXPOSURE" in
  domain|ip) echo "  Admin panel: $PUBLIC_URL   (the certificate can take a minute on first visit)" ;;
  tunnel) echo "  Admin panel: your Cloudflare Tunnel hostname (public hostname → http://localhost:$PORT)" ;;
  local) echo "  Admin panel: ssh -L $PORT:127.0.0.1:$PORT <user>@<this server>, then open http://localhost:$PORT" ;;
esac
if [ -n "$CODE" ]; then echo "  Setup code:  $CODE   (enter it in the panel to create the owner account)"
elif [ -n "${ADMIN_PASSWORD:-$OLD_PW}" ]; then echo "  Sign in as:  admin (the password you provided)"
else echo "  Already set up: sign in with your existing account."; fi
echo "  Logs:        journalctl -u whatsapp-agent-duniya -f"
echo "  Re-run this installer any time to update or change how the panel is reached."
