# Plan: 036 proxies, safe switching, neutral access

## Constitution Check
- I–V unaffected. VI: still only 80/443 or outbound tunnels; panel never on plain HTTP (constitution 1.3.2 states it).
- Security: the app cannot inject Caddy config (all values re-generated from parsed data by the root-owned
  webconfig.mjs); on-demand TLS gated by a local `ask`; client IP from Caddy only; trial with automatic undo.
- VII: spec + tests with fakes (fake DNS, fake routes for the reachability check, fake HTTPS "Flexible" proxy, stub
  helper tools). VIII: one status line per address, progress survives reloads, confirmations state the consequence.

## Design
- `deploy/ops/webconfig.mjs`: PROVIDERS (alphabetical), new doc model, renderer (see spec FR-001).
- `deploy/ops/duniya-ops`: multi-address HTTPS check, `--noproxy`, `-k` only for proxied addresses.
- `src/core/webaccess.js`: reachability + Flexible detection, `acmeProblem()` (Caddy journal → reason + fix), certInfo
  `temporary`, switch state machine (`switch.applying` resolved by `syncFromHelper`), trial (`trial.until` set when the
  helper reports done; `trialTick` every 10 s restores `trial.revert`), range sources per provider.
- `install.sh`: the Caddyfile is always rendered by webconfig.mjs.
- Panel: `webAccessCard` rewritten (addresses table with HTTPS state, switch steps, trial countdown, provider select).

## Complexity Tracking
- On-demand internal TLS on a catch-all: needed so a proxy in "Full" mode can reach the check before the domain is
  configured; restricted by `ask`.
