# Quickstart: Install, Exposure, Updates

## Automated

- `npm test` → `test/updates.test.js`: version comparison, newest stable tag selection, update against a local bare
  git remote (main + tags; failure rolls back), proxy-aware client IP / secure cookie, owner-only routes.
- CI: `bash -n install.sh deploy/*.sh`, `bash install.sh --dry-run --yes --domain example.com` prints the plan,
  `terraform validate` in `infra/oci`.

## Manual

1. Fresh Ubuntu 24.04 VM: `curl -fsSL …/install.sh | sudo bash -s -- --ip-https --yes` → open the printed URL → setup code.
2. Re-run the installer → "updating", data kept.
3. `docker compose --profile https up -d` with `DOMAIN=…` in `.env`.
4. Click "Deploy to Oracle Cloud" on the README (after a release exists).
5. Panel → Server → Updates: notify → "v1.0.1 available" → Update now.
