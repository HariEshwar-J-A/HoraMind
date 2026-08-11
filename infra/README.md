# Infrastructure

Three deployment shapes, same images, increasing capability.

| Stage | What runs it | When |
|---|---|---|
| Docker Compose | `infra/docker/` | Now — one box, no orchestrator |
| k3s | `infra/k8s/` | Same box, but with rolling deploys, health restarts and secret management |
| k3s on Hetzner | `infra/terraform/` | When the home machine stops being the right place |

Nothing here has been executed. Neither Docker, kubectl nor Terraform is
installed on the machine these files were written on, so treat the first run of
each as a first run: expect to fix something.

## Compose (now)

```bash
cp .env.example .env      # fill POSTGRES_PASSWORD and JWT_SECRET
docker compose -f infra/docker/docker-compose.yml --profile tunnel up -d
```

Run `./infra/scripts/tunnel-preflight.sh` first. This machine already runs a
tunnel for another application, and HoraMind gets its own — separate UUID,
separate credentials, separate config. The preflight only reports; it never
touches an existing tunnel.

## k3s

```bash
kubectl apply -k infra/k8s/overlays/home
```

The `home` overlay drops the HPA and the PodDisruptionBudget and switches the
API to a `Recreate` rollout. All three assume somewhere to reschedule to, which
a single node does not have — a PDB of `minAvailable: 1` at one replica blocks
a drain forever.

Secrets are never committed. `config.yaml` carries a template so the required
keys are documented; create the real one with `kubectl create secret`, or seal
it with SOPS if this ever goes through GitOps.

## Terraform

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in
terraform init && terraform plan
```

Two things are deliberate and worth not undoing:

- **`ssh_allowed_ips` has no default** and validation fails on an empty list.
  SSH is the only open port; pointing it at `0.0.0.0/0` hands it to the
  internet's background noise.
- **The data volume has `prevent_destroy`.** It exists so the server can be
  rebuilt without taking the database with it, which only holds if a
  `terraform destroy` cannot remove it.

Roughly €5.30/month for a cax11 with a 10 GB volume and snapshots.

## Backups

Two mechanisms answering different questions:

- **Hetzner snapshots** — "the server is gone." Whole-disk, daily.
- **`pg_dump` CronJob** — "someone dropped a table." Nightly, gzipped, kept 14
  days, and asserted non-empty, because a zero-byte backup is worse than none:
  it looks like one.

Neither is off-box. Before this holds anything that matters, ship the dumps
somewhere else.
