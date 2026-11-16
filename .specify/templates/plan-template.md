# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

Always include, for this repository:

- [ ] I–VIII principles (self-hosted channel, generic core, least privilege in code, confirm gate, observable, free tier
      / 1 GB, spec + tests with fakes, experience first) — pass / violation recorded in Complexity Tracking
- [ ] IX Definition of Done & documentation: the plan names the docs, website, screenshots, admin MCP, version and
      issue steps below

## Definition of Done plan (constitution IX, AGENTS.md)

| Item | Plan for this feature |
|------|-----------------------|
| Issue & labels | #[N], type / area / priority / status / `spec: [NNN]`; plan, progress, done comments |
| Tests (fakes) | [which test files in `test/`, which fakes] |
| Checks | `npm test`, `npm run lint`, `npm run check:panel`; `npm run check:responsive` if UI |
| Security | [secrets, TLS, shell input, untrusted text, permissions in code, CodeQL] |
| Privacy | [allow-list, logging of contents, privacy notice] |
| Small servers | [memory / CPU / downloads on a 1 GB VM; queue, timeouts, refusal below 2 GB] |
| Lean code | [what this replaces and deletes; helpers/resolvers reused; knip + jscpd + panel size budget; no new polling] |
| Admin MCP | [new or changed tools in `src/panel/admin-tools.js`, or n/a] |
| Docs | [`docs/*.md` pages, `docs/README.md`, `README.md` highlights, `mobile/README.md`, `DESIGN.md`, diagrams in `docs/diagrams/` (`npm run docs:diagrams`)] |
| Website | [section/tile in `docs/site/index.html`; shots to retake with `npm run site:shots`] |
| Version | [x.y.z] (minor feature / patch fix / major breaking) in `package.json`, `package-lock.json`, `infra/oci/schema.yaml` |
| Releases | `releases.json` entry (every version, one-line title at least); breaking? → major bump, `breaking: true`, actions for the owner (or a migration instead) |

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
