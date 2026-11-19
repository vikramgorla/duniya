# Command line (`duniya`)

**Recovery and maintenance when the panel is not enough: a forgotten password, a too-strict allow-list.**

```bash
sudo duniya help                      # installer servers
docker compose exec app duniya help   # Docker
```

**In 30 seconds**
- Safe while the service runs.
- Locked out? `reset-password`, `open-access` or `enable-password-login`.
- Health: `status` and `doctor` (prints fixes).

| Command | What it does |
|---|---|
| `reset-password <user> [--password PW]` | new password (asks, or makes one up and prints it); signs the account out everywhere |
| `create-user <name> --role admin\|viewer\|owner`, `list-users`, `set-role`, `remove-user` | manage panel accounts |
| `enable-password-login` | passwords back on if "Only allow Sign in with Google" locked you out |
| `show-setup-code` | the one-time code that creates the first owner |
| `status` | version, uptime, WhatsApp numbers, agents, last backup |
| `doctor` | checks DNS, HTTPS, ports, disk, memory, swap and prints fixes |
| `backup-now`, `restart`, `logs [-f]` | maintenance |
| `update [--check] [--breaking]` | newest release that needs no decision, backup first; `--breaking` also crosses a breaking release; also refreshes the root maintenance helper (OS updates) |
| `source [owner/name]` | where updates come from; with a GitHub repository (e.g. your fork) switches the app and the maintenance helper to it ([Update source](upgrading.md#update-source)) |
| `open-access` | removes the IP allow-list if it locked you out |

---
**Next:** [Install → Find things fast](install.md#find-things-fast) · [Docs index](README.md)
