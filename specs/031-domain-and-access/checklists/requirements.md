# Specification Quality Checklist: 031 Domain and access

**Created**: 2026-11-15 · **Feature**: [spec.md](../spec.md)

- [x] Stories with acceptance scenarios; rollback and lock-out recovery specified
- [x] Root boundary: validated JSON only, root-owned validator, no app code executed as root
- [x] Caddy version differences researched and handled
- [x] Unsupported setups (tunnel, local, Docker, old helper) explained in the UI
- [x] Tests for validation, config generation, helper flow and API
- [ ] Verified on a live server with a real domain and Cloudflare
