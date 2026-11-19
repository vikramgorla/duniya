# Contributing

Thanks for helping. Duniya is [MIT licensed](LICENSE); contributions are accepted under the same license. The full
working rules and the **Definition of Done** are in [AGENTS.md](AGENTS.md) (they apply to people and AI agents
alike). This page is the short version, plus how to run your own fork.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting help

- **Stuck installing or using it?** Read [Troubleshooting](docs/troubleshooting.md) (the ten most common first-day
  problems), then open an issue with the **Question or help** template. Remove keys, setup codes and phone numbers
  first.
- **Found a bug?** The **Bug** template; **an idea?** The **Feature / improvement** template.
- **A security problem?** Privately, never in an issue: [SECURITY.md](SECURITY.md).

## Good first issues

Issues labelled **`good first issue`** are small and fully described: what to change, where (files), and how to check
it (a test or a screen in the demo panel). They need no server and no real WhatsApp: everything runs against the demo
panel (`node scripts/demo-panel.mjs`) and the test fakes. Say in the issue that you are taking it, so nobody else does
it at the same time; ask there if anything is unclear. Maintainers: when you open one, add the files to touch and the
check that proves it works.

## How to contribute

1. **Start from an issue.** Open one (bug or feature template) or pick an open one. Every change has an issue with
   labels: one `type:`, one or more `area:`, a `priority:`, a `status:`, and `spec: NNN` once a spec exists (exact
   names, with a space after the colon). Plan, progress and done are posted as comments; issues close with the release
   that ships them.
2. **Branch** from `main` as `<type>/<issue>-<slug>`, e.g. `feat/10-silent-by-default` or `docs/54-refresh-dod`.
3. **Spec first for features.** Features follow Spec Kit (`.specify/`: constitution → spec → plan → tasks) in
   `specs/NNN-name/`; the task templates end with the Definition of Done.
4. **Build it with tests.** Tests use the fakes in `test/harness.js` (no real WhatsApp, model, MCP, GitHub or S3).
   Try it in the demo panel: `node scripts/demo-panel.mjs` (http://127.0.0.1:8099, admin / demo-password-123).
5. **Run the checks** (the same as CI):

   ```bash
   npm test && npm run lint && npm run typecheck && npm run check:panel
   node scripts/ci-checks.mjs          # versions, releases.json, doc links, diagrams, knip, jscpd, panel budgets, perf, repository slug
   npm run check:responsive            # UI changes: 375 / 393 / 1440 px, light and dark (needs Chrome)
   ```

6. **Docs are part of the change:** `docs/`, `README.md`, the website `docs/site/` (retake screenshots with
   `npm run site:shots` when the UI changed), the admin MCP tools, and `releases.json` with a version bump (minor for
   features, patch for fixes, major for breaking changes).
7. **Open a pull request** with `Closes #N` and the spec link; the template has the Definition of Done to tick.
   `main` is protected: squash-merged after every required check passes — test, quality (lint, panel, dependency
   audit, version consistency, lean code), scripts & infra, Docker build, CodeQL. No direct or force pushes.

**Commits and PRs:** clear messages. No attribution trailers or footers in commits and PRs (no Co-Authored-By, session
links or 'Generated with' lines). Commits are authored by the repository owner's identity; no AI co-author trailers or
signatures; squash merges use an explicit message.

**Design:** UI follows `DESIGN.md` and its checklist (light and dark, phones at 375/393 px). **Repository links:**
never hard-code the GitHub owner/name; it lives in `package.json` `repository` ([Repository and
forks](docs/development.md#repository-and-forks)).

## Forking

A fork is a full Duniya of your own: its own releases, Docker image, website and installer.

1. **Fork** on GitHub (keep the name or choose another).
2. **Enable Actions** in the fork (**Actions** tab → *I understand my workflows, go ahead and enable them*).
3. **Let Actions open pull requests** (off by default on new repositories and forks): **Settings → Actions → General →
   Workflow permissions** → tick **Allow GitHub Actions to create and approve pull requests** → Save.
4. **Run Actions → Fork setup → Run workflow** (it also runs on every push to `main`). It sees that the repository is
   now yours, runs `npm run repo:sync`, and opens a pull request *Set up this repository: you/name* that points
   `package.json`, the README buttons, the install command, the website, the OCI/GCP defaults and the compose image at
   your fork. Merge it.
   - **No pull request?** Then step 3 was skipped: the workflow still succeeds, pushes the branch
     `repo-sync/<you>-<name>` and prints a *compare* link in the run summary (**Actions → Fork setup → the run**).
     Open that link → **Create pull request** → merge. Or allow step 3 and run the workflow again.
   - **Without Actions:** `npm run repo:sync -- --repo you/name`, commit, push.
5. **Enable Pages:** **Settings → Pages → Source: GitHub Actions**, then run **Actions → Pages**. The website is at
   `https://<you>.github.io/<name>/`.
6. **Release:** bump the version and add a `releases.json` entry in a PR; merging publishes the release, `duniya.zip`
   (the OCI stack) and `ghcr.io/<you>/<name>`. Make the package public under your profile → **Packages** if Docker
   users should pull it without signing in.
7. **Install from your fork:**
   `curl -fsSL https://raw.githubusercontent.com/you/duniya/main/install.sh | sudo DUNIYA_REPO=you/duniya bash`.
   Servers update from your releases; an existing server switches under **Settings → Updates → Update source** or with
   `sudo duniya source you/duniya`.
8. **Stay in sync with upstream:** **Sync fork** on your fork's GitHub page (or `git fetch upstream && git merge
   upstream/main`). The sync keeps your slug: if a merge brings back upstream links, `node scripts/ci-checks.mjs`
   says so and `npm run repo:sync` fixes them (the Fork setup workflow does it for you on the next push).

Also worth changing in a fork: `.github/CODEOWNERS` (review requests), and the private vulnerability reporting and
ruleset settings described below.

## Repository settings (one-time, owner)

Protection for `main` is defined in `.github/rulesets/main-protection.json`: GitHub → Settings → Rules → Rulesets →
New ruleset → **Import a ruleset** → choose that file → Create. It requires a pull request (squash merge), all
required checks (test, quality, scripts-and-infra, docker, analyze), CodeQL code scanning results (blocks on security
alerts rated high or above and on any alert at error level), linear history, and blocks force pushes and deletion — for
everyone, including admins. Review conversations do not need resolving (scanner comments would otherwise block merges);
medium security alerts don't block but are fixed in follow-up PRs. The file mirrors the live ruleset — when you change
the ruleset in GitHub, update the file in the same week. Also enable Settings → Code security → Private vulnerability reporting,
Dependabot alerts and secret scanning with push protection.
