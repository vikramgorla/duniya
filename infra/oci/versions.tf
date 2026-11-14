# Used as-is by OCI Resource Manager ("Deploy to Oracle Cloud") and by the GitHub Actions workflow
# (which adds a backend.tf for remote state before `terraform init`).
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0"
    }
  }
}

provider "oci" {
  region = var.region
}
