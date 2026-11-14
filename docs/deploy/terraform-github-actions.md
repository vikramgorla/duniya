# Advanced example: Terraform + GitHub Actions on OCI

The same Terraform as the Deploy button (`infra/oci/`), driven from a GitHub repository with remote state in OCI
Object Storage. Useful if you fork the project and want infrastructure changes reviewed in pull requests.

## 1. OCI API key → repository secrets

OCI console → profile → **My profile → API keys → Add API key → Generate key pair**, download the private key, then
add repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `OCI_TENANCY_OCID`, `OCI_USER_OCID`, `OCI_FINGERPRINT`, `OCI_REGION` | from the key's config preview (home region) |
| `OCI_PRIVATE_KEY` | contents of the `.pem` |
| `ADMIN_PASSWORD` | optional owner password |
| `CF_TUNNEL_TOKEN` | only for `EXPOSURE=tunnel` |
| `OCI_COMPARTMENT_OCID`, `SSH_PUBLIC_KEY`, `GIT_CLONE_TOKEN` | optional |

Variables (optional): `EXPOSURE` (`ip` default, `domain`, `tunnel`, `local`), `DOMAIN`, `SHAPE`, `UPDATE_MODE`,
`SSH_INGRESS_CIDR`, `STATE_BUCKET`.

## 2. Run

**Actions → Infrastructure (OCI, advanced example) → Run workflow**: `plan`, then `apply`. The workflow creates a
private, versioned state bucket on first run. Pushes that change `infra/oci/**` run `plan` automatically; `apply` is
always manual. `destroy` removes everything.
