output "server_ipv4" {
  description = "Public IPv4. Used for SSH only — no HTTP port is open."
  value       = hcloud_server.node.ipv4_address
}

output "server_ipv6" {
  value = hcloud_server.node.ipv6_address
}

output "data_volume_device" {
  description = "Device path the data volume is mounted from."
  value       = hcloud_volume.data.linux_device
}

output "next_steps" {
  description = "What to run once the server is up."
  value       = <<-EOT

    Fetch the kubeconfig:
      ssh root@${hcloud_server.node.ipv4_address} cat /etc/rancher/k3s/k3s.yaml \
        | sed 's/127.0.0.1/${hcloud_server.node.ipv4_address}/' > ~/.kube/horamind.yaml

    Create the secrets (never commit these):
      kubectl create namespace horamind
      kubectl -n horamind create secret generic horamind-secrets \
        --from-literal=POSTGRES_USER=horamind \
        --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 32)" \
        --from-literal=POSTGRES_DB=horamind \
        --from-literal=JWT_SECRET="$(openssl rand -base64 48)"

    Create the tunnel secret from this app's OWN tunnel credentials:
      kubectl -n horamind create secret generic horamind-tunnel \
        --from-file=config.yml --from-file=creds.json

    Deploy:
      kubectl apply -k infra/k8s/overlays/home

    Note: the k3s API on 6443 is NOT open to the internet. Reach it over an SSH
    tunnel, or add your address to ssh_allowed_ips and forward the port.
  EOT
}

output "estimated_monthly_cost_eur" {
  description = "Rough, excluding traffic. Confirm against Hetzner's current pricing."
  value       = "server ~4.00 + volume ~0.50 + snapshots ~0.80 = ~5.30/month for cax11 + 10GB"
}
