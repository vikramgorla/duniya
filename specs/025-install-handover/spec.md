# Feature Specification: Install Progress Hand-over Fixes

**Feature Branch**: `025-install-handover` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "I reinstalled the stack; the progress screen said installing system packages, then lost connection —
both the progress and final URLs were not working." Diagnosis on the live server: the install had finished and the
panel worked at https://<ip>.sslip.io, but the progress address http://<ip>/ was redirected by Caddy to
https://<ip>/, which can have no certificate → browser error. Also, Ubuntu 24.04's needrestart can stop the
progress page (a transient unit) while packages install.

## Requirements
- FR-001 Caddy forwards http://<server-ip>/ to https://<panel-host>/ (ip and domain exposure).
- FR-002 The progress page and its renderer run as runtime systemd units with Restart=always.
- FR-003 needrestart is set to list-only during bootstrap and install (no service restarts mid-install).

## Follow-up (same day)
**Input**: "Better to have auto handover to the final page and show what's happening in between, including gracefully
handling restarts and web server switches, while you keep showing a page that works offline."
- FR-004 The progress page is static and never reloads: it polls `status.json` (written every 2 s by a renderer) and
  shows steps + log.
- FR-005 When the temporary server disappears (web server switch, restart), the page stays, explains what is
  happening ("Switching to the secure web server", "taking longer… may be restarting"), and probes the final
  https address; as soon as it answers, it shows "Ready" and opens the panel.
- FR-006 Verified in a browser: progress → server gone → final up → navigated in 3 s.
