# Feature Specification: Guided Provider Setup, OpenRouter Preset, GitHub Copilot

**Feature Branch**: `feat/018-provider-setup`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: Owner: "non-technical people should be able to connect model providers easily, with clear steps, visual
cues and one-click links." Plus: one-tap OpenRouter with a "Free models only" switch; clearer ChatGPT sign-in steps
for the paste-back flow on a remote server; GitHub Copilot through the official Copilot SDK only, labelled "Uses your
Copilot allowance", with the note "Copilot Free is meant for personal use".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know where to start and connect a provider by following steps (Priority: P1)

A person with no model connected opens Models and sees "Start here" with four choices (free to start, best answers,
"I pay for ChatGPT", "I have GitHub Copilot"). Each provider card says what it is and what it costs in one line, then
2–4 numbered steps with a direct link to the exact page, a small drawing of the button or field to look for, and the
field to paste into.

**Independent Test**: with no provider connected, open Models; every card shows steps with links and a paste field.

**Acceptance Scenarios**:

1. **Given** nothing connected, **When** Models opens, **Then** "Start here" recommends OpenRouter free models as a
   zero-cost start, Anthropic/OpenAI keys for quality, the ChatGPT plan for Plus/Pro subscribers and Copilot.
2. **Given** a card, **When** the person follows the steps, **Then** each step links straight to the page where the
   key or token is created and shows what to click and what the key starts with.
3. **Given** a key is pasted, **When** Connect is pressed, **Then** the card switches to its connected state.

### User Story 2 - See that it works (Priority: P1)

A connected card shows the account (where known), the number of models and a Test button that sends "Say hi" and shows
the reply, the model and how long it took — or the error in plain words.

**Acceptance Scenarios**:

1. **Given** a connected provider, **When** Test is pressed, **Then** the reply, model ref and latency are shown.
2. **Given** a provider whose key is wrong, **When** Test is pressed, **Then** the error is shown on the card (no crash).

### User Story 3 - OpenRouter in one tap, free models only (Priority: P1)

The person pastes an OpenRouter key and taps "Add OpenRouter". A "Free models only" switch (on by default) limits the
model list to ids ending in `:free`, Auto picks among them, and a paid model is refused while the switch is on.

**Acceptance Scenarios**:

1. **Given** a key, **When** "Add OpenRouter" is tapped, **Then** endpoint `openrouter` (base
   `https://openrouter.ai/api/v1`) is saved, the key is stored as a secret and never returned.
2. **Given** free-only on, **Then** only `:free` models are listed and Auto resolves to one of them.
3. **Given** free-only on and a bot set to a paid OpenRouter model, **Then** no request is sent and the bot says
   only free models are allowed.
4. **Given** free-only is switched off and on, **Then** the key is kept.

### User Story 4 - ChatGPT plan sign-in on a remote server (Priority: P2)

Clear steps: the plan needs ChatGPT Plus or Pro; after approving, the browser shows "This site can’t be reached" at
127.0.0.1:1455 — expected; copy the whole address from the address bar and paste it. Sign-in logic is unchanged (006).

### User Story 5 - GitHub Copilot via the official SDK (Priority: P2)

The owner creates a fine-grained token with the pre-filled link (Copilot requests permission), pastes it, and Copilot
models appear with the remaining premium-request allowance. Bots can use Copilot models, including tool use.

**Acceptance Scenarios**:

1. **Given** a classic `ghp_` token, **Then** it is refused with an explanation.
2. **Given** a token GitHub rejects, **Then** it is not kept and the message suggests switching the "Copilot
   requests" access level (docs disagree on read vs write).
3. **Given** a valid token, **Then** the card shows the GitHub login, model count and quota (left of total, reset).
4. **Given** a bot on a Copilot model, **When** the model calls a tool, **Then** the tool runs through the normal
   permission/confirmation path and the answer comes back; only the bot's tools are available (no shell/files/web).
5. Only owners can connect or disconnect Copilot.

### Edge Cases

- Copilot support is downloaded on first connect; a download failure shows a clear error and stores nothing.
- Copilot usage limit reached: the bot answers "I have reached the GitHub Copilot usage limit for now".
- A tool loop abandoned by the agent: the held SDK session is closed after 5 minutes.
- Viewers see states but no connect/test buttons.

## Requirements *(mandatory)*

- **FR-001**: Models MUST show a "Start here" recommendation when nothing is connected.
- **FR-002**: Each provider card MUST show a one-line description with cost, 2–4 numbered steps with direct links,
  a lightweight drawn cue per step where useful (no remote images), and the paste field.
- **FR-003**: Connected cards MUST show account (when known), model count and a Test button (reply + latency).
- **FR-004**: `POST /api/providers/openrouter` MUST create/update endpoint `openrouter` with the key as a secret and a
  `freeOnly` flag (default on); free-only MUST filter listing, Auto and use.
- **FR-005**: The ChatGPT card MUST explain the expected "can’t be reached" page and the copy-whole-address step and
  mention Plus/Pro.
- **FR-006**: Copilot MUST use only the official `@github/copilot-sdk`; never `api.githubcopilot.com` or unofficial
  APIs. Tokens: fine-grained PAT (`github_pat_`) or OAuth user token (`gho_`/`ghu_`); classic `ghp_` refused.
- **FR-007**: The Copilot adapter MUST map Anthropic-style blocks (text, tool_use, tool_result) to SDK sessions with
  custom tools only, and expose quota when available.
- **FR-008**: Copilot runtime MUST start only when used, get a scrubbed environment, and stop after 10 minutes idle.
- **FR-009**: Tests MUST NOT hit the network: Copilot is tested with an injected fake client.

## Success Criteria

- **SC-001**: A non-technical person connects OpenRouter free models in under 3 minutes from the panel alone.
- **SC-002**: All 018 tests and the existing suite pass with fakes only.
- **SC-003**: Screens pass the DESIGN.md checklist in light/dark on phone and iPad.
