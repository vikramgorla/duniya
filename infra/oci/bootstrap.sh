#!/usr/bin/env bash
# First-boot bootstrap (run by cloud-init): clone the repo and hand over to deploy/install.sh.
set -euo pipefail
exec > >(tee -a /var/log/duniya-install.log) 2>&1
set -a; . /etc/duniya/bootstrap.env; set +a
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null || { apt-get update -y && apt-get install -y git; }
URL="$REPO_URL"
if [ -n "${GIT_TOKEN:-}" ]; then URL="${REPO_URL/https:\/\//https://x-access-token:${GIT_TOKEN}@}"; fi
if [ ! -d /opt/whatsapp-agent-duniya/.git ]; then
  for i in 1 2 3 4 5; do git clone --branch "${BRANCH:-main}" "$URL" /opt/whatsapp-agent-duniya && break; sleep 10; done
fi
bash /opt/whatsapp-agent-duniya/deploy/install.sh
