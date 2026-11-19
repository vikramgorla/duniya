#!/usr/bin/env bash
# Duniya installer — install or update on Ubuntu/Debian (x86_64, arm64).
#
#   curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
#   curl -fsSL …/install.sh | sudo bash -s -- --ip-https --yes
#
# Panel exposure (pick one; asked interactively if omitted):
#   --domain NAME            https://NAME with an automatic certificate (DNS A/AAAA must point to this server)
#   --ip-https               https://<ip>.sslip.io with an automatic certificate (no domain needed)
#   --cloudflare-token TOK   Cloudflare Tunnel, no inbound ports (set the hostname → http://localhost:8080 in Cloudflare)
#   --tailscale-authkey KEY  Tailscale, no inbound ports: https://<machine>.<tailnet>.ts.net for your tailnet's devices
#                            (needs MagicDNS + HTTPS certificates on in the Tailscale admin console; key is not stored)
#   --local-only             only on 127.0.0.1:8080 (reach it with: ssh -L 8080:127.0.0.1:8080 user@server, or any
#                            tunnel of your own pointed at http://127.0.0.1:8080)
# Other:
#   --admin-password PW      create owner "admin" with this password (otherwise a one-time setup code is printed)
#   --repo REPO              where to install and update from: owner/name on GitHub (e.g. your fork) or an https git
#                            URL (default: this project; or set DUNIYA_REPO=owner/name). Re-runs keep the source.
#   --branch NAME            branch to install (default: main)
#   --git-token TOKEN        read-only token for a private repository
#   --update-mode MODE       off | notify | auto (default: notify)
#   --yes                    don't ask questions
#   --dry-run                print what would happen and exit
set -euo pipefail

# 084: the project's repository, kept in step with package.json by `npm run repo:sync` (never edit it by hand).
DEFAULT_REPO="https://github.com/vikramgorla/whatsapp-agent-duniya.git"
REPO=""
BRANCH="main"
EXPOSURE=""
DOMAIN=""
CF_TOKEN=""
TS_AUTHKEY=""
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
usage() { sed -n '2,23p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

# Re-runs reuse previous choices
if [ -f "$CONF_DIR/install.conf" ]; then
  # shellcheck disable=SC1091
  . "$CONF_DIR/install.conf"
fi

# Where to install from (084): --repo, then DUNIYA_REPO, then the source this server already updates from (it may
# have been changed in the panel), then the previous run's choice, then the project.
EXISTING_REPO=""
if [ -d "$APP_DIR/.git" ] && id "$APP_USER" >/dev/null 2>&1; then
  EXISTING_REPO="$(sudo -u "$APP_USER" git -C "$APP_DIR" config --get remote.origin.url 2>/dev/null | sed -E 's#^https://[^/@]*@#https://#' || true)"
fi
REPO="${DUNIYA_REPO:-${EXISTING_REPO:-${REPO:-$DEFAULT_REPO}}}"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) EXPOSURE=domain; DOMAIN="${2:?}"; shift ;;
    --ip-https) EXPOSURE=ip ;;
    --cloudflare-token) EXPOSURE=tunnel; CF_TOKEN="${2:?}"; shift ;;
    --tailscale-authkey) EXPOSURE=tailscale; TS_AUTHKEY="${2:?}"; shift ;;
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
# owner/name → its GitHub URL; anything else must be a plain https URL (it is written to install.conf and used by root)
if [[ "$REPO" =~ ^(github:)?([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9._-]+)$ ]]; then REPO="https://github.com/${BASH_REMATCH[2]}/${BASH_REMATCH[3]%.git}.git"; fi
[[ "$REPO" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)+/?$ ]] || die "--repo: use owner/name or an https git URL (got: $REPO)"
case "$EXPOSURE" in ''|domain|ip|tunnel|tailscale|local) ;; *) die "Unknown exposure: $EXPOSURE" ;; esac
if [ -n "$TS_AUTHKEY" ] && ! [[ "$TS_AUTHKEY" =~ ^tskey-[A-Za-z0-9_-]+$ ]]; then die "--tailscale-authkey: that does not look like a Tailscale auth key (tskey-…)"; fi

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
  4) Tailscale                       (no open ports; only your devices; needs an auth key)
  5) Only locally / SSH tunnel       (most private)
