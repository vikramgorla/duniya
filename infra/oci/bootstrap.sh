#!/bin/bash
# First boot (cloud-init user_data): clone the repo and run the same installer people use by hand.
# /etc/duniya/bootstrap.env is written just before this script runs (see main.tf).
#
# While installing, http://<server-ip>/ shows a live progress page (last lines of the install log, secrets redacted),
# so you can follow along in a browser without SSH. The real panel (Caddy) takes over port 80/443 at the end.
# If the install fails, the progress page stays up and shows the error.
set -euo pipefail
LOG=/var/log/duniya-install.log
exec > >(tee -a "$LOG") 2>&1
set -a; . /etc/duniya/bootstrap.env; set +a
export DEBIAN_FRONTEND=noninteractive

# ---------- live progress page on port 80 ----------
STATUS_DIR=/run/duniya-status
status_page() { # $1 = state shown in the banner
  install -d -m 755 "$STATUS_DIR"
  cat > /usr/local/sbin/duniya-status-render <<'EOF'
#!/bin/bash
# Renders the install log tail as a small auto-refreshing page. Redacts anything that looks like a secret.
STATE="${1:-Installing}"
while true; do
  {
    printf '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">'
    printf '<meta http-equiv=refresh content=5><title>whatsapp-agent-duniya: %s</title>' "$STATE"
    printf '<body style="font:15px system-ui;margin:24px;max-width:960px">'
    printf '<h2>whatsapp-agent-duniya: %s</h2>' "$STATE"
    if [ "$STATE" = "Install failed" ]; then
      printf '<p>The install stopped with an error (see the end of the log). Fix it, or redeploy: Destroy then Apply on the stack.</p>'
    else
      printf '<p>First boot takes about 10–15 minutes on the free VM. This page refreshes itself; the admin panel replaces it when ready.</p>'
    fi
    printf '<pre style="background:#111;color:#ddd;padding:12px;border-radius:8px;white-space:pre-wrap;font-size:12px">'
    tail -n 80 /var/log/duniya-install.log 2>/dev/null \
      | sed -E 's#(x-access-token:)[^@]+@#\1***@#g; s#((token|password|secret|passphrase|apikey|api_key|setup code)[^:=]*[:=] *)[^ ]+#\1***#Ig' \
      | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
    printf '</pre>'
  } > /run/duniya-status/index.html.tmp && mv /run/duniya-status/index.html.tmp /run/duniya-status/index.html
  sleep 3
done
EOF
  chmod 755 /usr/local/sbin/duniya-status-render
  systemctl stop duniya-status-page duniya-status-render 2>/dev/null || true
  systemd-run -q --unit=duniya-status-render /usr/local/sbin/duniya-status-render "$1" || true
  systemd-run -q --unit=duniya-status-page python3 -m http.server 80 --bind 0.0.0.0 --directory "$STATUS_DIR" || true
}

open_web_ports() { # OCI Ubuntu images REJECT everything but SSH in iptables
  if command -v iptables >/dev/null && iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
    for p in 80 443; do
      iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null || {
        line=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
        iptables -I INPUT "${line:-1}" -p tcp --dport "$p" -m state --state NEW -j ACCEPT
      }
    done
  fi
}

case "${EXPOSURE:-ip}" in ip|domain) open_web_ports; status_page "Installing" ;; esac
trap 'echo "whatsapp-agent-duniya install FAILED"; case "${EXPOSURE:-ip}" in ip|domain) status_page "Install failed" ;; esac' ERR

echo "== whatsapp-agent-duniya first boot: $(date -u +%FT%TZ)"
command -v git >/dev/null || { apt-get -o DPkg::Lock::Timeout=1200 update -y && apt-get -o DPkg::Lock::Timeout=1200 install -y git; }
URL="$REPO_URL"
if [ -n "${GIT_TOKEN:-}" ]; then URL="${REPO_URL/https:\/\//https://x-access-token:${GIT_TOKEN}@}"; fi
SRC=/root/duniya-installer
rm -rf "$SRC"
for _ in 1 2 3 4 5; do git clone -q --depth 1 --branch "${BRANCH:-main}" "$URL" "$SRC" && break; sleep 10; done

ARGS=(--yes --repo "$REPO_URL" --branch "${BRANCH:-main}" --update-mode "${UPDATE_MODE:-notify}")
case "${EXPOSURE:-ip}" in
  domain) ARGS+=(--domain "$DOMAIN") ;;
  tunnel) ARGS+=(--cloudflare-token "$CF_TUNNEL_TOKEN") ;;
  local) ARGS+=(--local-only) ;;
  *) ARGS+=(--ip-https) ;;
esac
[ -n "${ADMIN_PASSWORD:-}" ] && ARGS+=(--admin-password "$ADMIN_PASSWORD")
[ -n "${GIT_TOKEN:-}" ] && ARGS+=(--git-token "$GIT_TOKEN")
bash "$SRC/install.sh" "${ARGS[@]}"
systemctl stop duniya-status-render 2>/dev/null || true
rm -f /etc/duniya/bootstrap.env
echo "== done: $(date -u +%FT%TZ)"
