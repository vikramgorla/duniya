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
- [ ] `npm test`, `npm run lint`, `npm run typecheck` and `npm run check:panel` pass.
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
- [ ] Background work rides on the existing scheduler tick (`src/core/upkeep.js`) or on events, bounded per tick and
      skipped while memory is tight; no new timers or intervals per feature, chat or number.
- [ ] Nothing waits on the outside for good: every wait on a channel, model, tool service or the web has a deadline
      (`within()` in `src/core/config.js`, `AbortSignal.timeout` for `fetch`); screens and lists never ask a channel for
      extras (names, previews): they read what is stored, and upkeep fills the gaps; only real chat ids reach a channel.
- [ ] New queries pass `npm run check:perf` (also in `ci-checks.mjs`): no full scans of large tables on hot paths, time
      budgets in `scripts/check-perf.mjs` met; a new hot path is added to its workload; a budget is raised (or a scan
      allowed) only with a reason; index sizes stated in the PR.

**No chores for the owner**
- [ ] Anything the server can do or retry itself happens automatically (refresh, reload, sync, retry, re-check);
      buttons are optional extras, never required steps; if something needs the owner, the panel says exactly why.

**Lean code** (see `docs/development.md#lean-code`)
- [ ] Delete before you add: search for what the change replaces (functions, settings, wording, tests) and remove it.
- [ ] No compatibility layers or one-time migrations kept after the release that needed them; schema lives in
      `CREATE TABLE` and a fresh install works.
- [ ] One way to do each thing: reuse the resolvers (models, names), the scheduler tick, the small-server switch and
      the shared helpers in `src/core/config.js` instead of a local copy.
- [ ] `node scripts/ci-checks.mjs` passes: knip (no unused files, exports or dependencies), jscpd (no duplication over
      its threshold), the panel budgets in `scripts/check-panel.mjs` (first screen and total; raise one only with a
      reason in the PR), `tsc` over the `// @ts-check` files.
