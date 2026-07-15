# Tier 2 — Team / scaled

**Cost: low $$/mo.** For a team instance with a real database, backups, and room
to scale past one machine. The jump from Tier 1 is one thing: a **managed
PostgreSQL** instead of a single-file SQLite. That unlocks multiple API replicas,
proper backups, and a database that survives a lost container.

## Recipes

| Recipe | Topology | Where it runs | Backend |
|---|---|---|---|
| [`azure-container-apps`](../../deploy/azure-container-apps/) (Postgres mode) | Self-hosted | Azure Container Apps + Postgres Flexible Server | managed PostgreSQL |
| [`kubernetes`](../../deploy/kubernetes/) | Self-hosted | Any cluster (AKS/EKS/GKE/k3s) + managed or in-cluster Postgres | PostgreSQL (or PVC SQLite) |

Both run the same `apps/server` container. The move to Tier 2 is set purely by
`DATABASE_URL` pointing at PostgreSQL ([ADR-015](../adr/ADR-015-postgres-storage-adapter.md)) —
no code or recipe fork.

## What Postgres unlocks

- **Multiple API replicas** behind a load balancer (SQLite is single-writer, so
  it pins one replica; Postgres removes that limit). Run the scheduler on exactly
  one replica with `ENABLE_SCHEDULER=false` on the rest, or drive it externally
  ([ADR-018](../adr/ADR-018-scheduler-drivers.md)).
- **Backups and point-in-time restore** from your managed database.
- **A database that outlives any single container** — no volume to lose.

## What you'll pay for

- **Compute** — ACA consumption, or your Kubernetes cluster.
- **A managed PostgreSQL** — e.g. an Azure Postgres Flexible Server (Burstable
  tier is inexpensive), RDS, or Cloud SQL.
- **Secrets** — Key Vault, a Kubernetes `Secret`, or an external-secrets operator.

## Next step up

Full HA — separated controller/worker processes, private networking, an HA
database topology, SSO/RBAC hardening, and observability — is [Tier 3](tier-3).
Tier 2 already gives you the multi-replica database foundation those build on.
