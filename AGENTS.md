# AGENTS.md: working on Duniya

This is the **single source of truth** for how anyone works on this repository: people, Claude Code, Codex, Cursor,
GitHub Copilot, Gemini or any other agent in any harness. `CLAUDE.md`, `.github/copilot-instructions.md`,
`CONTRIBUTING.md`, the Spec Kit constitution and the PR template all point here. If they ever disagree, this file wins;
fix the other file in the same PR.

Read first: `.specify/memory/constitution.md` (principles) and `DESIGN.md` (UI). Product reference: `docs/README.md`.

## Definition of Done

A change is ready to merge only when **every** applicable item holds. Copy this list into the PR (the PR template
already has it) and tick it honestly; write "n/a" with a reason when an item does not apply.

**Tracking**
- [ ] A GitHub issue exists with labels: one `type:`, one or more `area:`, `priority:`, `status:`, and `spec: NNN` when
      a spec exists.
- [ ] The issue has a **plan** comment when work starts, **progress** comments at milestones, and a **done** comment
      (what shipped, version, open items).

**Spec & tests**
- [ ] Features and behaviour changes have a Spec Kit folder `specs/NNN-name/` (`spec.md`, `plan.md`, `tasks.md`)
      that matches the code (`/speckit-analyze`, `/speckit-converge`).
- [ ] Behaviour is covered by tests that use fakes (`test/harness.js`): no real WhatsApp, model, MCP, GitHub or S3
      calls.
- [ ] `npm test`, `npm run lint` and `npm run check:panel` pass.
- [ ] UI changed → `npm run check:responsive` passes (375 / 393 / 1440 px, light and dark) and the screens meet the
      `DESIGN.md` checklist.

**Security & privacy**
- [ ] No secrets in code, logs, fixtures or screenshots; secret values are never returned by an API.
- [ ] TLS verification is never disabled; no shell commands built from untrusted input (use `execFile` with argument
      arrays); text from WhatsApp, tools or models is rendered as text, never HTML.
- [ ] CodeQL is clean at high / error level (medium findings get a follow-up issue).
- [ ] The chat allow-list is respected: chats that are off are never stored or sent to a model.
- [ ] No message contents in logs unless the logging policy allows it; summaries and silence reasons keep counts only.
- [ ] Privacy notice behaviour still holds (posted once when a group is switched on; per-group opt-out; DM line once).
- [ ] Permissions are decided in code (role allow lists, confirm gate), never by prompt alone.

**Small servers**
- [ ] Impact on a 1 GB / 1 vCPU VM considered: memory (< 400 MB RSS normally), no native build toolchains, heavy work
      goes through the media queue / `runJob` with timeouts, large downloads are refused on small servers.

**Documentation** (the part most often forgotten)
- [ ] `docs/` topic pages updated (and `docs/README.md` index if a page was added).
- [ ] `README.md` highlights updated when a user-visible feature was added or changed.
- [ ] Website `docs/site/index.html` updated for new features, and **screenshots/videos retaken** when the UI
      changed: `npm run site:shots` (demo panel + headless Chrome; fake numbers only, WebP, H.264 `-preset veryfast`),
      checked at 375 / 393 / 1440 px and in dark mode, no external requests.
- [ ] `mobile/README.md` updated when the mobile app or its connect flow changed.
- [ ] Admin MCP tools (`src/panel/admin-tools.js`) cover new panel functionality, with confirmations for risky
      actions, and `docs/admin-mcp.md` mentions them.
- [ ] `DESIGN.md` updated when the visual language changed.
- [ ] No outdated wording left behind (search for the old name/behaviour across `docs/`, `README.md`, `docs/site/`).
- [ ] Doc pages keep the page template (promise, primary action, *In 30 seconds*, steps, callouts, **Next:**) and
      `node scripts/check-doc-links.mjs` passes (relative links and anchors; also part of `ci-checks.mjs`).
- [ ] Diagrams are images, never ` ```mermaid ` blocks: source in `docs/diagrams/<name>.mmd`, SVG re-rendered with
      `npm run docs:diagrams` and checked visually, embedded with a meaningful `alt` and a *Diagram as text*
      `<details>` (see `docs/development.md#diagrams`; `ci-checks.mjs` fails on stale SVGs and on Mermaid blocks).

**Version & release**
- [ ] Version bumped in `package.json`, `package-lock.json` (both `version` fields) and `infra/oci/schema.yaml`
      (`version:`), semver: **minor** for features, **patch** for fixes and docs, **major** for breaking changes.
      CI fails when `package.json` and `schema.yaml` differ.
- [ ] `releases.json` has an entry for the new version when owners should know something (CI warns when it is missing).
      **Breaking change → major version + a `releases.json` entry with `"breaking": true`, title, summary and
      `actions` (what the owner must do), `data` and `docs`; consider a migration instead.** CI fails on a major bump
      without it. Breaking releases are never installed automatically: owners confirm them (panel or WhatsApp).
- [ ] PR opened via REST with `Closes #N`, the spec link and the attribution lines your harness requires.
- [ ] Never pushed to `main`; squash-merged after all required checks passed.
- [ ] Issue closed with the release version in the done comment.

## Workflow

- **GitHub through REST.** GraphQL is blocked in some harnesses: use `gh api` (REST) for issues, labels, comments
  and PRs, e.g. `gh api repos/{owner}/{repo}/issues -f title=… -f body=…`, `gh api -X POST repos/{o}/{r}/pulls -f
  head=… -f base=main -f title=… -f body=…`, merge with `gh api -X PUT repos/{o}/{r}/pulls/N/merge -f
  merge_method=squash`.