EOF
    case "$(ask 'Choose 1-5' 2)" in
      1) EXPOSURE=domain; DOMAIN="$(ask 'Domain (DNS must point to this server)' '')"; [ -n "$DOMAIN" ] || die "A domain is required" ;;
      2) EXPOSURE=ip ;;
      3) EXPOSURE=tunnel; CF_TOKEN="$(ask 'Cloudflare tunnel token' '')"; [ -n "$CF_TOKEN" ] || die "A tunnel token is required" ;;
      4) EXPOSURE=tailscale; TS_AUTHKEY="$(ask 'Tailscale auth key (tskey-auth-…)' '')" ;;
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
export NEEDRESTART_MODE=l NEEDRESTART_SUSPEND=1  # don't let needrestart restart services in the middle of the install
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
# Photos & voice (043): ffmpeg makes WhatsApp voice notes (Ogg/Opus) and reads them for on-server speech; bzip2 unpacks
# the optional on-server speech models. Optional: the app works without them (provider routes only).
apt-get install -y -qq --no-install-recommends bzip2 >/dev/null || true
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
  if [ "$EXISTING_REPO" != "$REPO" ]; then
    say "Switching the source to $REPO"
    sudo -u "$APP_USER" git -C "$APP_DIR" remote set-url origin "$CLONE_URL"
    sudo -u "$APP_USER" git -C "$APP_DIR" fetch -q --force --prune --prune-tags origin '+refs/tags/*:refs/tags/*'
  fi
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
case "$EXPOSURE" in domain|ip|tunnel|tailscale) TRUST_PROXY=1 ;; esac
# Web address & access (031/036): the panel's settings, kept across re-runs
WEB_APPLIED=/var/lib/duniya-ops/web-applied.json
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
DUNIYA_EXPOSURE=$EXPOSURE
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
# 069: keep restarting after crashes, however often (Restart=always below)
StartLimitIntervalSec=0

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONF_DIR/app.env
ExecStart=/usr/bin/node --max-old-space-size=384 --disable-warning=ExperimentalWarning src/index.js
Restart=always
RestartSec=5
# 069: a graceful stop (running replies finish, the database closes) takes up to 10 s
TimeoutStopSec=20
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
# Server maintenance from the panel (OS updates, reboot): a root helper started by a path unit when the app writes
# an action word to its request file. The app itself never gets root. Logs: the app may read the journal.
install -m 0755 -o root -g root "$APP_DIR/deploy/ops/duniya-ops" /usr/local/sbin/duniya-ops
install -m 0644 "$APP_DIR/deploy/ops/duniya-ops.service" /etc/systemd/system/duniya-ops.service
install -m 0644 "$APP_DIR/deploy/ops/duniya-ops.path" /etc/systemd/system/duniya-ops.path
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" /var/lib/duniya/ops-request
install -d -m 0755 -o root -g root /var/lib/duniya-ops
# Web address & access (031): the helper runs this root-owned copy, never the app's own (app-writable) code.
install -d -m 0755 -o root -g root /usr/local/lib/duniya-ops
install -m 0644 -o root -g root "$APP_DIR/deploy/ops/webconfig.mjs" /usr/local/lib/duniya-ops/webconfig.mjs
# Command line tool (029): sudo duniya <command>
install -m 0755 -o root -g root "$APP_DIR/deploy/duniya" /usr/local/bin/duniya
getent group systemd-journal >/dev/null && usermod -a -G systemd-journal "$APP_USER"
systemctl daemon-reload
systemctl enable -q whatsapp-agent-duniya
systemctl enable -q --now duniya-ops.path
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
    # Use the distro's signed package (Ubuntu 24.04 / Debian 12 ship Caddy 2.6+). Caddy's own apt repo has had signing-key
    # mismatches, so we don't depend on it; fall back to the official release binary from GitHub.
    rm -f /etc/apt/sources.list.d/caddy-stable.list
    # The package would start Caddy with its "Caddy works!" page on port 80 and push the progress page away while the
    # rest of the install runs. policy-rc.d stops packages from starting services; Caddy starts below with our config.
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod 755 /usr/sbin/policy-rc.d
    trap 'rm -f /usr/sbin/policy-rc.d' EXIT
    CADDY_OK=1
    { apt-get install -y -qq caddy >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq caddy >/dev/null 2>&1; }; } || CADDY_OK=0
    rm -f /usr/sbin/policy-rc.d
    if [ "$CADDY_OK" -eq 0 ]; then
      say "Distro package not available; installing the Caddy release binary"
      case "$(uname -m)" in x86_64) CARCH=amd64 ;; aarch64|arm64) CARCH=arm64 ;; *) die "Unsupported CPU $(uname -m) for Caddy" ;; esac
      CVER="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)"
      [ -n "$CVER" ] || die "Could not find the latest Caddy release"
      CTMP="$(mktemp -d)"
      CBASE="https://github.com/caddyserver/caddy/releases/download/v$CVER"
      curl -fsSL -o "$CTMP/caddy.tgz" "$CBASE/caddy_${CVER}_linux_${CARCH}.tar.gz"
      curl -fsSL -o "$CTMP/sums" "$CBASE/caddy_${CVER}_checksums.txt"
      (cd "$CTMP" && grep " caddy_${CVER}_linux_${CARCH}.tar.gz\$" sums | sed "s# caddy_.*# caddy.tgz#" | sha512sum -c --quiet) || die "Caddy download checksum mismatch"
      tar -xzf "$CTMP/caddy.tgz" -C "$CTMP" caddy && install -m 0755 "$CTMP/caddy" /usr/bin/caddy && rm -rf "$CTMP"
      getent group caddy >/dev/null || groupadd --system caddy
      id caddy >/dev/null 2>&1 || useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
      install -d -m 0755 /etc/caddy
      cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
    fi
  fi
  install -d -m 0755 /etc/caddy
  # The Caddyfile always comes from webconfig.mjs (same as the panel's apply): panel over HTTPS only, port 80 for
  # certificates, redirects and the domain reachability check. Visiting the bare IP forwards to the panel address.
  # The panel's settings (031/036: extra addresses, proxies, access rules) are kept for the address chosen now.
  SERVER_IP="$(public_ip || true)"
  CVER="$(caddy version 2>/dev/null | awk '{print $1}' | tr -cd 'v0-9.')"
  WEB_REQ="$(mktemp)"
  if [ -f "$WEB_APPLIED" ]; then cp "$WEB_APPLIED" "$WEB_REQ"; else printf '{"host":"%s","port":%s,"access":{}}\n' "$HOSTNAME_PUBLIC" "$PORT" > "$WEB_REQ"; fi
  render_caddy() { (cd / && node /usr/local/lib/duniya-ops/webconfig.mjs render "$1" --out /etc/caddy/Caddyfile.duniya --host "$HOSTNAME_PUBLIC" --server-ip "$SERVER_IP" --caddy-version "${CVER:-2.6.0}" >/dev/null) \
      && caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile.duniya >/dev/null 2>&1; }
  if render_caddy "$WEB_REQ"; then
    if [ -f "$WEB_APPLIED" ]; then say "Kept the web settings from the panel (Settings → Web address & access)"; fi
  else
    if [ -f "$WEB_APPLIED" ]; then warn "Could not keep the panel's web settings; the panel is open to everyone at $PUBLIC_URL. Apply them again in Settings → Web address & access."; fi
    printf '{"host":"%s","port":%s,"access":{}}\n' "$HOSTNAME_PUBLIC" "$PORT" > "$WEB_REQ"
    render_caddy "$WEB_REQ" || die "Could not create the web server configuration for $HOSTNAME_PUBLIC"
  fi
  # Caddy runs as user "caddy": the config must be readable whatever umask this script runs with (cloud-init: 077).
  install -m 0644 -o root -g root /etc/caddy/Caddyfile.duniya /etc/caddy/Caddyfile && rm -f /etc/caddy/Caddyfile.duniya
  rm -f "$WEB_REQ"
  open_web_ports
  # Hand port 80 over from the first-boot progress page (OCI bootstrap) to Caddy only now, when the final config is ready.
  systemctl stop duniya-status-page duniya-status-render 2>/dev/null || true
  # Port 80 must be free before Caddy starts (the progress page may take a moment to let go).
  for _ in $(seq 1 15); do ss -Hltn 'sport = :80' 2>/dev/null | grep -q . || break; sleep 1; done
  systemctl enable -q caddy
  if ! systemctl reload-or-restart caddy; then
    sleep 3
    if ! systemctl restart caddy; then
      warn "Caddy (the web server) did not start. Its last messages:"
      journalctl -u caddy -n 40 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
      echo "    Listening on ports 80/443:"; ss -Hltnp 'sport = :80 or sport = :443' 2>/dev/null | sed 's/^/    /' || true
      die "The web server could not start (details above)"
    fi
  fi
  systemctl disable -q --now cloudflared 2>/dev/null || true
  if command -v tailscale >/dev/null; then tailscale serve reset >/dev/null 2>&1 || true; fi
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
elif [ "$EXPOSURE" = "tailscale" ]; then
  # Tailscale (033): outbound only, no inbound ports. The panel is served by `tailscale serve` over HTTPS at the
  # machine's tailnet name (certificate from Tailscale); only devices in the tailnet can reach it.
  if ! command -v tailscale >/dev/null; then
    say "Installing Tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
  fi
  systemctl enable -q --now tailscaled
  if ! tailscale status >/dev/null 2>&1; then
    [ -n "$TS_AUTHKEY" ] || die "Tailscale is not signed in: re-run with --tailscale-authkey tskey-… (create one at https://login.tailscale.com/admin/settings/keys)"
    tailscale up --auth-key="$TS_AUTHKEY" --hostname="$(hostname -s | tr -cd 'a-z0-9-' | cut -c1-40)" || die "tailscale up failed (is the auth key valid and unused?)"
  fi
  if ! timeout 60 tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    warn "tailscale serve did not start: turn on MagicDNS and HTTPS Certificates (Tailscale admin console → DNS), then run: sudo tailscale serve --bg --https=443 http://127.0.0.1:$PORT"
  fi
  TS_NAME="$(tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).Self.DNSName||"").replace(/\.$/,""))}catch{}})')"
  if [[ "$TS_NAME" =~ ^[a-z0-9.-]+$ ]]; then
    PUBLIC_URL="https://$TS_NAME"
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" "$CONF_DIR/app.env"
    systemctl restart whatsapp-agent-duniya
  fi
  systemctl disable -q --now caddy 2>/dev/null || true
  systemctl disable -q --now cloudflared 2>/dev/null || true
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

