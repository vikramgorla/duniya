# Domains, proxies, tunnels and access

How the panel is reached is chosen at install time (`--domain`, `--ip-https`, `--cloudflare-token`,
`--tailscale-authkey`, `--local-only`, see [Install](install.md)) and can be changed later in the panel.

*Settings → Web address & access* (owner). Applied by the root maintenance helper with strict validation (re-run the
installer once on older servers). If HTTPS does not come up within 4 minutes, the previous settings come back by
themselves; the check always runs on the server itself (127.0.0.1 with the domain as SNI), never through public DNS.

**Does the domain lead here?** **Check** looks at DNS only as a hint (*points straight here*, *behind a proxy/CDN
(looks like …)*, *other*, *missing*). What decides is a one-time proof: the panel serves a random token at
`/.well-known/duniya-check/<token>` and fetches it through the public domain. So a domain behind any proxy or CDN works,
whatever its DNS says.

**HTTPS is automatic in every mode:**

| The domain… | Certificate on this server | Proxy SSL/TLS mode |
|---|---|---|
| points straight here (no proxy) | Let's Encrypt (HTTP-01 / TLS-ALPN) | – |
| goes through a proxy/CDN (any provider) | Let's Encrypt through the proxy (HTTP-01); until it is issued, a temporary certificate from the web server's own CA (2-hour certificates, Let's Encrypt is retried about every 80 minutes) | **Full** at once, **Full (strict)** once the card says the real certificate is issued |

The panel is served over HTTPS only; port 80 only answers certificate challenges, the reachability token and
redirects. A proxy that talks to this server **without encryption** is never supported: it is detected (the token
arrives over plain HTTP although the visitor used HTTPS, or a redirect loop) and shown as a blocking error. If Let's
Encrypt keeps failing behind a proxy, the card shows the web server's reason and the fix (typically a firewall/bot rule
blocking `/.well-known/acme-challenge/`: add a rule that skips security checks for that path, and turn off
"under attack" style challenges for it). Let's Encrypt follows redirects to HTTPS, so a proxy's "always use HTTPS"
setting is fine.

**Changing the address is two-step and never cuts you off:** *Add this domain* serves it **next to** the current
address. Open the panel at the new address and click **Confirm — new address works** (accepted only from a request
that really arrived through the new domain); it becomes the main address while the old one keeps working. When nobody
needs the old address any more, **Turn off** it (it then only forwards). Nothing switches off on a timer.

**Who can open the panel:** everyone; **only a proxy/CDN** — its published address list, refreshed daily (Amazon
CloudFront, Bunny CDN, Cloudflare, Fastly, Gcore) or your own proxy's ranges — so nobody can bypass it via the server's
IP; and/or **your own list** of IPs/ranges (your current IP is kept by default). The visitor's real address is read
from the provider's header behind trusted proxies only (Cloudflare: `CF-Connecting-IP`; others: `X-Forwarded-For`
read right to left, which needs Caddy 2.8+ when combined with your own list). Stricter rules are a **trial**: confirm
them from the panel (through the new rules) within 10 minutes, or the previous rules come back by themselves; a
warning comes first if the rules would block the request you are making. Locked out anyway: `sudo duniya open-access`.

**No open ports at all:** install with a tunnel instead — Cloudflare Tunnel (`--cloudflare-token`) or Tailscale
(`--tailscale-authkey`; Tailscale Funnel can make it public). Other tunnels (frp, ngrok, Pangolin, zrok, …) work with
`--local-only` pointed at `http://127.0.0.1:8080`.

---
[Docs index](README.md)
