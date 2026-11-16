# Copilot instructions

Follow [AGENTS.md](../AGENTS.md) at the repository root: it holds the working rules, the architecture map and the
**Definition of Done** every change must meet (issue with labels and comments, Spec Kit folder for features, tests with
fakes, `npm test` / `npm run lint` / `npm run check:panel`, responsive check for UI, security and privacy review,
small-server impact, lean code (delete what a change replaces; knip, jscpd and the panel size budget in
`node scripts/ci-checks.mjs`; no new polling), docs + README + website + screenshots, version bump in package.json, package-lock and
infra/oci/schema.yaml, PR with "Closes #N", never push to `main`).
