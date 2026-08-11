variable "hcloud_token" {
  description = "Hetzner Cloud API token with read/write scope."
  type        = string
  sensitive   = true
}

variable "name" {
  description = "Prefix for every created resource."
  type        = string
  default     = "horamind"
}

variable "server_type" {
  description = <<-EOT
    Hetzner server type.

    CAX11 (2 shared ARM64 vCPU, 4 GB, ~EUR 4/mo) fits the whole stack: Postgres
    at 512 MB, Chroma at 1 GB, the API at 768 MB, and the edge at well under
    200 MB. CAX21 doubles it if the corpus grows or replicas are added.

    ARM is deliberate. The images are built multi-arch, and ARM instances are
    roughly 20% cheaper for the same memory.
  EOT
  type        = string
  default     = "cax11"
}

variable "location" {
  description = "Hetzner location. nbg1/fsn1/hel1 are EU; ash/hil are US."
  type        = string
  default     = "nbg1"
}

variable "data_volume_size" {
  description = "Data volume in GB. Minimum billable is 10."
  type        = number
  default     = 10

  validation {
    condition     = var.data_volume_size >= 10
    error_message = "Hetzner volumes start at 10 GB."
  }
}

variable "ssh_public_key" {
  description = "Public key for the admin user. Password auth is disabled."
  type        = string
}

variable "ssh_allowed_ips" {
  description = <<-EOT
    CIDRs permitted to reach SSH.

    Defaults to nothing on purpose. Leaving SSH open to 0.0.0.0/0 invites the
    background noise of the internet against the one port this host exposes,
    and an empty list fails loudly rather than defaulting to insecure.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.ssh_allowed_ips) > 0
    error_message = "Name at least one CIDR. Use your own address, not 0.0.0.0/0."
  }
}

variable "k3s_version" {
  description = "k3s channel or pinned version."
  type        = string
  default     = "v1.31"
}

variable "enable_snapshots" {
  description = <<-EOT
    Hetzner automated snapshots, billed at ~20% of server cost.

    Covers losing the server. It does not cover losing data to a bad migration
    or a mistaken delete — snapshots are whole-disk and daily, so the nightly
    pg_dump CronJob remains the tool for that.
  EOT
  type        = bool
  default     = true
}
