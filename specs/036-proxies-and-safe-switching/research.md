# Research: 036 (checked 2026-11-15)

## Caddy behaviour (verified locally with Caddy 2.6.2 = Debian 12 / Ubuntu 24.04 package, and 2.10.2)
- `tls { issuer acme; issuer internal { lifetime 2h } }` adapts and validates on 2.6.2; with ACME failing, Caddy served
  a certificate from "Caddy Local Authority" (observed). Renewal at 1/3 remaining lifetime retries issuers in order.
- ACME HTTP challenges are handled by every Caddy server before user routes, including the TLS listener
  (`modules/caddyhttp/server.go`: "guarantee ACME HTTP challenges; handle them separately from any user-defined handlers").
- `http://` catch-all coexists with the automatic HTTP→HTTPS redirects for configured hosts (observed: 308 for the
  configured host, 404/check for others). Directive order requires `handle` blocks (respond sorts before reverse_proxy).
- `https://` catch-all with `tls internal { on_demand }` + global `on_demand_tls { ask }` issues only for hosts the ask
  endpoint allows (observed: allowed host served, other host handshake refused).
- `trusted_proxies_strict` (right-to-left X-Forwarded-For) exists in current Caddy (`TrustedProxiesStrict` in server.go;
  Caddyfile validated on 2.10.2); treated as 2.8+.

## Let's Encrypt and Cloudflare
- Let's Encrypt HTTP-01 follows redirects (≤10, to http/https on 80/443) and does not validate certificates on HTTPS
  redirects: https://letsencrypt.org/docs/challenge-types/ — so "Always Use HTTPS" alone does not break issuance.
- Cloudflare "Full" connects with the visitor's scheme and accepts any certificate; "Full (strict)" needs an unexpired
  publicly trusted or Origin CA certificate matching the hostname:
  https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full/ ,
  https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/

## Published proxy/CDN address lists (all fetched successfully)
| Provider | URL | Format | Client IP header used |
|---|---|---|---|
| Amazon CloudFront | https://ip-ranges.amazonaws.com/ip-ranges.json (`service: CLOUDFRONT`), documented at https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html | JSON, v4+v6 | X-Forwarded-For (strict) |
| Bunny CDN | https://bunnycdn.com/api/system/edgeserverlist and `/IPv6` | JSON arrays of IPs | X-Forwarded-For (strict) |
| Cloudflare | https://www.cloudflare.com/ips-v4 , /ips-v6 | text | CF-Connecting-IP |
| Fastly | https://api.fastly.com/public-ip-list (https://www.fastly.com/documentation/reference/api/utils/public-ip-list/) | JSON | X-Forwarded-For (strict) |
| Gcore | https://api.gcore.com/cdn/public-net-list (https://gcore.com/docs/cdn/getting-started/configure-an-origin/add-cdn-servers-to-the-origin-acl-whitelist) | JSON networks | X-Forwarded-For (strict) |

## Not verified live
- End-to-end issuance through real proxies (Cloudflare/Fastly/…) and the exact Caddy log wording of WAF-blocked
  challenges (the classifier matches `acme-challenge|unauthorized|403|Invalid response`).
