# Feature Specification: Server Page and Activity Logging Controls

**Feature Branch**: `011-server-and-logging` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "Add an infra metrics page — we won't normally use SSH, everything on the web panel — and basic operations
like updating OS packages." / "A config for what gets logged in activity, global and chat level, to not bloat, with
different levels and categories."

## User Scenarios & Testing

### US1 – See the server's health (P1)
A Server tab shows CPU, memory, disk, swap, network and uptime as tiles with meters and 6-hour sparklines, system
info, service states (app, Caddy, cloudflared) and recent logs of each service. Refreshes every 10 s without flicker.

### US2 – Keep the OS up to date without SSH (P1)
The panel shows how many OS package updates are pending (and how many are security updates) and whether a restart is
required. The owner can install OS updates, remove unused packages, restart the web server/tunnel or restart the
server. Progress and output are shown; only one action runs at a time.

### US3 – Control what the activity log keeps (P2)
Settings → Activity log: level (Minimal / Normal / Verbose), categories on/off, retention days and max entries. Chats
page: per-chat override (Default / Off / Minimal / Normal / Verbose). Errors, confirmations, configuration changes
and connection status are always kept.

## Requirements
- FR-001 Metrics without root (/proc, statfs, systemctl is-active, apt-get -s, journalctl with journal group).
- FR-002 Maintenance through a root helper (`deploy/ops/duniya-ops`) started by a systemd path unit when the app
  writes an action word; fixed allowlist; output in a root-owned directory; one at a time; owner only.
- FR-003 Logs only for our units; admin+.
- FR-004 Logging policy enforced in `activity()`; retention by days and count.
- FR-005 Installs predating 1.3.0 need the installer run once for maintenance/logs; the panel says so.
