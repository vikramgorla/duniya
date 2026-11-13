#!/usr/bin/env bash
# Pull the latest code and install deps. Called by the admin panel ("Update from GitHub"),
# which then exits so systemd restarts the service with the new code.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
echo "Current: $(git log -1 --format='%h %s')"
git fetch --quiet origin "$BRANCH"
if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ]; then
  echo "Already up to date."
  exit 0
fi
OLD_LOCK_HASH="$(sha1sum package-lock.json | cut -d' ' -f1)"
git merge --ff-only "origin/$BRANCH"
echo "Now:     $(git log -1 --format='%h %s')"
if [ "$OLD_LOCK_HASH" != "$(sha1sum package-lock.json | cut -d' ' -f1)" ]; then
  echo "Dependencies changed, installing…"
  npm ci --omit=dev --no-audit --no-fund
fi
echo "OK"
