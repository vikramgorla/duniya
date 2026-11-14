# Feature Specification: One-Command Install, Exposure Options and Auto-Update

**Feature Branch**: `008-install-and-exposure`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "OCI docs should read as an example of deploying on the OCI free tier. Cloudflare should be
optional; the admin panel can be exposed directly from the server if required. Give a one-click install script for OCI…
Also: curl | bash on any VM, Deploy to Oracle Cloud button, Docker/Compose, keep GitHub Actions + Terraform, and an
auto-update option." The repository will be public when productized.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install on any Linux server with one command (Priority: P1)

An operator runs one command on a fresh Ubuntu/Debian VM (Oracle, Hetzner, a Raspberry Pi…). The installer asks how
the panel should be reached — directly over HTTPS on a domain, directly over HTTPS on the server's IP (automatic
hostname), through a Cloudflare Tunnel, or only locally — sets everything up, and prints the panel address and the
one-time setup code.

**Why this priority**: the main way people will install the product.

**Independent Test**: run the installer non-interactively on a fresh VM with `--domain`, open the URL, see the setup screen.

**Acceptance Scenarios**:

1. **Given** a fresh VM, **When** the operator runs the installer with a domain pointing at the server, **Then** the panel
   is served over HTTPS with a valid certificate and the setup code is printed.
2. **Given** no domain, **When** "HTTPS on the IP" is chosen, **Then** the panel gets an automatic hostname with a valid
   certificate.
3. **Given** a tunnel token, **When** "Cloudflare Tunnel" is chosen, **Then** no ports are opened and the panel works via
   the tunnel hostname.
4. **Given** the installer is run again, **Then** it updates in place without losing data.

---

### User Story 2 - Docker / Compose (Priority: P2)

An operator who prefers containers runs the app with Docker Compose, optionally with an HTTPS proxy or a Cloudflare
tunnel profile, and keeps data in a volume.

**Independent Test**: `docker compose up -d` and open the panel.

**Acceptance Scenarios**:

1. **Given** Docker, **When** compose starts, **Then** the panel is reachable and data persists across container recreation.

---

### User Story 3 - Deploy to Oracle Cloud button (Priority: P2)

From the README, the operator clicks "Deploy to Oracle Cloud", fills a short form (password, exposure, domain or tunnel
token, shape) and applies; the VM is created on the Always Free tier and installs itself with the same installer.

**Independent Test**: create a stack from the release zip; apply; the panel is reachable.

**Acceptance Scenarios**:

1. **Given** the button, **When** clicked, **Then** OCI Resource Manager opens with the stack and a form.
2. **Given** "direct HTTPS" exposure, **Then** the security list opens 80/443 only; otherwise no inbound ports.

---

### User Story 4 - Keep up to date (Priority: P2)

The owner chooses update mode: off, notify (show "update available"), or automatic (install at a quiet time), and a
channel: stable releases or the main branch. Updates keep all data.

**Independent Test**: publish a newer release; in notify mode the panel shows it; in auto mode the server updates at the set time.

**Acceptance Scenarios**:

1. **Given** notify mode and a newer release, **Then** the panel shows the version and an Update button.
2. **Given** auto mode, **When** the update time comes and a newer version exists, **Then** it installs and restarts; a failure
   keeps the old version and is reported.

---

### User Story 5 - Documentation by example (Priority: P3)

The README presents the product and the generic install; OCI Always Free, Cloudflare Tunnel and Terraform/GitHub
Actions are separate example guides.

### Edge Cases

- Non-Debian distro: installer stops with a clear message pointing to Docker.
- OCI images ship host firewall rules that block 80/443: installer opens them.
- Ports 80/443 already in use: installer reports it.
- Behind a proxy: login rate limits and secure cookies use the real client address and scheme.
- Docker installs: in-panel update is replaced by instructions (pull the new image).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A single `install.sh` MUST install or update the app on Ubuntu/Debian (x86_64 and arm64) idempotently,
  interactively or with flags (`--domain`, `--ip-https`, `--cloudflare-token`, `--local-only`, `--admin-password`,
  `--branch`, `--repo`, `--update-mode`, `--yes`).
- **FR-002**: Direct exposure MUST use automatic HTTPS (Caddy + Let's Encrypt) with the domain or an IP-derived hostname
  (sslip.io), open only 80/443 on the host firewall, and keep the app bound to localhost.
- **FR-003**: Cloudflare Tunnel MUST be optional and need no inbound ports.
- **FR-004**: The installer MUST print the panel URL and the setup code (or note that ADMIN_PASSWORD was used).
- **FR-005**: The app MUST honour forwarded client address and scheme from the local proxy when configured (`TRUST_PROXY`).
- **FR-006**: Docker image and Compose file MUST be provided with optional `https` (Caddy) and `tunnel` (cloudflared) profiles.
- **FR-007**: An OCI Resource Manager stack MUST be published as a release asset with a Deploy button; it MUST use the same
  installer and open 80/443 only for direct exposure.
- **FR-008**: The Terraform + GitHub Actions path MUST remain as an advanced example using the same stack code.
- **FR-009**: Updates MUST support modes off/notify/auto and channels stable (release tags) / main, from the panel (owner).
- **FR-010**: Docs MUST present OCI Always Free, Cloudflare Tunnel and Terraform as examples, not requirements.

### Key Entities

- **Install options**: exposure mode, domain, tunnel token, admin password, repo, branch, update mode.
- **Update settings**: mode, channel, time; **Update status**: current version, latest available, last check, last result.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh VM to the setup screen in under 10 minutes with one command.
- **SC-002**: 0 inbound ports besides 80/443 (direct) or none (tunnel/local) after install.
- **SC-003**: Updates never lose data (tested by update path tests).

## Assumptions

- sslip.io is used for IP-based hostnames (public wildcard DNS service); operators can use their own domain instead.
- Release tags follow `vMAJOR.MINOR.PATCH`.
