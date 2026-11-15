# Working on this repository (for Claude and other agents)

- Read `.specify/memory/constitution.md` and `DESIGN.md` before changing anything.
- **Track all work as GitHub issues** (REST API; GraphQL is unavailable): create/label the issue first, comment when
  starting (plan), at milestones and when done (what shipped, version, open items); close with the release.
- **Labels:** one `type:` (bug, feature, improvement, security, docs, chore, dependencies), one or more `area:`
  (whatsapp, agents, panel, mobile, models, tools-mcp, memory, security, infra, install, backups, cli, docs, build),
  `priority:` (high, medium, low), `status:` (triage, in progress, blocked, needs info), and `spec: NNN` when a spec
  exists.
- **Never push to `main`.** Branch `<type>/<issue>-<slug>`, open a PR (REST `POST /repos/{o}/{r}/pulls`), wait for
  all required checks, then merge (squash) via REST. The PR body links the issue and the spec.
- Tests use fakes (`test/harness.js`); `npm test` and `npm run lint` must pass. No backward-compatibility layers for
  old data unless an issue asks for it (single-owner deployments reinstall freely).
