# Contracts: OAuth endpoints, MCP endpoint and panel API

`BASE` = `PUBLIC_URL` or `scheme://Host`. CORS `*` (no credentials) on all endpoints below except `/oauth/authorize`.

## GET /.well-known/oauth-protected-resource[/mcp]
`{ resource: BASE/mcp, authorization_servers: [BASE], scopes_supported: ["duniya"], bearer_methods_supported: ["header"], resource_name }`

## GET /.well-known/oauth-authorization-server
`{ issuer: BASE, authorization_endpoint: BASE/oauth/authorize, token_endpoint: BASE/oauth/token, registration_endpoint: BASE/oauth/register, revocation_endpoint: BASE/oauth/revoke, response_types_supported: ["code"], grant_types_supported: ["authorization_code","refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["duniya"], authorization_response_iss_parameter_supported: true }`

## POST /oauth/register (JSON)
In: `redirect_uris` (1–10, https or loopback http), `client_name?`, `client_uri?`, `grant_types?`, `response_types?`.
201: `{ client_id, client_id_issued_at, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method: "none", scope }`.
400 `invalid_redirect_uri` / `invalid_client_metadata`; 429 when over 20/min per IP.

## GET /oauth/authorize
Query: `client_id, redirect_uri, response_type=code, code_challenge, code_challenge_method=S256, state, scope?, resource?`.
Unknown client or unregistered redirect → 400 HTML error (no redirect). Other errors → 302 to redirect_uri with
`error` (`unsupported_response_type`, `invalid_request`, `invalid_target`), `state`, `iss`.
With a session: consent HTML. Without: sign-in HTML (after one same-origin reload).

## POST /oauth/authorize (form)
Same params plus `action=login` (`username`, `password`) → consent HTML + session cookie, or 401 HTML;
`action=approve` (`csrf`, session required) → 302 `redirect_uri?code&state&iss`; `action=deny` → 302 `error=access_denied`.

## POST /oauth/token (form or JSON)
- `grant_type=authorization_code, code, redirect_uri, code_verifier, client_id, resource?`
- `grant_type=refresh_token, refresh_token, client_id, resource?`
200: `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope }`.
Errors: 400 `invalid_grant` / `invalid_target` / `unsupported_grant_type`, 401 `invalid_client`.

## POST /oauth/revoke (form)
`token, client_id?` → 200 `{}` always. A refresh token revokes its family.

## POST /mcp (Streamable HTTP, JSON-RPC)
`Authorization: Bearer <access token>`. 401 + `WWW-Authenticate: Bearer resource_metadata="BASE/.well-known/oauth-protected-resource/mcp"[, error="invalid_token"]`.
429 over 60 requests/min per token. GET/DELETE → 405 (after auth).

Tools (minimum role = highest role of the panel routes used; ⚠ = needs `confirm_action`):
get_overview, list_activity, list_bots, get_bot, list_templates, create_bot, update_bot, set_bot_enabled,
duplicate_bot, export_bot, delete_bot ⚠, run_schedule_now, test_bot, list_chats, assign_chat, set_chat_settings,
get_chat_memory, rebuild_chat_summary, erase_chat_memory ⚠, list_models, set_default_models, list_secrets,
set_secret ⚠, remove_secret ⚠, list_pending_confirmations, cancel_pending_confirmation, set_bots_paused,
get_logging_settings, set_logging_settings, get_update_status, check_for_updates, apply_update ⚠,
get_server_metrics, list_os_updates, get_maintenance_status, run_maintenance ⚠, restart_app ⚠, get_backup_status,
list_backups, run_backup, restore_backup ⚠, list_users, add_user, update_user, remove_user ⚠,
list_whatsapp_numbers, add_whatsapp_number, remove_whatsapp_number ⚠, confirm_action (admin+).

Risky result: text preview + `structuredContent: { status: "needs_confirmation", preview, confirm_code, expires_in_seconds: 600 }`.

## Panel API
- `GET /api/assistants` (viewer+): `{ mcpUrl, https, publicUrlSet, abilities, grants: [{ userId, username, role, clientId, clientName, redirectHost, connectedAt, lastUsedAt }], you }` — owners get everyone's grants, others their own.
- `DELETE /api/assistants/:userId/:clientId` (viewer+; others' grants owner only) → `{ ok }`, logs `config`.
- `GET /api/activity?chat=` filter added.
