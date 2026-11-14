locals {
  ip_host   = "${replace(oci_core_instance.app.public_ip, ".", "-")}.sslip.io"
  panel_url = var.exposure == "ip" ? "https://${local.ip_host}" : var.exposure == "domain" ? "https://${var.domain}" : ""
}

# Shown as clickable links / buttons on the Resource Manager job page (see outputs in schema.yaml).
output "panel_url" {
  description = "Admin panel (sign in as 'admin')"
  value       = local.panel_url != "" ? local.panel_url : "n/a (see panel_access)"
}

output "install_progress_url" {
  description = "Live install progress while the server sets itself up (10-15 min on the free VM)"
  value       = local.panel_url != "" ? "http://${oci_core_instance.app.public_ip}/" : "n/a"
}

output "panel_access" {
  value = (var.exposure == "ip" ? "Open the install progress link; when it finishes, open the panel link and sign in as 'admin'."
    : var.exposure == "domain" ? "Point the DNS A record of ${var.domain} to ${oci_core_instance.app.public_ip}, then open the panel link."
    : var.exposure == "tunnel" ? "Your Cloudflare Tunnel hostname (public hostname → http://localhost:8080)"
  : "ssh -L 8080:127.0.0.1:8080 ubuntu@${oci_core_instance.app.public_ip} → http://localhost:8080")
}

output "public_ip" {
  value = oci_core_instance.app.public_ip
}

output "instance_id" {
  value = oci_core_instance.app.id
}

output "manage_stack_url" {
  description = "Resource Manager: update (Edit → new zip → Apply) or remove (Destroy, then Delete) this stack"
  value       = "https://cloud.oracle.com/resourcemanager/stacks?region=${var.region}"
}

output "logs_url" {
  description = "Install and app logs in OCI Logging (Pay As You Go accounts only)"
  value       = var.enable_logs ? "https://cloud.oracle.com/logging/search?region=${var.region}" : "disabled"
}
