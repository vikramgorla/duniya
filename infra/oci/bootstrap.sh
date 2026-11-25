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
# Ubuntu 24.04's needrestart restarts services after apt installs; during setup only list, never restart.
export NEEDRESTART_MODE=l NEEDRESTART_SUSPEND=1

# ---------- live progress page on port 80 ----------
STATUS_DIR=/run/duniya-status
status_page() { # $1 = state shown in the banner
  install -d -m 755 "$STATUS_DIR"
  # Renderer: writes status.json (steps, log tail, state) every 2 s; secrets redacted, colours stripped.
  cat > /usr/local/sbin/duniya-status-render <<'RENDER'
#!/usr/bin/python3
import json, os, re, sys, time
STATE = sys.argv[1] if len(sys.argv) > 1 else 'Installing'
LOG = '/var/log/duniya-install.log'; OUT = '/run/duniya-status/status.json'
STEPS = [('Adding', 'Preparing the server'), ('Installing packages', 'Installing system packages'), ('Installing Node', 'Installing Node.js'),
         ('Downloading code', 'Downloading the app'), ('Installing Caddy', 'Setting up HTTPS'), ('Waiting for the service', 'Starting the panel')]
ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]|\[[0-9;]*m')
SECRET = re.compile(r'((?:token|password|secret|passphrase|apikey|api_key|setup code)[^:=\n]*[:=] *)\S+', re.I)
while True:
    try:
        with open(LOG, errors='replace') as f: text = f.read()[-60000:]
    except OSError: text = ''
    text = SECRET.sub(r'\1***', re.sub(r'(x-access-token:)[^@\s]+@', r'\1***@', ANSI.sub('', text)))
    cur = -1
    for i, (marker, _) in enumerate(STEPS):
        if marker in text: cur = i
    done = '== done:' in text
    data = {'state': 'failed' if STATE == 'Install failed' else 'done' if done else 'running', 'steps': [l for _, l in STEPS], 'current': cur,
            'log': text.splitlines()[-80:], 'uptime': float(open('/proc/uptime').read().split()[0]), 'at': time.time()}
    tmp = OUT + '.tmp'
    with open(tmp, 'w') as f: json.dump(data, f)
    os.replace(tmp, OUT)
    time.sleep(2)
RENDER
  chmod 755 /usr/local/sbin/duniya-status-render
  # The page itself is static and never reloads: it polls status.json and, when this temporary server goes away
  # (web server switch, restart), keeps probing the final panel address and opens it as soon as it answers.
  cat > "$STATUS_DIR/index.html" <<'PAGE'
<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Setting up · Duniya</title>
<style>
:root{--bg:#f2f1ec;--card:#fff;--ink:#101216;--mute:#5f636c;--line:#e2e0d8;--signal:#f55600;--bad:#c42443;--warn:#855600;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c0f;--card:#121419;--ink:#eceef2;--mute:#9196a1;--line:#23262e;--signal:#ff7a2e;--bad:#ff7d93;--warn:#ffc94d}}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(rgba(127,127,127,.12) 1px,transparent 1.2px) 0 0/22px 22px,var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif}
main{max-width:820px;margin:0 auto;padding:36px 18px}.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:19px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:16px}
.eyebrow{font:600 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
h1{font-size:26px;letter-spacing:-.02em;margin:4px 0 6px}p{margin:0;color:var(--mute)}
ol{list-style:none;padding:0;margin:20px 0 0;display:grid;gap:12px}li{display:flex;gap:12px;align-items:center;color:var(--mute)}
.d{width:22px;height:22px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none}
li.done{color:var(--ink)}li.done .d{background:var(--ink);border-color:var(--ink);color:var(--bg)}
li.now{color:var(--ink);font-weight:600}li.now .d{border-color:var(--signal);border-top-color:transparent;animation:s 1s linear infinite}
li.fail{color:var(--bad);font-weight:600}li.fail .d{background:var(--bad);border-color:var(--bad);color:#fff}
@keyframes s{to{transform:rotate(360deg)}}
.banner{margin-top:16px;border-left:3px solid var(--signal);background:color-mix(in srgb,var(--signal) 14%,transparent);padding:10px 12px;border-radius:8px;font-size:14px}
.banner.warn{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}.banner.bad{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.led{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--signal);box-shadow:0 0 8px var(--signal);margin-right:6px;vertical-align:1px}
pre{background:#0d0f13;color:#d6dae3;border-radius:12px;padding:14px;max-height:50vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.5 var(--mono)}
details summary{cursor:pointer;color:var(--mute);font-size:14px;margin-top:14px}a{color:inherit}
</style></head><body><main>
<div class=brand><svg viewBox="0 0 64 64" width=30 height=30 aria-hidden=true><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fb6602"/><stop offset="1" stop-color="#ec4a00"/></linearGradient></defs><rect width="64" height="64" rx="17" fill="url(#g)"/><g fill="#fff"><circle cx="32" cy="11" r="5"/><rect x="30.25" y="13" width="3.5" height="8"/><rect x="6.5" y="27" width="9.5" height="17" rx="4.75"/><rect x="48" y="27" width="9.5" height="17" rx="4.75"/><rect x="11.5" y="19" width="41" height="35" rx="14"/></g><rect x="17.5" y="25" width="29" height="22" rx="10" fill="#f25a00"/><path d="M21.6 38.5a4.4 4.4 0 0 1 8.8 0M33.6 38.5a4.4 4.4 0 0 1 8.8 0" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>Duniya</div>
<div class=card><div class=eyebrow id=eyebrow>Setting up your server</div><h1 id=title>Starting…</h1><p id=sub>First boot takes about 10–15 minutes on the free VM. Keep this page open: it follows the setup and opens your admin panel when it is ready.</p>
<ol id=steps></ol><div id=banner class=banner style="display:none"></div>
<details id=logbox open><summary>Log</summary><pre id=log>Waiting for the first lines…</pre></details></div>
<p style="margin-top:14px;font-size:13px">Your panel will be at <a id=final></a>. Secrets are hidden in this log.</p>
</main><script>
const FINAL='__FINAL__';
const $=(i)=>document.getElementById(i);
$('final').href=FINAL;$('final').textContent=FINAL;
let steps=['Preparing the server','Installing system packages','Installing Node.js','Downloading the app','Setting up HTTPS','Starting the panel'],cur=-1,state='running',lostSince=0,start=Date.now(),opened=false;
const EXTRA=['Switching to the secure web server','Opening your panel'];
function draw(){const all=steps.concat(EXTRA);const ol=$('steps');ol.replaceChildren();all.forEach((l,i)=>{const li=document.createElement('li');let c='';
 if(state==='failed'&&i===cur)c='fail';else if(i<cur||(state==='ready'&&i<all.length-1))c='done';else if(i===cur)c='now';li.className=c;const d=document.createElement('span');d.className='d';d.textContent=c==='done'?'✓':c==='fail'?'!':'';li.append(d,document.createTextNode(l));ol.append(li);});}
function banner(text,kind){const b=$('banner');b.style.display=text?'block':'none';b.className='banner '+(kind||'');b.replaceChildren();if(!text)return;const l=document.createElement('span');l.className='led';b.append(l,document.createTextNode(text));}
async function finalUp(){try{await fetch(FINAL+'/healthz',{mode:'no-cors',cache:'no-store'});return true;}catch{return false;}}
async function tick(){
 if(opened)return;
 let s=null;try{const r=await fetch('status.json?'+Date.now(),{cache:'no-store'});if(r.ok)s=await r.json();}catch{}
 if(s){lostSince=0;state=s.state;steps=s.steps||steps;cur=s.current;
  $('log').textContent=(s.log||[]).join('\n')||'…';const pre=$('log');pre.scrollTop=pre.scrollHeight;
  if(state==='failed'){$('eyebrow').textContent='Setup stopped';$('title').textContent='Something went wrong';$('sub').textContent='The end of the log below says what. Fix the cause, or redeploy: on the stack click Destroy, then Apply.';banner('');}
  else{$('eyebrow').textContent='Setting up your server · '+Math.round(s.uptime/60)+' min since boot';$('title').textContent=steps[Math.max(cur,0)]+'…';
   if(state==='done'||cur>=steps.length-2){banner('Almost there. This page will switch to your secure panel by itself.');if(await finalUp())return ready();}else banner('');}
  draw();return;}
 // This temporary page server is gone: the web server is switching over, or the server is restarting.
 if(!lostSince)lostSince=Date.now();const secs=Math.round((Date.now()-lostSince)/1000);
 if(state!=='failed'){cur=Math.max(cur,steps.length);draw();}
 $('eyebrow').textContent='Still working';$('title').textContent='Switching to the secure web server';
 banner(secs<240?`The setup page handed over to the final web server, which is getting its HTTPS certificate. Checking every few seconds… (${secs}s)`:`This is taking longer than usual (${Math.round(secs/60)} min). The server may be restarting. Still checking — you can also open the panel link below.`,secs<240?'':'warn');
 if(await finalUp())return ready();}
function ready(){opened=true;state='ready';cur=steps.length+1;draw();$('eyebrow').textContent='Ready';$('title').textContent='Your panel is ready';banner('Opening your admin panel…');setTimeout(()=>{location.href=FINAL;},1500);}
draw();tick();setInterval(tick,3000);
// Phones and iPads pause timers in background tabs: check at once when the page is shown again.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
</script></body></html>
PAGE
  sed -i "s#__FINAL__#${FINAL_URL}#" "$STATUS_DIR/index.html"
  chmod 755 /usr/local/sbin/duniya-status-render
  # Runtime units (gone after a reboot) with Restart=always: if Ubuntu's needrestart or anything else restarts or
  # kills them while packages install, systemd brings the page straight back.
  systemctl stop duniya-status-page duniya-status-render 2>/dev/null || true
  install -d /run/systemd/system
  cat > /run/systemd/system/duniya-status-render.service <<UNIT
[Unit]
Description=whatsapp-agent-duniya install progress (renderer)
[Service]
ExecStart=/usr/local/sbin/duniya-status-render "$1"
Restart=always
RestartSec=2
UNIT
  cat > /run/systemd/system/duniya-status-page.service <<UNIT
[Unit]
Description=whatsapp-agent-duniya install progress page on port 80
[Service]
ExecStart=/usr/bin/python3 -m http.server 80 --bind 0.0.0.0 --directory $STATUS_DIR
Restart=always
RestartSec=2
UNIT
  systemctl daemon-reload
  systemctl restart duniya-status-render duniya-status-page || true
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

SERVER_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
case "${EXPOSURE:-ip}" in domain) FINAL_URL="https://${DOMAIN}" ;; *) FINAL_URL="https://$(echo "$SERVER_IP" | tr '.:' '--').sslip.io" ;; esac
case "${EXPOSURE:-ip}" in ip|domain) open_web_ports; status_page "Installing" ;; esac
trap 'echo "whatsapp-agent-duniya install FAILED"; case "${EXPOSURE:-ip}" in ip|domain) status_page "Install failed" ;; esac' ERR

echo "== whatsapp-agent-duniya first boot: $(date -u +%FT%TZ)"
command -v git >/dev/null || { apt-get -o DPkg::Lock::Timeout=1200 update -y && apt-get -o DPkg::Lock::Timeout=1200 install -y git; }
URL="$REPO_URL"
if [ -n "${GIT_TOKEN:-}" ]; then URL="${REPO_URL/https:\/\//https://x-access-token:${GIT_TOKEN}@}"; fi
SRC=/root/duniya-installer
rm -rf "$SRC"
for _ in 1 2 3 4 5; do git clone -q --depth 1 --branch "${BRANCH:-main}" "$URL" "$SRC" && break; sleep 10; done

ARGS=(--yes --repo "$REPO_URL" --branch "${BRANCH:-main}" --update-mode "${UPDATE_MODE:-auto}")
case "${EXPOSURE:-ip}" in
  domain) ARGS+=(--domain "$DOMAIN") ;;
  tunnel) ARGS+=(--cloudflare-token "$CF_TUNNEL_TOKEN") ;;
  tailscale) ARGS+=(--tailscale-authkey "$TS_AUTHKEY") ;;
  local) ARGS+=(--local-only) ;;
  *) ARGS+=(--ip-https) ;;
esac
[ -n "${ADMIN_PASSWORD:-}" ] && ARGS+=(--admin-password "$ADMIN_PASSWORD")
[ -n "${GIT_TOKEN:-}" ] && ARGS+=(--git-token "$GIT_TOKEN")
if ! bash "$SRC/install.sh" "${ARGS[@]}"; then
  # Bring the progress page back (the installer hands port 80 to Caddy near the end) so the error is visible.
  echo "whatsapp-agent-duniya install FAILED (see the lines above)"
  systemctl stop caddy 2>/dev/null || true
  systemctl start duniya-status-render duniya-status-page 2>/dev/null || true
  exit 1
fi
systemctl stop duniya-status-render 2>/dev/null || true
rm -f /etc/duniya/bootstrap.env
echo "== done: $(date -u +%FT%TZ)"
