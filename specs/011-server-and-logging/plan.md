# Plan
`src/core/system.js` (metrics, history, OS update simulation, logs, ops request/status); `deploy/ops/*` (helper,
path + service units, installed by install.sh with the journal group); `src/core/events.js` (categories, levels,
per-chat override, retention); `src/core/chat-prefs.js` (per-chat logging); panel Server tab and Settings card.
Constitution V amended (operators may reduce logging; errors/confirmations/config/channel always kept).
Security: the app never gets root; the helper reads ≤32 bytes, keeps only [a-z-], matches an allowlist, never echoes
unknown content; status/log written to a root-owned dir (no symlink games in the app-writable dir).
