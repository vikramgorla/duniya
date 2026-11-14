# Quickstart: 018

## Try it

1. `npm ci` (installs the optional Copilot SDK) and `npm start`; open the panel → **Models**.
2. With nothing connected you see **Start here**. Tap **Free to start** → OpenRouter card: open the keys link, create
   a key, paste it, **Add OpenRouter**. "Free models only" is on; press **Test** → reply and latency.
3. ChatGPT (owner): **Sign in with ChatGPT** → **Open ChatGPT sign-in** → approve → the browser shows "This site can’t
   be reached" → copy the whole address → paste → **Finish**.
4. GitHub Copilot (owner): open the pre-filled token link, **Generate token**, paste `github_pat_…` → **Connect**. The
   card shows your login, models and premium requests left. If GitHub refuses, switch "Copilot requests" between
   Read-only and Read and write.

## Tests

`npm test` (all fakes). Feature tests: `node --test test/provider-setup.test.js`.

## Without Copilot

The Copilot SDK is downloaded into the data folder on first connect (~420 MB); servers that never use Copilot never download it.
