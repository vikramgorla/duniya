# Contract: GitHub Repository Configuration

## Secrets (required)

| Name | Used for |
|---|---|
| `OCI_TENANCY_OCID`, `OCI_USER_OCID`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY`, `OCI_REGION` | OCI API key auth (`~/.oci/config`) for provider, backend and CLI |
| `ADMIN_PASSWORD` | initial panel password |

## Secrets (optional)

| Name | Default behaviour when absent |
|---|---|
| `CF_TUNNEL_TOKEN` | no tunnel; panel only via SSH port-forward |
| `OCI_COMPARTMENT_OCID` | tenancy root compartment |
| `SSH_PUBLIC_KEY` | no SSH key on the VM |
| `GIT_CLONE_TOKEN` | repo must be public |

## Variables (optional)

| Name | Default |
|---|---|
| `SHAPE` | `VM.Standard.E2.1.Micro` |
| `SSH_INGRESS_CIDR` | none (no inbound SSH) |
| `STATE_BUCKET` | `whatsapp-agent-duniya-tfstate` |

## Workflows

- `Infrastructure (OCI)`: `workflow_dispatch` with `action` ∈ {plan, apply, destroy}; push to `main` touching
  `infra/terraform/**` runs `plan` only. Fails fast listing missing required secrets. Apply writes public IP and
  next steps to the run summary.
- `CI`: push to `main` and PRs → `npm ci`, `npm test`, `bash -n` on scripts.
