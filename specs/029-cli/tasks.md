# Tasks: `duniya` command line tool

- [X] T001 bin/duniya.js: parser, help, exit codes, aliases
- [X] T002 Accounts: list-users, create-user, reset-password (prompt / --password / generated), set-role, remove-user
- [X] T003 enable-password-login, show-setup-code
- [X] T004 status (runtime heartbeat src/core/runtime.js, wired in src/index.js)
- [X] T005 doctor (service, panel, DNS, HTTPS, ports, disk, memory, swap, helper, owner, Node)
- [X] T006 backup-now, restart, logs, update [--check], open-access
- [X] T007 busy_timeout; no staged restore from the CLI
- [X] T008 deploy/duniya wrapper (shellcheck -S warning clean); install.sh installs it; installer summary mentions it
- [X] T009 Dockerfile: bin/ + /usr/local/bin/duniya; docs/deploy/docker.md; README "Command line"
- [X] T010 Tests in test/cli-signin.test.js (live DB + fresh DATA_DIR)
- [ ] T011 Try the wrapper on a live server (runuser, sudo re-exec, update → restart)
