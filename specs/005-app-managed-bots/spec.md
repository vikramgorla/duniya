# Feature Specification: Bots, Users and Secrets Managed in the App

**Feature Branch**: `005-app-managed-bots`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "I want to productize it: have bots saved in the app rather than hardcoded in code.
Self-hosted now, SaaS later."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and edit bots in the panel (Priority: P1)

An owner creates a new bot entirely from the admin panel — name, instructions, triggers, who may DM it,
organizers, the tool services it uses and which tools each role may use, confirmation rules, schedules and
memory — and binds it to a group. No code change or redeploy is needed. Editing a bot takes effect immediately.

**Why this priority**: this is the core of productizing; today bots live in the code repository.

**Independent Test**: on a fresh install, create a bot from the panel, bind it to a group, and get an answer.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the owner creates a bot from the "Blank" template and saves it,
   **Then** the bot exists, can be bound to a group, and answers there.
2. **Given** a bot with a tool service, **When** the owner clicks "Discover tools", **Then** the service's tools
   are listed and the owner ticks which ones participants and organizers may use.
3. **Given** invalid input (missing name, malformed schedule, bad URL), **When** saving, **Then** nothing is
   saved and the problem is shown.
4. **Given** a bot, **When** the owner deletes it (confirming), **Then** it stops answering and its group
   bindings are removed; stored chat memory stays until erased separately.

---

### User Story 2 - Templates, import and export (Priority: P2)

The owner starts a bot from a template (e.g. "Event assistant (panduga.ch)", "Blank"), duplicates bots, and
exports a bot as a file to import on another server.

**Why this priority**: makes bots shareable and setup fast; replaces "copy a folder in the repo".

**Independent Test**: export a bot, import the file on a fresh instance, and compare.

**Acceptance Scenarios**:

1. **Given** the template list, **When** the owner picks one, **Then** the editor opens pre-filled.
2. **Given** a bot, **When** exported and re-imported, **Then** the imported bot has the same settings, a new id,
   no group bindings, and secret values are not included (only their names).

---

### User Story 3 - Existing installs migrate automatically (Priority: P2)

A server that ran the earlier version (bots defined in files plus panel overrides) upgrades and finds the same
bots, settings and bindings in the app.

**Why this priority**: the current deployment must not break.

**Independent Test**: start with legacy bot folders and override files; after start, the bots are in the app
with identical behaviour.

**Acceptance Scenarios**:

1. **Given** legacy bot files and overrides, **When** the new version starts the first time, **Then** each bot is
   imported once with overrides applied, and later starts don't re-import.

---

### User Story 4 - Several admins with roles (Priority: P2)

The owner invites co-organizers to the panel as admins (manage bots, chats, memory) or viewers (read-only).
The first account is created securely on first start.

**Why this priority**: events are run by several people; SaaS later needs real accounts.

**Independent Test**: create an admin and a viewer; the viewer can see but not change anything.

**Acceptance Scenarios**:

1. **Given** a fresh install without a preset password, **When** someone opens the panel, **Then** they must enter
   a one-time setup code (shown in the server log/installer output) to create the owner account.
2. **Given** a viewer, **When** they try to change anything, **Then** it is refused.
3. **Given** an admin, **When** they try to manage users, **Then** it is refused; only the owner can.

---

### User Story 5 - Secrets protected at rest (Priority: P3)

API keys and tokens entered in the panel are stored encrypted on disk, so a copied database or backup alone
does not reveal them.

**Independent Test**: set a secret and confirm its value does not appear in any data file.

**Acceptance Scenarios**:

1. **Given** a secret saved in the panel, **When** the data directory is inspected, **Then** the plaintext value
   is not present, and the bot still uses it.

### Edge Cases

- Two admins edit the same bot: the last save wins and both see the result after reload.
- A bot refers to a secret that doesn't exist: the bot shows as needing configuration; it doesn't crash others.
- Importing a file from a newer version with unknown fields: unknown fields are ignored with a warning.
- Deleting the last owner is not allowed.
- Code plugins (custom tools/commands) remain possible for advanced users and are attached to bots by name;
  a missing plugin disables only that bot's plugin features.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Bots MUST be stored in the application database and be fully creatable, editable, duplicable and
  deletable from the panel, with immediate effect and no restart.
- **FR-002**: The bot editor MUST cover: name, description, enabled, model, limits, instructions, triggers,
  mention behaviour, DM policy, organizers, participants, tool services (URL and per-role credentials as secret
  references), per-role tool allow/deny lists, confirmation rule, schedules, memory on/off, attached plugins.
- **FR-003**: The panel MUST discover a tool service's tools and let the owner choose them per role.
- **FR-004**: Bot configurations MUST be validated on save; invalid saves change nothing.
- **FR-005**: The system MUST ship bot templates and support export/import of a bot as a JSON file that never
  contains secret values.
- **FR-006**: On first start of this version, legacy file-based bots and their overrides MUST be imported once.
- **FR-007**: The panel MUST support multiple user accounts with roles owner, admin and viewer; viewers are
  read-only; only owners manage users; at least one owner must always exist.
- **FR-008**: The first owner MUST be created either from a preset bootstrap password or with a one-time setup
  code that is only available on the server.
- **FR-009**: Sessions MUST survive restarts and be revocable (logout, password change, user removal).
- **FR-010**: Secrets MUST be encrypted at rest with a server-held key; values are never returned by the API.
- **FR-011**: Bots, users, secrets and settings MUST carry a tenant identifier (single default tenant today) so
  the data model can support hosted multi-tenancy later.
- **FR-012**: Code plugins MUST be optional add-ons attached to bots by name, not required for any bot.
- **FR-013**: All bot, user and secret changes MUST be recorded in activity with the acting user.

### Key Entities

- **Tenant**: an isolated workspace (one "default" today).
- **User**: username, email (optional), role, password hash, tenant.
- **Session**: a signed-in browser for a user, with expiry.
- **Bot**: id, tenant, configuration (as in FR-002), timestamps.
- **Template**: a read-only bot configuration shipped with the app.
- **Secret**: tenant, name, encrypted value.
- **Plugin**: optional code providing tools/commands, referenced by name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new bot can be created and answering in a group in under 5 minutes without touching code or files.
- **SC-002**: 100% of legacy bots and settings are present after upgrade (test).
- **SC-003**: Viewers cannot change anything (test covering every mutating endpoint).
- **SC-004**: No secret value appears in data files or API responses (test).

## Assumptions

- One deployment = one tenant for now; hosted multi-tenancy (signup, billing, tenant isolation in the runtime)
  is a later feature.
- Code plugins live in the `plugins/` directory of the installation and are installed by the operator.
- The setup code is visible to whoever can read the server's logs or the installer output.
