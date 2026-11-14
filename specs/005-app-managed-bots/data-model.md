# Data Model: Bots, Users and Secrets Managed in the App

| Table | Columns | Notes |
|---|---|---|
| tenants | id PK, name, created_at | row `default` |
| users | id PK, tenant_id, username UNIQUE per tenant, email, role (owner/admin/viewer), pw_salt, pw_hash, created_at, disabled | ≥ 1 owner per tenant |
| sessions | token_hash PK, user_id, expires_at, created_at, ip | 7-day expiry |
| bots | id PK (slug), tenant_id, name, enabled, config JSON, created_at, updated_at, created_by | config validated by `schema.js` |
| secrets | tenant_id, name, value_enc, updated_at; PK(tenant_id, name) | AES-256-GCM |
| settings | tenant_id, key, value JSON; PK(tenant_id, key) | paused, defaultDmBot, backup/update settings (007/008) |

## Bot config (JSON)

```jsonc
{
  "name": "Panduga", "description": "", "enabled": true,
  "model": "auto", "maxTokens": 1024, "historySize": 30,
  "prompt": "…instructions…", "triggers": ["!panduga"], "respondToMentions": true,
  "dm": "members", "organizers": ["4179…"], "participants": [], "chats": ["…@g.us"],
  "mcpServers": { "panduga": { "url": "${PANDUGA_MCP_URL}", "tokens": { "organizer": "${PANDUGA_TOKEN_ORGANIZER}", "participant": "${PANDUGA_TOKEN_MEMBER}" } } },
  "tools": { "participant": ["panduga:agenda_list"], "organizer": ["panduga:*"], "deny": [] },
  "confirm": { "preview": "panduga:*_preview", "tool": "panduga:confirm", "idField": "confirm_id", "ttlMinutes": 9 },
  "schedules": [ { "id": "morning", "at": "08:00", "days": "daily", "chats": "all", "prompt": "…", "enabled": false } ],
  "memory": { "enabled": true },
  "plugins": ["example-dice"],
  "timezone": "Europe/Zurich"
}
```

Validation: id `^[a-z0-9][a-z0-9-]{1,40}$`; name 1–80 chars; prompt ≤ 20k; triggers lower-case; phones digits ≥ 6;
`mcpServers` keys `^[a-z][a-z0-9_]{0,30}$`, url must be `https://`, `http://` (or `${SECRET}`); tool rule patterns
`^(local|memory|[a-z][a-z0-9_]*):[\w*?.-]+$`; confirm tool never in allow lists; schedules `HH:MM`, days `daily` or
weekday list; unknown fields dropped with a warning.
