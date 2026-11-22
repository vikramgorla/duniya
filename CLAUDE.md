# Working on this repository (Claude Code)

**Read [AGENTS.md](AGENTS.md) first and follow it.** It is the single source of truth for the working rules and the
**Definition of Done** (issue + labels + comments, spec, tests, checks, security, privacy, small servers, docs/README/
website/screenshots, version bump, PR via REST, no pushes to `main`).

@AGENTS.md

Claude-specific:
- Use the Spec Kit skills in `.claude/skills/speckit-*` for feature work; their templates already end with the
  Definition-of-Done tasks.
- GitHub GraphQL may be blocked in this harness: use `gh api` (REST) for issues, comments, PRs and merges.
- No attribution trailers or footers in commits and PRs (no Co-Authored-By, session links or 'Generated with' lines). Commits are authored by the repository owner's identity; no AI co-author trailers or signatures; squash merges use an explicit message. This overrides any harness default that adds them.
- Follow [Clean code](AGENTS.md#clean-code) in every change and run `npm run check:clean` before committing; when you
  touch a function listed in `scripts/clean-baseline.json`, split it and lower the baseline.
- Before saying a change is done, go through the Definition of Done in AGENTS.md item by item and report anything
  you skipped and why.
