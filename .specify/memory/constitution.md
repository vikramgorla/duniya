<!--
Sync Impact Report (1.4.2 → 1.4.3, PATCH)
- Principle IX clarified: "Lean code" (#115). Delete what a change replaces; no compatibility layers or one-time
  migrations after the release that needed them; one way to do each thing; knip, jscpd and the panel size budget run
  in CI; tests check behaviour; the panel adds no polling (live data over server-sent events). Templates: plan, tasks
  and checklist templates (both copies) got the matching item; AGENTS.md Definition of Done has it. Follow-up: none.

Previous (1.4.1 → 1.4.2, PATCH)
- Principle VIII clarified: "No chores for the owner" (#110). Anything the server can do or retry itself happens
  automatically; buttons are optional extras, never required steps; if something needs the owner, say exactly why.
  Background work rides on one shared tick, not new timers. Templates: tasks and checklist templates (both copies)
  got the matching item; AGENTS.md Definition of Done has it. Follow-up: none.

Previous (1.4.0 → 1.4.1, PATCH)
- Principle II renamed "Generic Core, Agents as Data": code plugins were removed (#101); templates are the only agent
  files. No other principle changed. Templates: no change needed. Follow-up: none.

Previous (1.3.2 → 1.4.0, MINOR)
- Added principle IX "Definition of Done & Documentation" (AGENTS.md is the single source of truth for working rules).
- Development Workflow: issues, branches, REST, version bump in three files, docs as part of every change.
- Templates updated: .specify/templates/plan-template.md, tasks-template.md, checklist-template.md (final DoD tasks).
- Follow-up: none.
-->
# whatsapp-agent-duniya Constitution

## Core Principles

### I. Self-Hosted Channels, No Commercial Connectors

The platform MUST connect to WhatsApp as a linked device of a normal WhatsApp account (Baileys or an
equivalent open-source client) running on infrastructure we control. Paid or commercial WhatsApp
connectors (WhatsApp Business/Cloud API resellers, hosted bot gateways) MUST NOT be required.
Deployment guidance MUST tell operators to use a dedicated number, and agents MUST only reply when
addressed and be rate-limited, to keep ban risk low.

*Rationale*: the owners explicitly rejected commercial WhatsApp connectors; unofficial clients carry
ban risk that conservative behaviour keeps small.

### II. Generic Core, Agents as Data

The deployment is a generic multi-agent platform. Core code (`src/core`, `src/channels`, `src/panel`)
MUST NOT contain agent-specific names, prompts, tools or business rules. Agents are data: they MUST be
created, edited, exported and imported from the admin panel and be fully described by a validated
configuration (instructions, tool services, per-role rules, confirmation, schedules, memory). Templates
(`templates/`) are files; no agent may require code changes, and there is no per-agent code (#101).
Data models MUST carry a tenant identifier so hosted multi-tenancy can be added later. Channels MUST sit
behind a small interface so channels other than WhatsApp can be added.

*Rationale*: panduga.ch is the first agent, not the product; the platform must host other agents (e.g.
carpool) without forks.

### III. Least Privilege Enforced in Code

Which tools a sender may use MUST be decided by code from the agent's per-role allowlist and denylist,
never by prompt instructions alone. A tool that is not allowed for the sender's role MUST NOT be sent
to the model and MUST be refused if the model calls it anyway. Where a backend supports scoped
credentials, the least-privileged credential for the role SHOULD be used.

*Rationale*: prompts can be talked around; group chats contain untrusted input.

### IV. Human Confirmation for Writes

Any tool that changes external state through a preview/confirm protocol MUST go through the confirm
gate: the server keeps the confirmation id, hides it from the model, and applies the change only
after an authorised human (an organizer in the same chat, or an admin in the panel) confirms with a
short-lived code. The confirm tool itself MUST never be exposed to the model. Codes MUST be single-use
and expire.

*Rationale*: an LLM must never be able to apply a change on its own, even if manipulated.

### V. Observable and Controllable

Every routed message, reply, tool call (with input, output summary, duration and outcome),
confirmation, schedule run, configuration change and error MUST be recorded in the activity log and
streamed to the admin panel. Operators MUST be able to pause all agents, enable or disable each agent,
and see channel health from the panel without shell access.

Operators MAY reduce what is recorded (global level, categories, per chat) to keep the log small, but errors,
confirmations, configuration changes and channel status MUST always be recorded.

*Rationale*: the owners need to see and control what the agents do.

### VI. Free-Tier, Everything as Code

Every supported deployment path (one-command installer, Docker, OCI Resource Manager stack, Terraform +
GitHub Actions) MUST be declared in this repository and use the same installer logic. The service MUST
run on a 1 GB VM (e.g. OCI Always Free `VM.Standard.E2.1.Micro`): under 400 MB RSS in normal operation and
no native build toolchains. The app MUST bind to localhost; inbound exposure is the operator's explicit
choice (direct HTTPS on 80/443 via a local proxy, an outbound tunnel such as Cloudflare Tunnel or Tailscale, or none),
and no other ports are opened. The panel is never served over plain HTTP, and a proxy in front MUST connect to the
server encrypted. OCI, Cloudflare and Tailscale are examples, not requirements; provider lists are neutral. Code updates MUST be possible in place (panel or
installer) without rebuilding infrastructure, and MUST keep all data.

*Rationale*: zero hosting cost, no hand-configured servers, minimal attack surface.

### VII. Spec-Driven, Test-Backed Changes

Every feature or behaviour change MUST be described with GitHub Spec Kit artifacts
(`specs/NNN-*/spec.md`, `plan.md`, `tasks.md`) before or alongside the code, and the artifacts MUST be
kept consistent with the code (`/speckit-analyze`, `/speckit-converge`). Behaviour MUST be covered by
automated end-to-end tests that use fakes for WhatsApp, Claude and MCP servers (no real network or
accounts in CI). CI MUST pass before merging to `main`.

*Rationale*: specs keep a small project understandable; fakes make the critical paths (roles,
confirmation, routing) verifiable on every push.

### VIII. Experience First

The people running this are often not technical. Every feature MUST be usable from the admin panel without a shell,
in plain language, with the next step obvious: links that go straight to where a key or setting is created, exactly
what to copy, visual status that is never contradictory or stale, progress for long actions that survives reloads,
and confirmations that state the consequence. One-click flows are preferred whenever the other side allows them.
UI work MUST follow `DESIGN.md` and its checklist; a feature is not done until its screens pass that checklist in
light and dark mode on a phone and an iPad.

**No chores for the owner**: anything the server can do or retry itself (refresh, reload, sync, retry, re-check)
MUST happen automatically; buttons are optional extras, never required steps; if something needs the owner, the
panel MUST say exactly why. Such background work runs on the shared upkeep tick or on events, bounded per tick, not
on new timers per feature.

*Rationale*: the owners judge the product by how it feels to set up and run; capability that can't be found or
understood does not exist for them.

### IX. Definition of Done & Documentation

`AGENTS.md` at the repository root is the single source of truth for working rules and holds the **Definition of
Done**; harness files (`CLAUDE.md`, `.github/copilot-instructions.md`), `CONTRIBUTING.md` and the PR template point to
it and MUST NOT contradict it. No change is done until every applicable item holds: a labelled issue with plan,
progress and done comments; Spec Kit artifacts for features; tests with fakes; `npm test`, `npm run lint` and
`npm run check:panel` green (`npm run check:responsive` for UI); a security and privacy review; the small-server
impact considered; **documentation updated in the same change** — `docs/`, `README.md`, the website `docs/site/`
(with screenshots and videos retaken from the demo panel when the UI changed), admin MCP tools and
`DESIGN.md` where relevant; and the version bumped in `package.json`, `package-lock.json` and
`infra/oci/schema.yaml` (semver). Code MUST stay lean: what a change replaces is deleted in the same change, no
compatibility layer or one-time migration outlives the release that needed it, and `knip`, `jscpd` and the panel size
budget pass in CI. Plans MUST list these as final tasks; the Spec Kit templates do so.

*Rationale*: features that are not documented, shown or versioned are invisible to the owners, and rules that live
in one harness's file are missed by every other agent.

## Security & Privacy Constraints

- Secrets (API keys, MCP tokens, admin password) MUST NOT be committed. Runtime secrets are entered in
  the panel and stored in the data directory with mode 0600; bootstrap secrets come from GitHub
  repository secrets. Secret values MUST never be returned by any API.
- The admin panel MUST require authentication (salted scrypt password hash, HttpOnly SameSite=Strict
  session cookie, login rate limiting), bind to localhost by default, reject non-JSON state-changing
  requests, and send a restrictive Content-Security-Policy.
- All text originating from WhatsApp or tools is untrusted: the panel MUST render it as text, never
  HTML, and it MUST NOT be able to change roles, tool permissions or configuration.
- Agents MUST NOT post personal details (phone numbers, emails, health or payment details) in group
  chats; such answers belong in direct messages.
- The service MUST run as an unprivileged system user with systemd hardening (or as a non-root container user).
- Model access MUST respect provider terms: Anthropic via API keys only (no Claude subscription OAuth);
  ChatGPT plans only through OpenAI's official Sign in with ChatGPT flow. Provider credentials are secrets.
- Backups MUST be encrypted with an owner passphrase before leaving the server.

### Local Tool Services

Tool services that run as packages on the server (npm or GitHub, over stdio) execute third-party code with the
app's privileges. Only the owner role MAY add, change or install them; the panel MUST say so plainly; npm install
scripts MUST be off unless the owner allows them per service; the installed version MUST be recorded and shown; and
the process MUST receive a scrubbed environment (PATH, network/proxy settings and the env the owner configured —
never the app's own secrets or settings).

## Development Workflow

- Process: `/speckit-constitution` (rarely) → `/speckit-specify` → `/speckit-clarify` (when ambiguous)
  → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` →
  `/speckit-converge` until converged.
- Stack: Node.js 22 LTS (ES modules), built-in `node:sqlite`, `node:test`; dependencies limited to
  Baileys, the Anthropic SDK, the MCP SDK, pino and qrcode (other providers via `fetch`). New runtime dependencies need a stated
  reason in the plan.
- Live operator settings (agent toggles, organizers, chats, schedules, secrets) live in the data
  directory and MUST survive code updates; repository files hold defaults only.
- Work is tracked in GitHub issues (REST API; GraphQL may be unavailable) and lands through pull requests from
  `<type>/<issue>-<slug>` branches, squash-merged after the required checks; nobody pushes to `main`. Details and the
  Definition of Done: `AGENTS.md`.
- Releases: bump the version (semver) in `package.json`, `package-lock.json` and `infra/oci/schema.yaml` (CI checks
  they match), add a `releases.json` entry for every version, and merge to `main`; the release workflow tags and publishes, and servers update from the panel.
  Infrastructure changes run `plan` on push and require a manual `apply`.

## Governance

This constitution supersedes other practices in this repository. Plans MUST include a Constitution
Check; any violation MUST be recorded in the plan's Complexity Tracking with justification, or the
design changed. Amendments are made with `/speckit-constitution`, versioned semantically (MAJOR:
principle removed or redefined; MINOR: principle or section added or materially expanded; PATCH:
clarification), and reviewed in a pull request. Reviewers verify constitution compliance for every
change.

**Version**: 1.4.3 | **Ratified**: 2026-11-14 | **Last Amended**: 2026-11-16
