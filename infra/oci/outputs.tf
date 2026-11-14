output "public_ip" {
  value = oci_core_instance.app.public_ip
}

output "panel_url" {
  value = (var.exposure == "ip" ? "https://${replace(oci_core_instance.app.public_ip, ".", "-")}.sslip.io"
    : var.exposure == "domain" ? "https://${var.domain} (point its DNS A record to ${oci_core_instance.app.public_ip})"
    : var.exposure == "tunnel" ? "Your Cloudflare Tunnel hostname (public hostname → http://localhost:8080)"
  : "ssh -L 8080:127.0.0.1:8080 ubuntu@${oci_core_instance.app.public_ip} → http://localhost:8080")
}

output "next_steps" {
  value = <<EOT
The VM installs itself in about 5-10 minutes (log on the VM: /var/log/duniya-install.log).
Open the panel URL. Without an admin password, the one-time setup code is in the install log:
  sudo grep -A1 'Setup code' /var/log/duniya-install.log   (or OCI console → instance → Console connection)
EOT
}

output "instance_id" {
  value = oci_core_instance.app.id
}

output "manage_stack_url" {
  description = "Open Resource Manager to update (Edit → new zip → Apply) or remove (Destroy, then Delete) this stack"
  value       = "https://cloud.oracle.com/resourcemanager/stacks?region=${var.region}"
}
