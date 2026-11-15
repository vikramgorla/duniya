# Contributing

- **Issues first.** Every change starts from an issue with labels (`type:`, `area:`, `priority:`; `spec: NNN` once a
  spec exists). Progress, decisions and releases are posted as comments; issues close with the release that ships them.
- **Spec Kit.** Features follow `.specify/` (constitution → spec → plan → tasks) in `specs/NNN-name/`.
- **Pull requests only.** `main` is protected: changes land through a PR from a branch named `<type>/<issue>-<slug>`
  (e.g. `feat/10-silent-by-default`), after all required checks pass — tests, lint/quality, scripts & infra, Docker
  build, CodeQL. No direct pushes, no force pushes.
- **Design.** UI follows `DESIGN.md` and its checklist (light/dark, phone at 375 px).
- **Releases.** Bump `package.json` in the PR; merging to `main` creates the tag, release, OCI stack zip and image.
