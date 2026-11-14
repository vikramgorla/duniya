# Requirements checklist

- [X] Metadata at both protected-resource paths and the authorization-server path
- [X] Dynamic registration: public clients only, https or loopback redirect URIs
- [X] PKCE S256 only; exact redirect match; single-use codes
- [X] `resource` bound into codes and tokens, checked on each call
- [X] Tokens stored hashed; refresh rotation; reuse revokes the family; revocation endpoint
- [X] 401 with `WWW-Authenticate: Bearer resource_metadata=…`
- [X] Calls act as the approving user with the panel's role gates; viewers read-only; owner-only stays owner-only
- [X] Disabled/deleted users and revoked grants stop working immediately
- [X] Risky actions need `confirm_action` (single-use, 10 min, bound to user + assistant + args)
- [X] Secret values never returned or logged
- [X] `mcp.call` logged with user + assistant; grants/revokes logged as config
- [X] Rate limit 60/min per token
- [X] Consent page and Settings card follow DESIGN.md; plain language
- [X] No new dependencies; existing tests pass
