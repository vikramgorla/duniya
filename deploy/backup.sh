#!/usr/bin/env bash
# Nightly backup of the data dir (WhatsApp session, SQLite, secrets, bot settings). Keeps 7 locally.
# Off-VM copy: set BACKUP_RCLONE_REMOTE in /etc/duniya/app.env (e.g. "r2:duniya-backups") and install rclone.
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/duniya/data}"
OUT_DIR="$(dirname "$DATA_DIR")/backups"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/duniya-$(date +%F).tgz"
node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1]).exec('PRAGMA wal_checkpoint(TRUNCATE)')" "$DATA_DIR/duniya.sqlite" 2>/dev/null || true
tar -czf "$OUT" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
chmod 600 "$OUT"
ls -1t "$OUT_DIR"/duniya-*.tgz | tail -n +8 | xargs -r rm --
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$OUT" "$BACKUP_RCLONE_REMOTE" --quiet
fi
echo "$(date -Is) backup ok: $OUT"
