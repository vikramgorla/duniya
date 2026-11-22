#!/usr/bin/env bash
# Update the installation in place to TARGET (a release tag like v1.2.0, or a branch name; default: current branch).
# Called by the admin panel; the app restarts itself afterwards. Rolls back the code if dependencies fail to install.
# When it fails, its last line says why in plain words: the panel and Activity show that line.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-}"
PREV="$(git rev-parse HEAD)"
# What is installed: the packages the app runs on (src/core/update-guard.js: the app's own version and the development
# tools do not count, so most updates install nothing). If that cannot be asked, any change of the lockfile counts.
lock_hash() {
  [ -f package-lock.json ] || { echo none; return; }
  node -e 'import("./src/core/update-guard.js").then((m) => { const k = m.depsKey("."); if (!k) process.exit(1); console.log(k); })' 2>/dev/null \
    || sha1sum package-lock.json | cut -d' ' -f1
}
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

# A release is watched while it starts by its own entry and start guard (src/index.js, src/core/update-guard.js: Node
# built-ins only, so they load without the packages). If they do not load, nothing could put the release back once it
# is installed: it is refused here, while the previous version still runs.
guard_loads() {
  [ ! -f src/index.js ] || node --check src/index.js || return 1
  [ ! -f src/core/update-guard.js ] || node -e 'import("./src/core/update-guard.js")'
}
if ! guard_loads >/dev/null 2>&1; then
  echo "This release could not be put back if it did not start (its entry or its start guard does not load): not installed, the previous version stays" >&2
  git checkout -q "$PREV"
  exit 1
fi

if [ "$OLD_LOCK" != "$(lock_hash)" ] && [ -f package-lock.json ]; then
  echo "Dependencies changed, installing…"
  if ! npm ci --omit=dev --no-audit --no-fund --loglevel=error; then
    echo "Dependency install failed; rolling back to $PREV" >&2
    git checkout -q "$PREV"
    npm ci --omit=dev --no-audit --no-fund --loglevel=error || true
    echo "The packages this release needs could not be installed: not installed, the previous version stays" >&2
    exit 1
  fi
fi
echo "OK"