- **Branches:** `<type>/<issue>-<slug>`, e.g. `feat/10-silent-by-default`, `docs/54-refresh-dod`. Never push to `main`
  (the ruleset blocks it; don't try to work around it).
- **Labels:** `type:` bug, feature, improvement, security, docs, chore, dependencies · `area:` whatsapp, agents,
  panel, mobile, models, tools-mcp, memory, security, infra, install, backups, cli, docs, build · `priority:` high,
  medium, low · `status:` triage, in progress, blocked, needs info · `spec: NNN`.
- **Spec Kit:** `/speckit-specify` → `/speckit-clarify` (if ambiguous) → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-analyze` → `/speckit-implement` → `/speckit-converge`. The templates in `.specify/templates/` end every
  task list with the Definition-of-Done tasks above; keep them.
- **No backward-compatibility layers** for old data unless an issue asks for it: deployments are single-owner and
  reinstall freely (see `docs/upgrading.md`).
- **Ruleset file mirrors the live ruleset:** `.github/rulesets/main-protection.json` must match GitHub → Settings →
  Rules. When one changes, change the other in the same week.
- **Dependencies:** runtime deps are limited (Baileys, Anthropic SDK, MCP SDK, pino, qrcode); a new one needs a stated
  reason in the plan. Other providers use `fetch`.
- **Commits:** clear messages; end with the attribution lines your harness requires.

## Architecture map

| Path | What lives there |
|---|---|
| `src/index.js` | Startup: data dir, WhatsApp channels, router, panel, scheduler |
| `src/channels/` | `whatsapp.js` (Baileys linked device), `registry.js` (several numbers) |
| `src/core/router.js` | Message routing: allow-list, triggers, roles, rate limits, silence reasons, owner assistant hand-off |
| `src/core/runner.js`, `tools.js`, `mcp*.js` | Agent turns, tool allow lists, confirm gate, MCP clients (remote, OAuth, local) |
| `src/core/agents.js`, `schema.js`, `ai-builder.js` | Agents as data, validation, the AI helper |
| `src/core/providers/` | Anthropic, ChatGPT sign-in, Copilot, OpenAI-compatible; `breaker.js` + `fallback-config.js` (fallback, accounts) |
| `src/core/media*.js`, `speech-*.js`, `resources.js` | Photos & voice, media queue, on-server speech, small-server guardrails |
| `src/core/memory.js`, `contacts.js`, `chat-prefs.js` | Chat and shared memory, contacts, per-chat settings (on/off, private) |
| `src/core/owner-assistant.js`, `privacy-notice.js`, `owner-alerts.js`, `weekly.js`, `budget.js`, `silences.js` | Owner assistant, privacy notice, alerts, weekly summary, spending caps, why-quiet |
| `src/core/backup/`, `updates.js`, `system.js`, `webaccess.js` | Backups (GitHub, S3), updates, server metrics, domains & access |
| `src/core/store.js`, `db.js` | Settings, users, secrets; SQLite (`node:sqlite`) |
| `src/panel/server.js`, `http.js`, `routes/` | Panel HTTP API |
| `src/panel/public/index.html` | The whole panel UI (one file; `npm run check:panel` parses its script) |
| `src/panel/admin-mcp.js`, `admin-tools.js`, `src/core/admin-oauth.js` | Admin MCP server and its OAuth 2.1 |
| `bin/duniya.js`, `deploy/duniya` | `duniya` CLI |
| `install.sh`, `deploy/`, `infra/oci/`, `infra/gcp/`, `Dockerfile` | Installer, root maintenance helper (`deploy/ops/`), OCI stack, GCP script, Docker |
| `templates/`, `plugins/` | Agent templates (JSON), optional code plugins |
| `mobile/` | Expo app (own `package.json`, not installed on servers) |
| `test/` | `node:test` e2e tests with fakes (`harness.js`) |
| `scripts/` | `demo-panel.mjs`, `check-responsive.mjs`, `site-shots.mjs`, `cdp.mjs`, `ci-checks.mjs`, `check-doc-links.mjs` (broken doc links fail CI), `doc-thumbs.mjs` (docs/img thumbnails), `render-diagrams.mjs` (`npm run docs:diagrams`: docs/diagrams/*.mmd → SVG) |
| `docs/` | Reference docs (`docs/README.md` index), deploy guides, diagrams (`docs/diagrams/`), the website `docs/site/` |
| `specs/`, `.specify/` | Spec Kit: one folder per feature; constitution and templates |

## Demo panel, responsive check, screenshots

```bash
node scripts/demo-panel.mjs            # http://127.0.0.1:8099, admin / demo-password-123; seeded data, no network
DEMO_SMALL=1 node scripts/demo-panel.mjs   # pretend to be a 1 GB / 1 CPU server
npm run check:responsive               # every screen at 375 / 393 / 1440, light + dark (needs Chrome; CHROME_PATH)
npm run site:shots                     # retake docs/site/img + docs/site/video (needs Chrome + ffmpeg)
npm run site:shots -- --only card-ask,overview --no-video
```

The demo uses fake WhatsApp numbers (`+41 79 000 00 xx`) and fake model endpoints. When you add a screen, add a state
to `scripts/check-responsive.mjs`; when you add a feature worth showing, add a shot to `scripts/site-shots.mjs` and a
tile/section to `docs/site/index.html`.

## Claude-specific and harness notes

Harness-specific files only add to this one: `CLAUDE.md` (Claude Code), `.github/copilot-instructions.md` (Copilot).
Spec Kit skills live in `.claude/skills/speckit-*` and use the templates in `.specify/templates/`.

## Spec Kit templates

Our Definition of Done is baked into `.specify/templates/{plan,tasks,checklist}-template.md`. The same files are copied
to `.specify/templates/overrides/`, which Spec Kit reads first, so a Spec Kit upgrade cannot silently drop these steps.
When you change a template, change both copies.

