# Quickstart: 019

## Sign in with Google

1. Open the panel through its https name (e.g. `https://1-2-3-4.sslip.io` from `install.sh --ip-https`, or your domain).
2. Settings → Sign in with Google: follow steps 1–4 (Copy the origin and redirect URI into Google), Save and test.
3. Settings → Your Google account → Link my Google account (checks it end to end).
4. Settings → Users → Invite someone with Google: email + role → Email / Copy message.

After moving to a new hostname, add the new origin and redirect URI to the same Google client.

## GitHub backups

Backups → GitHub → Create GitHub app → (GitHub) Create GitHub App → Create private repository → Install the app
(Only select repositories) → the panel shows "✓ Backups go to you/duniya-backup".

## Move to a new server

1. Old server: Backups → Back up now & download (keep the passphrase handy).
2. Deploy the new server (installer or OCI stack). Open the panel.
3. Welcome screen → Restore a backup → setup code + file + passphrase → Upload and restore.
4. Sign in with your usual account; turn the old server off.

## Tests

`npm test` (fakes only). Feature tests: `node --test test/signin-backups.test.js`.