- [ ] Tests check behaviour (panel API, router, fakes), not internals; nothing is exported only for a test.
- [ ] **Clean code** (see [Clean code](#clean-code)): small functions with one job, early returns over nesting, names
      that say what a thing is, no magic numbers (a named constant with its unit), generic over special-cased (nothing
      keyed on a tool, service or channel name), comments say *why*. `npm run check:clean` passes: no new break of the
      size, branch, nesting, parameter and file-length rules; `scripts/clean-baseline.json` only ever goes down.
- [ ] UI changes keep the panel snappy: no new polling (status and activity come over `/api/events`), screens load
      through `api()` and its cache, simple switches update at once.

**Documentation** (the part most often forgotten)
- [ ] `docs/` topic pages updated (and `docs/README.md` index if a page was added).
- [ ] `README.md` highlights updated when a user-visible feature was added or changed.
- [ ] Website `docs/site/index.html` updated for new features, and **screenshots/videos retaken** when the UI
      changed: `npm run site:shots` (demo panel + headless Chrome; fake numbers only, WebP, H.264 `-preset veryfast`),
      checked at 375 / 393 / 1440 px and in dark mode, no external requests.
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
- [ ] `releases.json` has an entry for **every** new version: `"breaking": false`, a one-line `title` and `changes`:
      short, plain, owner-facing bullets `{ "type": "new" | "improved" | "fixed" | "removed", "text": "…" }` (no issue
      numbers, no internal names; the panel shows them before and after an update, GitHub Releases list them). Add a
      `summary` when owners should know more. CI fails when the entry or its `changes` is missing.
      **Breaking change → major version + a `releases.json` entry with `"breaking": true`, title, summary and
      `actions` (what the owner must do), `data` and `docs`; consider a migration instead.** CI fails on a major bump
      without it. Breaking releases are never installed automatically: owners confirm them (panel or WhatsApp).
- [ ] PR opened via REST with `Closes #N` and the spec link. No attribution trailers or footers in commits and PRs (no
      Co-Authored-By, session links or 'Generated with' lines).
- [ ] Never pushed to `main`; squash-merged after all required checks passed, with an explicit title and message
      (`commit_title`, `commit_message`), so no co-author trailers from branch commits are appended.
- [ ] Issue closed with the release version in the done comment.

## Clean code

Every change, by anyone or any agent, leaves the code at least as clean as it found it. These are rules, not tips:
CI enforces the measurable ones (`npm run check:clean`, also in `node scripts/ci-checks.mjs`), reviews the rest.

1. **One job per function, one topic per file.** At most 120 lines per function and 800 per file, at most 20
   branches (complexity), 4 levels of nesting, 5 parameters (more: one options object), 4 nested callbacks. Split
   by meaning (find → decide → act), not by line count.
2. **Return early.** Guard clauses first; the main path stays at the left margin.
3. **Names carry meaning.** A function says what it returns or does (`findMedia`, `postMedia`, not `handle`); a
   boolean reads as a question (`fitsCaption`); no abbreviations a newcomer can't read.
4. **No magic values.** A number or string that means something is a named constant with its unit
   (`CAPTION_MAX = 500`, `FAIL_TTL = 60 * 1000`).
5. **Generic, never special-cased.** Behaviour comes from what a tool, service or channel declares (MCP annotations,
   output schemas, channel capabilities), never from its name. If you are about to write `if (name === 'gifs')`,
   design the general rule instead.
6. **One way to do each thing** (Lean code above): reuse the shared helpers; delete what you replace in the same PR.
7. **Comments say why**, not what; a module starts with a short paragraph on what it is for.
8. **Errors are explicit.** Throw with a plain message (and a status for the panel); never swallow an error silently
   unless the comment says why it is safe; anything the owner sees is in plain words.
9. **The ratchet only goes down.** Code that broke the rules before the gate is listed in `scripts/clean-baseline.json`;
   a new break fails CI, a file you made cleaner must lower its entry (`npm run clean:baseline`). Raising an entry
   needs a reason in the PR. When you touch a listed function, prefer to split it.

## Workflow

- **GitHub through REST.** GraphQL is blocked in some harnesses: use `gh api` (REST) for issues, labels, comments
  and PRs, e.g. `gh api repos/{owner}/{repo}/issues -f title=… -f body=…`, `gh api -X POST repos/{o}/{r}/pulls -f
  head=… -f base=main -f title=… -f body=…`, merge with `gh api -X PUT repos/{o}/{r}/pulls/N/merge -f
  merge_method=squash -f commit_title=… -f commit_message=…` (explicit message, no trailers).
- **Branches:** `<type>/<issue>-<slug>`, e.g. `feat/10-silent-by-default`, `docs/54-refresh-dod`. Never push to `main`
  (the ruleset blocks it; don't try to work around it).
- **Labels** (exact names, with a space after the colon — GitHub creates a new label if you mistype one):
  `type: bug|feature|improvement|security|docs|chore|dependencies|epic` · `area: whatsapp|agents|panel|mobile|models|
  tools-mcp|memory|security|infra|install|backups|cli|docs|build` · `priority: high|medium|low` · `status: triage|in
  progress|blocked|needs info` · `spec: NNN`. Check with `gh api repos/{o}/{r}/labels` before creating issues.
- **Security alerts:** the `Security alerts (automatic)` issue mirrors open code-scanning alerts on `main` (workflow
  `security-alerts.yml`), so agents without access to the Security tab still see them. Fix real findings in code (CodeQL closes them as fixed on the next scan). A reviewed false positive is dismissed by
  adding an entry (rule id, path, reason `false positive` | `won't fix` | `used in tests`, comment) to
  `.github/security/dismissals.json` in a PR; the workflow dismisses it after merge. Check the issue (and Dependabot alerts:
  `gh api repos/{o}/{r}/dependabot/alerts?state=open`) at the start of every work session and fix high ones first.
- **Spec Kit:** `/speckit-specify` → `/speckit-clarify` (if ambiguous) → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-analyze` → `/speckit-implement` → `/speckit-converge`. The templates in `.specify/templates/` end every
  task list with the Definition-of-Done tasks above; keep them.
- **No backward-compatibility layers** for old data unless an issue asks for it: deployments are single-owner and
  reinstall freely (see `docs/upgrading.md`). A migration a release needs is removed in the next release.
- **Ruleset file mirrors the live ruleset:** `.github/rulesets/main-protection.json` must match GitHub → Settings →
  Rules. When one changes, change the other in the same week.
- **Repository slug:** never hard-code the GitHub owner/name. It lives only in `package.json` `repository`; code
  reads `REPO` from `src/core/config.js` (`src/core/repo.js` derives every URL), docs and infra are rewritten with
  `npm run repo:sync`, and `ci-checks.mjs` fails on a project URL with another slug. After a fork or rename, the
  *Fork setup* workflow opens the set-up PR only if Actions may create pull requests (Settings → Actions → General);
  otherwise look for the branch `repo-sync/<owner>-<name>` and open the PR from it via REST
  (`gh api -X POST repos/{o}/{r}/pulls -f head=repo-sync/<owner>-<name> -f base=main …`).
- **Dependencies:** runtime deps are limited (Baileys, Anthropic SDK, MCP SDK, pino, qrcode); a new one needs a stated
  reason in the plan. Other providers use `fetch`.
- **Commits:** clear messages. No attribution trailers or footers in commits and PRs (no Co-Authored-By, session links
  or 'Generated with' lines). Commits are authored by the repository owner's identity; no AI co-author trailers or
  signatures; squash merges use an explicit message: `gh api -X PUT repos/{o}/{r}/pulls/N/merge -f merge_method=squash
  -f commit_title="<PR title> (#N)" -f commit_message="<short summary>"`.

## Architecture map

| Path | What lives there |
|---|---|
| `src/index.js` | Startup: data dir, the channel hub, router, panel, scheduler |
| `src/channels/` | `index.js` (the catalogue: channel ids, `isGroup`/`phoneOf`/`chatKey` helpers, capabilities; no adapter code), `hub.js` (loads an adapter with `import()` only when its channel is set up and on, routes every chat action by chat id, status, upkeep, memory per channel), `whatsapp/` (adapter #1: `index.js` several numbers, `session.js` one Baileys linked device, `ids.js` JIDs). See `docs/development.md#adding-a-channel` |
| `src/core/router.js` | Message routing: allow-list, triggers, roles, rate limits, silence reasons, owner assistant hand-off |
| `src/core/runner.js`, `tools.js`, `chat-tools.js`, `mcp*.js` | Agent turns, tool allow lists, chat actions by channel capability, confirm gate, MCP clients (remote, OAuth, local) |
| `src/core/agents.js`, `schema.js`, `ai-builder.js` | Agents as data, validation, the AI helper |
| `src/core/quick.js`, `welcome.js` | Built-in answers without AI: quick replies, `!help`, FAQ matching; welcome for new group members |
| `src/core/providers/` | Anthropic, ChatGPT sign-in, Copilot, OpenAI-compatible; `breaker.js` + `fallback-config.js` (fallback, accounts) |
| `src/core/media*.js`, `speech-*.js`, `resources.js` | Photos & voice, media queue, on-server speech, small-server guardrails |
| `src/core/memory.js`, `contacts.js`, `people.js`, `chat-prefs.js` | Chat and shared memory, contacts, people across channels (identities joined by phone), per-chat settings (on/off, private) |
| `src/core/owner-assistant.js`, `privacy-notice.js`, `owner-alerts.js`, `weekly.js`, `budget.js`, `silences.js` | Owner assistant, privacy notice, alerts, weekly summary, spending caps, why-quiet |
| `src/core/backup/`, `updates.js`, `system.js`, `webaccess.js` | Backups (GitHub, S3), updates, server metrics, domains & access |
| `src/core/store.js`, `db.js` | Settings, users, secrets; SQLite (`node:sqlite`) |
| `src/panel/server.js`, `http.js`, `routes/` | Panel HTTP API: `server.js` is the router (role gates, CSRF guard) and registers `routes/<area>.js` (`auth`, `status`, `agents`, `chats`, `contacts`, `system`, one per feature) |
| `src/panel/assets.js`, `module-graph.js` | The panel's static files from memory: content-hash URLs, import map (its hash in the CSP), first-screen preload |
| `src/panel/public/` | The panel UI: `index.html` (shell), `app/*.js` native ES modules (`core.js`, `main.js`, one per screen, loaded on first visit; see `docs/development.md#panel-modules`), `app/styles.css`; `manifest.webmanifest` and `icons/` make it installable on phones |
| `src/panel/admin-mcp.js`, `admin-tools.js`, `src/core/admin-oauth.js` | Admin MCP server and its OAuth 2.1 |
| `bin/duniya.js`, `deploy/duniya` | `duniya` CLI |
| `install.sh`, `deploy/`, `infra/oci/`, `infra/gcp/`, `Dockerfile` | Installer, root maintenance helper (`deploy/ops/`), OCI stack, GCP script, Docker |
| `templates/` | Agent templates (JSON) |
| `test/` | `node:test` e2e tests with fakes (`harness.js`) |
| `scripts/` | `check-clean.mjs` + `clean-baseline.json` (`npm run check:clean`: the clean-code ratchet), `demo-panel.mjs`, `check-responsive.mjs`, `site-shots.mjs`, `cdp.mjs`, `measure-load.mjs` (`npm run measure:load`), `check-panel.mjs` (modules link, budgets), `check-perf.mjs` + `scale-fixture.mjs` (query plans and time budgets on 200k messages / 5k people), `ci-checks.mjs` (versions, releases, docs, knip, jscpd, panel budgets, types, check-perf, repository slug), `repo-sync.mjs` (`npm run repo:sync`: project URLs from `package.json` `repository`), `check-doc-links.mjs` (broken doc links fail CI), `doc-thumbs.mjs` (docs/img thumbnails), `render-diagrams.mjs` (`npm run docs:diagrams`: docs/diagrams/*.mmd → SVG) |
| `docs/` | Reference docs (`docs/README.md` index), deploy guides, diagrams (`docs/diagrams/`), the website `docs/site/` |
| `specs/`, `.specify/` | Spec Kit: one folder per feature; constitution and templates |

## Demo panel, responsive check, screenshots

```bash
node scripts/demo-panel.mjs            # http://127.0.0.1:8099, admin / demo-password-123; seeded data, no network
DEMO_SMALL=1 node scripts/demo-panel.mjs   # pretend to be a 1 GB / 1 CPU server
DEMO_EMPTY=1 node scripts/demo-panel.mjs   # a fresh install: the true first run (Getting started from step 1)
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

