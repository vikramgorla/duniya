---

description: "Task list for 006-model-providers"
---

# Tasks: Model Providers and Model Selection

**Input**: Design documents from `/specs/006-model-providers/`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Foundational

- [X] T001 Provider registry, model refs, listing cache, resolveModel, chat() in src/core/providers/index.js
- [X] T002 [P] Anthropic adapter in src/core/providers/anthropic.js
- [X] T003 [P] Chat Completions adapter (message/tool conversion both ways) in src/core/providers/openai-chat.js
- [X] T004 Agent and memory summariser call providers.chat() with purpose; activity records model + usage in src/core/agent.js, src/core/memory.js

## Phase 2: User Story 1 - Connect a provider (P1)

- [X] T005 [P] [US1] Tests: compatible provider status/models; bad key isolated in test/providers.test.js
- [X] T006 [US1] Providers/compatible endpoints in src/panel/routes/providers.js

## Phase 3: User Story 2 - Choose models / auto (P1)

- [X] T007 [P] [US2] Tests: bot on compatible model uses tools + confirm gate; auto + background resolution in test/providers.test.js
- [X] T008 [US2] /api/models + defaultModel/backgroundModel settings in src/panel/routes/providers.js

## Phase 4: User Story 3 - ChatGPT plan (P2)

- [X] T009 [P] [US3] Tests: fake auth (discovery, JWKS, token), paste-back, validation failures, refresh, SSE tools, usage-limit in test/providers.test.js
- [X] T010 [US3] RS256 ID-token verification via discovery/JWKS in src/core/providers/jwt.js
- [X] T011 [US3] Connect/complete/refresh/disconnect + Responses SSE adapter in src/core/providers/chatgpt.js
- [X] T012 [US3] ChatGPT endpoints in src/panel/routes/providers.js

## Phase 5: Polish

- [X] T013 Usage-limit/eligibility errors → friendly reply + activity in src/core/agent.js
- [X] T014 Docs: README models section
