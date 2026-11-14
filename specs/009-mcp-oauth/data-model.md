# Data Model

`mcp_oauth` (tenant_id, bot_id, server, role, url, data_enc, status, connected_by, connected_at, updated_at;
PK tenant_id+bot_id+server+role). `data_enc` = encrypted JSON `{ client, redirectUri, tokens, tokensAt }`.
`status`: `connected` | `reconnect`. A row whose `url` differs from the bot's current service URL is ignored.

Bot config: `mcpServers.<key>.auth`: `oauth` | `token` | `none` (default `token` when a token reference is set,
otherwise `none`).
