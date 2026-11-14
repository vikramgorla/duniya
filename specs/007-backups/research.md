# Research: Encrypted Scheduled Backups and Restore

## Encryption

- **Decision**: file = `DUNIYA1\n` + JSON header `{kdf:"scrypt",N:32768,r:8,p:1,salt,iv,tag}` + `\n` + AES-256-GCM
  ciphertext of gzip(JSON bundle). Wrong passphrase fails the GCM tag check.
- **Alternatives**: age/gpg (external binaries), zip with password (weak).

## Consistent database snapshot

- **Decision**: `VACUUM INTO '<tmp>'` (SQLite ≥ 3.27) creates a consistent copy while the app keeps writing.

## GitHub upload

- **Decision**: Git Data API — create blob (base64), create tree with `base_tree` plus entries for the new file and
  `sha: null` entries for pruned files, create commit, update `refs/heads/<default>`. One commit per backup.
  Repo created with `auto_init: true` so a ref exists. Device flow: `POST https://github.com/login/device/code`
  (`client_id`, `scope=repo`) and poll `POST https://github.com/login/oauth/access_token` with
  `grant_type=urn:ietf:params:oauth:grant-type:device_code`; requires an OAuth App with "Enable Device Flow".
- **Alternatives**: contents API (simpler, but pruning needs one commit per file); git CLI (credentials on disk).

## S3

- **Decision**: minimal SigV4 (service `s3`, `UNSIGNED-PAYLOAD` not used; payload SHA-256 computed), path-style URLs
  `<endpoint>/<bucket>/<key>`; ListObjectsV2 XML parsed with regex for `<Key>`, `<Size>`, `<LastModified>`.
- Works with Cloudflare R2, OCI Object Storage S3 compatibility API, AWS, MinIO.

## Restore at boot

- **Decision**: stage to `restore-pending/` with a manifest; on start, before opening SQLite, move current files to
  `pre-restore-<ts>/` and put restored files in place. The panel triggers a restart (systemd/Docker restarts).
