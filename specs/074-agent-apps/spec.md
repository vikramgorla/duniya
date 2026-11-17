# 074 · Agent apps: your Claude, ChatGPT and Copilot plans through their official apps

Issue #156 · version 2.34.0

## Why

The owner uses Duniya personally and already pays for Claude, ChatGPT and GitHub Copilot plans. Claude could only be
used with an API key, ChatGPT only through the Responses API sign-in, and Copilot was refused below 2 GB of memory, so
the typical 1 GB server could not use it. Agent Durbar (the owner's desktop app) drives the official apps (Claude
Code, Codex, the Copilot SDK); Duniya should do the same on the server, and still fit a 1 GB / 1 vCPU VM.

## User stories

1. **As the owner, I connect my Claude Pro/Max plan** by pasting the token from `claude setup-token`; Duniya downloads
   Claude Code, checks the token with one tiny answer and keeps it as a secret.
2. **I connect my ChatGPT plan through Codex** with its own device sign-in: the panel shows a link and a one-time
   code, and updates by itself when I am done. The account (email · plan) is shown to me only.
3. **My agents keep their tools and rules**: WhatsApp actions and tool services work; roles, the confirm gate and
   activity stay in Duniya; the apps get no shell, files or web.
4. **It runs on my 1 GB server** with Small server mode: one app at a time, only with enough free memory, nothing
   running between answers; a usage limit pauses the account until the reset and the next model answers.

## Requirements

- R1 Providers `claudecode` (*Claude Code*) and `codex` (*Codex*) in Models (names.js), owner only, one account each;
  GitHub Copilot keeps its token sign-in and follows the same app rules.
- R2 On-demand install: npm into `DATA_DIR/apps/<id>` when connected; refused with a clear message when free memory
  (< 380 MB) or disk (< 1.2 GB) is short. Disconnect removes the download and the sign-in.
- R3 Small servers: agent apps only with Small server mode (the shared `smallServerCheck`); one app turn at a time
  (2 / 3 on medium / large); a waiting turn gets ⏳ and fails over after 2 minutes; a memory check (need + 80 MB)
  before every start; refusals are `unavailable` (next model, no pause). The old 2 GB rule for Copilot is removed.
- R4 Per-turn processes: started for a turn, ended with it; abandoned turns (tool calls unanswered for 3 minutes) and
  idle resident runtimes (Copilot: 2 minutes on small servers, 10 otherwise, at once under memory pressure) are
  stopped from the upkeep tick — no new timers per feature.
- R5 Tools through a per-turn MCP bridge on 127.0.0.1 (random token); calls return to the runner as tool_use blocks.
  Claude Code: `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--permission-mode dontAsk`, no session
  files. Codex: `exec --json --ephemeral -s read-only`, shell/patch/web/plugin/skill tools off, a model catalog
  without tool search. System prompts go in a private file, never on the command line.
- R6 Usage limits: Claude Code's `rate_limit_event` (rejected, resetsAt) and Codex's usage-limit failure pause the
  account (quota) until the reset; sign-in errors mark it for reconnect.
- R7 Measured memory and start time per app shown on its page and in `list_model_accounts`.
- R8 Docs: models.md *Agent apps* (connect, measured numbers, terms in plain words with sources), small-servers.md.
