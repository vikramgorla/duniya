# Research: Bots, Users and Secrets Managed in the App

## Bot storage format

- **Decision**: one row per bot with the full configuration as validated JSON (`config` column) plus indexed
  columns (`id`, `tenant_id`, `name`, `enabled`, timestamps).
- **Rationale**: the configuration is a nested document (tool services, rules, schedules); JSON keeps
  import/export trivial and the schema validator is the single source of truth.
- **Alternatives**: fully normalised tables (heavy for little benefit at this scale).

## Secret encryption

- **Decision**: AES-256-GCM with a random 32-byte master key in `DATA_DIR/master.key` (0600), or `MASTER_KEY`
  env (base64) when operators want the key outside the data dir. Stored as `v1:<iv>:<tag>:<ciphertext>` base64.
- **Rationale**: protects copied databases and backups that exclude the key; backups (feature 007) are encrypted
  separately with the operator's passphrase.

## Sessions

- **Decision**: random 256-bit token in cookie; SHA-256 hash stored in `sessions` with expiry (7 days) and
  user id; deleted on logout/password change/user removal.

## First owner

- **Decision**: `ADMIN_PASSWORD` env (existing installs, IaC) creates owner `admin` once; otherwise a 6-word…
  simpler: a random 10-character setup code written to `DATA_DIR/setup-code.txt` and logged at start. Setup screen
  requires it. Removed after the owner exists.

## Tool discovery

- **Decision**: panel endpoint connects to a tool service with the organizer credential and returns tool names +
  descriptions; the editor turns ticks into exact `server:tool` entries (globs still allowed in advanced mode).

## Legacy migration

- **Decision**: if the `bots` table is empty and legacy folders exist (`BOTS_DIR`, default `<repo>/bots`), import
  each `bot.json` + `prompt.md` + `DATA_DIR/bots/<id>.json` overrides; legacy `index.js` hooks are not executed
  from data — if present, they map to a plugin of the same name when `plugins/<id>/` exists. Secrets from
  `secrets.json` are encrypted into the table and the file is removed.
