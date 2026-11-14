# Contract: Backups API (owner only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/backups` | | `{ settings, passphraseSet, github: { connected, login?, clientIdSet }, s3: { keysSet }, last, local: [file…] }` |
| PUT | `/api/backups/settings` | partial `backup` setting | settings (400 on invalid; enabling requires passphrase) |
| PUT | `/api/backups/passphrase` | `{ passphrase }` | `{ ok }` |
| POST | `/api/backups/run` | | `{ file, size, results }` |
| GET | `/api/backups/list?source=local\|github\|s3` | | `[{ file, size, at }]` newest first |
| GET | `/api/backups/download/:file` | | encrypted file (local only) |
| POST | `/api/backups/restore` | `{ source, file, passphrase }` | `{ ok, restarting: true }` / 400 wrong passphrase |
| POST | `/api/backups/github/device` | | `{ userCode, verificationUri, expiresIn, interval }` |
| POST | `/api/backups/github/poll` | | `{ status: "pending"\|"connected"\|"expired"\|"denied", login? }` |
| PUT | `/api/backups/github/token` | `{ token }` | `{ login }` |
| POST | `/api/backups/github/create-repo` | `{ name?, owner? }` | `{ repo }` |
| DELETE | `/api/backups/github` | | `{ ok }` |
| PUT | `/api/backups/s3/keys` | `{ accessKeyId, secretAccessKey }` | `{ ok }` |
| POST | `/api/backups/test/:dest` | | `{ ok }` / `{ error }` |
