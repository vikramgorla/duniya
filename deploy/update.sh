#!/usr/bin/env bash
# Update the installation in place to TARGET (a release tag like v1.2.0, or a branch name; default: current branch).
# Called by the admin panel; the app restarts itself afterwards. Rolls back the code if dependencies fail to install.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-}"
PREV="$(git rev-parse HEAD)"
lock_hash() { [ -f package-lock.json ] && sha1sum package-lock.json | cut -d' ' -f1 || echo none; }
OLD_LOCK="$(lock_hash)"

echo "Current: $(git describe --tags --always 2>/dev/null) $(git log -1 --format='%s')"
git fetch -q origin --tags --prune

if [ -z "$TARGET" ]; then TARGET="$(git rev-parse --abbrev-ref HEAD)"; fi
if git rev-parse -q --verify "refs/tags/$TARGET" >/dev/null; then
  git checkout -q "refs/tags/$TARGET"
else
  git checkout -q "$TARGET" 2>/dev/null || git checkout -q -b "$TARGET" "origin/$TARGET"
  git merge -q --ff-only "origin/$TARGET"
fi

if [ "$(git rev-parse HEAD)" = "$PREV" ]; then echo "Already up to date."; exit 0; fi
echo "Now:     $(git describe --tags --always 2>/dev/null) $(git log -1 --format='%s')"

if [ "$OLD_LOCK" != "$(lock_hash)" ] && [ -f package-lock.json ]; then
  echo "Dependencies changed, installing…"
  if ! npm ci --omit=dev --no-audit --no-fund --loglevel=error; then
    echo "Dependency install failed; rolling back to $PREV" >&2
    git checkout -q "$PREV"
    npm ci --omit=dev --no-audit --no-fund --loglevel=error || true
    exit 1
  fi
fi
echo "OK"
