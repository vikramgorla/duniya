variable "tenancy_ocid" {
  type        = string
  description = "Tenancy OCID (filled in automatically by Resource Manager)"
}

variable "region" {
  type        = string
  description = "Home region (Always Free resources only exist in the home region)"
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
  description = "VM.Standard.E2.1.Micro (x86, 1 GB, Always Free) or VM.Standard.A1.Flex (Arm, Always Free up to 2 OCPU/12 GB)"
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

variable "exposure" {
  type        = string
  default     = "ip"
  description = "How the admin panel is reached: ip (https://<ip>.sslip.io), domain, tunnel (Cloudflare), local"
  validation {
    condition     = contains(["ip", "domain", "tunnel", "local"], var.exposure)
    error_message = "exposure must be ip, domain, tunnel or local"
  }
}

variable "domain" {
  type        = string
  default     = ""
  description = "Domain for exposure=domain (point its DNS A record to the instance IP after apply)"
}

variable "cf_tunnel_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Cloudflare Tunnel token for exposure=tunnel"
}

variable "admin_password" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Optional owner password (user 'admin'). Empty = a one-time setup code is shown in the panel log."
}

variable "update_mode" {
  type    = string
  default = "notify"
  validation {
    condition     = contains(["off", "notify", "auto"], var.update_mode)
    error_message = "update_mode must be off, notify or auto"
  }
}

variable "ssh_public_key" {
  type        = string
  default     = ""
  description = "Optional SSH public key for the ubuntu user"
}

variable "ssh_ingress_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "CIDR allowed to SSH (key-only login). Narrow it to your IP/32, or empty = no SSH from the internet."
}

variable "repo_url" {
  type    = string
  default = "https://github.com/vikramgorla/whatsapp-agent-duniya.git"
}

variable "branch" {
  type    = string
  default = "main"
}

variable "git_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Read-only token, only for a private fork"
}
