# Feature Specification: Encrypted Scheduled Backups and Restore

**Feature Branch**: `007-backups`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "Provide option to periodically backup bots, config, memory… could be to a GitHub private
repo it creates and backs up to, with option to create a GitHub account." Clarified: GitHub via device login or token,
plus S3-compatible storage.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn on scheduled encrypted backups (Priority: P1)

The owner sets a backup passphrase, picks a schedule (e.g. daily 03:30) and how many backups to keep. Backups contain
everything needed to rebuild the server: bots, users, settings, secrets, chat memory and (optionally) the WhatsApp
session. Each backup is encrypted with the passphrase before it leaves the server.

**Why this priority**: free VMs can disappear; losing the WhatsApp link and memory is the worst outcome.

**Independent Test**: enable backups, run one now, see it listed with size and time.

**Acceptance Scenarios**:

1. **Given** no passphrase, **When** the owner tries to enable backups, **Then** it asks for a passphrase first.
2. **Given** backups enabled, **When** the schedule time arrives, **Then** one backup is made and older ones beyond the
   keep count are removed from every destination.
3. **Given** a backup file, **When** inspected without the passphrase, **Then** no content is readable.

---

### User Story 2 - Back up to a private GitHub repository (Priority: P1)

The owner clicks "Connect GitHub", enters the shown code on github.com (or pastes a token), and the app creates a
private repository (e.g. `duniya-backups`) and pushes each backup there. A link helps people without a GitHub account
create one first.

**Why this priority**: free, off-server, versioned storage most owners already have.

**Independent Test**: connect GitHub, create the repo, run a backup, see the file in the repo.

**Acceptance Scenarios**:

1. **Given** a GitHub app client id is configured, **When** the owner clicks Connect, **Then** a code and link are shown
   and the connection completes after approval on GitHub.
2. **Given** no client id, **Then** the panel explains how to paste a token instead (and how to enable device login).
3. **Given** a connection, **When** "Create private repo" is clicked, **Then** a private repo is created and selected.
4. **Given** the keep count is exceeded, **Then** the oldest backup files are deleted from the repo in the same commit.

---

### User Story 3 - Back up to S3-compatible storage (Priority: P2)

The owner enters an endpoint, region, bucket, optional prefix and access keys (Cloudflare R2, OCI Object Storage S3
API, AWS S3, MinIO…). Backups are uploaded there with the same retention.

**Independent Test**: configure a bucket, run a backup, list it.

**Acceptance Scenarios**:

1. **Given** valid S3 settings, **When** a backup runs, **Then** the object exists under the prefix; wrong keys show an error.

---

### User Story 4 - Restore (Priority: P1)

On the same or a new server, the owner picks a backup (from the server, GitHub or S3), enters the passphrase and
restores. The server restarts with the restored bots, users, settings, secrets, memory and WhatsApp session.

**Why this priority**: a backup that can't be restored is worthless.

**Independent Test**: back up, change data, restore, restart; data matches the backup.

**Acceptance Scenarios**:

1. **Given** a backup and the right passphrase, **When** restoring, **Then** after restart the data equals the backup.
2. **Given** a wrong passphrase, **Then** restore is refused and nothing changes.

### Edge Cases

- A destination fails (network, auth): other destinations still get the backup; the failure is shown and recorded.
- Backup while messages arrive: the database snapshot is consistent.
- Passphrase changed: new backups use the new one; old backups need the old one (the panel warns).
- Restoring onto a server with a different master key: secrets are restored with the backup's key.
- Very large backups (> 90 MB) on GitHub: refused with a message suggesting S3.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Backups MUST include the database (bots, users, sessions excluded, settings, encrypted secrets, memory,
  activity), the master key, and optionally the WhatsApp session; plugins are not included.
- **FR-002**: Backups MUST be encrypted with a key derived from an owner passphrase (scrypt + AES-256-GCM) and be
  unreadable without it.
- **FR-003**: Backups MUST run on a schedule (hourly, every 6 h, daily at a time, weekly) and on demand, keep the
  newest N (default 14) per destination, and always keep a local copy.
- **FR-004**: GitHub destination MUST support device login (with a configurable OAuth client id) and a pasted token,
  create a private repository, and upload via commits that also prune old backups.
- **FR-005**: S3-compatible destination MUST support custom endpoint, region, bucket, prefix and access keys with
  Signature V4 (path-style).
- **FR-006**: Restore MUST verify the passphrase, stage files, and apply them at the next start, then restart.
- **FR-007**: Backup and restore actions and failures MUST be recorded in activity; destination status visible in the panel.
- **FR-008**: Only owners can configure, run, download or restore backups.
- **FR-009**: The panel MUST link to GitHub signup for owners without an account.

### Key Entities

- **Backup**: file name with timestamp, size, destinations, created time.
- **Backup settings**: enabled, schedule, keep, include WhatsApp, destinations config.
- **Destination**: local, GitHub (repo, token), S3 (endpoint, region, bucket, prefix, keys).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Restore after a lost server (new install + restore) takes under 15 minutes and needs no WhatsApp re-link.
- **SC-002**: 100% of round-trip tests (backup → modify → restore) reproduce the backed-up data.
- **SC-003**: No backup content readable without the passphrase (test).

## Assumptions

- GitHub device login needs an OAuth App with Device Flow enabled; the project ships its client id once registered,
  and installs can override it. Accounts can't be created by the app (GitHub requires a person to sign up).
- Backups are small (MBs) for typical use; GitHub's 100 MB file limit is acceptable with a 90 MB guard.
