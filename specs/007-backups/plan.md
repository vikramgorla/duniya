# Implementation Plan: Encrypted Scheduled Backups and Restore

**Branch**: `007-backups` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

## Summary

`src/core/backup/` builds a bundle (SQLite snapshot via `VACUUM INTO`, master key, optional WhatsApp auth files) as
gzip'd JSON, encrypts it (scrypt N=2^15 → AES-256-GCM) into `DUNIYA1` files, keeps a local copy and uploads to GitHub
(Git Data API: blob → tree with deletions → commit → ref) and/or S3-compatible storage (SigV4, no SDK). Restore
decrypts into `DATA_DIR/restore-pending/` and the process restarts; `config.js` applies pending restores before the
database opens. A scheduler runs due backups.

## Technical Context

**Language/Version**: Node.js 22 LTS

**Primary Dependencies**: none new (`node:zlib`, `node:crypto`, `fetch`)

**Storage**: settings `backup` (JSON), secrets `BACKUP_PASSPHRASE`, `GITHUB_BACKUP_TOKEN`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`; files `DATA_DIR/../backups/` (local), `DATA_DIR/restore-pending/`

**Testing**: fake GitHub (device flow, repo create, git data API, contents) and fake S3 (path-style, SigV4 header
checks) servers; round-trip restore into a second data directory

**Constraints**: owner-only; destinations independent; GitHub file ≤ 90 MB

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| VI. Free tier | Uses free GitHub private repos / any S3; no extra service | PASS |
| V. Observable | backup.* activity, destination status | PASS |
| Security | Client-side encryption with owner passphrase; tokens encrypted; owner-only | PASS |
| VII. Tested | round-trip + destination fakes | PASS |

## Project Structure

```text
src/core/backup/
├── bundle.js     # create/extract bundle, encrypt/decrypt, apply pending restore
├── github.js     # device flow, repo create, upload/prune/list/download
├── s3.js         # SigV4 client: put/get/list/delete
└── index.js      # settings, run now, schedule, list, restore
src/core/config.js          # applyPendingRestore() before DB open
src/panel/routes/backups.js
test/backups.test.js
```

## Complexity Tracking

No violations.
