terraform {
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0"
    }
  }

  # Native OCI backend. bucket/namespace/region are passed at `terraform init`
  # (see .github/workflows/infra.yml), credentials come from ~/.oci/config.
  backend "oci" {
    key = "whatsapp-agent-duniya/terraform.tfstate"
  }
}

provider "oci" {
  # Reads ~/.oci/config (profile DEFAULT), written by the GitHub Actions workflow.
  region = var.region
}
