# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub → Security → "Report a vulnerability" on this repository
(private vulnerability reporting), not in public issues. You will get an answer within a few days. Fixes ship as a
patch release.

## Supported versions

The latest 2.x release. Self-hosted servers update from the panel (**Overview → Server → Updates**), with
`sudo duniya update`, or by running the installer again; Docker: `docker compose pull && docker compose up -d`.
See [docs/upgrading.md](docs/upgrading.md).

## Security model in short

- The app binds to localhost; the panel is served over HTTPS only (Caddy with automatic certificates, Cloudflare
  Tunnel or Tailscale), and a proxy in front must connect encrypted.
- Panel sign-in with Google (optionally Google-only) or salted scrypt passwords; HttpOnly SameSite=Strict sessions,
  login rate limiting, a restrictive Content-Security-Policy, optional IP allow-list.
- Secrets are stored encrypted in the data directory (mode 0600) and never returned by any API; backups are encrypted
  with the owner's passphrase before they leave the server.
- Secrets never pass through WhatsApp, the owner assistant or AI assistants: keys are entered on one-time panel links
  (256-bit token in the URL fragment, only its hash stored, single use, 15 minutes, panel sign-in as owner or admin);
  new users set their own password on a one-time sign-up link (48 hours, rate limited); restores from chat use the
  stored passphrase. Messages that look like keys are not stored or sent to a model.
- Chats are off by default; off chats are never stored or sent to a model. Tool permissions are enforced in code per
  role. Changes follow the agent's *How sure before changing things* (or a service's own setting): a risk from each
  tool's annotations; only changes an organizer clearly asked for happen at once (logged in Activity); tools that
  declare themselves destructive (deletes, money, sends, other people's registrations) wait for a human yes or
  `confirm CODE`, decided in code, never by the prompt. Per-service limits are enforced in code. Media shared on its
  own sends only mood and style words to the service, never names or message text.
- Local tool services (npm/GitHub) are owner-only and run with a scrubbed environment.
- The admin MCP server uses OAuth 2.1 with PKCE and resource-bound tokens; its tokens only open `/mcp`. The panel API
  accepts only the panel's session cookie (HttpOnly, SameSite=Strict).
- CI runs CodeQL, `npm audit` (production, high+), Dependabot and secret scanning with push protection.

## Secrets from the environment

Two optional settings can come from the environment (`/etc/duniya/app.env` on installer servers, `.env` with Docker).
Neither is needed: the normal path is the one-time setup code and panel links.

| Variable | What it is for | Without it |
|---|---|---|
| `ADMIN_PASSWORD` | Creates the first owner, `admin`, with this password when no owner exists yet (`--admin-password` in the installer). Afterwards it changes nothing; passwords are changed in the panel or with `duniya reset-password`. | The installer prints a one-time setup code; the owner chooses a password in the panel. |
| `MASTER_KEY` | The 32-byte key (base64) that encrypts stored secrets, instead of the generated `master.key` in the data directory (mode 0600). For setups that keep keys outside the data directory. Encrypted backups include it (so a restore works on a new server); keep a copy anyway: without it, stored secrets cannot be read. | A key is generated once in the data directory (and included in encrypted backups). |

Both are read once at start, never written to the activity log or the service log, never sent to a model or an AI
assistant, and never returned by any API (a test sweeps every read-only panel route with both set:
`test/env-secrets.test.js`). Nothing reads `ADMIN_PASSWORD` again once the owner exists: the installer removes it
from `app.env` as soon as the service has started (also a password left there by an earlier version, at the next
run); with Docker, take it out of your `.env` after the first start.