# ffmpeg (043: voice notes, on-server speech) is large; install it after the panel is up so the first start is quick.
if ! command -v ffmpeg >/dev/null; then
  say "Installing ffmpeg (voice notes) in the background"
  (apt-get install -y -qq --no-install-recommends ffmpeg >/dev/null 2>&1 || true) </dev/null >/dev/null 2>&1 &
  disown || true
fi

echo
say "Installed."
case "$EXPOSURE" in
  domain|ip) echo "  Admin panel: $PUBLIC_URL   (the certificate can take a minute on first visit)" ;;
  tunnel) echo "  Admin panel: your Cloudflare Tunnel hostname (public hostname → http://localhost:$PORT)" ;;
  tailscale) echo "  Admin panel: ${PUBLIC_URL:-https://<this machine>.<your tailnet>.ts.net}   (from devices in your tailnet)" ;;
  local) echo "  Admin panel: ssh -L $PORT:127.0.0.1:$PORT <user>@<this server>, then open http://localhost:$PORT" ;;
esac
if [ -n "$CODE" ]; then echo "  Setup code:  $CODE   (enter it in the panel to create the owner account)"
elif [ -n "${ADMIN_PASSWORD:-$OLD_PW}" ]; then echo "  Sign in as:  admin (the password you provided)"
else echo "  Already set up: sign in with your existing account."; fi
echo "  Logs:        sudo duniya logs -f      (all commands: sudo duniya help)"
echo "  Re-run this installer any time to update or change how the panel is reached."
