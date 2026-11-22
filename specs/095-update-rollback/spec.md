# Feature Specification: A release that does not start is rolled back

**Feature Branch**: `feat/279-update-rollback`

**Created**: 2026-11-22

**Status**: Implemented in v2.59.0

**Input**: User description: "Update rollback: a release that does not start is rolled back by itself. Today an update (panel, WhatsApp confirmation, automatic at night, or `duniya update`) checks out the new release and restarts; if the new release then cannot start, systemd restarts it for ever, the panel is unreachable and the owner needs SSH."

Found by the audit of every functionality (resilience of updates). Issue #279.

## Problem

An update replaces the code and restarts the app. When the new release cannot start on this server (a crash while it
starts, or in its first minute), the service restarts every few seconds for good: no panel, no agents, no message to
the owner. Automatic updates run at night, so the owner finds a dead server in the morning and needs a terminal to
put the old release back. Everything else in the app heals itself; this is the one failure that asks for SSH.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The server puts the previous release back (Priority: P1)

An owner's server updates itself at night. The new release crashes while it starts. After three tries the server
puts the previous release back and runs it again; agents answer as before. The owner did nothing.

**Why this priority**: it is the whole point: a bad release must not need a terminal.

**Independent Test**: install a release that throws while it starts on a test checkout; start three times; the fourth
start runs the previous release.

**Acceptance Scenarios**:

1. **Given** an update was installed, **When** the new release starts and stays up for one minute, **Then** the update
   counts as holding and nothing else happens.
2. **Given** an update was installed, **When** three starts in a row end before that minute is over, **Then** at the
   next start the previous release (code and, when they differ, its dependencies) is put back and started.
3. **Given** the previous release was put back, **When** it starts, **Then** it is not rolled back again and no further
   start is counted.
4. **Given** no update was installed (a normal restart, a crash on an old release), **When** the app starts, **Then**
   nothing is counted and nothing is rolled back.

---

### User Story 2 - The owner is told what happened (Priority: P2)

After a rollback the owner reads, in plain words, which version did not start, which one runs now, that the data was
not changed, and where the backup made before the update is (when one was made).

**Why this priority**: a silent rollback leaves the owner believing the update is installed.

**Independent Test**: after the rollback of story 1, Activity, the owner alert, the Updates card and the admin MCP
update status all name both versions.

**Acceptance Scenarios**:

1. **Given** a rollback happened, **When** the previous release has started, **Then** Activity has one line that names
   the version that did not start and the version running now, and the owner alert is sent once.
2. **Given** a rollback happened, **When** the owner opens Updates (panel) or asks the admin MCP for the update status,
   **Then** it says the same, with the time, until a later update holds.
3. **Given** the update had been confirmed on WhatsApp, **When** the previous release has started, **Then** the result
   message says the update did not start and was undone (not only "did not finish").

---

### User Story 3 - The same release is not installed again by itself (Priority: P2)

Automatic updates do not install the version that was rolled back. A newer release is installed as usual; the owner
can still choose **Update** by hand to try the same version again.

**Why this priority**: without it the server would install the same release every night and roll back every night.

**Independent Test**: after a rollback, the automatic update round at the configured time does nothing for that
version; with a newer version available it installs that one; a manual update installs the rolled-back version.

**Acceptance Scenarios**:

1. **Given** version X was rolled back and X is still the newest, **When** the automatic update time comes, **Then**
   nothing is installed and the status says why.
2. **Given** version X was rolled back, **When** version Y (newer) is available, **Then** Y is installed automatically
   as usual.
3. **Given** version X was rolled back, **When** the owner starts the update by hand (panel, WhatsApp confirmation or
   command line), **Then** X is installed and guarded like any update.

### Edge Cases

- The note about the update cannot be read (damaged file): it is dropped and the app starts normally.
- A step of putting the previous release back fails (its dependencies cannot be installed for a moment): it is tried
  again at the next start, three times at most; then the failure is reported, nothing more is counted and the start
  goes on with what is there.
- The owner restarts the server by hand three times within a minute each, right after an update: counted like failed
  starts (accepted: it needs three restarts in a row, each within the first minute).
- The server reboots during the first minute: one start is counted, not three.
- Someone already put the previous release back by hand: the note is dropped, nothing is rolled back.
- The new release changed the database before it failed: the data stays as it is; additive changes do not disturb the
  previous release. The backup made before the update (when backups are set up) is named in the message.
- Docker and development checkouts: nothing is noted, counted or rolled back.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After an update was installed on an installer server, and before the restart, the app MUST note where it
  came from (the exact code and its version), where it went to, when, and the backup made before it (if any).
  An update that changed nothing ("already up to date") notes nothing.
- **FR-002**: Every start MUST be guarded before any other app code is loaded. The guard MUST depend on nothing but the
  runtime itself, so a release whose own code is broken still reaches it.
- **FR-003**: A start with such a note counts as one try. When the app has finished starting and stayed up for one
  minute, the note MUST be removed (the update holds).
- **FR-004**: When three tries in a row did not hold, the next start MUST put the noted previous code back, install its
  dependencies only when they differ from the new release's, note the result and end, so the service manager starts the
  previous release. A step that fails is tried again at the next start, three times at most.
- **FR-005**: The guard MUST fail open: any error inside it (unreadable note, failing commands, missing tools) is noted
  when possible and never prevents a start. It MUST do nothing in Docker and in development checkouts.
- **FR-006**: Every wait of the guard on a command MUST have a deadline.
- **FR-007**: After a rollback (or a failed rollback) the app MUST tell the owner once, in plain words: Activity, the
  owner alert, the Updates card of the panel, the update status of the admin MCP and the status of the command line. The text names the version that
  did not start, the version running now, that the data was not changed, and the pre-update backup when there is one.
- **FR-008**: Automatic updates MUST NOT install the version that was rolled back. A newer version, or an update the
  owner starts by hand, lifts this.
- **FR-009**: The rollback notice MUST stay visible in the update status until a later update holds.
- **FR-010**: Nothing to configure; no new background timer besides the single one-minute check of a start after an
  update; no new dependency.

### Key Entities

- **Update note**: where the update came from (code, version), where it went, when, the pre-update backup, how many
  starts were tried. Exists only between an update and the moment it holds or is rolled back.
- **Rollback result**: which version did not start, which runs now, when, whether putting it back worked (and why
  not). Read once at the next start; kept in the update status until a later update holds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A release that cannot start is replaced by the previous one without any action by the owner, within five
  minutes on a small server when the dependencies did not change.
- **SC-002**: After a rollback the owner can read what happened in the panel and gets one alert; no terminal needed.
- **SC-003**: A server never installs the same failing release twice by itself.
- **SC-004**: A normal restart or a crash of a release that already held never triggers a rollback.
- **SC-005**: A failure of the guard itself never keeps a release from starting.

## Assumptions

- Installer servers run the app under a service manager that restarts it after a crash (as the installer sets up).
- The previous release is still in the checkout's history (updates fetch, they do not prune commits).
- Restoring data is out of scope: the database stays as it is. Releases change the schema additively; a breaking
  release is never installed automatically and needs the owner's decision (045).
- Docker images and the root maintenance helper are out of scope.
- The first release with this feature guards updates from itself onwards: the note is written by the release that
  installs the update.
