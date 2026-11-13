output "public_ip" {
  value = oci_core_instance.app.public_ip
}

output "instance_id" {
  value = oci_core_instance.app.id
}

output "availability_domain" {
  value = oci_core_instance.app.availability_domain
}

output "image" {
  value = data.oci_core_images.ubuntu.images[0].display_name
}

output "next_steps" {
  value = <<EOT
VM is booting; install takes ~5-8 minutes (log: /var/log/duniya-install.log).
Panel: https://<your tunnel hostname>  (Cloudflare Zero Trust > Tunnels > Public hostname -> http://localhost:8080)
No tunnel? ssh -L 8080:127.0.0.1:8080 ubuntu@${oci_core_instance.app.public_ip} then open http://localhost:8080
EOT
}
