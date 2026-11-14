# Research

- MCP SDK 1.32 `StdioClientTransport({command,args,env,cwd,stderr})`; default env adds only HOME/PATH/SHELL/TERM/USER.
- `npm install <spec> --ignore-scripts --omit=dev` in an isolated prefix; GitHub specs (`github:owner/repo#ref`) need
  git and often install scripts (build on install).
- npm needs proxy/CA env (HTTPS_PROXY, NODE_EXTRA_CA_CERTS, npm_config_*) behind proxies — passed through; verified a
  real install of `@modelcontextprotocol/server-sequential-thinking` (6 s) and tool listing.
- SDK `auth()` skips registration when `saveClientInformation` is absent and client info is provided; token endpoint
  auth method chosen from the server's supported methods.
