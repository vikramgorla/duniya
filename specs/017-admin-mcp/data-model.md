# Data Model: Admin MCP Server

All tables carry `tenant_id` (constitution II).

## admin_oauth_clients
| column | notes |
| --- | --- |
| client_id | `duniya-<hex>`, PK |
| name, client_uri | from registration, sanitised |
| redirect_uris | JSON array (https or loopback http) |
| created_at, last_used_at | ms; at most 300 rows: oldest clients without a grant are pruned |

## admin_oauth_grants
PK (tenant_id, user_id, client_id); created_at, last_used_at (updated at most once a minute). Removing a grant deletes
its tokens. Deleting a user deletes their grants and tokens (`onUserDeleted`).

## admin_oauth_tokens
| column | notes |
| --- | --- |
| token_hash | sha256 of the opaque token, PK |
| kind | `access` (1 h) or `refresh` (30 d) |
| family | one per approval; rotation keeps it; reuse deletes it |
| user_id, client_id, resource, scope | resource = `<base>/mcp` |
| expires_at, used_at, created_at | `used_at` set when a refresh token is rotated |

Expired rows are pruned at start and occasionally on issue.

## In memory
- Authorization codes: sha256(code) → client, user, redirect URI, PKCE challenge, resource; 5 min; single-use.
- Confirm codes: 8-character code → user, client, tool, args, args hash, preview; 10 min; single-use.
- Rate-limit windows: per token hash (60/min), per IP for registration (20/min) and consent sign-in (5/min).
