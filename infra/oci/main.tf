locals {
  compartment = var.compartment_ocid != "" ? var.compartment_ocid : var.tenancy_ocid
  is_flex     = length(regexall("Flex$", var.shape)) > 0
  direct_web  = contains(["ip", "domain"], var.exposure)
  tags        = { app = var.name }

  # Shell-safe KEY='value' lines (single quotes escaped)
  bootstrap_env = join("\n", [for k, v in {
    REPO_URL        = var.repo_url
    BRANCH          = var.branch
    GIT_TOKEN       = var.git_token
    EXPOSURE        = var.exposure
    DOMAIN          = var.domain
    CF_TUNNEL_TOKEN = var.cf_tunnel_token
    ADMIN_PASSWORD  = var.admin_password
    UPDATE_MODE     = var.update_mode
  } : "${k}='${replace(v, "'", "'\\''")}'"])

  user_data = join("\n", [
    "#!/bin/bash",
    "install -d -m 700 /etc/duniya",
    "echo '${base64encode(local.bootstrap_env)}' | base64 -d > /etc/duniya/bootstrap.env",
    "chmod 600 /etc/duniya/bootstrap.env",
    "echo '${filebase64("${path.module}/bootstrap.sh")}' | base64 -d > /usr/local/sbin/duniya-bootstrap",
    "chmod 700 /usr/local/sbin/duniya-bootstrap",
    "/usr/local/sbin/duniya-bootstrap",
  ])
}

# ---------- placement: first availability domain that offers the shape ----------
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_shapes" "by_ad" {
  for_each            = toset([for ad in data.oci_identity_availability_domains.ads.availability_domains : ad.name])
  compartment_id      = local.compartment
  availability_domain = each.key
  filter {
    name   = "name"
    values = [var.shape]
  }
}

locals {
  ads_with_shape = [for ad, s in data.oci_core_shapes.by_ad : ad if length(s.shapes) > 0]
  ad             = length(local.ads_with_shape) > 0 ? local.ads_with_shape[0] : data.oci_identity_availability_domains.ads.availability_domains[0].name
}

data "oci_core_images" "ubuntu" {
  compartment_id           = local.compartment
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# ---------- network ----------
resource "oci_core_vcn" "main" {
  compartment_id = local.compartment
  display_name   = "${var.name}-vcn"
  cidr_blocks    = ["10.42.0.0/16"]
  dns_label      = "duniya"
  freeform_tags  = local.tags
}

resource "oci_core_internet_gateway" "igw" {
  compartment_id = local.compartment
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.name}-igw"
  freeform_tags  = local.tags
}

resource "oci_core_route_table" "public" {
  compartment_id = local.compartment
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.name}-rt"
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.igw.id
  }
  freeform_tags = local.tags
}

resource "oci_core_security_list" "main" {
  compartment_id = local.compartment
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.name}-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  ingress_security_rules {
    protocol = "1"
    source   = "0.0.0.0/0"
    icmp_options {
      type = 3
      code = 4
    }
  }

  # 80/443 only when the panel is served directly (exposure = ip or domain)
  dynamic "ingress_security_rules" {
    for_each = local.direct_web ? [80, 443] : []
    content {
      protocol = "6"
      source   = "0.0.0.0/0"
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }

  dynamic "ingress_security_rules" {
    for_each = var.ssh_ingress_cidr != "" ? [var.ssh_ingress_cidr] : []
    content {
      protocol = "6"
      source   = ingress_security_rules.value
      tcp_options {
        min = 22
        max = 22
      }
    }
  }
  freeform_tags = local.tags
}

resource "oci_core_subnet" "public" {
  compartment_id    = local.compartment
  vcn_id            = oci_core_vcn.main.id
  display_name      = "${var.name}-subnet"
  cidr_block        = "10.42.1.0/24"
  dns_label         = "app"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.main.id]
  freeform_tags     = local.tags
}

# ---------- the VM ----------
resource "oci_core_instance" "app" {
  compartment_id      = local.compartment
  availability_domain = local.ad
  display_name        = var.name
  shape               = var.shape

  dynamic "shape_config" {
    for_each = local.is_flex ? [1] : []
    content {
      ocpus         = var.a1_ocpus
      memory_in_gbs = var.a1_memory_gb
    }
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "duniya"
  }

  metadata = merge(
    { user_data = base64encode(local.user_data) },
    var.ssh_public_key != "" ? { ssh_authorized_keys = var.ssh_public_key } : {}
  )

  freeform_tags = local.tags

  lifecycle {
    # Code updates happen in place (panel/installer); don't rebuild the VM for new images or changed bootstrap values.
    ignore_changes = [source_details[0].source_id, metadata["user_data"], availability_domain]
  }
}
