# Optional: see what the VM is doing from the OCI console, no SSH needed.
# Observability & Management → Logging → Log groups → <name>-logs → <name>
# Ships: first-boot install log, cloud-init output, and the app / web server log.

# Identity resources (dynamic group, policy) must be created in the tenancy's home region.
data "oci_identity_tenancy" "this" {
  tenancy_id = var.tenancy_ocid
}

data "oci_identity_regions" "all" {}

locals {
  home_region = one([for r in data.oci_identity_regions.all.regions : r.name if r.key == data.oci_identity_tenancy.this.home_region_key])
  log_suffix  = substr(md5(local.compartment), 0, 6)
}

provider "oci" {
  alias  = "home"
  region = local.home_region
}

resource "oci_identity_dynamic_group" "vm" {
  count          = var.enable_logs ? 1 : 0
  provider       = oci.home
  compartment_id = var.tenancy_ocid
  name           = "${var.name}-vm-${local.log_suffix}"
  description    = "The ${var.name} VM (lets its Oracle Cloud Agent write logs)"
  matching_rule  = "ALL {instance.id = '${oci_core_instance.app.id}'}"
}

resource "oci_identity_policy" "vm_logs" {
  count          = var.enable_logs ? 1 : 0
  provider       = oci.home
  compartment_id = local.compartment
  name           = "${var.name}-logs-${local.log_suffix}"
  description    = "Allow the ${var.name} VM to push logs"
  statements     = ["Allow dynamic-group ${oci_identity_dynamic_group.vm[0].name} to use log-content in compartment id ${local.compartment}"]
}

resource "oci_logging_log_group" "main" {
  count          = var.enable_logs ? 1 : 0
  compartment_id = local.compartment
  display_name   = "${var.name}-logs"
  description    = "Logs from the ${var.name} VM"
  freeform_tags  = local.tags
}

resource "oci_logging_log" "vm" {
  count              = var.enable_logs ? 1 : 0
  display_name       = var.name
  log_group_id       = oci_logging_log_group.main[0].id
  log_type           = "CUSTOM"
  is_enabled         = true
  retention_duration = 30
  freeform_tags      = local.tags
}

resource "oci_logging_unified_agent_configuration" "vm" {
  count          = var.enable_logs ? 1 : 0
  compartment_id = local.compartment
  display_name   = "${var.name}-agent"
  description    = "Tail the install and app logs on the ${var.name} VM"
  is_enabled     = true

  service_configuration {
    configuration_type = "LOGGING"
    destination {
      log_object_id = oci_logging_log.vm[0].id
    }
    sources {
      source_type = "LOG_TAIL"
      name        = "duniya"
      paths       = ["/var/log/duniya-install.log", "/var/log/cloud-init-output.log", "/var/log/whatsapp-agent-duniya.log"]
      parser {
        parser_type = "NONE"
      }
    }
  }

  group_association {
    group_list = [oci_identity_dynamic_group.vm[0].id]
  }

  depends_on = [oci_identity_policy.vm_logs]
}
