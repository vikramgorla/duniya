# Data Model: Backups

## Setting `backup`

```jsonc
{
  "enabled": false,
  "schedule": "daily",          // hourly | 6h | daily | weekly
  "at": "03:30",                // for daily/weekly (server timezone setting)
  "weekday": "sun",             // weekly
  "keep": 14,                   // 1–365
  "includeWhatsApp": true,
  "github": { "enabled": false, "repo": "owner/duniya-backups", "branch": "main", "path": "backups" },
  "s3": { "enabled": false, "endpoint": "https://<acct>.r2.cloudflarestorage.com", "region": "auto", "bucket": "x", "prefix": "duniya/" },
  "githubClientId": ""          // overrides GITHUB_OAUTH_CLIENT_ID
}
```

Secrets: `BACKUP_PASSPHRASE` (≥ 12 chars), `GITHUB_BACKUP_TOKEN`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
State in kv: `backup:last` (`{at, file, size, results:{local,github,s3}}`).

## Bundle (inside encryption, gzip JSON)

`{ format: "duniya-backup", version: 1, createdAt, app: { version }, files: { "duniya.sqlite": b64, "master.key": b64,
"whatsapp-auth/<name>": b64 … } }`

File name: `duniya-YYYYMMDD-HHMMSS.dbk`.
