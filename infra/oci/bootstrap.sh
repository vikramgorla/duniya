#!/bin/bash
# First boot (cloud-init user_data): clone the repo and run the same installer people use by hand.
# /etc/duniya/bootstrap.env is written just before this script runs (see main.tf).
set -euo pipefail
exec > >(tee -a /var/log/duniya-install.log) 2>&1
set -a; . /etc/duniya/bootstrap.env; set +a
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null || { apt-get update -y && apt-get install -y git; }
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
rm -f /etc/duniya/bootstrap.env
