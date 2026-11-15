# Specification Quality Checklist: 029 CLI

**Created**: 2026-11-15 · **Feature**: [spec.md](../spec.md)

- [x] All commands from the issue (plus set-role, remove-user, doctor, update, open-access) specified
- [x] Concurrency with the running service considered (WAL, busy_timeout, no restore)
- [x] File ownership considered (node as the app user)
- [x] Docker path specified
- [x] Tests cover the core commands against a temp DATA_DIR
- [ ] Wrapper exercised on a live server
