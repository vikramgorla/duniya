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
