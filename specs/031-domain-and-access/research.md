# Research: Caddy configuration for domain + IP allow-list

- **Caddy versions in the wild**: Ubuntu 24.04 and Debian 12 ship Caddy **2.6.2**; the installer falls back to the
  GitHub release (2.10.x in 2026-11) only when the distro package is missing. Verified with the real binaries:
  2.6.2 rejects `servers { trusted_proxies … }` ("unrecognized servers option"); 2.10.2 accepts all generated files.
- **`remote_ip`** (all versions) matches the TCP peer — right for "Only Cloudflare" (the peer is Cloudflare's edge)
  and for own lists without a proxy.
- **`client_ip`** + global `servers { trusted_proxies static <ranges>; client_ip_headers CF-Connecting-IP X-Forwarded-For }`
  (Caddy ≥ 2.7) resolves the visitor address behind trusted proxies — needed for "Only Cloudflare + own list".
  On 2.6 the old `remote_ip forwarded` reads the first X-Forwarded-For entry, which Cloudflare does not overwrite
  (spoofable), so that combination is refused instead.
- **Health check**: `curl --resolve host:443:127.0.0.1 https://host/healthz` proves a valid certificate for the host
  without depending on outside DNS caches; loopback is always allowed by the generated matchers.
- **ACME**: HTTP-01 is answered on port 80 by Caddy before site routes, so the allow-list (on 443 routes) does not
  block issuance. Behind an orange-cloud record with "Always use HTTPS", issuance can fail → the card advises "DNS only"
  until the certificate exists, then SSL mode Full (strict).
- **Cloudflare ranges**: https://www.cloudflare.com/ips-v4 and /ips-v6 (plain text, one CIDR per line). Built-in copy
  in webconfig.mjs as a fallback.
- **TRUST_PROXY**: `cloudflare` (new value, treated as on) when Only Cloudflare is applied; `clientIp()` already prefers
  `CF-Connecting-IP`, which is trustworthy once the origin only accepts Cloudflare.
