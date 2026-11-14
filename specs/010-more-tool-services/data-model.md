# Data Model

`mcpServers.<key>`: remote `{ type:'remote', url, auth, tokens, headers, oauthClient? }`;
local `{ type:'local', package, args[], env{}, allowScripts }`. Install record `DATA_DIR/mcp-local/<hash>/duniya-install.json`
`{ spec, name, version, bin, dir, at }` (not in backups; reinstalled on first use).
