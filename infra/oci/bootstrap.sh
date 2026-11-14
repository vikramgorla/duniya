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
  cat > /usr/local/sbin/duniya-status-render <<'RENDER'
#!/bin/bash
# Renders a small auto-refreshing progress page from the install log. Secrets are redacted, ANSI colors stripped.
STATE="${1:-Installing}"
LOGF=/var/log/duniya-install.log
STEPS=("Adding|Preparing the server" "Installing packages|Installing system packages" "Installing Node|Installing Node.js"
       "Downloading code|Downloading the app" "Installing Caddy|Setting up HTTPS" "Waiting for the service|Starting the panel")
esc() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
clean() { sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\[[0-9;]*m//g; s#(x-access-token:)[^@]+@#\1***@#g; s#((token|password|secret|passphrase|apikey|api_key|setup code)[^:=]*[:=] *)[^ ]+#\1***#Ig'; }
while true; do
  LOGTXT="$(tail -n 400 "$LOGF" 2>/dev/null | clean)"
  MIN=$(( $(cut -d. -f1 /proc/uptime) / 60 ))  # minutes since the VM booted
  # which step are we on? the last step whose marker appears in the log
  CUR=-1; for i in "${!STEPS[@]}"; do grep -q -- "${STEPS[$i]%%|*}" <<<"$LOGTXT" && CUR=$i; done
  ITEMS=""
  for i in "${!STEPS[@]}"; do
    label="${STEPS[$i]#*|}"
    if [ "$i" -lt "$CUR" ]; then cls=done; icon="✓"
    elif [ "$i" -eq "$CUR" ]; then if [ "$STATE" = "Install failed" ]; then cls=fail; icon="!"; else cls=now; icon=""; fi
    else cls=todo; icon=""; fi
    ITEMS+="<li class=$cls><span class=dot>$icon</span>$label</li>"
  done
  if [ "$STATE" = "Install failed" ]; then
    TITLE="Install stopped"; SUB="Something went wrong. The details are at the end of the log below. Fix the cause, or redeploy: on the stack click <b>Destroy</b>, then <b>Apply</b>."; BADGE="<span class='badge bad'>Failed</span>"
  else
    TITLE="Setting up your server"; SUB="This takes about 10–15 minutes on the free VM. You can leave this page open: it refreshes itself and turns into the admin panel when it's ready."; BADGE="<span class='badge'>Running · ${MIN} min</span>"
  fi
  {
    cat <<HTML
<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=5><title>$TITLE · whatsapp-agent-duniya</title>
<style>
:root{--bg:#f4f6f5;--card:#fff;--ink:#14201b;--mute:#5b6a63;--line:#e3e8e5;--ok:#1f9d57;--now:#25a36b;--bad:#d14343}
@media (prefers-color-scheme:dark){:root{--bg:#0e1311;--card:#161d1a;--ink:#e8efeb;--mute:#93a39b;--line:#25302b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 20px}
.brand{display:flex;align-items:center;gap:10px;color:var(--mute);font-weight:600;font-size:14px;letter-spacing:.02em}
.logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#25d366,#128c7e);display:grid;place-items:center;color:#fff;font-size:15px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px;margin-top:18px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 30px rgba(0,0,0,.04)}
h1{font-size:26px;line-height:1.2;margin:0 0 8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
p{margin:0;color:var(--mute)}
.badge{font-size:13px;font-weight:600;padding:4px 10px;border-radius:99px;background:rgba(37,163,107,.12);color:var(--now)}
.badge.bad{background:rgba(209,67,67,.12);color:var(--bad)}
ol{list-style:none;padding:0;margin:24px 0 0;display:grid;gap:12px}
li{display:flex;align-items:center;gap:12px;color:var(--mute)}
.dot{width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;font-size:13px;font-weight:700;flex:none}
li.done{color:var(--ink)}li.done .dot{background:var(--ok);border-color:var(--ok);color:#fff}
li.now{color:var(--ink);font-weight:600}li.now .dot{border-color:var(--now);border-top-color:transparent;animation:spin 1s linear infinite}
li.fail{color:var(--bad);font-weight:600}li.fail .dot{background:var(--bad);border-color:var(--bad);color:#fff}
@keyframes spin{to{transform:rotate(360deg)}}
details{margin-top:24px}summary{cursor:pointer;color:var(--mute);font-size:14px;font-weight:600}
pre{margin:12px 0 0;background:#0b0f0d;color:#cfd8d3;padding:16px;border-radius:12px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:55vh;overflow:auto}
footer{margin-top:16px;color:var(--mute);font-size:13px;text-align:center}
</style></head><body><main>
<div class=brand><div class=logo>✦</div>whatsapp-agent-duniya</div>
<div class=card>
<h1>$TITLE $BADGE</h1><p>$SUB</p>
<ol>$ITEMS</ol>
<details open><summary>Log</summary><pre>
HTML
    tail -n 80 <<<"$LOGTXT" | esc
    cat <<HTML
</pre></details></div>
<footer>Secrets are hidden in this log. This page is only shown during setup.</footer>
</main></body></html>
HTML
  } > /run/duniya-status/index.html.tmp && mv /run/duniya-status/index.html.tmp /run/duniya-status/index.html
  sleep 3
done
RENDER
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
