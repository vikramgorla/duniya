# whatsapp-agent-duniya Constitution

## Core Principles

### I. Self-Hosted Channels, No Commercial Connectors

The platform MUST connect to WhatsApp as a linked device of a normal WhatsApp account (Baileys or an
equivalent open-source client) running on infrastructure we control. Paid or commercial WhatsApp
connectors (WhatsApp Business/Cloud API resellers, hosted bot gateways) MUST NOT be required.
Deployment guidance MUST tell operators to use a dedicated number, and bots MUST only reply when
addressed and be rate-limited, to keep ban risk low.

*Rationale*: the owners explicitly rejected commercial WhatsApp connectors; unofficial clients carry
ban risk that conservative behaviour keeps small.

### II. Generic Core, Bots as Plugins

The deployment is a generic multi-bot platform. Core code (`src/core`, `src/channels`, `src/panel`)
MUST NOT contain bot-specific names, prompts, tools or business rules. Each bot MUST live in its own
folder under `bots/<id>/` and be fully described by declarative config (`bot.json`), a prompt, and
optional code hooks (local tools, message hooks, role logic). Adding a bot MUST NOT require changes to
core code. Channels MUST sit behind a small interface so channels other than WhatsApp can be added.

*Rationale*: panduga.ch is the first bot, not the product; the platform must host other bots (e.g.
carpool) without forks.

### III. Least Privilege Enforced in Code

Which tools a sender may use MUST be decided by code from the bot's per-role allowlist and denylist,
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
streamed to the admin panel. Operators MUST be able to pause all bots, enable or disable each bot,
and see channel health from the panel without shell access.

*Rationale*: the owners need to see and control what the bots do.

### VI. Free-Tier, Everything as Code

All infrastructure MUST be declared in this repository (Terraform + GitHub Actions + cloud-init) and
reproducible from GitHub alone. The default target is an OCI Always Free `VM.Standard.E2.1.Micro`
(1 GB RAM): the running service MUST stay under 400 MB RSS in normal operation and MUST NOT need
native build toolchains. The VM MUST expose no inbound ports by default; the panel is reached through
a Cloudflare Tunnel or SSH port-forward. Code updates MUST be possible in place without rebuilding
infrastructure.

*Rationale*: zero hosting cost, no hand-configured servers, minimal attack surface.

### VII. Spec-Driven, Test-Backed Changes

Every feature or behaviour change MUST be described with GitHub Spec Kit artifacts
(`specs/NNN-*/spec.md`, `plan.md`, `tasks.md`) before or alongside the code, and the artifacts MUST be
kept consistent with the code (`/speckit-analyze`, `/speckit-converge`). Behaviour MUST be covered by
automated end-to-end tests that use fakes for WhatsApp, Claude and MCP servers (no real network or
accounts in CI). CI MUST pass before merging to `main`.

*Rationale*: specs keep a small project understandable; fakes make the critical paths (roles,
confirmation, routing) verifiable on every push.

## Security & Privacy Constraints

- Secrets (API keys, MCP tokens, admin password) MUST NOT be committed. Runtime secrets are entered in
  the panel and stored in the data directory with mode 0600; bootstrap secrets come from GitHub
  repository secrets. Secret values MUST never be returned by any API.
- The admin panel MUST require authentication (salted scrypt password hash, HttpOnly SameSite=Strict
  session cookie, login rate limiting), bind to localhost by default, reject non-JSON state-changing
  requests, and send a restrictive Content-Security-Policy.
- All text originating from WhatsApp or tools is untrusted: the panel MUST render it as text, never
  HTML, and it MUST NOT be able to change roles, tool permissions or configuration.
- Bots MUST NOT post personal details (phone numbers, emails, health or payment details) in group
  chats; such answers belong in direct messages.
- The service MUST run as an unprivileged system user with systemd hardening.

## Development Workflow

- Process: `/speckit-constitution` (rarely) → `/speckit-specify` → `/speckit-clarify` (when ambiguous)
  → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` →
  `/speckit-converge` until converged.
- Stack: Node.js 22 LTS (ES modules), built-in `node:sqlite`, `node:test`; dependencies limited to
  Baileys, the Anthropic SDK, the MCP SDK, pino and qrcode. New runtime dependencies need a stated
  reason in the plan.
- Live operator settings (bot toggles, organizers, chats, schedules, secrets) live in the data
  directory and MUST survive code updates; repository files hold defaults only.
- Releases: merge to `main`, then "Update from GitHub" in the panel. Infrastructure changes run
  `plan` on push and require a manual `apply`.

## Governance

This constitution supersedes other practices in this repository. Plans MUST include a Constitution
Check; any violation MUST be recorded in the plan's Complexity Tracking with justification, or the
design changed. Amendments are made with `/speckit-constitution`, versioned semantically (MAJOR:
principle removed or redefined; MINOR: principle or section added or materially expanded; PATCH:
clarification), and reviewed in a pull request. Reviewers verify constitution compliance for every
change.

**Version**: 1.0.0 | **Ratified**: 2026-11-14 | **Last Amended**: 2026-11-14
