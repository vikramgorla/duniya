# Research: Install, Exposure, Updates

## HTTPS without a domain

- **Decision**: `<ip-with-dashes>.sslip.io` resolves to the IP; Caddy obtains a Let's Encrypt certificate for it.
- **Alternatives**: self-signed (browser warnings), Let's Encrypt IP certificates (short-lived, newer ACME profile; not
  universally supported by Caddy configs yet).

## OCI host firewall

- OCI platform Ubuntu images ship iptables rules in `/etc/iptables/rules.v4` that REJECT inbound except SSH. The
  installer inserts ACCEPT rules for 80/443 before the REJECT and saves with `netfilter-persistent`. The VCN security
  list must also allow 80/443 (stack does it for direct mode).

## Deploy to Oracle Cloud button

- `https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=<zip>`; zip from
  `https://github.com/<owner>/<repo>/releases/latest/download/oci-stack.zip` (public repo).
- Resource Manager provides `tenancy_ocid`, `region`, `compartment_ocid` variables; `schema.yaml` defines the form.

## Updates

- **Stable channel**: newest `vX.Y.Z` tag from `git ls-remote --tags origin`; checkout detached at the tag.
- **Main channel**: compare `HEAD` with `origin/main`; fast-forward.
- `npm ci` only when `package-lock.json` changed; on failure, checkout back to the previous commit.
- **Docker**: the app can't update its own image; the panel shows the pull command (Watchtower optional in compose).
