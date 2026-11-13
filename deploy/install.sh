#!/usr/bin/env bash
# Installs whatsapp-agent-duniya on Ubuntu 22.04/24.04 (OCI E2.1.Micro or A1). Idempotent.
# Run as root. Reads /etc/duniya/bootstrap.env (written by cloud-init):
#   REPO_URL, BRANCH, GIT_TOKEN (optional, for private repos), ADMIN_PASSWORD, CF_TUNNEL_TOKEN (optional)
set -euo pipefail
exec > >(tee -a /var/log/duniya-install.log) 2>&1
echo "== duniya install $(date -Is)"

set -a; . /etc/duniya/bootstrap.env; set +a
APP_DIR=/opt/whatsapp-agent-duniya
APP_USER=duniya
DATA_DIR=/var/lib/duniya/data
BRANCH="${BRANCH:-main}"

echo "== swap (2 GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf && sysctl -p /etc/sysctl.d/99-swappiness.conf
fi

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates gnupg unattended-upgrades
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== user + code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/duniya --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR" && chown -R "$APP_USER:$APP_USER" /var/lib/duniya && chmod 700 /var/lib/duniya
CLONE_URL="$REPO_URL"
if [ -n "${GIT_TOKEN:-}" ]; then CLONE_URL="${REPO_URL/https:\/\//https://x-access-token:${GIT_TOKEN}@}"; fi
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$CLONE_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" git -C "$APP_DIR" config pull.ff only
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund"

echo "== service env"
install -d -m 750 -o root -g "$APP_USER" /etc/duniya
umask 027
cat > /etc/duniya/app.env <<EOF
NODE_ENV=production
DATA_DIR=$DATA_DIR
PANEL_HOST=127.0.0.1
PANEL_PORT=8080
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
BRANCH=$BRANCH
EOF
chown root:"$APP_USER" /etc/duniya/app.env && chmod 640 /etc/duniya/app.env

cat > /etc/systemd/system/whatsapp-agent-duniya.service <<EOF
[Unit]
Description=whatsapp-agent-duniya (WhatsApp agents + admin panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/duniya/app.env
ExecStart=/usr/bin/node --max-old-space-size=384 --disable-warning=ExperimentalWarning src/index.js
Restart=always
RestartSec=5
MemoryMax=700M
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable whatsapp-agent-duniya
systemctl restart whatsapp-agent-duniya

echo "== cloudflared tunnel"
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  if ! command -v cloudflared >/dev/null; then
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -y && apt-get install -y cloudflared
  fi
  if ! systemctl is-enabled cloudflared >/dev/null 2>&1; then
    cloudflared service install "$CF_TUNNEL_TOKEN"
  fi
  systemctl restart cloudflared || true
else
  echo "   (no CF_TUNNEL_TOKEN: panel only on 127.0.0.1:8080 — use: ssh -L 8080:127.0.0.1:8080 ubuntu@<ip>)"
fi

echo "== nightly backup"
cat > /etc/cron.d/duniya-backup <<EOF
30 3 * * * $APP_USER bash -c 'set -a; . /etc/duniya/app.env; set +a; $APP_DIR/deploy/backup.sh' >> /var/lib/duniya/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/duniya-backup

echo "== done $(date -Is)"
