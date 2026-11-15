# Development

```bash
npm install
ADMIN_PASSWORD=dev-password-123 npm start     # panel on http://127.0.0.1:8080
npm test                                      # e2e with fake WhatsApp, Claude, OpenAI, MCP, GitHub and S3
npm run lint
node scripts/demo-panel.mjs                   # seeded demo panel on :8099 (admin / demo-password-123), no network
npm run check:panel                           # the panel's inline script parses
npm run check:responsive                      # every screen at 375 / 393 / 1440 px, light + dark (needs Chrome)
npm run site:shots                            # retake the website screenshots and videos (needs Chrome + ffmpeg)
```

Built with [GitHub Spec Kit](https://github.com/github/spec-kit): the constitution is
`.specify/memory/constitution.md` and every feature has its spec, plan and tasks under [`specs/`](../specs).
New work: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` → `/speckit-converge`.
Process and Definition of Done: [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). Design language: [DESIGN.md](../DESIGN.md).

Releases: bump the version in `package.json`, `package-lock.json` and `infra/oci/schema.yaml` (CI checks they match) and merge to `main` (or push a `vX.Y.Z` tag, or run the workflow by hand).
The release workflow creates the tag and GitHub release, attaches the OCI stack zip and publishes the Docker image to
`ghcr.io/vikramgorla/whatsapp-agent-duniya`.

The project site lives in [`docs/site/`](site/) (plain HTML/CSS, no build step) and is deployed to GitHub Pages by
`.github/workflows/pages.yml` on every push to `main` that touches it.

---
[Docs index](README.md)
