# Feature Specification: Free-Tier Deployment from GitHub

**Feature Branch**: `003-oci-deployment`

**Created**: 2026-11-14

**Status**: Implemented; superseded in part by [008](../008-install-and-exposure/spec.md) (one installer, optional Cloudflare, OCI as an example)

**Input**: User description: "Set up everything in OCI; code must be on GitHub; infrastructure as code from
GitHub — I can create an API key. Can it run on an Oracle always-free VM? Can it be VM.Standard.E2.1.Micro?
Reach the admin panel through a Cloudflare Tunnel."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create the server from GitHub (Priority: P1)

The operator adds their Oracle Cloud API key and a few other values as GitHub repository secrets, then runs
a workflow. The workflow shows what it will create, and on approval creates the network and a free virtual
machine that installs and starts the platform by itself.

**Why this priority**: it is the only way the platform gets a home; no hand-built servers.

**Independent Test**: in an empty Oracle tenancy, run the workflow with plan, then apply; within 15
minutes the service is running and the panel is reachable.

**Acceptance Scenarios**:

1. **Given** the required secrets, **When** the workflow runs with "plan", **Then** it lists the network and
   one VM to create and changes nothing.
2. **Given** a reviewed plan, **When** the workflow runs with "apply", **Then** the VM is created and the
   summary shows its address and next steps.
3. **Given** a required secret is missing, **When** the workflow runs, **Then** it stops immediately and
   names the missing secrets.
4. **Given** the workflow ran before, **When** it runs again with no changes, **Then** nothing is recreated.

---

### User Story 2 - Reach the panel securely without open ports (Priority: P1)

The panel is available at a hostname on the operator's Cloudflare domain. The VM accepts no inbound
connections; SSH is closed unless the operator explicitly allows one address.

**Why this priority**: the panel controls the bots and holds secrets.

**Independent Test**: check the VM's firewall has no inbound rules (except path-MTU ICMP) and the panel
opens through the tunnel hostname.

**Acceptance Scenarios**:

1. **Given** a tunnel token, **When** the VM finishes installing, **Then** the panel is reachable at the
   tunnel hostname and nowhere else.
2. **Given** no tunnel token, **When** the VM finishes installing, **Then** the panel is reachable only through
   an SSH port-forward (if SSH was allowed).

---

### User Story 3 - Run reliably on the smallest free machine (Priority: P2)

The platform runs on a 1 GB x86 free VM (or an Arm free VM if available), survives reboots and crashes,
keeps its data across code updates, and keeps nightly backups.

**Why this priority**: zero cost is a requirement; reliability keeps the event bot available.

**Independent Test**: reboot the VM and kill the process; the service comes back with WhatsApp still linked.

**Acceptance Scenarios**:

1. **Given** the service is running, **When** it crashes or the VM reboots, **Then** it restarts by itself
   and stays linked to WhatsApp.
2. **Given** a night passes, **When** the operator checks backups, **Then** a dated backup of all data exists
   and only the last 7 are kept locally.
3. **Given** the operator presses Update in the panel, **Then** code updates in place without touching the
   infrastructure.

### Edge Cases

- The free Arm shape is out of capacity: the operator can stay on (or switch back to) the 1 GB x86 shape.
- The 1 GB shape is offered in only one availability domain: placement picks a domain that offers it.
- The admin password contains quotes or `$`: it still works.
- The repository is private: the VM can still clone it with a read-only token.
- Oracle reclaims an idle free VM: the operator can re-run apply and restore the latest backup.
- A newer OS image is published: re-running apply does not rebuild the VM.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All infrastructure (network, firewall, VM, bootstrap) MUST be declared in the repository and
  created by a GitHub Actions workflow with plan, apply and destroy actions.
- **FR-002**: The workflow MUST authenticate to Oracle Cloud with an API key stored as repository secrets and
  MUST validate that required secrets exist before doing anything.
- **FR-003**: Infrastructure state MUST be stored remotely in a private, versioned Oracle Object Storage
  bucket that the workflow creates if missing.
- **FR-004**: The default VM MUST be an Always Free `VM.Standard.E2.1.Micro`; the Arm Always Free shape MUST
  be selectable by a repository variable.
- **FR-005**: The VM's firewall MUST allow no inbound traffic by default; SSH from one CIDR is opt-in.
- **FR-006**: On first boot the VM MUST install everything unattended: swap, runtime, the platform as a
  hardened service under an unprivileged user, the Cloudflare tunnel connector (if a token is given), and
  nightly backups.
- **FR-007**: Bootstrap values (repository, branch, optional clone token, admin password, tunnel token) MUST
  reach the VM safely regardless of special characters.
- **FR-008**: Re-running apply MUST NOT rebuild the VM because of new OS images or changed bootstrap values.
- **FR-009**: Code updates MUST happen in place from the panel (feature 002) and keep all live data.
- **FR-010**: Pushes that change infrastructure MUST run a plan automatically; apply MUST be manual.
- **FR-011**: A CI workflow MUST run the automated tests and syntax-check scripts on every push and pull request.
- **FR-012**: Setup documentation MUST walk an operator from zero to a working bot.

### Key Entities

- **Repository secrets**: Oracle API key fields, region, admin password, tunnel token, optional clone token,
  SSH key, compartment.
- **Infrastructure state**: the record of created cloud resources.
- **Server**: the VM, its service, data directory and backups.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From secrets added to panel reachable in under 15 minutes of wall time.
- **SC-002**: Monthly hosting cost of 0 within Always Free limits.
- **SC-003**: The service uses under 400 MB of memory in normal operation on the 1 GB VM.
- **SC-004**: 0 inbound ports open on the VM in the default configuration.
- **SC-005**: Recovery from a lost VM (re-apply + restore backup + re-link) in under 30 minutes.

## Assumptions

- The operator has an Oracle Cloud account with an Always Free home region and a user able to create an API key.
- The operator's domain is on Cloudflare and they create the tunnel and its public hostname in the Cloudflare
  dashboard (the token is then a secret).
- Upgrading the tenancy to Pay-As-You-Go is recommended to avoid idle reclamation; it is the operator's choice.
- Ubuntu 24.04 is the base image.
