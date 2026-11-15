# Implementation Plan: Photos & Voice, with Small-Server Guardrails

**Spec**: [spec.md](spec.md) · **Issue**: #48 · **Release**: v2.7.0

## Research (2026-11-15)

- OpenAI audio API reference: transcription models `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`
  (+ dated snapshot), OGG accepted; speech models `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`; response format `opus` (Ogg
  Opus, what WhatsApp voice notes use — no conversion needed).
- OpenAI image models: `gpt-image-2` (default since April 2026), `gpt-image-1.5` (deprecated), `gpt-image-1`,
  `gpt-image-1-mini`; endpoints `/images/generations` and `/images/edits`. We use whichever the key lists, newest first.
- Sign in with ChatGPT (token sharing, preview limitations): image generation, audio input and the transcription API
  are unsupported; text, images and files are supported when the model accepts them; inference must use
  `api.openai.com/v1/responses`, not ChatGPT `backend-api`. So the ChatGPT adapter gets image/file input only. Codex
  CLI's built-in image tool runs against ChatGPT's own backend, which our constitution and OpenAI's doc rule out.
- OpenRouter: `/api/v1/audio/transcriptions` (JSON `input_audio`), `/api/v1/audio/speech` (MP3/PCM), `/api/v1/images`
  (+ `/images/models`; `input_references` for edits); responses report `usage.cost`.
- On-server: whisper.cpp ships no Linux binaries; Piper binaries are archived. `sherpa-onnx-node@1.13.8` has prebuilt
  Linux x64/arm64 binaries and runs Whisper and Piper models (2.x dropped the phonemizer Piper needs). Verified on x64:
  Piper "amy-low" ~180 MB RSS, Whisper tiny int8 ~295 MB RSS, round trip TTS → Opus → STT correct.

## Design

- `src/core/media-ai.js` — capabilities per account, server settings (`media`), agent settings (`agent.media`),
  `prepareInbound()` (download, temp file, blocks, transcription chain), `planAttachments()` (vision check / fallback /
  note), `create_image` tool (queues a job) and `createImage()` (provider chain, usage, WhatsApp send),
  `wantsVoice()` / `speak()` (TTS chain).
- `src/core/media-queue.js` — `media_jobs` table, workers by server size, per-chat order, ⏳ / "I'm on it", max age,
  bounded length, restart recovery; handlers registered by the router (`turn`, `image`, `voice`).
- `src/core/resources.js` — server size (cgroup aware), `localEngineCheck`, `heavyCheck`, `maxLocalServices`, memory
  pressure (`optionalPaused`, watcher), `runJob` limiter with timeouts, `lowPriority` (nice + ulimit -v).
- `src/core/speech-local.js` + `speech-worker.cjs` — on-demand install into `DATA_DIR/speech`, per-job child process,
  ffmpeg conversion; fakes for tests.
- Providers (additive): `openai-chat.js` media parts + `transcribe` / `speak` / `createImage` / `listImageModels` for
  OpenAI and OpenRouter, `inputs`/`outputs` from model listings; `chatgpt.js` `input_image` / `input_file`.
- `src/channels/whatsapp.js` — `mediaInfo` (declared size, seconds), `mediaRef` (serialisable), `fetchMedia`,
  `downloadMedia`; registry routes `downloadMedia`.
- Router: media turns go to the queue; `runTurn()` shared by inline text turns and queued turns; `deliver()` sends text
  or voice. Runner: image/document blocks, vision plan, test console never creates pictures. Tools: `media:create_image`.
- Usage: `recordUsage({ cost, priced })` for provider-reported / per-picture costs.
- Guardrails elsewhere: summaries skip under pressure; Copilot connect refused < 2 GB; local MCP process cap.
- Panel: Models capability card, agent "Photos & voice", Settings card with engine progress, Server size note; routes
  `src/panel/routes/media.js`; admin MCP tools.
- Install: `ffmpeg bzip2` in `install.sh` (optional) and the Dockerfile.

## Constitution Check

- I/II: no commercial connectors; generic core (no agent names). III: tool exposure decided in code per role and
  deny list. IV unaffected (pictures are not external state changes behind a preview tool). V: transcripts, pictures,
  queue errors, pressure, quiet reasons in Activity (`media` category). VI: no new app dependency — the speech runtime
  is downloaded on demand into DATA_DIR like the Copilot SDK; 1 GB VMs get guardrails, the app stays well under
  400 MB (engines run in separate short-lived processes and are refused below 2 GB). VII: spec + fakes. VIII: plain
  wording, one state, progress survives reloads.
- Provider terms: ChatGPT plan used only through the official flow and only for what OpenAI documents as supported.

## Complexity Tracking

- ffmpeg/bzip2 as OS packages: needed for Ogg/Opus voice notes via OpenRouter / on-server engines; optional (provider
  routes work without them).
