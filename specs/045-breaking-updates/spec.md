# Feature Specification: Breaking Releases Need the Owner's Confirmation

**Feature Branch**: `feat/57-breaking-updates` (issue #57)

**Created**: 2026-11-15

**Status**: Implemented (v2.9.0)

**Input**: Owner: "For auto update when there are non backward compatible or breaking changes, make it work like a
notification asking the owner to confirm (on the panel, or on WhatsApp if the owner has it configured). Maybe with some
tags in the release which help identify it between installed and available release."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic updates never cross a breaking release (Priority: P1)

The owner runs *Install automatically*. Releases that need nothing from them keep installing at the configured time.
When a breaking release appears, the app installs the newest release before it and stops.

**Acceptance Scenarios**:

1. **Given** installed v1.0.0 and tags v1.1.0, v1.2.0 (marked breaking), v1.3.0, v2.0.0, **When** the scheduler runs
   in auto mode, **Then** v1.1.0 is installed (after a local backup) and nothing beyond it.
2. **Given** a major version bump without a `releases.json` entry, **Then** it counts as breaking.
3. **Given** notify mode, **Then** nothing is installed; the notice is the same.

### User Story 2 - I am told once, on the panel and on WhatsApp (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a breaking release, **Then** exactly one notice per breaking version: Overview banner "Version X needs
   your decision", the Updates card, an Activity entry, a WhatsApp message to the owner alert number and, to every
   **owner** who linked the owner assistant, a message with a code ("Reply `confirm ABCD` to update to X — a backup is
   made first"). Admins and viewers never get codes. When the alert number is a linked owner's, one message is sent.
2. **Remind me in 7 days** hides the banner and notifies again after 7 days; **Dismiss** hides it until a newer
   breaking release.

### User Story 3 - Confirm with the release notes in front of me (Priority: P1)

**Acceptance Scenarios**:

1. **Review update** shows, for every breaking release in between: title, summary, what I need to do, whether data is
   carried over, a docs link; *Make a backup first* (on by default; the update waits for it); *Update to X*.
2. **Given** `confirm ABCD` from the owner's linked chat, **Then** backup → update → restart, and after the restart the
   owner gets "✓ Updated to X (from Y)" in the same chat (pending report kept in kv, 2 days). A failed update is
   reported at once. `cancel ABCD` snoozes 7 days. Codes: owners only, single use, 3 days, survive restarts.
3. Without the confirmation the apply API installs only the safe release, or answers 409 when none is left.

### User Story 4 - A backup before every update (Priority: P2)

**Given** a backup passphrase is set, **Then** every update (panel, automatic, WhatsApp, CLI) makes a local backup first
and does not install when it fails. The last N pre-update backups are kept (setting `keepPreUpdate`, default 3, 1–20),
separate from the normal retention, local only, listed with local backups.

### User Story 5 - Releases carry the information (Priority: P2)

`releases.json` at the repository root: `versions["X.Y.Z"] = { breaking, title, summary, actions[], data, docs }`, read
from the target with `git show <tag>:releases.json` (no GitHub API). The release workflow builds the GitHub release
notes from it and prefixes the title with "⚠️ Breaking —". CI fails on a major bump without a breaking entry with
actions and warns when the version has no entry. AGENTS.md (Definition of Done) and the Spec Kit templates require it.

### Edge Cases

- `releases.json` missing or malformed in a release → treated as empty (only major bumps count); hostile fields are
  dropped (docs paths must match a safe pattern, strings clipped).
- `main` channel: the target version is `package.json` at `origin/main`; safe target is `main` or nothing.
- Docker installs: the notice is shown; confirming explains `docker compose pull`.
- Servers older than 2.9.0 do not read `releases.json` (documented: update to 2.9.0 first).

## Requirements *(mandatory)*

- **FR-001** Breaking = major grows OR any version v with current < v <= target is marked breaking.
- **FR-002** Status exposes `breaking`, `steps`, `safeTarget`, `decisionVersion`, recomputed for the running version.
- **FR-003** Auto mode installs `safeTarget` only; announcements deduplicated per decision version (kv `updates:notice`).
- **FR-004** Confirmation (panel or WhatsApp) is for owners only, decided in code.
- **FR-005** Pre-update backup when a passphrase is set; failure stops the update; retention `keepPreUpdate`.
- **FR-006** Release workflow notes/title from `releases.json`; CI rule; DoD + templates.
- **FR-007** Admin MCP: `get_update_status` (steps), `apply_update` (`breaking`, `backup`; confirmation), 
  `snooze_update_decision`. CLI: `duniya update [--breaking]`.

## Success Criteria

- No automatic update crosses a breaking release (tests with real git repositories).
- The owner is notified once per breaking release on every configured channel.
