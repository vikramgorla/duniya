# Feature Specification: Automatic OS updates

**Feature Branch**: `feat/307-os-auto-updates` · **Issue**: #307 · **Status**: Implemented (2.63.0)

## User Scenarios & Testing

### User Story 1 — The server patches itself (P1)
The owner never has to press **Install OS updates** or **Restart server**: on an installer server the OS updates
install by themselves at night, and the server restarts when an update needs it.

**Acceptance**
1. A fresh or updated server has automatic OS updates on, without any setting.
2. When updates wait, they install once a night, from 30 minutes after the app's update time (owner's clock) and within
   three hours; Activity says *Install OS updates requested by automatic OS updates*.
3. When an update needs a restart, the server restarts in the same window, once a night.
4. Nothing runs outside the window, while an app update or another maintenance action runs, or when nothing waits.

### User Story 2 — The owner can switch it off (P2)
**Server → OS updates & maintenance → Install OS updates automatically** shows the night window and switches it off
(and on); the admin MCP has `set_os_auto_updates` (switching on needs a confirmation) and `get_maintenance_status → auto`.

### Edge Cases
- An app update time late in the evening: the window crosses midnight and still counts as one night.
- A restart left from a manual install: done at night by the same rule.
- Docker and servers without the maintenance helper: nothing happens and no switch is shown.
- An install that fails: tried again the next night (the helper finishes a cut-off run first).

## Requirements
- **FR-001**: Update settings carry `os: 'auto' | 'off'`, default `auto`; other values are refused (400, field `os`).
- **FR-002**: The round rides the existing update scheduler (every 10 minutes, installer servers only): no new timer.
- **FR-003**: At most one install request and one restart request per night, through the existing helper actions
  (`os-update`, `reboot`), never while `updateRunning()` or a helper action runs.
- **FR-004**: The panel's OS updates card shows the switch and the window; the admin MCP covers it.

## Success Criteria
- **SC-001**: With automatic updates on, a server with waiting updates has them installed within one night, and a
  pending restart is done the same night, with no owner action.
- **SC-002**: No more than one automatic restart per night.
