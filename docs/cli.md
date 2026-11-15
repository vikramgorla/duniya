# Command line (`duniya`)

For recovery and maintenance when the panel is not enough (a forgotten password, a too-strict allow-list).

On an installer server, `sudo duniya <command>` (Docker: `docker compose exec app duniya <command>`). Safe while the
service runs.

| Command | What it does |
|---|---|
| `reset-password <user> [--password PW]` | new password (asks, or makes one up and prints it); signs the account out everywhere |
| `create-user <name> --role admin\|viewer\|owner`, `list-users`, `set-role`, `remove-user` | manage panel accounts |
| `enable-password-login` | switch passwords back on if "Only allow Sign in with Google" locked you out |
| `show-setup-code` | the one-time code that creates the first owner |
| `status` | version, uptime, WhatsApp numbers, agents, last backup |
| `doctor` | checks DNS, HTTPS, ports, disk, memory, swap and prints fixes |
| `backup-now`, `restart`, `logs [-f]`, `update [--check]` | maintenance |
| `open-access` | remove the IP allow-list if it locked you out of the panel |

---
[Docs index](README.md)
