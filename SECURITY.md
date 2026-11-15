# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub → Security → "Report a vulnerability" on this repository
(private vulnerability reporting), not in public issues. You will get an answer within a few days. Fixes ship as a
patch release.

## Supported versions

The latest 2.x release. Self-hosted servers update from the panel (**Overview → Server → Updates**), with
`sudo duniya update`, or by running the installer again; Docker: `docker compose pull && docker compose up -d`.
1.x is no longer supported (see [docs/upgrading.md](docs/upgrading.md)).

## Security model in short

- The app binds to localhost; the panel is served over HTTPS only (Caddy with automatic certificates, Cloudflare
  Tunnel or Tailscale), and a proxy in front must connect encrypted.
- Panel sign-in with Google (optionally Google-only) or salted scrypt passwords; HttpOnly SameSite=Strict sessions,
  login rate limiting, a restrictive Content-Security-Policy, optional IP allow-list.
- Secrets are stored encrypted in the data directory (mode 0600) and never returned by any API; backups are encrypted
  with the owner's passphrase before they leave the server.
- Chats are off by default; off chats are never stored or sent to a model. Tool permissions are enforced in code per
  role, and changes go through a human `confirm CODE` step the model never sees.
- Local tool services (npm/GitHub) are owner-only and run with a scrubbed environment.
- The admin MCP server and the mobile app use OAuth 2.1 with PKCE and resource-bound tokens.
- CI runs CodeQL, `npm audit` (production, high+), Dependabot and secret scanning with push protection.
