# Models, fallback and photos & voice

## Providers

- **Models**: OpenRouter (optionally free models only), Anthropic API key, OpenAI API key, any OpenAI-compatible
  endpoint (Ollama, …), your ChatGPT Plus/Pro plan via Sign in with ChatGPT, or your GitHub Copilot allowance via the
  official Copilot SDK (downloaded only if you connect it). Pick per agent and per chat, or *Auto*.

Claude **subscriptions** (Pro/Max) can't be used by third-party apps under Anthropic's terms, so Claude needs an API
key. ChatGPT plan usage goes through OpenAI's official Sign in with ChatGPT flow (preview).

## Fallback and several accounts

- **Fallback and several accounts** (042): when a model hits a rate or usage limit, runs out of credit, is down, times
  out or its sign-in expired, the agent answers with the next model of the fallback chain (**Models → When a model
  fails**; default: any other connected provider's Auto; per agent and per chat: inherit / switch / don't switch, own
  chain). Refused requests (400) never switch, and tools that already ran never run again. A failing account is paused
  (1 min, doubling to 30 min; usage limits until the provider's reset time) and shown as "Paused until 14:20 — usage
  limit reached"; the owner gets a WhatsApp alert after 15 minutes or when no provider can answer. Each provider can
  have several accounts with a label (model refs `openai-work:gpt-…`), used *in order* (failover) or *spread* (least
  recently used). Use your own accounts: some plans' terms forbid sharing accounts or getting around their limits.

Admin MCP: `list_model_accounts`, `get_model_fallback`, `set_model_fallback`, `set_account_strategy`,
`retry_model_account`.

![When a model fails](site/img/card-fallback.webp)

## Photos & voice

(043, #48) When a connected provider supports it, agents see photos, listen to voice notes, create pictures and answer
with voice notes. Photos and voice notes are sent to that provider. **Models → Photos & voice** shows what each
provider can do and how to enable what is missing; each agent switches its use under **Photos & voice** on its page;
server-wide choices are under **Settings → Photos & voice**.

| | Anthropic | OpenAI (API key) | ChatGPT sign-in | Copilot | OpenRouter | Other endpoints | This server |
|---|---|---|---|---|---|---|---|
| Sees photos / PDFs | ✓ | ✓ | ✓ | — (vision fallback) | models that list image input | by model | — |
| Hears voice notes | — | ✓ `gpt-4o-mini-transcribe` | — ¹ | — | ✓ (paid) | — | Whisper tiny (optional) |
| Creates pictures | — | ✓ `gpt-image-*` listed for the key | — ¹ | — | ✓ image models (paid) | — | — |
| Speaks | — | ✓ `gpt-4o-mini-tts` (Ogg/Opus) | — | — | ✓ (paid, needs ffmpeg) | — | Piper voice (optional) |

¹ OpenAI's Sign in with ChatGPT preview lists image generation and the transcription API as unsupported for ChatGPT
plan usage on `api.openai.com`, and says not to use ChatGPT's `backend-api` endpoints, so Duniya does not use the plan for
these. Free-only OpenRouter makes no paid media calls.

- **Photos in** (and PDFs, stickers optional): only in chats that are on and when the agent is addressed (a caption with
  the trigger, a mention, a reply to the agent, or a direct message). The photo goes to the model as an image; a model
  that can't see images uses the **vision fallback model** (Settings) or says kindly that it can't look at photos.
  Photos are kept in temp files under `DATA_DIR/media-tmp` (deleted after 15 minutes); the history keeps only
  `[image: caption]`.
- **Voice notes in**: transcribed (OpenAI → OpenRouter → on-server engine), then handled like typed text; stored and
  shown as `🎤 transcript`. In groups a voice note counts as addressed when it replies to the agent or mentions it.
  Longest voice note: 5 minutes (Settings).
- **Create images**: tool `media__create_image` (`prompt`, `size`, `caption`, `edit_of: "last_photo"`), only when a
  capable provider is connected; organizers by default, participants if the agent allows it. The picture is made in
  the media queue and sent as a WhatsApp image with a caption.
- **Voice replies**: per agent *never* / *to voice notes* / *always*; sent as a WhatsApp voice note (Ogg/Opus), text
  kept in the history. Replies with a confirm code or a link stay text; if speaking fails, the text is sent.
- **Usage & caps**: transcriptions (`transcribe`), pictures (`image`) and speech (`speech`) appear in Usage and count
  toward spending caps — with the cost the provider reports (OpenRouter), a price per picture you set, or token prices.
- **On-server speech** (owner, Settings): Whisper tiny (listening, ~115 MB download) and a Piper voice (speaking,
  ~65 MB), run by the open-source [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) runtime (`sherpa-onnx-node`,
  prebuilt for Linux x64 and arm64, downloaded into `DATA_DIR/speech` only when you choose to). Each job runs in its
  own low-priority process (~300 MB while listening, ~180 MB while speaking) and needs ffmpeg and bzip2 (the
  installer and the Docker image include them). whisper.cpp publishes no Linux binaries (it would need a build
  toolchain), so it is not used.
- Admin MCP tools: `get_photos_and_voice`, `set_photos_and_voice_settings`, `install_speech_engine`,
  `set_agent_photos_and_voice`.

---
[Docs index](README.md)
