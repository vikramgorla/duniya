## What and why
Closes #<issue> · Spec: `specs/NNN-…` (or "no spec: <reason>")

## Definition of Done ([AGENTS.md](../AGENTS.md#definition-of-done))
Tick each item or write "n/a – reason".

**Tracking**
- [ ] Issue has labels (type / area / priority / status / spec) and plan + progress comments; done comment follows the merge

**Spec & tests**
- [ ] Spec Kit artifacts (spec, plan, tasks) match the code
- [ ] Tests with fakes cover the behaviour
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run check:panel` pass
- [ ] UI changed: `npm run check:responsive` passes (375 / 393 / 1440, light + dark) and DESIGN.md checklist met

**Security & privacy**
- [ ] No secrets; TLS never disabled; no shell with untrusted input; untrusted text rendered as text
- [ ] CodeQL clean at high / error
- [ ] Chat allow-list respected; no message contents in logs beyond the logging policy; privacy notice behaviour intact
- [ ] Permissions enforced in code (role allow lists, confirm gate)

**Small servers**
- [ ] Impact on a 1 GB / 1 vCPU VM considered (memory, CPU, downloads, queue/timeouts)
- [ ] New queries pass `npm run check:perf` (no full scans of large tables, time budgets met; index sizes stated; budgets raised only with a reason)

**Lean code**
- [ ] What the change replaces is deleted; no compatibility layer or one-time migration left after its release; existing helpers reused
- [ ] `node scripts/ci-checks.mjs` passes (knip, jscpd, panel budgets, types, one repository slug, clean code); tests check behaviour, not internals
- [ ] Clean code (AGENTS.md#clean-code): small single-purpose functions, early returns, meaningful names, named constants, generic (nothing keyed on a tool/service/channel name); `npm run check:clean` passes and `scripts/clean-baseline.json` did not go up (or the PR says why)
- [ ] No hard-coded repository owner/name: code reads `REPO` (`src/core/config.js`), docs are rewritten by `npm run repo:sync`
- [ ] UI: no new polling (live data over `/api/events`)

**Docs**
- [ ] `docs/` pages (+ `docs/README.md` index)
- [ ] `README.md` highlights
- [ ] Website `docs/site/` (sections/tiles; screenshots/videos retaken with `npm run site:shots` if UI changed)
- [ ] Admin MCP tools + `docs/admin-mcp.md`
- [ ] `DESIGN.md` (visual changes)

**Version & release**
- [ ] Version bumped in `package.json`, `package-lock.json`, `infra/oci/schema.yaml` (minor feature / patch fix / major breaking)
- [ ] `releases.json` entry for the version (required for every version: one-line title + `changes`, short owner-facing bullets with a type new / improved / fixed / removed); breaking → major + `"breaking": true` with actions (or a migration instead)
- [ ] Opened via REST, not pushed to `main`; squash merge after required checks, with an explicit title and message
- [ ] No attribution trailers or footers in commits and this PR (no Co-Authored-By, session links or 'Generated with' lines)

## Risk
<!-- security impact, data changes, anything a reviewer should look at first -->

## How it was checked
<!-- commands run, screens looked at -->
