/**
 * HoraMind — cloud infrastructure.
 *
 * Not needed today: the application runs on a home machine behind a Cloudflare
 * Tunnel, which costs nothing and works. This exists so that moving off that
 * box is an afternoon rather than a project, and so the shape of the target is
 * decided while there is no pressure.
 *
 * Hetzner Cloud, because the arithmetic is hard to argue with: a CAX11 is 2
 * shared ARM64 vCPU and 4 GB for roughly €4/month, which comfortably runs
 * Postgres, Chroma, the API and the edge. The equivalent on a hyperscaler is
 * five to ten times that for the same workload.
 *
 * Two properties worth noting:
 *
 *   - **No inbound ports.** The firewall permits SSH only, and even that is
 *     restricted to named addresses. Traffic arrives through the tunnel, which
 *     dials out. The server has no public HTTP surface to attack.
 *   - **Data on a separate volume.** Postgres and Chroma write to an attached
 *     volume, not the boot disk, so the server can be destroyed and rebuilt
 *     without touching the data.
 */

terraform {
  required_version = ">= 1.6"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }

  # Local state by default. Before anyone else touches this, move it to a
  # remote backend — concurrent applies against local state silently diverge.
  #
  # backend "s3" {
  #   bucket = "horamind-tfstate"
  #   key    = "prod/terraform.tfstate"
  # }
}

provider "hcloud" {
  token = var.hcloud_token
}

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

resource "hcloud_firewall" "horamind" {
  name = "${var.name}-fw"

  # SSH only, and only from addresses that were named deliberately. Everything
  # else reaches the application through the tunnel.
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_ips
  }

  # ICMP makes the host diagnosable. It exposes nothing.
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_ssh_key" "admin" {
  name       = "${var.name}-admin"
  public_key = var.ssh_public_key
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

resource "hcloud_volume" "data" {
  name     = "${var.name}-data"
  size     = var.data_volume_size
  location = var.location
  format   = "ext4"

  # The point of the separate volume is that it outlives the server. Removing
  # this line would let a `terraform destroy` take the database with it.
  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Compute
# ---------------------------------------------------------------------------

resource "hcloud_server" "node" {
  name        = var.name
  server_type = var.server_type
  image       = "ubuntu-24.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.admin.id]

  firewall_ids = [hcloud_firewall.horamind.id]

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    volume_device = hcloud_volume.data.linux_device
    k3s_version   = var.k3s_version
  })

  public_net {
    ipv4_enabled = true
    # IPv6 only would be cheaper still, but Cloudflare Tunnel and package
    # mirrors are both simpler over v4 and the saving is cents.
    ipv6_enabled = true
  }

  # Hetzner's automated snapshots, about 20% of server cost. This covers "the
  # server broke". It does not cover "someone dropped a table" — snapshots
  # restore the whole disk to a daily granularity, which is why the nightly
  # pg_dump CronJob exists alongside it. The two answer different questions.
  backups = var.enable_snapshots

  labels = {
    app = "horamind"
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.node.id
  automount = false # cloud-init mounts it, so the fstab entry survives a rebuild.
}

