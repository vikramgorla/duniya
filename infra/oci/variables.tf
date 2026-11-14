variable "tenancy_ocid" {
  type        = string
  description = "Tenancy OCID"
}

variable "region" {
  type        = string
  description = "Home region, e.g. eu-zurich-1 (Always Free resources only exist in the home region)"
}

variable "compartment_ocid" {
  type        = string
  default     = ""
  description = "Compartment for all resources. Empty = tenancy root."
}

variable "name" {
  type    = string
  default = "whatsapp-agent-duniya"
}

variable "shape" {
  type        = string
  default     = "VM.Standard.E2.1.Micro"
  description = "VM.Standard.E2.1.Micro (x86, 1 GB) or VM.Standard.A1.Flex (Arm)"
}

variable "a1_ocpus" {
  type    = number
  default = 1
}

variable "a1_memory_gb" {
  type    = number
  default = 4
}

variable "boot_volume_gb" {
  type    = number
  default = 50
}

variable "ssh_public_key" {
  type        = string
  default     = ""
  description = "Optional SSH public key for the ubuntu user"
}

variable "ssh_ingress_cidr" {
  type        = string
  default     = ""
  description = "Optional CIDR allowed to SSH (e.g. your IP/32). Empty = no inbound ports at all."
}

variable "repo_url" {
  type        = string
  description = "HTTPS URL of the GitHub repo to deploy"
}

variable "branch" {
  type    = string
  default = "main"
}

variable "git_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Read-only token for cloning a private repo (fine-grained PAT, contents:read). Empty for public repos."
}

variable "admin_password" {
  type        = string
  sensitive   = true
  description = "Initial admin panel password (change it in the panel later)"
}

variable "cf_tunnel_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Cloudflare Tunnel token. Empty = panel only reachable through an SSH tunnel."
}
