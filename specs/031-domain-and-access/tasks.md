# Tasks: Custom domain and IP allow-list

- [X] T001 deploy/ops/webconfig.mjs: normalizeDomain, parseCidr, ipInRanges, validateWebConfig, renderCaddyfile, envFor, CLI
- [X] T002 duniya-ops `apply-web-config` (copy, validate, render, caddy validate, backup, reload, HTTPS wait, rollback, env updates, status)
- [X] T003 install.sh: root copy of webconfig.mjs, DUNIYA_EXPOSURE, TRUST_PROXY=cloudflare, keep rules on re-run
- [X] T004 src/core/webaccess.js (DNS check, cert probe, request + lock-out checks, Cloudflare refresh daily, sync, openAccess)
- [X] T005 system.js action + request files; config.js accepts TRUST_PROXY=cloudflare
- [X] T006 API routes (owner) and error details (needsConfirm, warnings, check)
- [X] T007 Settings card "Web address & access" (domain + DNS record, access modes, preview, progress, last result, recovery hint)
- [X] T008 CLI `open-access`
- [X] T009 Tests: test/web-access.test.js; Caddyfiles checked with Caddy 2.6.2 and 2.10.2
- [ ] T010 Live test on a server (real certificate, Cloudflare proxy, rollback) and the card on phone/iPad light/dark
