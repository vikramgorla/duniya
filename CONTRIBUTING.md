# Contributing

Thanks for helping. The full working rules and the **Definition of Done** are in [AGENTS.md](AGENTS.md) (they apply to
people and AI agents alike). In short:

- **Issues first.** Every change starts from an issue with labels (`type:`, `area:`, `priority:`, `status:`;
  `spec: NNN` once a spec exists). Plan, progress and done are posted as comments; issues close with the release that
  ships them.
- **Spec Kit.** Features follow `.specify/` (constitution → spec → plan → tasks) in `specs/NNN-name/`.
- **Pull requests only.** `main` is protected: changes land through a PR from a branch named `<type>/<issue>-<slug>`
  (e.g. `feat/10-silent-by-default`), squash-merged after all required checks pass — test, quality (lint, panel
  script, dependency audit, version consistency), scripts & infra, Docker build, CodeQL. No direct or force pushes.
- **Checks you run locally:** `npm test`, `npm run lint`, `npm run check:panel`; for UI also
  `npm run check:responsive` (needs Chrome). The demo panel: `node scripts/demo-panel.mjs`.
- **Design.** UI follows `DESIGN.md` and its checklist (light/dark, phones at 375/393 px).
- **Docs are part of the change.** Update `docs/`, `README.md`, the website `docs/site/` (retake screenshots with
  `npm run site:shots` when the UI changed) where relevant. The PR template has the checklist.
- **Releases.** Bump the version in `package.json`, `package-lock.json` and `infra/oci/schema.yaml` in the PR (minor
  for features, patch for fixes, major for breaking changes) and add a `releases.json` entry for it (every version,
  one-line title at least); merging to `main` creates the tag, release, OCI stack zip
  and Docker image.

## Repository settings (one-time, owner)
Protection for `main` is defined in `.github/rulesets/main-protection.json`: GitHub → Settings → Rules → Rulesets →
New ruleset → **Import a ruleset** → choose that file → Create. It requires a pull request (squash merge), all
required checks (test, quality, scripts-and-infra, docker, analyze), CodeQL code scanning results (blocks on security
alerts rated high or above and on any alert at error level), linear history, and blocks force pushes and deletion — for
everyone, including admins. Review conversations do not need resolving (scanner comments would otherwise block merges);
medium security alerts don't block but are fixed in follow-up PRs. The file mirrors the live ruleset — when you change
the ruleset in GitHub, update the file in the same week. Also enable Settings → Code security → Private vulnerability reporting,
Dependabot alerts and secret scanning with push protection.
