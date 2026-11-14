# Quickstart: Backups

## Automated

`npm test` → `test/backups.test.js`: passphrase required to enable; encrypted file unreadable; local + GitHub (device
flow, private repo creation, commit with pruning) + S3 (SigV4 headers, put/list/delete, retention); destination failure
isolation; schedule due logic; restore with wrong passphrase refused; round trip into a fresh data dir reproduces bots,
users, secrets (with master key), memory and WhatsApp session files.

## Manual

1. Panel → Backups → set passphrase → enable daily 03:30, keep 14 → Run now → listed.
2. Connect GitHub (code) or paste token → Create private repo → Run now → file in repo.
3. S3: R2 endpoint, region `auto`, bucket, keys → Test → Run now.
4. On a new server: finish setup, Backups → GitHub/S3 list → Restore with passphrase → server restarts → sign in with the
   old account; WhatsApp is still linked.
