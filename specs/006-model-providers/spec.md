# Feature Specification: Model Providers and Model Selection

**Feature Branch**: `006-model-providers`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "Model API key or app connection — support linking their Claude account subscription and
ChatGPT subscription to the app for models; they select from available models or auto." Clarified: Claude
subscriptions may not be used by third-party apps (Anthropic terms) → Anthropic API key; ChatGPT plan via OpenAI's
official open-source "Sign in with ChatGPT" plan usage; plus OpenAI API key and OpenAI-compatible endpoints.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a model provider (Priority: P1)

The owner opens Models and connects at least one provider: pastes an Anthropic API key, an OpenAI API key, or adds
an OpenAI-compatible endpoint (name, base URL, key — e.g. OpenRouter, a local Ollama). The panel shows each provider
as connected (with its models) or with the error.

**Why this priority**: nothing works without a model; today only an Anthropic key is supported.

**Independent Test**: add each provider type and see its models listed.

**Acceptance Scenarios**:

1. **Given** no providers, **When** the owner pastes an Anthropic key, **Then** Anthropic shows as connected with
   its models.
2. **Given** an OpenAI-compatible endpoint with a wrong key, **When** it is saved, **Then** it shows the error and
   other providers keep working.

---

### User Story 2 - Choose models: per bot or auto (Priority: P1)

Each bot's model is either a specific model from the connected providers or "Auto". The owner sets the default
model used by Auto, and a low-cost model for background work (memory summaries).

**Why this priority**: owners want control over quality and cost.

**Independent Test**: set bot A to a specific OpenAI-compatible model and bot B to Auto with an Anthropic default;
each bot's requests go to the right provider and tools still work.

**Acceptance Scenarios**:

1. **Given** a bot set to a specific model, **When** it answers, **Then** that provider/model is used, including tool
   calls and confirmation flows.
2. **Given** a bot on Auto, **When** a default model is set, **Then** it is used; **When** none is set, **Then** the
   first connected provider's recommended model is used, or the panel explains that a default is needed.
3. **Given** memory summaries, **Then** they use the background model setting (Auto = cheapest recommended).

---

### User Story 3 - Use a ChatGPT Plus/Pro plan (Priority: P2)

The owner clicks "Sign in with ChatGPT", signs in at OpenAI and allows plan usage. Because the app runs on a server,
OpenAI's sign-in ends on a page that can't load (it redirects to the owner's own computer); the owner pastes that
page's address back into the panel to finish. Then the ChatGPT plan's models are available like any other provider,
and the connection keeps itself signed in.

**Why this priority**: lets owners use an existing subscription instead of paying per use; officially supported by
OpenAI for open-source apps.

**Independent Test**: complete the flow against OpenAI (or a test double) and send a request using a plan model.

**Acceptance Scenarios**:

1. **Given** the owner completes sign-in and pastes the address, **Then** the connection is saved and plan models are
   listed.
2. **Given** the user did not allow plan usage, **Then** the panel explains plan usage wasn't granted and doesn't use it.
3. **Given** the access token expired, **When** a request is made, **Then** it is refreshed automatically.
4. **Given** the plan's usage cap is reached, **Then** the bot replies with a clear message and the error is recorded.

### Edge Cases

- A provider key is removed while bots use it: those bots report "model unavailable" in activity; others continue.
- A model disappears from a provider: the bot falls back to Auto and records a warning.
- Pasted address with wrong `state` or an error from OpenAI: rejected with the reason.
- Claude subscription sign-in is not offered (not permitted); the panel explains to use an API key.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support providers: Anthropic (API key), OpenAI (API key), OpenAI-compatible endpoints (any
  number; name, base URL, optional key), and ChatGPT plan via Sign in with ChatGPT.
- **FR-002**: System MUST list available models per connected provider (cached, refreshable) and show provider status
  and errors.
- **FR-003**: Bot model MUST be "auto" or a provider-qualified model; a global default model and a background model
  MUST be configurable.
- **FR-004**: All providers MUST support the bot's tool use (function calling), the confirmation gate and memory.
- **FR-005**: ChatGPT connection MUST follow OpenAI's open-source plan-usage contract: dynamic client registration,
  PKCE S256, state and nonce, loopback redirect `http://127.0.0.1:1455/auth/callback`, ID token signature and claim
  validation, required `chatgpt.tokens.use.direct` scope, `store=false`/`stream=true`, no forbidden parameters,
  automatic refresh, credentials encrypted at rest.
- **FR-006**: Because the server can't receive the loopback redirect, the owner MUST be able to paste the final
  address to complete sign-in.
- **FR-007**: Provider keys and tokens MUST be stored as encrypted secrets and never returned.
- **FR-008**: Usage-limit and eligibility errors MUST produce a clear reply and an activity entry.
- **FR-009**: Activity MUST record which provider/model answered each request and token usage.

### Key Entities

- **Provider connection**: id, type, name, base URL (compatible), key secret name, status, last error.
- **Model**: provider-qualified reference (`provider:model`), display name.
- **ChatGPT credentials**: client id, host id, tokens, granted scopes, account email/subject, expiry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A bot can be switched between providers in under a minute with no other change.
- **SC-002**: Tool-using conversations pass the same automated scenarios on Anthropic and OpenAI-style providers.
- **SC-003**: 0 secret or token values returned by the API (test).

## Assumptions

- The repository is public (open source), which qualifies it for OpenAI's self-serve plan usage; OpenAI marks this as a
  preview and may change it.
- Function tools are passed in the Responses API `tools` list; if OpenAI requires namespaces later, the adapter changes.
- Recommended defaults: Anthropic `claude-sonnet-5-5` (background `claude-haiku-5-5`); other providers require choosing
  a default model in the panel.
