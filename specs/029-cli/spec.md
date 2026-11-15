# Feature Specification: `duniya` command line tool

**Feature Branch**: `feat/i4-infra-signin` | **Created**: 2026-11-15 | **Status**: Implemented | **Issue**: #5

**Input**: "Command line tool: reset admin password and more. `duniya` command on the server (run with sudo):
reset-password, create-user, list-users, enable-password-login, show-setup-code, status, backup, restart, logs.
Installed by install.sh and in Docker; documented; tests."

## User Scenarios & Testing

### Story 1 — Locked out (P1)
The owner forgot the password. Over SSH: `sudo duniya reset-password admin` asks for a new one (or makes one up and
prints it). All sessions of that account end. Docker: `docker compose exec app duniya reset-password admin`.

### Story 2 — Accounts without the panel (P2)
`create-user anu --role viewer` (prints a generated password unless `--password`), `list-users`, `set-role anu admin`,
`remove-user anu --yes`. The last owner cannot be removed or demoted.

### Story 3 — Is it working? (P1)
`status` prints version (and a pending version on disk), uptime, WhatsApp numbers with state, bots, sign-in mode and
last backup. `doctor` checks service, local panel, DNS vs. public IP (or Cloudflare), HTTPS, ports 80/443, disk,
memory, swap, helper, owner account and Node version, and prints a fix under each problem.

### Story 4 — Maintenance (P2)
`backup-now`, `restart`, `logs [-f]`, `update [--check]`, `show-setup-code`, `enable-password-login` (028),
`open-access` (031).

### Edge cases
- Runs while the service runs: SQLite WAL with `busy_timeout`; the CLI never applies a staged restore.
- Non-interactive use: `reset-password` without a terminal generates a password; `remove-user` needs `--yes`.
- Docker: `restart` signals PID 1 (the container restarts it); `logs`/`update` explain the docker commands.
- Run without sudo on a server: the wrapper re-runs itself with sudo.

## Requirements
- **FR-001** `bin/duniya.js` (Node, no new dependency) with the commands above, friendly help, exit codes 0/1/2
  (ok / failed / usage).
- **FR-002** `deploy/duniya` installed by install.sh to `/usr/local/bin/duniya`: needs root (re-execs with sudo),
  loads `/etc/duniya/app.env`, runs node as the `duniya` user (runuser, fallback sudo -u) with only that environment;
  `restart`, `logs`, and finishing `update` (service restart) are done by the wrapper.
- **FR-003** Docker image has `/usr/local/bin/duniya`.
- **FR-004** The running app writes `DATA_DIR/runtime.json` every 30 s (pid, start, version, RSS, numbers) for `status`.
- **FR-005** Account changes and password resets are logged in the activity log ("from the server command line").
- **FR-006** Tests run the real CLI as a child process against the harness's DATA_DIR while the app has it open, and
  against a fresh temp DATA_DIR.

## Success Criteria
- Every listed command works on an installer server and in Docker; tests in `test/cli-signin.test.js` pass.
