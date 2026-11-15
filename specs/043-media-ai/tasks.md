# Tasks

- [X] T001 Research: model names, SIWC limitations, OpenRouter audio/image APIs, on-server engines (plan.md)
- [X] T002 Adapters: media parts (OpenAI-compatible, ChatGPT Responses), OpenAI/OpenRouter transcribe / speak / images
- [X] T003 WhatsApp channel: media info, serialisable media reference, download; registry routing
- [X] T004 `media-ai.js`: capabilities, settings, inbound preparation, vision plan, create_image, voice replies
- [X] T005 `media-queue.js`: persisted queue, workers by size, per-chat order, ⏳ / note, max age, full queue
- [X] T006 `resources.js`: server size, engine/heavy checks, memory pressure, limiter, low priority
- [X] T007 `speech-local.js` + worker: on-demand install, per-job processes, ffmpeg; verified for real on x64
- [X] T008 Router/runner/tools/schema/usage/events/silences wiring; summaries pause; Copilot refusal; local MCP cap
- [X] T009 Panel: Models card, agent section, Settings card, Server note; routes; admin MCP tools
- [X] T010 Installer + Dockerfile: ffmpeg, bzip2
- [X] T011 Tests `test/media-ai.test.js` (harness: media fakes); docs/configuration.md; version 2.7.0
- [X] T012 (#67) Photo turns: `chat({ accept, lastResort })` skips image-incapable candidates, vision fallback last,
  retry without the photo + kind note; test in `test/media-ai.test.js`
